// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircleIcon } from '@primer/octicons-react';
import {
  api,
  qk,
  type CommitRuns,
  type ReportedCommitStatus,
  type RepoDetail,
  type WorkflowRun,
} from '@/lib/uiApi';
import { duration } from '@/lib/format';
import { checkCounts, checkTarget } from '@/lib/commitChecks';
import { lang, t, tn } from '@/lib/i18n';
import { RunStatusIcon } from './RunStatusIcon';
import { Dropdown } from './Dropdown';
import { RunChip } from './actions/RunChip';
import { QueryError, RowsSkeleton } from './actions/states';
import { EmptyState } from './ui/EmptyState';

/** A commit's workflow runs (its checks); polls while any is pending. */
export function useCommitRuns(
  repo: RepoDetail,
  sha: string | null | undefined
) {
  const o = repo.owner.username;
  return useQuery({
    queryKey: qk.commitRuns(o, repo.name, sha ?? ''),
    queryFn: () => api.commitRuns(o, repo.name, sha!),
    enabled: Boolean(sha),
    refetchInterval: (q) => (q.state.data?.state === 'pending' ? 4000 : false),
  });
}

/** The status glyph for a commit's combined check state. */
export const STATE_ICON: Record<
  NonNullable<CommitRuns['state']>,
  Parameters<typeof RunStatusIcon>[0]
> = {
  success: { status: 'completed', conclusion: 'success' },
  failure: { status: 'completed', conclusion: 'failure' },
  pending: { status: 'in_progress', conclusion: null },
};

/** The ✓ / ✗ / spinner next to the latest commit; click it for a summary of its checks. */
export function CommitStatus({ repo, sha }: { repo: RepoDetail; sha: string }) {
  const q = useCommitRuns(repo, sha);
  return <ChecksBadge repo={repo} checks={q.data} align="right" />;
}

/** Checks for many commits in one request, keyed by SHA; polls while any is running. */
export function useCommitStatuses(
  repo: RepoDetail | undefined,
  shas: (string | null | undefined)[]
) {
  const o = repo?.owner.username ?? '';
  const name = repo?.name ?? '';
  const list = [...new Set(shas.filter((s): s is string => !!s))].slice(0, 100);
  return useQuery({
    queryKey: qk.commitStatuses(o, name, list.join(',')),
    queryFn: () => api.commitStatuses(o, name, list),
    enabled: Boolean(repo) && list.length > 0,
    refetchInterval: (q) =>
      Object.values(q.state.data ?? {}).some((c) => c.state === 'pending')
        ? 5000
        : false,
  });
}

/** A commit's combined check state (✓ / ✗ / spinner); opens a summary; empty with no checks. */
export function ChecksBadge({
  repo,
  checks,
  align = 'left',
}: {
  repo: RepoDetail;
  checks: CommitRuns | undefined;
  align?: 'left' | 'right';
}) {
  if (!checks?.state) return null;
  const state = checks.state;
  return (
    <Dropdown
      align={align}
      width={380}
      className="checks-popover"
      trigger={(open, toggle) => (
        <button
          type="button"
          className="btn-octicon p-0 m-0 d-inline-flex flex-items-center"
          style={{ background: 'none', border: 0, cursor: 'pointer' }}
          aria-expanded={open}
          aria-label={STATE_LABEL[state]}
          title={STATE_LABEL[state]}
          onClick={(e) => {
            // Rows are often links; the badge opens its summary instead of following them.
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }}
        >
          <RunStatusIcon {...STATE_ICON[state]} size={14} />
        </button>
      )}
    >
      {() => <ChecksSummary repo={repo} data={checks} />}
    </Dropdown>
  );
}

export const STATE_LABEL: Record<NonNullable<CommitRuns['state']>, string> = {
  success: t('All checks have passed'),
  failure: t('Some checks were not successful'),
  pending: t("Some checks haven't completed yet"),
};

/** "(pull_request) · Successful in 1m 2s": what started a run, and how it went. */
function runLine(r: WorkflowRun): string {
  const event = r.event === 'pull_request' ? 'pull_request' : 'push';
  const how =
    r.status === 'completed' && r.startedAt
      ? t('{result} in {time}', {
          result:
            r.conclusion === 'success'
              ? t('Successful')
              : r.conclusion === 'failure'
                ? t('Failing')
                : r.conclusion === 'skipped'
                  ? t('Skipped')
                  : t('Cancelled'),
          time: duration(r.startedAt, r.completedAt),
        })
      : r.status === 'in_progress'
        ? t('In progress')
        : t('Queued');
  return `(${event}) · ${how}`;
}

/** "1 failing, 2 successful checks". */
export function checksDetail(data: CommitRuns): string {
  const { failed, pending, passed, total } = checkCounts(data);
  const detail = [
    failed && t('{n} failing', { n: failed }),
    pending && t('{n} in progress', { n: pending }),
    passed && t('{n} successful', { n: passed }),
  ]
    .filter(Boolean)
    .join(lang === 'zh' ? '，' : ', ');
  return tn(total, '{detail} check', '{detail} checks', { detail });
}

function ExternalCheck({ status }: { status: ReportedCommitStatus }) {
  const state = status.state === 'error' ? 'failure' : status.state;
  const target = checkTarget(status.targetUrl);
  return (
    <>
      <RunStatusIcon {...STATE_ICON[state]} />
      <span className="checks-name flex-1" style={{ minWidth: 0 }}>
        <b>{status.context}</b>{' '}
        <span className="muted small">
          {t('External CI')}
          {status.description ? ` · ${status.description}` : ''}
        </span>
      </span>
      {target && (
        <a
          className="small flex-shrink-0"
          href={target}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('Details')}
        </a>
      )}
    </>
  );
}

/** The summary of a commit's checks (the badge's popover): the overall result, then one row per workflow run. */
function ChecksSummary({ repo, data }: { repo: RepoDetail; data: CommitRuns }) {
  const base = `/${repo.fullName}`;
  return (
    <>
      <div
        className="px-3 py-2 border-bottom d-flex flex-items-center"
        style={{ gap: 12 }}
      >
        <RunStatusIcon {...STATE_ICON[data.state!]} size={16} />
        <div>
          <div className="text-bold">{STATE_LABEL[data.state!]}</div>
          <div className="f6 color-fg-muted">{checksDetail(data)}</div>
        </div>
      </div>
      {data.runs.map((r) => (
        <div
          key={r.id}
          className="px-3 py-2 border-bottom d-flex flex-items-center f6"
          style={{ gap: 8 }}
        >
          <RunStatusIcon status={r.status} conclusion={r.conclusion} />
          <span className="flex-1" style={{ minWidth: 0 }}>
            <span className="text-bold">{r.name}</span>{' '}
            <span className="color-fg-muted">{runLine(r)}</span>
          </span>
          <Link
            to={`${base}/actions/runs/${r.runNumber}`}
            className="flex-shrink-0"
          >
            {t('Details')}
          </Link>
        </div>
      ))}
      {(data.statuses ?? []).map((status) => (
        <div
          key={status.context}
          className="px-3 py-2 border-bottom d-flex flex-items-center f6"
          style={{ gap: 8 }}
        >
          <ExternalCheck status={status} />
        </div>
      ))}
    </>
  );
}

/**
 * A pull request's checks: the head commit's workflow runs, the overall result first, then one row per run with
 * its "Details" link. Says so when nothing ran, and offers a retry when the list didn't load.
 */
export function ChecksBox({
  repo,
  sha,
}: {
  repo: RepoDetail;
  sha: string | null;
}) {
  const q = useCommitRuns(repo, sha);
  const data = q.data;
  const base = `/${repo.fullName}`;
  if (!sha)
    return (
      <div className="panel">
        <EmptyState
          picture={<CheckCircleIcon size={20} />}
          title={t('No commit to check')}
          body={t('The branch is gone, so there are no checks to show.')}
        />
      </div>
    );
  if (q.isError && !data)
    return (
      <div className="panel">
        <QueryError
          error={q.error}
          title={t('The checks did not load')}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  if (!data) return <RowsSkeleton rows={2} />;
  if (!data.state || !checkCounts(data).total)
    return (
      <div className="panel">
        <EmptyState
          picture={<CheckCircleIcon size={20} />}
          title={t('No checks ran on this commit')}
          body={t('Workflow runs and external CI statuses show up here.')}
        />
      </div>
    );
  return (
    <section className="panel checks-box" aria-label={t('Checks')}>
      <div className="checks-head">
        <RunStatusIcon {...STATE_ICON[data.state]} size={20} />
        <div>
          <p className="checks-title">{STATE_LABEL[data.state]}</p>
          <p className="muted small">{checksDetail(data)}</p>
        </div>
      </div>
      <ul className="checks-list">
        {data.runs.map((r) => (
          <li key={r.id}>
            <RunChip status={r.status} conclusion={r.conclusion} />
            <span className="checks-name">
              <b>{r.name}</b> <span className="muted small">{runLine(r)}</span>
            </span>
            <Link to={`${base}/actions/runs/${r.runNumber}`} className="small">
              {t('Details')}
            </Link>
          </li>
        ))}
        {(data.statuses ?? []).map((status) => (
          <li key={status.context} className="checks-external">
            <ExternalCheck status={status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
