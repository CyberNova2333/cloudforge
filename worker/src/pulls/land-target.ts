// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { sql, type SQL } from 'drizzle-orm';
import { pullRequests, type PullRequest } from '../db/app.schema';
import type { GitService } from '../git/service';

/**
 * Where a pull request finally lands; base_ref may be a parent PR's head branch while it is stacked. NULL (rows
 * from before the column) means base_ref. The one helper every "where this lands" reader uses.
 */
export function landTargetOf(
  pr: Pick<PullRequest, 'landTarget' | 'baseRef'>
): string {
  return pr.landTarget ?? pr.baseRef;
}

/** `landTargetOf(pr) = branch`, for SQL filters on pull_requests. */
export function landTargetIs(branch: string): SQL {
  return sql`COALESCE(${pullRequests.landTarget}, ${pullRequests.baseRef}) = ${branch}`;
}

/** The commits that decide merging an open PR: its land target's tip and its head's. */
export async function landShas(
  git: GitService,
  pr: Pick<PullRequest, 'landTarget' | 'baseRef' | 'headRef'>
): Promise<{ base: string; head: string } | null> {
  const [base, head] = await Promise.all([
    git.resolveBranch(landTargetOf(pr)),
    git.resolveBranch(pr.headRef),
  ]);
  return base && head ? { base, head } : null;
}
