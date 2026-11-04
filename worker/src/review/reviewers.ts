// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, desc, eq, exists, inArray, notExists } from 'drizzle-orm';
import type { DrizzleDB } from '../db/middleware';
import {
  prClassifications,
  prReviewers,
  prReviewFlags,
  pullRequests,
  repositories,
  type PullRequest,
  type ReviewerStatus,
} from '../db/app.schema';
import { findReposByIds, visibleTo } from '../repositories/service';
import type { SessionUser } from '../variables';
import { settleStates } from '../pulls/settle';
import { invitedAgentsAt } from './head';
import { headReviewFor, headReviewId } from './keys';

/** Agents one repository may invite: bounds the model calls per reviewed commit. */
export const MAX_AGENTS_PER_REPOSITORY = 10;

export type RetryResult =
  { ok: true } | { ok: false; status: 400 | 404 | 409 | 503; error: string };

/**
 * Retries one agent's failed review of the pull request's current head, at the agent's current default-branch
 * commit: that agent's earlier findings on this commit are dropped, and the row goes back to reviewing (or
 * stays failed with the current error when AGENT.md is still invalid there). The caller checked merge permission.
 */
export async function retryReviewer(
  env: CloudflareBindings,
  db: DrizzleDB,
  pr: PullRequest,
  reviewerId: string,
  head: string | null,
  after: (work: Promise<unknown>) => void
): Promise<RetryResult> {
  if (pr.state !== 'open')
    return {
      ok: false,
      status: 400,
      error: 'This pull request is no longer open',
    };
  const row = await db
    .select()
    .from(prReviewers)
    .where(
      and(eq(prReviewers.id, reviewerId), eq(prReviewers.pullRequestId, pr.id))
    )
    .get();
  if (!row) return { ok: false, status: 404, error: 'Not Found' };
  if (row.headSha !== head)
    return {
      ok: false,
      status: 400,
      error:
        'This review is of an older commit; the current one is reviewed afresh',
    };
  if (row.status !== 'failed')
    return {
      ok: false,
      status: 400,
      error: 'Only a failed review can be retried',
    };
  const [agent] = await invitedAgentsAt(env, db, pr.repositoryId, row.agentId);
  if (!agent)
    return {
      ok: false,
      status: 400,
      error: 'This agent is no longer invited to the repository',
    };
  const reviewId = headReviewId(pr.id, row.headSha);
  const review = await headReviewFor(db, pr.id, row.headSha);
  const attemptAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  // created_at is both the attempt identity (second precision) and the retention clock. A failed create can be
  // retried immediately, so incrementing the prior identity would accumulate time in the future. Wait for the
  // next real second instead; leave the failed attempt and its findings intact until a new identity is possible.
  if (attemptAt <= row.createdAt)
    return {
      ok: false,
      status: 409,
      error: 'This review was just attempted. Wait a moment and retry.',
    };
  const failedAttempt = and(
    eq(prReviewers.id, row.id),
    eq(prReviewers.status, 'failed'),
    eq(prReviewers.createdAt, row.createdAt)
  );
  // Its earlier findings go first (the re-run's findings are INSERT OR IGNORE on the same keys), and only while
  // the row is still failed: a retry that lost a race never deletes the winner's findings.
  const [, claimed] = await db.batch([
    db
      .delete(prReviewFlags)
      .where(
        and(
          eq(prReviewFlags.classificationId, reviewId),
          eq(prReviewFlags.agentId, row.agentId),
          exists(
            db
              .select({ id: prReviewers.id })
              .from(prReviewers)
              .where(failedAttempt)
          )
        )
      ),
    db
      .update(prReviewers)
      .set({
        status: agent.error ? 'failed' : 'reviewing',
        requested: true,
        agentSha: agent.agentSha,
        error: agent.error,
        summary: null,
        // The clock (stale after REVIEW_STALE_MS) starts now. The strictly newer second also names the Pi reviewer
        // and fences every write; a concurrent retry still has to win failedAttempt below.
        createdAt: attemptAt,
        finishedAt: agent.error ? new Date() : null,
      })
      .where(failedAttempt)
      .returning({ id: prReviewers.id }),
  ]);
  if (!claimed.length)
    return { ok: false, status: 400, error: 'This review was already retried' };
  after(settleStates(env, db, pr.repositoryId));
  if (agent.error) return { ok: true };
  await db
    .update(prClassifications)
    .set({ status: 'reviewing', finishedAt: null })
    .where(eq(prClassifications.id, reviewId));
  try {
    await env.MERGE_RESOLUTION.create({
      id: `review-${crypto.randomUUID()}`,
      params: { reviewer: { id: row.id, generation: attemptAt.getTime() } },
    });
  } catch (e) {
    console.error('[review] could not start a retry', row.id, e);
    const failed = await db
      .update(prReviewers)
      .set({
        status: 'failed',
        error: 'The review could not be started. Try again.',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(prReviewers.id, row.id),
          eq(prReviewers.status, 'reviewing'),
          eq(prReviewers.createdAt, attemptAt)
        )
      )
      .returning({ id: prReviewers.id });
    // The commit's review goes back to how it was, unless another of its reviewers is still running.
    if (failed.length && review && review.status !== 'reviewing')
      await db
        .update(prClassifications)
        .set({
          status: review.status,
          finishedAt: review.finishedAt ?? new Date(),
        })
        .where(
          and(
            eq(prClassifications.id, reviewId),
            eq(prClassifications.status, 'reviewing'),
            exists(
              db
                .select({ id: prReviewers.id })
                .from(prReviewers)
                .where(
                  and(
                    eq(prReviewers.id, row.id),
                    eq(prReviewers.status, 'failed'),
                    eq(prReviewers.createdAt, attemptAt)
                  )
                )
            ),
            notExists(
              db
                .select({ id: prReviewers.id })
                .from(prReviewers)
                .where(
                  and(
                    eq(prReviewers.pullRequestId, pr.id),
                    eq(prReviewers.headSha, row.headSha),
                    eq(prReviewers.status, 'reviewing')
                  )
                )
            )
          )
        );
    return {
      ok: false,
      status: 503,
      error: 'The review could not be started; try again later',
    };
  }
  return { ok: true };
}

/**
 * Cancels an agent's reviews still running on open pull requests (of one repository, or everywhere): the rows
 * become not_needed ("Removed from the repository.") and stop counting. Returns how many it cancelled.
 */
export async function cancelAgentReviews(
  db: DrizzleDB,
  agentId: string,
  repositoryId?: string
): Promise<number> {
  const open = db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.state, 'open'),
        repositoryId ? eq(pullRequests.repositoryId, repositoryId) : undefined
      )
    );
  const rows = await db
    .update(prReviewers)
    .set({
      status: 'not_needed',
      requested: false,
      summary: 'Removed from the repository.',
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(prReviewers.agentId, agentId),
        eq(prReviewers.status, 'reviewing'),
        inArray(prReviewers.pullRequestId, open)
      )
    )
    .returning({ id: prReviewers.id });
  return rows.length;
}

/** An agent's latest requested reviews in repositories `viewer` can see, newest first. */
export async function recentReviews(
  db: DrizzleDB,
  agentId: string,
  viewer: SessionUser,
  limit = 10
): Promise<
  {
    repository: string;
    number: number;
    title: string;
    headSha: string;
    agentSha: string | null;
    status: ReviewerStatus;
    createdAt: string;
  }[]
> {
  const visible = visibleTo(viewer);
  const rows = await db
    .select({
      r: prReviewers,
      number: pullRequests.number,
      title: pullRequests.title,
      repoId: pullRequests.repositoryId,
    })
    .from(prReviewers)
    .innerJoin(pullRequests, eq(pullRequests.id, prReviewers.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      and(
        eq(prReviewers.agentId, agentId),
        eq(prReviewers.requested, true),
        ...(visible ? [visible] : [])
      )
    )
    .orderBy(desc(prReviewers.createdAt))
    .limit(limit)
    .all();
  const repos = await findReposByIds(db, [
    ...new Set(rows.map((r) => r.repoId)),
  ]);
  return rows.flatMap(({ r, number, title, repoId }) => {
    const found = repos.get(repoId);
    return found
      ? [
          {
            repository: `${found.namespace.username}/${found.repo.name}`,
            number,
            title,
            headSha: r.headSha,
            agentSha: r.agentSha,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
          },
        ]
      : [];
  });
}
