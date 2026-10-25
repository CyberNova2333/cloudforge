// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  landingIntents,
  pullRequests,
  type LandingIntent,
  type PullRequest,
  type Repository,
} from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import type { GitService } from '../git/service';
import { findRepoById, gitFor } from '../lib/repos';
import { publishChange } from '../live/publish';
import { settleStates } from '../pulls/settle';
import { queueLessons } from '../learn/lessons';
import { refreshAgentConfig } from '../agents/refresh';
import { onRefsUpdated } from '../actions/trigger';
import { unwindLanding } from '../stack/landing';
import { startSweep } from './auto';
import { deleteMergedBranch } from './land';
import { d1Of } from '../pulls/events';
import { closeLinkedIssues } from '../lib/issue-links';

export const landingReceipt = (pr: number, id: string) =>
  `refs/pull/${pr}/landings/${id}`;

/**
 * Where an attempt stands, from one ref snapshot. `pushed`: its receipt exists and the target contains its exact
 * result. `stale`: the target has moved off the attempt's base without its result, so the attempt's compare-and-swap
 * can never succeed (short of the target being reset to that base). `pending`: neither yet.
 */
export async function landingStatus(
  git: GitService,
  pr: PullRequest,
  intent: LandingIntent
): Promise<'pushed' | 'stale' | 'pending'> {
  const { refs } = await git.client.listRefs();
  const target = refs.get(`refs/heads/${intent.target}`);
  const contains =
    !!target &&
    (target === intent.landHeadSha ||
      (await git.mergeBase(target, intent.landHeadSha)) === intent.landHeadSha);
  if (
    contains &&
    refs.get(landingReceipt(pr.number, intent.id)) === intent.landHeadSha
  )
    return 'pushed';
  return !contains && target !== intent.baseSha ? 'stale' : 'pending';
}

/** Closes an attempt that never landed and never can: later merges and the daily recovery stop re-checking it. */
export async function closeStaleLanding(db: DrizzleDB, id: string) {
  await db
    .update(landingIntents)
    .set({ finishedAt: new Date() })
    .where(and(eq(landingIntents.id, id), isNull(landingIntents.recordedAt)));
}

/** Git is already committed. PR state, repository time, audit entry and recovery checkpoint commit together. */
export async function recordLanding(
  db: DrizzleDB,
  pr: PullRequest,
  intent: LandingIntent
): Promise<boolean> {
  const d1 = d1Of(db);
  const auditTime = Date.now();
  const now = Math.floor(auditTime / 1000);
  // Recovery may follow a long outage; preserve the first recording time, not the time a retry happens to run.
  const recordedAt = `(SELECT recorded_at FROM landing_intents WHERE id = ?)`;
  const recorded = `EXISTS (SELECT 1 FROM landing_intents WHERE id = ? AND recorded_at IS NOT NULL)`;
  const [claim] = await d1.batch([
    // Only one attempt owns a PR's merge and follow-ups, even when two requests pushed the same commit.
    d1
      .prepare(
        `UPDATE landing_intents SET recorded_at = COALESCE(recorded_at, ?) WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM landing_intents AS other WHERE other.pull_request_id = ? AND other.id <> ? AND other.recorded_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM pull_requests WHERE id = ? AND (state <> 'merged' OR merge_commit_sha = ?))`
      )
      .bind(now, intent.id, pr.id, intent.id, pr.id, intent.landHeadSha),
    d1
      .prepare(
        `UPDATE pull_requests SET state_revision = state_revision + CASE WHEN state <> 'merged' THEN 1 ELSE 0 END,
      state = 'merged', merge_commit_sha = ?, landed_commits = ?,
      merged_by_id = ?, merged_automatically = ?, merged_at = ${recordedAt}, closed_at = ${recordedAt},
      updated_at = MAX(updated_at, ${recordedAt}), land_target = ?
      WHERE id = ? AND ${recorded}`
      )
      .bind(
        intent.landHeadSha,
        intent.landedCommits,
        intent.actorId,
        intent.automatic ? 1 : 0,
        intent.id,
        intent.id,
        intent.id,
        intent.target,
        pr.id,
        intent.id
      ),
    d1
      .prepare(
        `INSERT INTO audit_events (id, repository_id, actor_id, actor_kind, action, target, data, created_at)
      SELECT ?, ?, ?, ?, 'pull.merged', ?, ?, ? WHERE ${recorded} ON CONFLICT (id) DO NOTHING`
      )
      .bind(
        `landing:${intent.id}`,
        pr.repositoryId,
        intent.actorId,
        intent.automatic ? 'system' : 'person',
        `#${pr.number}`,
        JSON.stringify({
          pull: pr.number,
          title: pr.title,
          sha: intent.landHeadSha,
          into: intent.target,
          automatic: intent.automatic,
        }),
        auditTime,
        intent.id
      ),
    d1
      .prepare(
        `UPDATE repositories SET updated_at = MAX(updated_at, ${recordedAt}) WHERE id = ? AND ${recorded}`
      )
      .bind(intent.id, pr.repositoryId, intent.id),
  ]);
  return (claim.meta.changes ?? 0) > 0;
}

/** Retry only this landing's follow-up work. Each durable effect is idempotent, then checkpointed separately. */
export async function finishLanding(
  env: CloudflareBindings,
  db: DrizzleDB,
  repo: Repository,
  repoFullName: string,
  pr: PullRequest,
  intent: LandingIntent
): Promise<void> {
  const updates = [
    {
      ref: `refs/heads/${intent.target}`,
      old: intent.baseSha,
      new: intent.landHeadSha,
    },
  ];
  const eventId = `landing:${intent.id}`;
  const tasks: [string, () => Promise<unknown>][] = [
    [
      'actions',
      () =>
        onRefsUpdated(
          env,
          db,
          repo,
          repoFullName,
          updates,
          intent.actorId ?? pr.authorId,
          eventId
        ),
    ],
    ['stack', () => unwindLanding(env, db, pr, intent)],
    ['lessons', () => queueLessons(env, db, pr, true)],
    [
      'sweep',
      () =>
        startSweep(
          env,
          repo,
          [
            ...updates,
            {
              ref: `refs/heads/${pr.headRef}`,
              old: intent.landHeadSha,
              new: intent.landHeadSha,
            },
          ],
          `landing-${intent.id}`
        ),
    ],
    [
      'config',
      () =>
        intent.target === repo.defaultBranch
          ? refreshAgentConfig(env, db, repo.id, true)
          : Promise.resolve(),
    ],
    // A closing keyword (`Fixes #12`) closes its issue once the change is on the default branch.
    [
      'issues',
      () =>
        intent.target === repo.defaultBranch
          ? closeLinkedIssues(db, pr, intent.actorId)
          : Promise.resolve(),
    ],
    ['states', () => settleStates(env, db, repo.id)],
  ];
  let failed = false;
  for (const [key, run] of tasks) {
    const current = await db
      .select()
      .from(landingIntents)
      .where(eq(landingIntents.id, intent.id))
      .get();
    if (!current || current.completed[key]) continue;
    try {
      await run();
      await db
        .update(landingIntents)
        .set({
          completed: sql`json_set(${landingIntents.completed}, ${`$.${key}`}, 1)`,
        })
        .where(eq(landingIntents.id, intent.id));
    } catch (error) {
      failed = true;
      console.error(
        '[merge] landing follow-up will retry',
        intent.id,
        key,
        error
      );
    }
  }
  // Only after children are detached. A deletion is CAS-protected and harmless to repeat after lost progress.
  const current = await db
    .select()
    .from(landingIntents)
    .where(eq(landingIntents.id, intent.id))
    .get();
  if (current?.completed.stack && !current.completed.branch) {
    try {
      if (repo.deleteMergedBranches)
        await deleteMergedBranch({
          env,
          db,
          repo,
          git: gitFor(env, repo),
          pr,
          headSha: intent.landHeadSha,
          strict: true,
        });
      await db
        .update(landingIntents)
        .set({
          completed: sql`json_set(${landingIntents.completed}, '$.branch', 1)`,
        })
        .where(eq(landingIntents.id, intent.id));
    } catch (error) {
      failed = true;
      console.error(
        '[merge] landed branch cleanup will retry',
        intent.id,
        error
      );
    }
  }
  if (!failed)
    await db
      .update(landingIntents)
      .set({ finishedAt: new Date() })
      .where(eq(landingIntents.id, intent.id));
  await publishChange(env, repo.id, { approvals: true });
}

/** Scheduled backstop for request termination, a lost push response or a D1 outage after Git committed. */
export async function recoverLandings(
  env: CloudflareBindings,
  db: DrizzleDB,
  limit = 50
): Promise<void> {
  const pending = await db
    .select()
    .from(landingIntents)
    .where(isNull(landingIntents.finishedAt))
    .orderBy(asc(landingIntents.attemptedAt), asc(landingIntents.createdAt))
    .limit(limit)
    .all();
  for (const intent of pending) {
    try {
      await db
        .update(landingIntents)
        .set({ attemptedAt: new Date() })
        .where(eq(landingIntents.id, intent.id));
      const pr = await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, intent.pullRequestId))
        .get();
      const found = await findRepoById(db, intent.repositoryId);
      if (!pr || !found) continue;
      if (pr.state === 'merged' && !intent.recordedAt) {
        // Another attempt already owns this merge. Its atomic checkpoint and tail are the authoritative ones.
        await db
          .update(landingIntents)
          .set({ finishedAt: new Date() })
          .where(eq(landingIntents.id, intent.id));
        continue;
      }
      if (!intent.recordedAt) {
        const status = await landingStatus(gitFor(env, found.repo), pr, intent);
        if (status === 'stale') await closeStaleLanding(db, intent.id);
        if (status !== 'pushed') continue;
        if (!(await recordLanding(db, pr, intent))) {
          await db
            .update(landingIntents)
            .set({ finishedAt: new Date() })
            .where(eq(landingIntents.id, intent.id));
          continue;
        }
      }
      await finishLanding(
        env,
        db,
        found.repo,
        `${found.namespace.username}/${found.repo.name}`,
        pr,
        intent
      );
    } catch (error) {
      console.error('[merge] landing recovery failed', intent.id, error);
    }
  }
}
