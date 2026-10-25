// Refs CloudForge writes under refs/pull/N/ for its own bookkeeping only grow: each rebase keeps the head it replaced
// (`pre-rebase/<sha7>`), each landing writes a receipt (`landings/<intent id>`). Every one makes each ref
// advertisement longer, and keeps old objects alive in a repository's storage. Once its pull request has been closed
// for a while nothing reads them (a receipt only matters while its landing is unfinished), so the daily retention
// deletes them. `refs/pull/N/head` stays: a closed pull request still shows its commits.
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { landingIntents, pullRequests, repositories } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { ZERO_SHA } from '../git/remote';
import { gitFor } from './repos';

/** Days a pull request stays closed before its bookkeeping refs go. */
export const PULL_REF_RETENTION_DAYS = 30;
/** Days after that a repository is still looked at, so a missed daily run is made up for. */
const CATCH_UP_DAYS = 7;
/** Repositories pruned per run, and refs deleted per push. */
const MAX_REPOS = 50;
const REFS_PER_PUSH = 200;

const BOOKKEEPING = /^refs\/pull\/(\d+)\/(pre-rebase|landings)\/(.+)$/;

/** Deletes the bookkeeping refs of pull requests closed or merged long enough ago. Returns the refs deleted. */
export async function prunePullRefs(
  env: CloudflareBindings,
  db: DrizzleDB,
  now = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - PULL_REF_RETENTION_DAYS * 86_400_000);
  const from = new Date(cutoff.getTime() - CATCH_UP_DAYS * 86_400_000);
  const endedAt = sql`coalesce(${pullRequests.mergedAt}, ${pullRequests.closedAt})`;
  const due = await db
    .selectDistinct({ repo: repositories })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      and(
        ne(pullRequests.state, 'open'),
        sql`${endedAt} >= ${Math.floor(from.getTime() / 1000)}`,
        sql`${endedAt} < ${Math.floor(cutoff.getTime() / 1000)}`
      )
    )
    .limit(MAX_REPOS)
    .all();
  let deleted = 0;
  for (const { repo } of due) {
    try {
      deleted += await pruneRepository(env, db, repo, cutoff);
    } catch (e) {
      console.error('[refs] could not prune pull refs', repo.id, e);
    }
  }
  return deleted;
}

async function pruneRepository(
  env: CloudflareBindings,
  db: DrizzleDB,
  repo: typeof repositories.$inferSelect,
  cutoff: Date
): Promise<number> {
  const git = gitFor(env, repo);
  const { refs } = await git.client.listRefs();
  const candidates = [...refs].filter(([ref]) => BOOKKEEPING.test(ref));
  if (!candidates.length) return 0;
  const numbers = [
    ...new Set(candidates.map(([ref]) => Number(BOOKKEEPING.exec(ref)![1]))),
  ];
  const ended = new Set<number>();
  for (let i = 0; i < numbers.length; i += 90) {
    const rows = await db
      .select({ number: pullRequests.number })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryId, repo.id),
          inArray(pullRequests.number, numbers.slice(i, i + 90)),
          ne(pullRequests.state, 'open'),
          sql`coalesce(${pullRequests.mergedAt}, ${pullRequests.closedAt}) < ${Math.floor(cutoff.getTime() / 1000)}`
        )
      )
      .all();
    for (const r of rows) ended.add(r.number);
  }
  // A receipt of a landing not yet finished is what recovery reads: never delete it.
  const unfinished = new Set(
    (
      await db
        .select({ id: landingIntents.id })
        .from(landingIntents)
        .where(
          and(
            eq(landingIntents.repositoryId, repo.id),
            isNull(landingIntents.finishedAt)
          )
        )
        .all()
    ).map((r) => r.id)
  );
  const doomed = candidates.filter(([ref]) => {
    const [, n, kind, rest] = BOOKKEEPING.exec(ref)!;
    if (!ended.has(Number(n))) return false;
    return !(kind === 'landings' && unfinished.has(rest));
  });
  let deleted = 0;
  for (let i = 0; i < doomed.length; i += REFS_PER_PUSH) {
    const chunk = doomed.slice(i, i + REFS_PER_PUSH);
    // Compare-and-swap on what was listed: a ref written again meanwhile stays.
    await git.client.push(
      chunk.map(([ref, sha]) => ({ ref, old: sha, new: ZERO_SHA })),
      []
    );
    deleted += chunk.length;
  }
  return deleted;
}
