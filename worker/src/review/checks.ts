// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
export type CheckRun = {
  runNumber: number;
  status: string;
  conclusion: string | null;
  workflowPath: string;
  event: string;
};
export type CheckJob = {
  key: string;
  name: string;
  status: string;
  conclusion: string | null;
  runNumber: number;
};
/** Which checks hold a commit: `any` (the default: any failed or running latest run), `all` (also waits for a first run), `none`, or named jobs. */
export type CheckRequirement = 'all' | 'any' | 'none' | string[];
export type CheckVerdict =
  | { kind: 'failed'; reason: string; runNumber: number; check: string | null }
  | {
      kind: 'waiting';
      reason: string;
      check: string | null;
      started: boolean;
    };

/** A commit status reported from outside (docs/webhooks.md): the latest one of its context. */
export type ReportedStatus = { context: string; state: string };

/**
 * Whether reported statuses hold a commit up: failure or error fails it, pending waits. `runNumber` 0: not an
 * Actions run (there is nothing to re-run here).
 */
export function statusVerdict(statuses: ReportedStatus[]): CheckVerdict | null {
  const bad = statuses.find(
    (s) => s.state === 'failure' || s.state === 'error'
  );
  if (bad)
    return {
      kind: 'failed',
      reason: `The "${bad.context}" check failed`,
      runNumber: 0,
      check: bad.context,
    };
  const pending = statuses.find((s) => s.state === 'pending');
  if (pending)
    return {
      kind: 'waiting',
      reason: `The "${pending.context}" check is running`,
      check: pending.context,
      started: true,
    };
  return null;
}

/** Two verdicts as one: any failure first, then any wait. */
export function combineVerdicts(
  a: CheckVerdict | null,
  b: CheckVerdict | null
): CheckVerdict | null {
  if (a?.kind === 'failed') return a;
  if (b?.kind === 'failed') return b;
  return a ?? b;
}

/**
 * Like the checks badge: only failures and cancellations fail; success and skipped don't. A required
 * job that was skipped in a run that failed or was cancelled fails, though (see checkVerdict).
 */
const failed = (x: { status: string; conclusion: string | null }) =>
  x.status === 'completed' &&
  (x.conclusion === 'failure' || x.conclusion === 'cancelled');

/**
 * The latest run per workflow and event (a re-run is a new run for the same commit and replaces the old one),
 * dropping the jobs of replaced runs. Matches the checks badge (`commitChecks`).
 */
function latestRuns(runs: CheckRun[], jobs: CheckJob[]) {
  const latest = new Map<string, CheckRun>();
  for (const r of runs) {
    const k = `${r.workflowPath}\0${r.event}`;
    const seen = latest.get(k);
    if (!seen || r.runNumber > seen.runNumber) latest.set(k, r);
  }
  const kept = [...latest.values()].sort((a, b) => a.runNumber - b.runNumber);
  const superseded = new Set(
    runs.filter((r) => !kept.includes(r)).map((r) => r.runNumber)
  );
  return {
    runs: kept,
    jobs: jobs.filter((j) => !superseded.has(j.runNumber)),
  };
}

/**
 * Whether a commit's Actions checks hold it up: null when they don't. `all` and `any` look at runs (`all` also
 * waits for a first run); a list looks at the named jobs. Only the latest run per workflow and event counts.
 * Shared by auto-merge and pull request states.
 */
export function checkVerdict(
  allRuns: CheckRun[],
  allJobs: CheckJob[],
  require: CheckRequirement
): CheckVerdict | null {
  if (require === 'none') return null;
  const { runs, jobs } = latestRuns(allRuns, allJobs);
  if (require === 'all' || require === 'any') {
    if (!runs.length)
      return require === 'all'
        ? {
            kind: 'waiting',
            reason: 'No checks have run for this commit yet',
            check: null,
            started: false,
          }
        : null;
    const bad = runs.find(failed);
    if (bad)
      return {
        kind: 'failed',
        reason: 'Checks failed',
        runNumber: bad.runNumber,
        check: null,
      };
    if (runs.some((r) => r.status !== 'completed'))
      return {
        kind: 'waiting',
        reason: 'Checks are running',
        check: null,
        started: true,
      };
    return null;
  }
  for (const wanted of require) {
    const matching = jobs.filter((j) => j.key === wanted || j.name === wanted);
    if (!matching.length)
      return {
        kind: 'waiting',
        reason: `Waiting for the "${wanted}" check`,
        check: wanted,
        started: false,
      };
    // The executor skips a job when a job it needs failed: that skip is its run's failure, not a pass. The
    // run's conclusion lands only once all its jobs finish, so until then such a job is still running.
    const skipped = (j: CheckJob) =>
      j.status === 'completed' && j.conclusion === 'skipped';
    const runOf = (j: CheckJob) =>
      runs.find((r) => r.runNumber === j.runNumber);
    const bad = matching.find(
      (j) => failed(j) || (skipped(j) && !!runOf(j) && failed(runOf(j)!))
    );
    if (bad)
      return {
        kind: 'failed',
        reason: `The "${wanted}" check failed`,
        runNumber: bad.runNumber,
        check: wanted,
      };
    if (
      matching.some(
        (j) =>
          j.status !== 'completed' ||
          (skipped(j) && !!runOf(j) && runOf(j)!.status !== 'completed')
      )
    )
      return {
        kind: 'waiting',
        reason: `The "${wanted}" check is running`,
        check: wanted,
        started: true,
      };
  }
  return null;
}
