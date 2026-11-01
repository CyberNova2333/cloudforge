// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMergeIcon, TagIcon } from '@primer/octicons-react';
import {
  api,
  qk,
  type Release,
  type RepoDetail,
  type UnreleasedChanges,
} from '@/lib/api/uiApi';
import { ApiError, errorMessage } from '@/lib/api/api';
import { fullDate, shortSha, timeAgo } from '@/lib/utils/format';
import { t, tn, tx } from '@/lib/i18n/i18n';
import { bumpLabel, isVersion } from '@/lib/repo/versionBump';
import { refreshDraft, suggestedDraft } from '@/lib/repo/releaseDraft';
import { Markdown } from '@/components/ui/Markdown';
import { MarkdownEditor } from '@/components/ui/CommentForm';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { Section } from '@/components/ui/Section';

/**
 * Releases (`/:owner/:repo/releases`): the Unreleased section (what has landed on the default branch since the
 * latest release, the version it makes and, with push access, the button that cuts it), then every release with its
 * notes: the changelog. Tags are one link away.
 */
export default function RepoReleases() {
  const repo = useOutletContext<RepoDetail>();
  const base = `/${repo.fullName}`;
  return (
    <>
      <PageHead
        icon="tag"
        crumbs={[{ label: t('Releases') }]}
        title={t('Releases')}
        tab="releases"
        lede={tx(
          'Each pull request says what it does to the version. Cut a release when what has landed on {branch} is ready; the releases below are the changelog.',
          { branch: <code>{repo.defaultBranch}</code> }
        )}
        actions={
          <Link to={`${base}/tags`} className="btn">
            <TagIcon size={16} />
            {t('Tags')}
          </Link>
        }
      />
      <Unreleased repo={repo} />
      <Changelog repo={repo} />
    </>
  );
}

function Unreleased({ repo }: { repo: RepoDetail }) {
  const o = repo.owner.username;
  const q = useQuery({
    queryKey: qk.unreleased(o, repo.name),
    queryFn: () => api.unreleased(o, repo.name),
  });
  const u = q.data;
  return (
    <Section
      title={t('Unreleased')}
      actions={
        u?.latest ? (
          <span className="muted small">
            {t('since {version}', { version: u.latest ?? '' })}
          </span>
        ) : undefined
      }
    >
      {q.isError && !u ? (
        <div className="panel">
          <QueryError
            error={q.error}
            onRetry={() => void q.refetch()}
            title={t('The unreleased changes did not load')}
          />
        </div>
      ) : !u ? (
        <RowsSkeleton rows={3} />
      ) : u.pulls.length === 0 ? (
        <div className="panel">
          <EmptyState
            picture={<TagIcon size={24} />}
            title={t('Nothing to release')}
            body={
              u.latest
                ? t('Nothing has landed on {branch} since {version}.', {
                    branch: repo.defaultBranch,
                    version: u.latest ?? '',
                  })
                : t('No pull request has landed on {branch} yet.', {
                    branch: repo.defaultBranch,
                  })
            }
          />
        </div>
      ) : (
        <div className="panel rel-unreleased">
          {u.latest ? (
            <ul className="rel-pulls">
              {u.pulls.map((p) => (
                <li key={p.number}>
                  <GitMergeIcon size={16} className="rel-merged" />
                  <span className="rel-pull-main">
                    <Link to={`/${repo.fullName}/pull/${p.number}`}>
                      {p.title}
                    </Link>{' '}
                    <span className="muted small">
                      {t('#{number} by {author}', {
                        number: p.number,
                        author: p.author,
                      })}
                    </span>
                  </span>
                  <Chip tone={p.bump ? 'info' : 'off'}>
                    {bumpLabel(p.bump)}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rel-count">
              <strong>
                {tn(
                  u.pulls.length,
                  '{n} pull request has',
                  '{n} pull requests have'
                )}
              </strong>{' '}
              {t(
                'landed. The first release is a starting line: it records them without listing them, and the changelog starts from there.'
              )}
            </p>
          )}
          <CutRelease repo={repo} u={u} refetch={() => q.refetch()} />
        </div>
      )}
    </Section>
  );
}

/** "Next: vX.Y.Z" and, with push access, the button and the inline form that cut it. */
function CutRelease({
  repo,
  u,
  refetch,
}: {
  repo: RepoDetail;
  u: UnreleasedChanges;
  refetch: () => Promise<{ data?: UnreleasedChanges }>;
}) {
  const o = repo.owner.username;
  const qc = useQueryClient();
  const first = !u.latest;
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = repo.permissions.write;

  const start = () => {
    const draft = suggestedDraft(u);
    setVersion(draft.version);
    setNotes(draft.notes);
    setError(null);
    setOpen(true);
  };

  const cut = async () => {
    if (!u.head) return;
    setBusy(true);
    setError(null);
    try {
      await api.cutRelease(o, repo.name, {
        headSha: u.head,
        version,
        notes,
      });
      setOpen(false);
      await qc.invalidateQueries({ queryKey: qk.repo(o, repo.name) });
    } catch (e) {
      setError(errorMessage(e));
      // The default branch moved: show what landed since, and cut from the new head. Fields still at the old
      // suggestion follow the new one; whatever the person typed stays, next to the server's message.
      if (e instanceof ApiError && e.status === 409 && e.body?.head) {
        const fresh = (await refetch()).data;
        if (fresh) {
          const draft = refreshDraft(
            { version, notes },
            suggestedDraft(u),
            suggestedDraft(fresh)
          );
          setVersion(draft.version);
          setNotes(draft.notes);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const typed = version.trim();
  const valid = isVersion(typed);
  const label = first
    ? t('Cut first release')
    : u.next
      ? t('Cut {version}', { version: u.next })
      : t('Cut release');

  return (
    <div className="rel-cut">
      {!first && (
        <p className="rel-next">
          {tx('Next: {version}', {
            version: <strong className="mono">{u.next ?? '—'}</strong>,
          })}
        </p>
      )}
      {!write ? null : !open ? (
        <button
          type="button"
          className="btn primary"
          onClick={start}
          disabled={!u.head}
          title={u.head ? undefined : t('The default branch has no commits')}
        >
          <TagIcon size={16} />
          {label}
        </button>
      ) : (
        <form
          className="rel-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && valid) void cut();
          }}
        >
          {error && (
            <p className="rel-error" role="alert">
              {error}
            </p>
          )}
          <div className="fld rel-version">
            <label htmlFor="rel-version">{t('Version')}</label>
            <input
              id="rel-version"
              className="form-control mono"
              value={version}
              placeholder="v0.1.0"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setVersion(e.target.value)}
              aria-describedby="rel-version-hint"
            />
            <span id="rel-version-hint" className="hint">
              {typed && !valid
                ? t('A version is vX.Y.Z, like v0.1.0.')
                : first
                  ? t(
                      'The version to start from. Later ones follow from each pull request’s bump.'
                    )
                  : t(
                      'Tags the head of {branch}. A version you type must be higher than {version}.',
                      { branch: repo.defaultBranch, version: u.latest ?? '' }
                    )}
            </span>
          </div>
          <div className="fld">
            <span className="lbl">{t('Notes')}</span>
            <MarkdownEditor
              value={notes}
              onChange={setNotes}
              placeholder={t('What this release changes')}
              minHeight={160}
            />
          </div>
          <div className="rel-form-actions">
            <button
              type="button"
              className="btn quiet"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t('Cancel')}
            </button>
            <PendingButton
              type="submit"
              className="primary"
              pending={busy}
              pendingLabel={t('Cutting…')}
              disabled={!valid}
            >
              {valid ? t('Cut {version}', { version: typed }) : label}
            </PendingButton>
          </div>
        </form>
      )}
    </div>
  );
}

function Changelog({ repo }: { repo: RepoDetail }) {
  const o = repo.owner.username;
  const q = useQuery({
    queryKey: qk.releases(o, repo.name),
    queryFn: () => api.releases(o, repo.name),
  });
  const list = q.data;
  return (
    <Section
      title={t('Releases')}
      actions={
        list?.length ? (
          <span className="muted small">
            {tn(list.length, '{n} release', '{n} releases')}
          </span>
        ) : undefined
      }
    >
      {q.isError && !list ? (
        <div className="panel">
          <QueryError
            error={q.error}
            onRetry={() => void q.refetch()}
            title={t('The releases did not load')}
          />
        </div>
      ) : !list ? (
        <RowsSkeleton rows={3} />
      ) : list.length === 0 ? (
        <div className="panel">
          <EmptyState
            picture={<TagIcon size={24} />}
            title={t('No releases yet')}
            body={t(
              'Once a release is cut, its notes appear here, newest first.'
            )}
          />
        </div>
      ) : (
        <ol className="rel-list">
          {list.map((r) => (
            <li key={r.tag}>
              <ReleaseEntry repo={repo} release={r} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** One release in the changelog: title (the tag unless renamed), when and by whom, the commit, and its notes. */
function ReleaseEntry({
  repo,
  release: r,
}: {
  repo: RepoDetail;
  release: Release;
}) {
  const base = `/${repo.fullName}`;
  return (
    <article className="panel rel-entry">
      <header className="rel-entry-head">
        <h3 className="rel-entry-title">
          <Link to={`${base}/releases/${encodeURIComponent(r.tag)}`}>
            {r.title}
          </Link>
        </h3>
        <p className="rel-entry-meta small muted">
          {r.title !== r.tag && (
            <span className="chip info">
              <TagIcon size={13} />
              {r.tag}
            </span>
          )}
          <time
            dateTime={new Date(r.createdAt).toISOString()}
            title={fullDate(r.createdAt)}
          >
            {timeAgo(r.createdAt)}
          </time>
          {r.createdBy && (
            <span>
              {tx('by {name}', {
                name: <Link to={`/${r.createdBy}`}>{r.createdBy}</Link>,
              })}
            </span>
          )}
          <Link to={`${base}/commit/${r.commitSha}`} className="mono">
            {shortSha(r.commitSha)}
          </Link>
        </p>
      </header>
      {r.notes.trim() ? (
        <Markdown source={r.notes} className="rel-notes" />
      ) : (
        <p className="muted small">{t('No notes.')}</p>
      )}
    </article>
  );
}
