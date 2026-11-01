// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link } from 'react-router-dom';
import { CodeIcon, GitCommitIcon } from '@primer/octicons-react';
import { useMemo, useState } from 'react';
import type { Commit, CommitRuns, RepoDetail } from '@/lib/api/uiApi';
import { shortSha, timeAgo } from '@/lib/utils/format';
import { t } from '@/lib/i18n/i18n';
import { parseCommitMessage } from '@/lib/repo/commitMessage';
import { groupByDay } from '@/lib/repo/commits';
import { CommitAuthor } from './CommitAuthor';
import { CoAuthored, CommitBody } from './CommitBody';
import { CopyButton } from '@/components/ui/CopyButton';
import { ChecksBadge, useCommitStatuses } from '@/components/actions/Checks';

function CommitRow({
  c,
  base,
  repo,
  checks,
}: {
  c: Commit;
  base: string;
  repo?: RepoDetail;
  checks?: CommitRuns;
}) {
  const [expanded, setExpanded] = useState(false);
  const message = useMemo(() => parseCommitMessage(c.message), [c.message]);
  const more = !!message.body || message.trailers.length > 0;
  return (
    <li>
      <div className="cl-main">
        <div className="cl-top">
          <Link to={`${base}/commit/${c.hash}`} className="cl-subj">
            {message.subject}
          </Link>
          {more && (
            <button
              type="button"
              className="ellipsis-expander"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              aria-label={
                expanded
                  ? t('Hide the rest of the message')
                  : t('Show the rest of the message')
              }
            >
              …
            </button>
          )}
        </div>
        {expanded && <CommitBody message={message} />}
        <p className="cl-by small muted">
          <CommitAuthor commit={c} size={20} repo={repo} />
          <CoAuthored trailers={message.trailers} />
          <span className="no-wrap">
            {t('committed {when}', { when: timeAgo(c.committedAt) })}
          </span>
        </p>
      </div>
      <div className="cl-side">
        {repo && <ChecksBadge repo={repo} checks={checks} />}
        <div className="cl-sha-group">
          <CopyButton
            text={c.hash}
            className="btn small cl-copy-btn"
            label={t('Copy full SHA')}
          />
          <Link
            to={`${base}/commit/${c.hash}`}
            className="shabtn mono"
            title={t('Open this commit')}
          >
            {shortSha(c.hash)}
          </Link>
        </div>
        <Link
          to={`${base}/tree/${c.hash}`}
          className="btn small cl-tree-btn"
          aria-label={t('Browse the code at {sha}', { sha: shortSha(c.hash) })}
          title={t('Browse the code at this commit')}
        >
          <CodeIcon />
        </Link>
      </div>
    </li>
  );
}

/** Commits grouped by day, preserving input order. */
export function CommitList({
  commits,
  base,
  repo,
}: {
  commits: Commit[];
  base: string;
  /** Shows each commit's checks (one request for the list). */
  repo?: RepoDetail;
}) {
  const statuses = useCommitStatuses(
    repo,
    commits.map((c) => c.hash)
  );
  return (
    <div className="commit-days">
      {groupByDay(commits).map((g) => (
        <section key={g.day} className="commit-day-group">
          <h3 className="daylabel">
            <span className="daylabel-node" aria-hidden="true">
              <GitCommitIcon size={16} />
            </span>
            <span>{t('Commits on {day}', { day: g.day })}</span>
          </h3>
          <ul className="commitlist panel">
            {g.commits.map((c) => (
              <CommitRow
                key={c.hash}
                c={c}
                base={base}
                repo={repo}
                checks={statuses.data?.[c.hash]}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
