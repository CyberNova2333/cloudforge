// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import type { DrizzleDB } from '../db/middleware';
import type { LandingIntent, PullRequest } from '../db/app.schema';
import { d1Of } from '../pulls/events';
import { resolutionConfigured } from '../merge/resolution';
import { startLandingWorkflow } from '../merge/followups';

/** Unwind a landed stack and record its child events in the same transaction as the replay fence. */
export async function unwindLanding(
  env: CloudflareBindings,
  db: DrizzleDB,
  pr: PullRequest,
  intent: LandingIntent
): Promise<void> {
  const d1 = d1Of(db);
  const now = Date.now();
  const once = `EXISTS (SELECT 1 FROM landing_intents WHERE id = ? AND COALESCE(json_extract(completed, '$.unwind'), 0) = 0)`;
  const children = `repository_id = ? AND state = 'open' AND base_ref = ? AND COALESCE(land_target, base_ref) = ?`;
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO pr_events (id, repository_id, pull_request_id, kind, state, data, actor_id, computed_at, created_at)
      SELECT ? || ':' || id, repository_id, id, 'unstacked', NULL, ?, NULL, ?, ?
      FROM pull_requests WHERE ${children} AND ${once} ON CONFLICT (id) DO NOTHING`
      )
      .bind(
        `unstacked:${intent.id}`,
        JSON.stringify({ pr: pr.number, why: `#${pr.number} landed.` }),
        now,
        now,
        pr.repositoryId,
        pr.headRef,
        intent.target,
        intent.id
      ),
    d1
      .prepare(
        `UPDATE pull_requests SET base_ref = ?, land_target = ?, updated_at = ? WHERE ${children} AND ${once}`
      )
      .bind(
        intent.target,
        intent.target,
        Math.floor(now / 1000),
        pr.repositoryId,
        pr.headRef,
        intent.target,
        intent.id
      ),
    d1
      .prepare(
        `UPDATE pr_edges SET dismissed_at = NULL, dismissed_by_id = NULL, b_head = ''
      WHERE slot = 'pair' AND kind = 'must_account_for' AND dismissed_at IS NOT NULL AND accounted_for_at IS NULL
      AND prerequisite = 'a' AND pr_a_id = ? AND ${once}`
      )
      .bind(pr.id, intent.id),
    d1
      .prepare(
        `UPDATE pr_edges SET dismissed_at = NULL, dismissed_by_id = NULL, a_head = ''
      WHERE slot = 'pair' AND kind = 'must_account_for' AND dismissed_at IS NOT NULL AND accounted_for_at IS NULL
      AND prerequisite = 'b' AND pr_b_id = ? AND ${once}`
      )
      .bind(pr.id, intent.id),
    d1
      .prepare(
        `UPDATE pr_edges SET dismissed_at = NULL, dismissed_by_id = NULL
      WHERE slot = 'pair' AND dismissed_at IS NOT NULL AND (pr_a_id = ? OR pr_b_id = ?) AND ${once}`
      )
      .bind(pr.id, pr.id, intent.id),
    d1
      .prepare(
        `DELETE FROM pr_edges WHERE slot = 'order' AND (pr_a_id = ? OR pr_b_id = ? OR for_pr_id = ?) AND ${once}`
      )
      .bind(pr.id, pr.id, pr.id, intent.id),
    d1
      .prepare(
        `UPDATE landing_intents SET completed = json_set(completed, '$.unwind', 1) WHERE id = ?`
      )
      .bind(intent.id),
  ]);
  // The sweep rebases the moved children; reconciliation re-establishes their ordering. A stable id prevents
  // a lost create response from launching another model run on the next recovery attempt.
  if (resolutionConfigured(env))
    await startLandingWorkflow(env, `reconcile-landing-${intent.id}`, {
      reconcile: { repositoryId: pr.repositoryId, landTarget: intent.target },
    });
}
