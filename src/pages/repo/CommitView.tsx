// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useMemo } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CodeIcon } from '@primer/octicons-react';
import { api, qk, type FileDiff, type RepoDetail } from '@/lib/api/uiApi';
import { ApiError } from '@/lib/api/api';
import { t, tn } from '@/lib/i18n/i18n';
import { shortSha, timeAgo } from '@/lib/utils/format';
import { parseCommitMessage } from '@/lib/repo/commitMessage';
import { CommitAuthor } from '@/components/code/CommitAuthor';
import { CoAuthored, CommitBody } from '@/components/code/CommitBody';
import { CopyButton } from '@/components/ui/CopyButton';
import { DiffTotals, DiffView } from '@/components/code/DiffView';
import { LoadError } from '@/components/code/LoadError';
import { useEnter } from '@/components/code/useEnter';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { usePageHead } from '@/components/ui/PageHead';
import { NotFound } from '@/pages/overview/NotFound';

/** The changed files as a list that jumps to each one's diff (every diff has an `id`). */
function FileSummary({ files }: { files: FileDiff[] }) {
  return (
    <div className="table-wrap file-summary">
      <table className="table">
        <caption className="sr">{t('Changed files')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('File')}</th>
            <th scope="col">{t('Added')}</th>
            <th scope="col">{t('Removed')}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.path}>
              <td className="mono small">
                <a href={`#diff-${encodeURIComponent(f.path)}`}>{f.path}</a>
              </td>
              <td className="mono fs-add">
                {f.binary ? '' : `+${f.additions}`}
              </td>
              <td className="mono fs-del">
                {f.binary ? '' : `−${f.deletions}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One commit: its message (trailers apart), who made it, the files it changed and their diffs. */
export default function CommitView() {
  const repo = useOutletContext<RepoDetail>();
  const o = repo.owner.username;
  const { sha = '' } = useParams();
  const base = `/${repo.fullName}`;
  const q = useQuery({
    queryKey: qk.commit(o, repo.name, sha),
    queryFn: () => api.commit(o, repo.name, sha),
  });
  const commit = q.data?.commit;
  const message = useMemo(
    () => (commit ? parseCommitMessage(commit.message) : null),
    [commit]
  );
  const entering = useEnter(!!q.data);

  const short = shortSha(commit?.hash ?? sha);
  usePageHead({
    icon: 'commit',
    crumbs: [
      { label: t('Commits'), to: `${base}/commits/${repo.defaultBranch}` },
      { label: short },
    ],
    title: short,
    documentTitle: message ? `${message.subject} · ${short}` : short,
  });

  // Anything the server refuses (an unknown or unreadable commit) is a missing page; a failed request is not.
  if (q.error instanceof ApiError && q.error.status < 500) return <NotFound />;
  if (q.isError && !q.data)
    return (
      <LoadError
        what={t('this commit')}
        error={q.error}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  if (!q.data || !commit || !message) return <Skeleton kind="graph" />;
  const { files } = q.data;
  const hasMessage = !!message.body || message.trailers.length > 0;
  return (
    <div className={`code-page commit-view ${entering}`}>
      <section className="panel commitbox" aria-label={t('Commit')}>
        <div className="cb-head">
          <div className="cb-head-main">
            <h2 className="cb-title">{message.subject}</h2>
            {hasMessage && (
              <div className="cb-message">
                <CommitBody message={message} />
              </div>
            )}
          </div>
          <div className="cb-head-actions">
            <Link to={`${base}/tree/${commit.hash}`} className="btn small">
              <CodeIcon />
              {t('Browse files')}
            </Link>
          </div>
        </div>
        <div className="cb-foot">
          <span className="cb-who">
            <CommitAuthor commit={commit} repo={repo} size={20} />
            <CoAuthored trailers={message.trailers} />
            <span className="muted">
              {t('committed {when}', { when: timeAgo(commit.committedAt) })}
            </span>
          </span>
          <span className="grow" />
          <span className="muted small cb-parents">
            {tn(commit.parents.length, '{n} parent', '{n} parents')}{' '}
            {commit.parents.map((p) => (
              <Link key={p} to={`${base}/commit/${p}`} className="mono shabtn">
                {shortSha(p)}
              </Link>
            ))}
          </span>
          <span className="cb-sha small">
            <span className="muted">{t('commit')}</span>{' '}
            <span className="mono">{shortSha(commit.hash)}</span>
            <CopyButton
              text={commit.hash}
              className="btn small quiet"
              label={t('Copy full SHA')}
            />
          </span>
        </div>
      </section>
      <Section
        title={tn(files.length, '{n} file changed', '{n} files changed')}
        actions={<DiffTotals files={files} />}
      >
        {files.length > 1 && <FileSummary files={files} />}
        <DiffView files={files} />
      </Section>
    </div>
  );
}
