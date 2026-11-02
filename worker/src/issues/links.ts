// The issues a pull request names in its title and description (docs/issues.md): `Fixes #12` closes #12 when the pull
// request lands on the default branch; any other `#12` only mentions it. Recorded in `issue_links` whenever the title
// or description is written, so landing and the pages read the table, never the text.
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  issueEvents,
  issueLinks,
  issues,
  pullRequests,
  type PullRequest,
} from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { closeIssue } from './service';
import { withoutCode } from '../shared/markdown-text';
import type { NotifyCtx } from '../notifications/service';

/** References read from one pull request; more are ignored. */
const MAX_REFS = 50;

const KEYWORD = /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)$/i;

/**
 * The issue numbers `text` names, in order, each once: `closes` when a closing keyword (close, closes, closed, fix,
 * fixes, fixed, resolve, resolves, resolved; any case, an optional colon) comes right before it. A `#N` inside a word,
 * a URL or an HTML entity (`&#12;`) is not a reference.
 */
export function issueRefs(text: string): { number: number; closes: boolean }[] {
  const found = new Map<number, boolean>();
  const re = /(?:^|[^\w&#/])(?:(\w+):?\s+)?#(\d{1,9})(?![\w-])/g;
  const plain = withoutCode(text);
  for (const m of plain.matchAll(re)) {
    const n = Number(m[2]);
    if (!n) continue;
    const closes = !!m[1] && KEYWORD.test(m[1]);
    found.set(n, (found.get(n) ?? false) || closes);
    if (found.size >= MAX_REFS) break;
  }
  return [...found].map(([number, closes]) => ({ number, closes }));
}

/**
 * Records the issues `pr`'s title and description name, replacing what it named before. An issue it names for the
 * first time gets a `referenced` event.
 */
export async function linkPullToIssues(
  db: DrizzleDB,
  pr: Pick<PullRequest, 'id' | 'repositoryId' | 'number' | 'title' | 'body'>,
  actorId: string | null
): Promise<void> {
  const refs = issueRefs(`${pr.title}\n${pr.body}`);
  const named = refs.length
    ? await db
        .select({ id: issues.id, number: issues.number })
        .from(issues)
        .where(
          and(
            eq(issues.repositoryId, pr.repositoryId),
            inArray(
              issues.number,
              refs.map((r) => r.number)
            )
          )
        )
        .all()
    : [];
  const before = await db
    .select({ issueId: issueLinks.issueId, closes: issueLinks.closes })
    .from(issueLinks)
    .where(eq(issueLinks.pullRequestId, pr.id))
    .all();
  const closesByNumber = new Map(refs.map((r) => [r.number, r.closes]));
  const next = named.map((i) => ({
    issueId: i.id,
    closes: closesByNumber.get(i.number) ?? false,
  }));
  const had = new Map(before.map((l) => [l.issueId, l.closes]));
  if (
    next.length === before.length &&
    next.every((l) => had.get(l.issueId) === l.closes)
  )
    return;
  const now = new Date();
  const fresh = next.filter((l) => !had.has(l.issueId));
  await db.batch([
    db.delete(issueLinks).where(eq(issueLinks.pullRequestId, pr.id)),
    ...(next.length
      ? [
          db
            .insert(issueLinks)
            .values(next.map((l) => ({ pullRequestId: pr.id, ...l }))),
        ]
      : []),
    ...(fresh.length
      ? [
          db.insert(issueEvents).values(
            fresh.map((l) => ({
              id: crypto.randomUUID(),
              issueId: l.issueId,
              kind: 'referenced' as const,
              data: { pull: pr.number, closes: l.closes },
              actorId,
              createdAt: now,
            }))
          ),
        ]
      : []),
  ]);
}

/**
 * Closes the open issues `pr` closes (its closing keywords) as completed by it. Safe to run again: only issues still
 * open change. Returns the issues it closed.
 */
export async function closeLinkedIssues(
  db: DrizzleDB,
  pr: Pick<PullRequest, 'id' | 'number'>,
  actorId: string | null,
  notifyCtx?: NotifyCtx
): Promise<number> {
  const open = await db
    .select({ id: issues.id, repositoryId: issues.repositoryId })
    .from(issueLinks)
    .innerJoin(issues, eq(issues.id, issueLinks.issueId))
    .where(
      and(
        eq(issueLinks.pullRequestId, pr.id),
        eq(issueLinks.closes, true),
        eq(issues.state, 'open')
      )
    )
    .all();
  let closed = 0;
  for (const issue of open)
    if (
      await closeIssue(db, issue, {
        actorId,
        reason: 'completed',
        pull: { id: pr.id, number: pr.number },
        notify: notifyCtx,
      })
    )
      closed++;
  return closed;
}

/** The pull requests that name each issue, with whether they close it. */
export async function pullsNaming(db: DrizzleDB, issueId: string) {
  return db
    .select({
      number: pullRequests.number,
      title: pullRequests.title,
      state: pullRequests.state,
      closes: issueLinks.closes,
    })
    .from(issueLinks)
    .innerJoin(pullRequests, eq(pullRequests.id, issueLinks.pullRequestId))
    .where(eq(issueLinks.issueId, issueId))
    .orderBy(sql`${pullRequests.number} DESC`)
    .all();
}

/** The issues a pull request names, with whether it closes them. */
export async function issuesNamedBy(db: DrizzleDB, pullRequestId: string) {
  return db
    .select({
      number: issues.number,
      title: issues.title,
      state: issues.state,
      closes: issueLinks.closes,
    })
    .from(issueLinks)
    .innerJoin(issues, eq(issues.id, issueLinks.issueId))
    .where(eq(issueLinks.pullRequestId, pullRequestId))
    .orderBy(issues.number)
    .all();
}
