// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import {
  Link,
  Navigate,
  useNavigate,
  useOutletContext,
} from 'react-router-dom';
import { useSignInHref } from '@/lib/signIn';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  CheckIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitIcon,
  XIcon,
} from '@primer/octicons-react';
import { useRepoSubPath } from '@/components/RepoLayout';
import {
  api,
  qk,
  type FileDiff,
  type RepoDetail,
  type VersionBump,
} from '@/lib/uiApi';
import { BUMPS, BUMP_OPTION, parseBump } from '@/lib/versionBump';
import { useCurrentUser } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { t, tx } from '@/lib/i18n';
import {
  comparison,
  compareHref,
  parseRange,
  prefillTitle,
} from '@/lib/compareForm';
import { Avatar } from '@/components/Avatar';
import { BranchSelect } from '@/components/BranchSelect';
import { CommitList } from '@/components/CommitList';
import { MarkdownEditor } from '@/components/CommentForm';
import { DiffTotals, DiffView } from '@/components/DiffView';
import { QueryError } from '@/components/actions/states';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { Section } from '@/components/ui/Section';

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

/** Compare two branches and, with write access, open a pull request from the comparison. Members only. */
export default function PullNew() {
  const signedIn = !!useCurrentUser();
  const signIn = useSignInHref();
  return signedIn ? <CompareBranches /> : <Navigate to={signIn} replace />;
}

function CompareBranches() {
  const repo = useOutletContext<RepoDetail>();
  const user = useCurrentUser()!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const base = `/${repo.fullName}`;
  const { base: from, head } = parseRange(
    useRepoSubPath('compare') ?? '',
    repo.defaultBranch
  );
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bump, setBump] = useState<VersionBump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cmp = useQuery({
    queryKey: qk.compare(repo.owner.username, repo.name, from, head),
    queryFn: () => api.compare(repo.owner.username, repo.name, from, head),
    enabled: !!head && head !== from,
  });
  const go = (b: string, h: string) => navigate(compareHref(base, b, h));
  const view = cmp.data ? comparison(cmp.data) : null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const pr = await api.createPull(repo.owner.username, repo.name, {
        title,
        body,
        base: from,
        head,
        versionBump: bump,
      });
      await qc.invalidateQueries({
        queryKey: qk.repo(repo.owner.username, repo.name),
      });
      navigate(`${base}/pull/${pr.number}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const picked = !!head && head !== from;
  const others = repo.branches.filter((b) => b.name !== from);
  // The band's trail and name; the page's own heading below changes once the form is open.
  usePageHead({
    icon: 'pull',
    crumbs: [
      { label: t('Pull requests'), to: `${base}/pulls` },
      { label: t('New pull request') },
    ],
    title: t('New pull request'),
    tab: 'pulls',
  });

  return (
    <div className="cmp">
      <header className="phead">
        <div className="phead-row">
          <div className="phead-main">
            <h2 className="ph-title">
              {showForm ? t('Open a pull request') : t('Comparing changes')}
            </h2>
            <p className="lede">
              {showForm
                ? t(
                    'Create a new pull request by comparing changes across two branches.'
                  )
                : t(
                    'Choose two branches to see what’s changed or to start a new pull request.'
                  )}
            </p>
          </div>
        </div>
      </header>

      <div className="panel cmp-bar">
        <BranchSelect
          branches={repo.branches}
          current={from}
          label={t('base:')}
          defaultBranch={repo.defaultBranch}
          onSelect={(b) => go(b, head)}
        />
        <span className="cmp-arrow muted">
          <ArrowLeftIcon aria-label={t('compared with')} />
        </span>
        <BranchSelect
          branches={repo.branches}
          current={head || t('choose…')}
          label={t('compare:')}
          defaultBranch={repo.defaultBranch}
          onSelect={(h) => go(from, h)}
        />
        {view && picked && (view.canRebase || view.conflicts) && (
          <span className="cmp-status">
            {view.canRebase ? (
              <>
                <Chip tone="good" icon={<CheckIcon size={13} />}>
                  {t('Able to merge')}
                </Chip>
                <span className="muted small">
                  {t('This branch can be rebased onto the base cleanly.')}
                </span>
              </>
            ) : (
              <>
                <Chip tone="critical" icon={<XIcon size={13} />}>
                  {t('Can’t rebase automatically')}
                </Chip>
                <span className="muted small">
                  {t('Don’t worry, you can still create the pull request.')}
                </span>
              </>
            )}
          </span>
        )}
      </div>

      {!picked ? (
        <div className="panel">
          <EmptyState
            picture={<GitBranchIcon size={24} />}
            title={t('Compare changes')}
            body={tx(
              'Compare changes across branches. Pick a branch to compare against {branch}.',
              { branch: <strong>{from}</strong> }
            )}
          />
          {others.length ? (
            <div className="cmp-picks">
              {others.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  className="btn small"
                  onClick={() => go(from, b.name)}
                >
                  {b.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="cmp-picks muted small">
              {t('There are no other branches yet.')}
            </p>
          )}
        </div>
      ) : cmp.isError ? (
        <div className="panel">
          <QueryError
            error={cmp.error}
            onRetry={() => void cmp.refetch()}
            title={t('This comparison did not load')}
          />
        </div>
      ) : cmp.isPending ? (
        <div
          className="cmp-wait"
          role="status"
          aria-busy="true"
          aria-label={t('Loading the comparison')}
        >
          <div className="sk sk-block short" />
          <div className="sk sk-row tall" />
          <div className="sk sk-block" />
        </div>
      ) : !view?.ready ? (
        <div className="panel">
          <EmptyState
            picture={<GitCommitIcon size={24} />}
            title={t('There isn’t anything to compare.')}
            body={tx('{from} is up to date with all commits from {head}.', {
              from: <strong>{from}</strong>,
              head: <strong>{head}</strong>,
            })}
          />
        </div>
      ) : (
        <>
          {!showForm ? (
            <div className="panel cmp-open">
              <p>
                {t(
                  'Discuss and review the changes in this comparison with others.'
                )}
              </p>
              {repo.permissions.write ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setShowForm(true);
                    if (!title) setTitle(prefillTitle(cmp.data!.commits, head));
                  }}
                >
                  {t('Create pull request')}
                </button>
              ) : (
                <span className="muted small">
                  {t('You need write access to open a pull request.')}
                </span>
              )}
            </div>
          ) : (
            <form
              className="panel cmp-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && title.trim()) void create();
              }}
            >
              <span className="cmp-avatar">
                <Avatar
                  user={{ username: user.username ?? user.name }}
                  size={40}
                />
              </span>
              <div className="cmp-fields">
                {error && (
                  <p className="cmp-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="fld">
                  <label htmlFor="pr-title">{t('Add a title')}</label>
                  <input
                    id="pr-title"
                    className="form-control input-lg"
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('Title')}
                  />
                </div>
                <div className="fld">
                  <span className="lbl" id="pr-body-label">
                    {t('Add a description')}
                  </span>
                  <MarkdownEditor
                    value={body}
                    onChange={setBody}
                    placeholder={t('Add your description here...')}
                    minHeight={200}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="pr-bump">{t('Version bump')}</label>
                  <select
                    id="pr-bump"
                    className="form-select"
                    value={bump ?? ''}
                    onChange={(e) => setBump(parseBump(e.target.value))}
                    aria-describedby="pr-bump-hint"
                  >
                    <option value="">{t('None (counts as patch)')}</option>
                    {BUMPS.map((b) => (
                      <option key={b} value={b}>
                        {BUMP_OPTION[b]}
                      </option>
                    ))}
                  </select>
                  <span id="pr-bump-hint" className="hint">
                    {t(
                      'What this change does to the next release’s version once it lands. Nothing changes until someone cuts a release.'
                    )}
                  </span>
                </div>
                <div className="cmp-actions">
                  <PendingButton
                    type="submit"
                    className="primary"
                    pending={busy}
                    pendingLabel={t('Creating…')}
                    disabled={!title.trim()}
                  >
                    {t('Create pull request')}
                  </PendingButton>
                </div>
              </div>
            </form>
          )}

          <div className="panel cmp-stats">
            <span>
              <GitCommitIcon size={16} />{' '}
              {cmp.data!.commits.length === 1
                ? tx('{n} commit', {
                    n: <strong>{cmp.data!.commits.length}</strong>,
                  })
                : tx('{n} commits', {
                    n: <strong>{cmp.data!.commits.length}</strong>,
                  })}
            </span>
            <span>
              <FileDiffIcon size={16} />{' '}
              {cmp.data!.files.length === 1
                ? tx('{n} file changed', {
                    n: <strong>{cmp.data!.files.length}</strong>,
                  })
                : tx('{n} files changed', {
                    n: <strong>{cmp.data!.files.length}</strong>,
                  })}
            </span>
            <DiffTotals files={cmp.data!.files} />
          </div>

          <CommitList
            commits={[...cmp.data!.commits].reverse()}
            base={base}
            repo={repo}
          />

          <Section title={t('Files changed')}>
            {cmp.data!.files.length > 1 && (
              <FileSummary files={cmp.data!.files} />
            )}
            <DiffView files={cmp.data!.files} />
          </Section>
        </>
      )}
      <p className="small muted">
        <Link to={`${base}/pulls`}>{t('Back to pull requests')}</Link>
      </p>
    </div>
  );
}
