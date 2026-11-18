// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
import type { PullRequest } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { getSetting } from '../instance/settings';

/** Why an author may not approve their own pull request or decide its findings for a person. */
export const SELF_APPROVAL_REFUSED =
  'You opened this pull request: someone else with push access approves it and decides its findings. A site admin can let authors do it (Site admin → Settings → Reviews).';

/**
 * Whether `userId` approving `pr`, or deciding one of its findings for a person, would be its author deciding their
 * own change while the instance doesn't allow that (`review.allow_self_approval`, off by default). Read on each
 * decision, never cached.
 */
export async function selfApprovalRefused(
  db: DrizzleDB,
  env: CloudflareBindings,
  pr: Pick<PullRequest, 'authorId'>,
  userId: string
): Promise<boolean> {
  if (pr.authorId !== userId) return false;
  return !(await getSetting(db, env, 'review.allow_self_approval'));
}
