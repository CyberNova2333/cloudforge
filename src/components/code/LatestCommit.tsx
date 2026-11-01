// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { Link } from 'react-router-dom';
import { t } from '@/lib/i18n/i18n';
import { ClockIcon } from '@primer/octicons-react';
import { firstLine, shortSha, timeAgo } from '@/lib/utils/format';
import type { Contents, RepoDetail } from '@/lib/api/uiApi';
import { CommitAuthor } from '@/components/code/CommitAuthor';
import { CommitStatus } from '@/components/actions/Checks';

/**
 * The bar above a tree, a file or an LFS file: the latest commit's author, its message, whether its checks
 * passed, its short SHA and age, and a link to the history. On phones only the icon of the history link stays,
 * so the message keeps its room.
 */
export function LatestCommit({
  repo,
  data,
}: {
  repo: RepoDetail;
  data: Contents;
}) {
  const c = data.latestCommit;
  if (!c) return null;
  const base = `/${repo.fullName}`;
  return (
    <div className="ft-head">
      <span className="authors">
        <CommitAuthor
          commit={c}
          repo={repo}
          size={20}
          className="text-bold"
          showCommitter={false}
        />
      </span>
      <Link to={`${base}/commit/${c.hash}`} className="ft-msg">
        {firstLine(c.message)}
      </Link>
      <CommitStatus repo={repo} sha={c.hash} />
      <span className="ft-meta">
        <Link to={`${base}/commit/${c.hash}`} className="mono ft-sha">
          {shortSha(c.hash)}
        </Link>
        <span className="ft-sha-dot"> · </span>
        {timeAgo(c.committedAt)}
      </span>
      <Link
        to={`${base}/commits/${data.ref}`}
        className="ft-count"
        aria-label={t('History')}
      >
        <ClockIcon />
        <span className="ft-count-label">{t('History')}</span>
      </Link>
    </div>
  );
}
