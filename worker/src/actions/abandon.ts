// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { workflowJobs, workflowRuns, workflowSteps } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { inJsonArray } from '../lib/sql-set';

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
