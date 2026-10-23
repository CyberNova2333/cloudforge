import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  pullCloseIntents,
  pullRequests,
  type PullCloseIntent,
  type PullRequest,
} from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { landTargetOf } from '../lib/land-target';
import { findRepoById } from '../lib/repos';
import { publishChange } from '../live/publish';
import { queueLessons } from '../learn/lessons';
import { startSweep } from '../merge/auto';
import { startLandingWorkflow } from '../merge/followups';
import { resolutionConfigured } from '../merge/resolution';
import { d1Of } from './events';
import { settleStates } from './settle';

/** The close and its outbox commit together. The revision also fences close/reopen/close ABA races. */
export async function updatePullWithCloseIntent(
  db: DrizzleDB,
  pr: PullRequest,
  patch: Partial<PullRequest>
): Promise<{ changed: boolean; closeId?: string }> {
  const update = db
    .update(pullRequests)
    .set({
      ...patch,
      ...(patch.state !== undefined && patch.state !== pr.state
        ? { stateRevision: sql`${pullRequests.stateRevision} + 1` }
        : {}),
    })
    .where(
      and(
        eq(pullRequests.id, pr.id),
        eq(pullRequests.state, pr.state),
        eq(pullRequests.stateRevision, pr.stateRevision),
        eq(pullRequests.headRef, pr.headRef),
        eq(pullRequests.baseRef, pr.baseRef),
        sql`${pullRequests.landTarget} IS ${pr.landTarget}`
      )
    )
    .returning({ id: pullRequests.id });
  if (patch.state === 'closed') {
    const closeId = crypto.randomUUID();
    const now = Date.now();
    const [changed] = await db.batch([
      update,
      db
        .insert(pullCloseIntents)
        .select(
          sql`SELECT ${closeId}, ${pr.id}, ${pr.repositoryId},
        ${pr.headRef}, ${landTargetOf(pr)}, ${now}, NULL, NULL, '{}'
        WHERE changes() > 0`
        )
        .onConflictDoUpdate({
          target: pullCloseIntents.pullRequestId,
          set: {
            id: closeId,
            headRef: pr.headRef,
            target: landTargetOf(pr),
            createdAt: new Date(now),
            attemptedAt: null,
            finishedAt: null,
            completed: {},
          },
        }),
    ]);
    return {
      changed: changed.length > 0,
      ...(changed.length ? { closeId } : {}),
    };
  }
  if (patch.state === 'open') {
    const [changed] = await db.batch([
      update,
      db
        .delete(pullCloseIntents)
        .where(
          and(eq(pullCloseIntents.pullRequestId, pr.id), sql`changes() > 0`)
        ),
    ]);
    return { changed: changed.length > 0 };
  }
  return { changed: (await update).length > 0 };
}

/** All child moves, timeline entries, ordering edges and the replay fence share one transaction. */
async function unwindClosedPull(
  db: DrizzleDB,
  pr: PullRequest,
  intent: PullCloseIntent
) {
  const d1 = d1Of(db);
  const now = Date.now();
  const once = `EXISTS (SELECT 1 FROM pull_close_intents ci JOIN pull_requests p ON p.id = ci.pull_request_id
    WHERE ci.id = ? AND p.state = 'closed' AND COALESCE(json_extract(ci.completed, '$.unwind'), 0) = 0)`;
  const children = `repository_id = ? AND state = 'open' AND base_ref = ? AND COALESCE(land_target, base_ref) = ?`;
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO pr_events (id, repository_id, pull_request_id, kind, state, data, actor_id, computed_at, created_at)
      SELECT ? || ':' || id, repository_id, id, 'unstacked', NULL, ?, NULL, ?, ? FROM pull_requests
      WHERE ${children} AND ${once} ON CONFLICT (id) DO NOTHING`
      )
      .bind(
        `unstacked:${intent.id}`,
        JSON.stringify({
          pr: pr.number,
          why: `#${pr.number} was closed without landing.`,
        }),
        now,
        now,
        intent.repositoryId,
        intent.headRef,
        intent.target,
        intent.id
      ),
    d1
      .prepare(
        `UPDATE pull_requests SET base_ref = ?, land_target = ?, updated_at = MAX(updated_at, ?)
      WHERE ${children} AND ${once}`
      )
      .bind(
        intent.target,
        intent.target,
        Math.floor(now / 1000),
        intent.repositoryId,
        intent.headRef,
        intent.target,
        intent.id
      ),
    d1
      .prepare(
        `DELETE FROM pr_edges WHERE slot = 'order' AND (pr_a_id = ? OR pr_b_id = ? OR for_pr_id = ?) AND ${once}`
      )
      .bind(pr.id, pr.id, pr.id, intent.id),
    d1
      .prepare(
        `UPDATE pull_close_intents SET completed = json_set(completed, '$.unwind', 1) WHERE id = ? AND ${once}`
      )
      .bind(intent.id, intent.id),
  ]);
}

/** Only failed follow-ups are retried; workflow dispatches have a stable per-close identity. */
export async function finishPullClose(
  env: CloudflareBindings,
  db: DrizzleDB,
  id: string
): Promise<void> {
  try {
    const intent = await db
      .select()
      .from(pullCloseIntents)
      .where(eq(pullCloseIntents.id, id))
      .get();
    if (!intent || intent.finishedAt) return;
    await db
      .update(pullCloseIntents)
      .set({ attemptedAt: new Date() })
      .where(eq(pullCloseIntents.id, id));
    const pr = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, intent.pullRequestId))
      .get();
    if (!pr || pr.state !== 'closed') {
      await db.delete(pullCloseIntents).where(eq(pullCloseIntents.id, id));
      return;
    }
    const found = await findRepoById(db, intent.repositoryId);
    if (!found) return;
    const tasks: [string, () => Promise<unknown>][] = [
      ['unwind', () => unwindClosedPull(db, pr, intent)],
      [
        'sweep',
        () =>
          startSweep(
            env,
            found.repo,
            [intent.target, intent.headRef].map((branch) => ({
              ref: `refs/heads/${branch}`,
              old: '',
              new: '',
            })),
            `close-${id}`
          ),
      ],
      [
        'reconcile',
        () =>
          resolutionConfigured(env)
            ? startLandingWorkflow(env, `reconcile-close-${id}`, {
                reconcile: {
                  repositoryId: intent.repositoryId,
                  landTarget: intent.target,
                },
              })
            : Promise.resolve(),
      ],
      ['lessons', () => queueLessons(env, db, pr, true)],
      ['states', () => settleStates(env, db, intent.repositoryId)],
    ];
    for (const [key, run] of tasks) {
      const current = await db
        .select()
        .from(pullCloseIntents)
        .where(eq(pullCloseIntents.id, id))
        .get();
      if (!current || current.finishedAt) return;
      if (current.completed[key]) continue;
      await run();
      if (key === 'unwind') {
        const saved = await db
          .select()
          .from(pullCloseIntents)
          .where(eq(pullCloseIntents.id, id))
          .get();
        if (!saved?.completed.unwind) return;
      }
      // Unwind sets its own checkpoint atomically, fenced against reopen and a new close generation.
      if (key !== 'unwind')
        await db
          .update(pullCloseIntents)
          .set({
            completed: sql`json_set(${pullCloseIntents.completed}, ${`$.${key}`}, 1)`,
          })
          .where(eq(pullCloseIntents.id, id));
    }
    await db
      .update(pullCloseIntents)
      .set({ finishedAt: new Date() })
      .where(eq(pullCloseIntents.id, id));
    await publishChange(env, intent.repositoryId, { approvals: true });
  } catch (error) {
    console.error('[pulls] close follow-up will retry', id, error);
  }
}

/** Daily bounded recovery, rotated by last attempt so a failing entry cannot starve the rest. */
export async function recoverPullCloses(
  env: CloudflareBindings,
  db: DrizzleDB,
  limit = 50
) {
  const pending = await db
    .select({ id: pullCloseIntents.id })
    .from(pullCloseIntents)
    .where(isNull(pullCloseIntents.finishedAt))
    .orderBy(
      asc(pullCloseIntents.attemptedAt),
      asc(pullCloseIntents.createdAt),
      asc(pullCloseIntents.id)
    )
    .limit(limit)
    .all();
  for (const intent of pending) await finishPullClose(env, db, intent.id);
}
