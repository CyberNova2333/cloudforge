// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Deleting a repository. Its D1 row goes in one batch with a `repository_deletions` row; its storage (the Artifacts
// repo, LFS bytes in R2, Actions logs, caches and artifacts) is then removed step by step, each step recorded once
// done, so a step that fails is run again by the daily retention instead of leaving the bytes behind for good.
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { deleteRepositoryLogs } from '../actions/trigger';
import { stopAbandonedRun } from '../actions/abandon';
import { actionsQueue, dropRun, queueConfigured } from '../actions/queue';
import {
  repositoryDeletions,
  workflowRuns,
  type Repository,
} from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { recordAudit } from '../audit/service';
import { deleteRepositoryObjects } from '../lfs/storage';

/** Attempts at a deletion's cleanup before it is left alone (each failure is logged). */
export const MAX_DELETION_ATTEMPTS = 10;
/** Finished deletions are kept this long, then forgotten. */
const KEEP_MS = 30 * 86_400_000;

type Step = (env: CloudflareBindings, row: Deletion) => Promise<void>;
type Deletion = typeof repositoryDeletions.$inferSelect;

/** The cleanup, in order; each is safe to run again. */
const STEPS: [string, Step][] = [
  [
    'artifacts',
    async (env, row) => {
      try {
        await env.ARTIFACTS.delete(row.artifactsName);
      } catch (e) {
        // Already gone: the step is done.
        if (!/not.?found/i.test(String(e))) throw e;
      }
    },
  ],
  // LFS rows went with the repository; their R2 bytes have to go explicitly.
  ['lfs', (env, row) => deleteRepositoryObjects(env, row.id)],
  ['actions', (env, row) => deleteRepositoryLogs(env, row.id)],
];

/**
 * Deletes `repo`: stops its Actions runs that are still going, deletes its row (everything in D1 cascades) together
 * with a deletion record, audits it, then cleans its storage up (finishRepositoryDeletion).
 */
export async function deleteRepository(
  env: CloudflareBindings,
  db: DrizzleDB,
  repo: Repository,
  actorId: string,
  fullName: string
) {
  // A fenced run can still hold containers. Keep its jobs and capacity until stop is confirmed.
  const active = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.repositoryId, repo.id),
        or(
          ne(workflowRuns.status, 'completed'),
          sql`EXISTS (SELECT 1 FROM workflow_jobs j WHERE j.run_id=workflow_runs.id AND j.status='in_progress')`
        )
      )
    )
    .orderBy(workflowRuns.id)
    .limit(21)
    .all();
  let stopped = active.length <= 20;
  for (const run of active.slice(0, 20)) {
    if (!(await stopAbandonedRun(env, db, run.id, 'cancelled'))) {
      stopped = false;
      break;
    }
    await dropRun(env, run.id);
  }
  if (!stopped) {
    if (queueConfigured(env)) {
      try {
        await actionsQueue(env).reclaim();
      } catch (error) {
        console.warn('[repos] could not schedule Actions stop recovery', error);
      }
    }
    return false;
  }

  // D1 executes this batch atomically: a run inserted after the stop snapshot must block deletion.
  const idle = `NOT EXISTS (SELECT 1 FROM workflow_runs r WHERE r.repository_id=?
    AND (r.status!='completed' OR EXISTS (SELECT 1 FROM workflow_jobs j WHERE j.run_id=r.id AND j.status='in_progress')))`;
  const [, deleted] = await env.DB.batch<{ id: string }>([
    env.DB.prepare(
      `INSERT INTO repository_deletions (id,artifacts_name,full_name,created_at)
       SELECT id,artifacts_name,?,? FROM repositories WHERE id=? AND ${idle}
       ON CONFLICT(id) DO NOTHING`
    ).bind(fullName, Date.now(), repo.id, repo.id),
    env.DB.prepare(
      `DELETE FROM repositories WHERE id=? AND ${idle}
       AND EXISTS (SELECT 1 FROM repository_deletions d WHERE d.id=repositories.id) RETURNING id`
    ).bind(repo.id, repo.id),
    // A zero-row DELETE must not leave an outbox that retention could mistake for a deleted repo.
    env.DB.prepare(
      'DELETE FROM repository_deletions WHERE id=? AND EXISTS (SELECT 1 FROM repositories WHERE id=?)'
    ).bind(repo.id, repo.id),
  ]);
  if (!deleted.results.length) return false;
  // An instance event: the repository's own log went with it.
  await recordAudit(db, {
    repositoryId: null,
    actorId,
    action: 'repository.deleted',
    target: fullName,
    data: { repository: repo.id },
  });
  await finishRepositoryDeletion(env, db, repo.id);
  return true;
}

/**
 * Runs deletion `id`'s cleanup steps not done yet, recording each one done. Never throws: a failed step stays for
 * the next run. True when every step is done.
 */
export async function finishRepositoryDeletion(
  env: CloudflareBindings,
  db: DrizzleDB,
  id: string
): Promise<boolean> {
  const row = await db
    .select()
    .from(repositoryDeletions)
    .where(eq(repositoryDeletions.id, id))
    .get();
  if (!row) return false;
  if (row.finishedAt) return true;
  const completed = { ...row.completed };
  let failed = false;
  for (const [name, step] of STEPS) {
    if (completed[name]) continue;
    try {
      await step(env, row);
      completed[name] = true;
    } catch (e) {
      console.error('[repos] deletion cleanup failed; it runs again later', {
        repository: id,
        step: name,
        error: String(e),
      });
      failed = true;
    }
  }
  await db
    .update(repositoryDeletions)
    .set({
      completed,
      attempts: row.attempts + 1,
      finishedAt: failed ? null : new Date(),
    })
    .where(eq(repositoryDeletions.id, id));
  return !failed;
}

/** Runs the cleanup of deletions left unfinished, then forgets finished ones past KEEP_MS. Returns those finished. */
export async function recoverRepositoryDeletions(
  env: CloudflareBindings,
  db: DrizzleDB,
  opts: { now?: Date; limit?: number } = {}
): Promise<number> {
  const now = opts.now ?? new Date();
  const pending = await db
    .select({ id: repositoryDeletions.id })
    .from(repositoryDeletions)
    .where(
      and(
        isNull(repositoryDeletions.finishedAt),
        lt(repositoryDeletions.attempts, MAX_DELETION_ATTEMPTS)
      )
    )
    .limit(opts.limit ?? 20)
    .all();
  let finished = 0;
  for (const { id } of pending)
    if (await finishRepositoryDeletion(env, db, id)) finished++;
  await db
    .delete(repositoryDeletions)
    .where(
      and(
        isNotNull(repositoryDeletions.finishedAt),
        lt(repositoryDeletions.finishedAt, new Date(now.getTime() - KEEP_MS))
      )
    );
  return finished;
}
