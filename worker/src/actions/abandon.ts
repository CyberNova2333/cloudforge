// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { workflowJobs, workflowRuns, workflowSteps } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { inJsonArray } from '../shared/sql-set';
import { runnersStopped } from '../usage/record';

/** Call only after confirmed destruction; this records D1 progress without stopping a resource itself. */
export async function markStoppedJob(
  db: DrizzleDB,
  jobId: string,
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped'
) {
  const now = new Date();
  await db.batch([
    db
      .update(workflowJobs)
      .set({ status: 'completed', conclusion, completedAt: now })
      .where(
        and(eq(workflowJobs.id, jobId), eq(workflowJobs.status, 'in_progress'))
      ),
    db
      .update(workflowSteps)
      .set({
        status: 'completed',
        conclusion: sql`CASE WHEN status='in_progress' THEN ${conclusion} ELSE 'skipped' END`,
        completedAt: now,
      })
      .where(
        and(
          eq(workflowSteps.jobId, jobId),
          inArray(workflowSteps.status, ['queued', 'in_progress'])
        )
      ),
  ]);
}

/** Fence execution first; only confirmed stopped containers surrender their D1 capacity. */
export async function stopAbandonedRun(
  env: CloudflareBindings,
  db: DrizzleDB,
  runId: string,
  conclusion: 'cancelled' | 'failure'
): Promise<boolean> {
  await db
    .update(workflowRuns)
    .set({
      status: 'completed',
      conclusion,
      completedAt: new Date(),
      errorMessage:
        conclusion === 'failure'
          ? 'The run stopped unexpectedly. Try re-running it.'
          : null,
    })
    .where(
      and(
        eq(workflowRuns.id, runId),
        inArray(workflowRuns.status, ['queued', 'in_progress'])
      )
    );
  if (!env.ACTIONS_RUN || !env.JOB_RUNNER) return false;
  try {
    const instance = await env.ACTIONS_RUN.get(runId);
    const { status } = await instance.status();
    if (!['errored', 'terminated', 'complete'].includes(status))
      await instance.terminate();
    const jobs = await db
      .select({ id: workflowJobs.id })
      .from(workflowJobs)
      .where(
        and(
          eq(workflowJobs.runId, runId),
          eq(workflowJobs.status, 'in_progress')
        )
      )
      .orderBy(asc(workflowJobs.id))
      .limit(51)
      .all();
    for (const { id } of jobs.slice(0, 50)) {
      await env.JOB_RUNNER.getByName(id).destroy();
      await runnersStopped(db, [id]);
      await markStoppedJob(db, id, conclusion);
    }
    if (jobs.length > 50) return false;
    await finishAbandoned(db, runId, conclusion);
    return true;
  } catch (error) {
    console.warn(
      '[actions] could not stop abandoned run; retaining capacity',
      runId,
      error
    );
    return false;
  }
}

/** Marks a run and everything still open in it as finished. */
export async function finishAbandoned(
  db: DrizzleDB,
  runId: string,
  conclusion: 'cancelled' | 'failure'
) {
  const now = new Date();
  const open = inArray(workflowJobs.status, ['queued', 'in_progress']);
  const jobIds = (
    await db
      .select({ id: workflowJobs.id })
      .from(workflowJobs)
      .where(and(eq(workflowJobs.runId, runId), open))
      .all()
  ).map((j) => j.id);
  await db.batch([
    db
      .update(workflowRuns)
      .set({
        status: 'completed',
        conclusion,
        completedAt: now,
        errorMessage:
          conclusion === 'failure'
            ? 'The run stopped unexpectedly. Try re-running it.'
            : null,
      })
      .where(
        and(
          eq(workflowRuns.id, runId),
          inArray(workflowRuns.status, ['queued', 'in_progress'])
        )
      ),
    db
      .update(workflowJobs)
      .set({ status: 'completed', conclusion, completedAt: now })
      .where(and(eq(workflowJobs.runId, runId), open)),
    ...(jobIds.length
      ? [
          db
            .update(workflowSteps)
            .set({
              status: 'completed',
              conclusion: sql`CASE WHEN status = 'in_progress' THEN ${conclusion} ELSE 'skipped' END`,
              completedAt: now,
            })
            .where(
              and(
                inJsonArray(workflowSteps.jobId, jobIds),
                inArray(workflowSteps.status, ['queued', 'in_progress'])
              )
            ),
        ]
      : []),
  ]);
  return jobIds;
}
