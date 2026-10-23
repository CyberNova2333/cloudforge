// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { and, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/middleware';
import { prEdges, pullRequests, type PullRequest } from '../db/app.schema';
import { landTargetOf } from '../lib/land-target';
import { ensureRebase } from '../merge/rebase';
import { resolutionConfigured } from '../merge/resolution';
import { findRepoById, gitFor } from '../lib/repos';
import { d1Of } from '../pulls/events';
import { settleStates } from '../pulls/settle';

/** The metadata CAS and its timeline entry either both commit or both roll back. */
async function unstackWithEvent(
  db: DrizzleDB,
  pr: PullRequest,
  target: string,
  event: { id: string; data: { pr: number; why: string }; actorId?: string }
): Promise<boolean> {
  const d1 = d1Of(db);
  const now = Date.now();
  const [update] = await d1.batch([
    d1
      .prepare(
        `UPDATE pull_requests SET base_ref = ?, land_target = ?, updated_at = ?
      WHERE id = ? AND base_ref = ? AND state = 'open'`
      )
      .bind(target, target, Math.floor(now / 1000), pr.id, pr.baseRef),
    d1
      .prepare(
        `INSERT INTO pr_events (id, repository_id, pull_request_id, kind, state, data, actor_id, computed_at, created_at)
      SELECT ?, ?, ?, 'unstacked', NULL, ?, ?, ?, ? WHERE changes() > 0 ON CONFLICT (id) DO NOTHING`
      )
      .bind(
        event.id,
        pr.repositoryId,
        pr.id,
        JSON.stringify(event.data),
        event.actorId ?? null,
        now,
        now
      ),
  ]);
  return (update.meta.changes ?? 0) > 0;
}

/** Starts a reconcile run for a land target (no-op without the Workflow binding). Never throws. */
export async function startReconcile(
  env: CloudflareBindings,
  repositoryId: string,
  landTarget: string
): Promise<void> {
  if (!resolutionConfigured(env)) return;
  try {
    await env.MERGE_RESOLUTION.create({
      id: `reconcile-${crypto.randomUUID()}`,
      params: { reconcile: { repositoryId, landTarget } },
    });
  } catch (e) {
    console.error('[stack] could not start reconcile', repositoryId, e);
  }
}

/** Dismisses every edge between `pr` and #`other` (a maintainer's decision; survives new heads). */
export async function dismissEdge(
  env: CloudflareBindings,
  db: DrizzleDB,
  pr: PullRequest,
  other: number,
  actorId: string
): Promise<'dismissed' | 'not_found'> {
  const o = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repositoryId, pr.repositoryId),
        eq(pullRequests.number, other)
      )
    )
    .get();
  if (!o) return 'not_found';
  const now = Date.now();
  const d1 = d1Of(db);
  const eventId = `dismissed:${pr.id}:${o.id}:${now}`;
  // One transaction: the edges and their timeline entry are dismissed together, so a crash can't lose the event.
  const [update] = await d1.batch([
    d1
      .prepare(
        `UPDATE pr_edges SET dismissed_at = ?, dismissed_by_id = ?, updated_at = ?
          WHERE ((pr_a_id = ? AND pr_b_id = ?) OR (pr_a_id = ? AND pr_b_id = ?)) AND dismissed_at IS NULL`
      )
      .bind(
        Math.floor(now / 1000),
        actorId,
        Math.floor(now / 1000),
        pr.id,
        o.id,
        o.id,
        pr.id
      ),
    // changes(): rows the UPDATE above changed (same transaction, the statement just before).
    d1
      .prepare(
        `INSERT INTO pr_events (id, repository_id, pull_request_id, kind, state, data, actor_id, computed_at, created_at)
         SELECT ?, ?, ?, 'dismissed', NULL, ?, ?, ?, ? WHERE changes() > 0
         ON CONFLICT (id) DO NOTHING`
      )
      .bind(
        eventId,
        pr.repositoryId,
        pr.id,
        JSON.stringify({ pr: other }),
        actorId,
        now,
        now
      ),
  ]);
  let did = (update.meta?.changes ?? 0) > 0;
  const target = landTargetOf(pr);
  if (pr.baseRef === o.headRef && pr.baseRef !== target) {
    // Compare-and-swap, like a reconcile's retarget: a racing reconcile moves it once.
    const moved = await unstackWithEvent(db, pr, target, {
      id: `unstacked:${pr.id}:${o.id}:${now}`,
      data: { pr: other, why: 'A maintainer unstacked it.' },
      actorId,
    });
    if (moved) {
      did = true;
      await settleStates(env, db, pr.repositoryId, { branch: target });
      // Now on the land target: it rebases onto it.
      const found = await findRepoById(db, pr.repositoryId);
      if (found)
        await ensureRebase(env, db, gitFor(env, found.repo), {
          ...pr,
          baseRef: target,
          landTarget: target,
        });
    }
  }
  if (!did) return 'not_found';
  await startReconcile(env, pr.repositoryId, target);
  return 'dismissed';
}
