import { Link } from 'react-router-dom';
import { GitBranchIcon, GitCompareIcon } from '@primer/octicons-react';
import type { PullDetail, RepoDetail, User } from '@/lib/uiApi';
import { t, tn, tx } from '@/lib/i18n';
import { participants } from '@/lib/pullPage';
import { Avatar } from '@/components/Avatar';
import { AgentRunLink } from '@/components/AgentRunLink';
import { RunStatusIcon } from '@/components/RunStatusIcon';
import {
  checksDetail,
  STATE_ICON,
  STATE_LABEL,
  useCommitRuns,
} from '@/components/Checks';
import { ReviewersSidebar } from '@/components/ReviewersBox';
import { PullStateLabel, PullStateReasons } from '@/components/PullStateLabel';
import { VersionPanel } from './VersionPanel';

/** The head commit's checks in one line, with a link to the Checks tab. */
function ChecksPanel({ repo, d }: { repo: RepoDetail; d: PullDetail }) {
  const q = useCommitRuns(repo, d.headSha);
  const checksTab = `/${repo.fullName}/pull/${d.pull.number}/checks`;
  const data = q.data;
  return (
    <section className="panel pad" aria-labelledby="pr-checks-title">
      <div className="pr-panel-head">
        <h2 id="pr-checks-title">{t('Checks')}</h2>
        <span className="grow" />
        <Link to={checksTab} className="small">
          {t('Details')}
        </Link>
      </div>
      {!d.headSha ? (
        <p className="muted small">
          {t('The branch is gone, so nothing runs.')}
        </p>
      ) : q.isError && !data ? (
        <p className="muted small">
          {t('The checks did not load.')}{' '}
          <button
            type="button"
            className="btn quiet small"
            onClick={() => void q.refetch()}
          >
            {t('Retry')}
          </button>
        </p>
      ) : !data ? (
        <div
          className="sk sk-line w60"
          role="status"
          aria-label={t('Loading')}
        />
      ) : !data.state ? (
        <p className="muted small">{t('No checks ran on this commit.')}</p>
      ) : (
        <p className="pr-checks-line">
          <RunStatusIcon {...STATE_ICON[data.state]} size={16} />
          <span>
            <b>{STATE_LABEL[data.state]}</b>
            <span className="muted small">{checksDetail(data)}</span>
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * The side of the conversation: Reviews (each requested agent in its state), the head commit's checks, the
 * version bump and the release that shipped it, the branches, the people in the conversation, and the technical
 * details a developer may want.
 */
export function PullSide({
  repo,
  d,
  anchored,
  refresh,
}: {
  repo: RepoDetail;
  d: PullDetail;
  anchored: string | null;
  refresh: () => Promise<unknown>;
}) {
  const pr = d.pull;
  const base = `/${repo.fullName}`;
  const people: User[] = participants(pr, d.comments);
  const open = pr.state === 'open';
  return (
    <aside
      className="col side pr-side"
      aria-label={t('About this pull request')}
    >
      {d.review && (
        <ReviewersSidebar
          repo={repo}
          d={d}
          anchor={anchored === null}
          onChange={refresh}
        />
      )}
      {open && <ChecksPanel repo={repo} d={d} />}
      <VersionPanel repo={repo} pr={pr} onSaved={refresh} />
      <section className="panel pad" aria-labelledby="pr-branch-title">
        <h2 id="pr-branch-title">{t('Branch')}</h2>
        <p className="pr-branches">
          {d.headBranchExists ? (
            <Link to={`${base}/tree/${pr.headRef}`} className="mono">
              <GitBranchIcon size={14} />
              {pr.headRef}
            </Link>
          ) : (
            <span className="mono muted">
              <GitBranchIcon size={14} />
              {t('{branch} (deleted)', { branch: pr.headRef })}
            </span>
          )}
          <span className="muted small">
            {tx('into {base} · {commits}', {
              base: <span className="mono">{pr.baseRef}</span>,
              commits: tn(d.commitCount, '{n} commit', '{n} commits'),
            })}
          </span>
        </p>
        {open && d.headBranchExists && (
          <p className="actions">
            <Link
              className="btn small"
              to={`${base}/compare/${pr.baseRef}...${pr.headRef}`}
            >
              <GitCompareIcon size={14} />
              {t('Compare')}
            </Link>
            <Link
              className="btn small quiet"
              to={`${base}/pull/${pr.number}/commits`}
            >
              {t('Commits')}
            </Link>
          </p>
        )}
      </section>
      <section className="panel pad" aria-labelledby="pr-people-title">
        <h2 id="pr-people-title">{t('Participants')}</h2>
        <ul className="pr-participants">
          {people.map((u) => (
            <li key={u.id}>
              <Link to={`/${u.username}`} title={u.username}>
                <Avatar user={u} size={26} />
                <span className="sr">{u.username}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <details className="panel pad pr-tech">
        <summary>{t('Technical details')}</summary>
        {d.pullState && (
          <div className="pr-tech-state">
            <PullStateLabel state={d.pullState} showReason />
            <PullStateReasons state={d.pullState} />
          </div>
        )}
        <dl className="pr-tech-list">
          <dt>{t('Head')}</dt>
          <dd>
            {d.headSha ? (
              <Link to={`${base}/commit/${d.headSha}`} className="mono">
                {d.headSha.slice(0, 7)}
              </Link>
            ) : (
              '—'
            )}
          </dd>
          <dt>{t('Base')}</dt>
          <dd className="mono">{d.baseSha ? d.baseSha.slice(0, 7) : '—'}</dd>
          {d.pullState && (
            <>
              <dt>{t('State code')}</dt>
              <dd className="mono">
                {d.pullState.state}
                {d.pullState.reasons.length > 0 &&
                  ` · ${d.pullState.reasons.map((r) => r.kind).join(', ')}`}
              </dd>
            </>
          )}
          {d.review?.summaryModel && (
            <>
              <dt>{t('Summaries')}</dt>
              <dd className="mono">{d.review.summaryModel}</dd>
            </>
          )}
        </dl>
        <p className="pr-tech-runs">
          <AgentRunLink
            repo={repo}
            number={pr.number}
            kind="review"
            label={t('Review run')}
          />
          <AgentRunLink
            repo={repo}
            number={pr.number}
            kind="stack_discovery"
            label={t('Stack run')}
          />
          <AgentRunLink
            repo={repo}
            number={pr.number}
            kind="rebase"
            label={t('Rebase run')}
          />
        </p>
      </details>
    </aside>
  );
}
