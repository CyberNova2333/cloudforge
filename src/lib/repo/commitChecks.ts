import type { CommitRuns } from '../api/uiApi';

/** Actions and external contexts both count, including commits with no Actions runs. */
export function checkCounts(data: CommitRuns) {
  const statuses = data.statuses ?? [];
  const failed =
    data.runs.filter(
      (run) => run.conclusion === 'failure' || run.conclusion === 'cancelled'
    ).length +
    statuses.filter(
      (status) => status.state === 'failure' || status.state === 'error'
    ).length;
  const pending =
    data.runs.filter((run) => run.status !== 'completed').length +
    statuses.filter((status) => status.state === 'pending').length;
  const total = data.runs.length + statuses.length;
  return { failed, pending, passed: total - failed - pending, total };
}

/** Persisted CI links remain untrusted even when supplied by an older server. */
export function checkTarget(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
