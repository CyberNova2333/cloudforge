import { useState, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CrossReferenceIcon,
  IssueClosedIcon,
  IssueReopenedIcon,
  PencilIcon,
  PersonIcon,
  SkipIcon,
  TagIcon,
} from '@primer/octicons-react';
import {
  api,
  qk,
  type Comment,
  type IssueDetail,
  type IssueEvent,
  type RepoDetail,
} from '@/lib/api/uiApi';
import { ApiError, errorMessage } from '@/lib/api/api';
import { useCurrentUser } from '@/lib/auth/auth';
import { useSignInHref } from '@/lib/auth/signIn';
import { fullDate, timeAgo } from '@/lib/utils/format';
import { t, tn, tx } from '@/lib/i18n/i18n';
import { issueTimeline, issuesHref } from '@/lib/issues/issuesView';
import { EventRow } from '@/components/pull/PullEvents';
import { TimelineComment } from '@/components/pull/Conversation';
import { MarkdownEditor } from '@/components/ui/CommentForm';
import { PendingButton } from '@/components/ui/PendingButton';
import { InlineConfirm } from '@/components/ui/InlineConfirm';
import { PanelError } from '@/components/approvals/Panels';
import { Avatar } from '@/components/ui/Avatar';
import { usePageHead } from '@/components/ui/PageHead';
import { QueryError } from '@/components/actions/states';
import { Skeleton } from '@/components/ui/Skeleton';
import { PrStateIcon } from '@/pages/pulls/PrIcons';
import { IssueStatePill, LabelChip } from '@/components/issue/IssueParts';
import { SubscribeButton } from '@/components/notifications/NotificationParts';
import { NOT_FOUND_HEAD, NotFound } from '@/pages/overview/NotFound';

const when = (at: string) => (
  <time dateTime={at} title={fullDate(at)}>
    {timeAgo(at)}
  </time>
);

const who = (u: { username: string } | null) =>
  u ? (
    <Link to={`/${u.username}`} className="pr-who">
      {u.username}
    </Link>
  ) : (
    <b>CloudForge</b>
  );

/** One timeline event as a row on the conversation's line. */
function EventItem({ e, base }: { e: IssueEvent; base: string }) {
  const d = e.data;
  const pull = typeof d.pull === 'number' ? d.pull : null;
  const pullLink = pull ? (
    <Link to={`${base}/pull/${pull}`}>#{pull}</Link>
  ) : null;
  let icon: ReactNode = <TagIcon />;
  let text: ReactNode;
  switch (e.kind) {
    case 'closed':
      icon = d.reason === 'not_planned' ? <SkipIcon /> : <IssueClosedIcon />;
      text = pullLink
        ? tx('{who} closed this as completed in {pull} {when}', {
            who: who(e.actor),
            pull: pullLink,
            when: when(e.createdAt),
          })
        : d.reason === 'not_planned'
          ? tx('{who} closed this as not planned {when}', {
              who: who(e.actor),
              when: when(e.createdAt),
            })
          : tx('{who} closed this as completed {when}', {
              who: who(e.actor),
              when: when(e.createdAt),
            });
      break;
    case 'reopened':
      icon = <IssueReopenedIcon />;
      text = tx('{who} reopened this {when}', {
        who: who(e.actor),
        when: when(e.createdAt),
      });
      break;
    case 'labeled':
    case 'unlabeled': {
      const chip = (
        <LabelChip
          label={{
            name: String(d.label ?? ''),
            color: String(d.color ?? 'ededed'),
          }}
        />
      );
      const vars = { who: who(e.actor), label: chip, when: when(e.createdAt) };
      text =
        e.kind === 'labeled'
          ? tx('{who} added the {label} label {when}', vars)
          : tx('{who} removed the {label} label {when}', vars);
      break;
    }
    case 'assigned':
    case 'unassigned': {
      const self = !!e.user && !!e.actor && e.user.id === e.actor.id;
      const vars = {
        who: who(e.actor),
        person: who(e.user),
        when: when(e.createdAt),
      };
      icon = <PersonIcon />;
      text = self
        ? e.kind === 'assigned'
          ? tx('{who} self-assigned this {when}', vars)
          : tx('{who} removed their assignment {when}', vars)
        : e.kind === 'assigned'
          ? tx('{who} assigned {person} {when}', vars)
          : tx('{who} unassigned {person} {when}', vars);
      break;
    }
    case 'renamed':
      icon = <PencilIcon />;
      text = tx('{who} changed the title from {from} to {to} {when}', {
        who: who(e.actor),
        from: <del>{String(d.from ?? '')}</del>,
        to: <b>{String(d.to ?? '')}</b>,
        when: when(e.createdAt),
      });
      break;
    case 'referenced': {
      icon = <CrossReferenceIcon />;
      const vars = {
        who: who(e.actor),
        pull: pullLink,
        when: when(e.createdAt),
      };
      text = d.closes
        ? tx(
            '{who} linked {pull}, which closes this when it merges, {when}',
            vars
          )
        : tx('{who} mentioned this in {pull} {when}', vars);
      break;
    }
  }
  return (
    <EventRow
      icon={icon}
      tone={
        e.kind === 'closed' && d.reason !== 'not_planned' ? 'merged' : undefined
      }
    >
      {text}
    </EventRow>
  );
}

/** A comment you may edit or delete: its text in place of the view while editing. */
function EditableComment({
  c,
  me,
  isAuthor,
  canEdit,
  base,
  onSave,
  onDelete,
}: {
  c: Pick<Comment, 'author' | 'body' | 'createdAt'>;
  me: boolean;
  isAuthor: boolean;
  canEdit: boolean;
  base: string;
  onSave: (body: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (editing)
    return (
      <div className="pr-entry">
        <span className="pr-entry-ava" aria-hidden="true">
          <Avatar user={c.author} size={40} />
        </span>
        <div className="pr-card issue-edit">
          <MarkdownEditor value={draft} onChange={setDraft} minHeight={120} />
          {error && <PanelError error={error} />}
          <div className="issue-edit-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(c.body);
                setEditing(false);
              }}
            >
              {t('Cancel')}
            </button>
            <PendingButton
              className="primary"
              pending={busy}
              pendingLabel={t('Saving…')}
              onClick={() => void run(() => onSave(draft))}
            >
              {t('Save')}
            </PendingButton>
          </div>
        </div>
      </div>
    );
  return (
    <TimelineComment
      c={c}
      me={me}
      label={isAuthor ? t('Author') : undefined}
      refs={base}
      actions={
        canEdit ? (
          <span className="issue-comment-tools">
            <button
              type="button"
              className="btn-link small"
              onClick={() => {
                setDraft(c.body);
                setEditing(true);
              }}
            >
              {t('Edit')}
            </button>
            {onDelete && (
              <InlineConfirm
                label={t('Delete')}
                confirmLabel={t('Delete comment')}
                pendingLabel={t('Deleting…')}
                pending={busy}
                error={error}
                onConfirm={() => void run(onDelete)}
              />
            )}
          </span>
        ) : undefined
      }
    />
  );
}

/** The side panel: assignees, labels and linked pull requests; writers change the first two. */
function Side({
  repo,
  d,
  canTriage,
  onChange,
}: {
  repo: RepoDetail;
  d: IssueDetail;
  canTriage: boolean;
  onChange: (body: {
    labels?: string[];
    assignees?: string[];
  }) => Promise<unknown>;
}) {
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const me = useCurrentUser();
  const issue = d.issue;
  const labels = useQuery({
    queryKey: qk.labels(o, repo.name),
    queryFn: () => api.labels(o, repo.name),
    enabled: canTriage,
  });
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (body: Parameters<typeof onChange>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await onChange(body);
      setAssignee('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const assigned = issue.assignees.map((u) => u.username);
  const has = new Set(issue.labels.map((l) => l.name));
  return (
    <aside className="issue-side">
      {error && <PanelError error={error} />}
      <section className="issue-side-box" aria-labelledby="issue-notify">
        <h3 id="issue-notify">{t('Notifications')}</h3>
        <SubscribeButton repo={repo} kind="issues" number={issue.number} />
      </section>
      <section className="issue-side-box" aria-labelledby="issue-assignees">
        <h3 id="issue-assignees">{t('Assignees')}</h3>
        {issue.assignees.length ? (
          <ul className="issue-people">
            {issue.assignees.map((u) => (
              <li key={u.id}>
                <Avatar user={u} size={20} />
                <Link to={`/${u.username}`}>{u.username}</Link>
                {canTriage && (
                  <button
                    type="button"
                    className="btn-link small"
                    disabled={busy}
                    aria-label={t('Unassign {name}', { name: u.username })}
                    onClick={() =>
                      void change({
                        assignees: assigned.filter((n) => n !== u.username),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t('Nobody yet')}</p>
        )}
        {canTriage && (
          <form
            className="issue-assign"
            onSubmit={(e) => {
              e.preventDefault();
              const name = assignee.trim().replace(/^@/, '');
              if (name && !assigned.includes(name))
                void change({ assignees: [...assigned, name] });
            }}
          >
            {me?.username && !assigned.includes(me.username) && (
              <button
                type="button"
                className="btn-link small"
                disabled={busy}
                onClick={() =>
                  void change({ assignees: [...assigned, me.username!] })
                }
              >
                {t('Assign yourself')}
              </button>
            )}
            <input
              className="form-control input-sm"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder={t('Username')}
              aria-label={t('Assign someone by username')}
            />
          </form>
        )}
      </section>
      <section className="issue-side-box" aria-labelledby="issue-labels">
        <h3 id="issue-labels">{t('Labels')}</h3>
        {issue.labels.length ? (
          <div className="issue-labels">
            {issue.labels.map((l) => (
              <Link key={l.id} to={issuesHref(base, { label: l.name })}>
                <LabelChip label={l} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted small">{t('None yet')}</p>
        )}
        {canTriage && labels.data && (
          <fieldset className="issue-label-picks" disabled={busy}>
            <legend className="sr">{t('Choose labels')}</legend>
            {labels.data.map((l) => (
              <label key={l.id}>
                <input
                  type="checkbox"
                  checked={has.has(l.name)}
                  onChange={(e) =>
                    void change({
                      labels: e.target.checked
                        ? [...has, l.name]
                        : [...has].filter((n) => n !== l.name),
                    })
                  }
                />
                <LabelChip label={l} />
              </label>
            ))}
            {!labels.data.length && (
              <Link to={`${base}/labels`} className="small">
                {t('Create labels')}
              </Link>
            )}
          </fieldset>
        )}
      </section>
      <section className="issue-side-box" aria-labelledby="issue-pulls">
        <h3 id="issue-pulls">{t('Pull requests')}</h3>
        {d.pulls.length ? (
          <ul className="issue-pulls">
            {d.pulls.map((p) => (
              <li key={p.number}>
                <PrStateIcon state={p.state as 'open' | 'closed' | 'merged'} />
                <Link to={`${base}/pull/${p.number}`}>
                  #{p.number} {p.title}
                </Link>
                {p.closes && (
                  <span className="chip off">{t('Closes this')}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">
            {t(
              'Write “Fixes #{n}” in a pull request to close this issue when it merges.',
              {
                n: issue.number,
              }
            )}
          </p>
        )}
      </section>
    </aside>
  );
}

/** One issue: what it says, its conversation and events, and who and what it is linked to. */
export default function IssueView() {
  const repo = useOutletContext<RepoDetail>();
  const { number } = useParams();
  const num = Number(number);
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const me = useCurrentUser();
  const signIn = useSignInHref();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.issue(o, repo.name, num),
    queryFn: () => api.issue(o, repo.name, num),
    enabled: Number.isInteger(num) && num > 0,
    retry: (count, e) =>
      !(e instanceof ApiError && e.status === 404) && count < 2,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<null | 'comment' | 'state'>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const d = query.data;
  usePageHead(
    d
      ? {
          icon: 'issue',
          crumbs: [
            { label: t('Issues'), to: `${base}/issues` },
            { label: `#${d.issue.number}` },
          ],
          title: d.issue.title,
          tab: 'issues',
          documentTitle: `${d.issue.title} · #${d.issue.number}`,
        }
      : NOT_FOUND_HEAD
  );

  const missing = query.error instanceof ApiError && query.error.status === 404;
  const pullNumber = missing
    ? ((query.error as ApiError).body?.pullNumber as number | undefined)
    : undefined;
  if (typeof pullNumber === 'number')
    return <Navigate to={`${base}/pull/${pullNumber}`} replace />;
  if (missing || !Number.isInteger(num) || num < 1) return <NotFound />;
  if (query.isError && !d)
    return (
      <div className="panel">
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          title={t('The issue did not load')}
        />
      </div>
    );
  if (!d) return <Skeleton />;

  const issue = d.issue;
  const canEdit = repo.permissions.write || me?.id === issue.author.id;
  const canTriage = repo.permissions.write;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.issue(o, repo.name, num) }),
      queryClient.invalidateQueries({
        queryKey: ['repo', o, repo.name, 'issues'],
      }),
      queryClient.invalidateQueries({ queryKey: qk.repo(o, repo.name) }),
    ]);
  const update = async (body: Parameters<typeof api.updateIssue>[3]) => {
    await api.updateIssue(o, repo.name, num, body);
    await refresh();
  };
  const send = async (close: 'completed' | 'not_planned' | 'reopen' | null) => {
    setSending(close ? 'state' : 'comment');
    setError(null);
    try {
      if (draft.trim()) {
        await api.commentIssue(o, repo.name, num, draft);
        setDraft('');
      }
      if (close === 'reopen') await update({ state: 'open' });
      else if (close) await update({ state: 'closed', stateReason: close });
      else await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(null);
    }
  };
  const timeline = issueTimeline(d.comments, d.events);

  return (
    <div className="issue-page">
      <header className="issue-head">
        {editingTitle ? (
          <form
            className="issue-title-edit"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              void update({ title: title.trim() })
                .then(() => setEditingTitle(false))
                .catch((err) => setError(errorMessage(err)));
            }}
          >
            <input
              className="form-control input-lg"
              value={title}
              maxLength={256}
              autoFocus
              aria-label={t('Title')}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="submit" className="btn primary">
              {t('Save')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setEditingTitle(false)}
            >
              {t('Cancel')}
            </button>
          </form>
        ) : (
          <h2 className="issue-title">
            {issue.title} <span className="muted">#{issue.number}</span>
            {canEdit && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setTitle(issue.title);
                  setEditingTitle(true);
                }}
              >
                {t('Edit')}
              </button>
            )}
          </h2>
        )}
        <p className="issue-sub">
          <IssueStatePill issue={issue} />
          <span>
            {tx('{author} opened this issue {when}', {
              author: who(issue.author),
              when: when(issue.createdAt),
            })}
            {' · '}
            {tn(issue.commentCount, '{n} comment', '{n} comments')}
          </span>
        </p>
      </header>
      <div className="issue-layout">
        <section className="section issue-main" aria-label={t('Conversation')}>
          <div className="pr-timeline">
            <EditableComment
              c={{
                author: issue.author,
                body: issue.body,
                createdAt: issue.createdAt,
              }}
              me={issue.author.id === me?.id}
              isAuthor
              canEdit={canEdit}
              base={base}
              onSave={(body) => update({ body })}
            />
            {timeline.map((entry) =>
              entry.kind === 'event' ? (
                <EventItem key={entry.event.id} e={entry.event} base={base} />
              ) : (
                <EditableComment
                  key={entry.comment.id}
                  c={entry.comment}
                  me={entry.comment.author.id === me?.id}
                  isAuthor={entry.comment.author.id === issue.author.id}
                  canEdit={
                    repo.permissions.write || entry.comment.author.id === me?.id
                  }
                  base={base}
                  onSave={async (body) => {
                    await api.updateIssueComment(
                      o,
                      repo.name,
                      num,
                      entry.comment.id,
                      body
                    );
                    await refresh();
                  }}
                  onDelete={async () => {
                    await api.deleteIssueComment(
                      o,
                      repo.name,
                      num,
                      entry.comment.id
                    );
                    await refresh();
                  }}
                />
              )
            )}
          </div>
          {me ? (
            <div className="issue-reply">
              <MarkdownEditor value={draft} onChange={setDraft} />
              {error && <PanelError error={error} />}
              <div className="issue-edit-actions">
                {canEdit &&
                  (issue.state === 'open' ? (
                    <>
                      <PendingButton
                        pending={sending === 'state'}
                        disabled={!!sending}
                        onClick={() => void send('not_planned')}
                      >
                        <SkipIcon size={14} />
                        {t('Close as not planned')}
                      </PendingButton>
                      <PendingButton
                        pending={sending === 'state'}
                        disabled={!!sending}
                        onClick={() => void send('completed')}
                      >
                        <IssueClosedIcon size={14} />
                        {draft.trim()
                          ? t('Close with comment')
                          : t('Close issue')}
                      </PendingButton>
                    </>
                  ) : (
                    <PendingButton
                      pending={sending === 'state'}
                      disabled={!!sending}
                      onClick={() => void send('reopen')}
                    >
                      <IssueReopenedIcon size={14} />
                      {t('Reopen issue')}
                    </PendingButton>
                  ))}
                <PendingButton
                  className="primary"
                  pending={sending === 'comment'}
                  pendingLabel={t('Sending…')}
                  disabled={!draft.trim() || !!sending}
                  onClick={() => void send(null)}
                >
                  {t('Comment')}
                </PendingButton>
              </div>
            </div>
          ) : (
            <p className="muted">
              <Link to={signIn}>{t('Sign in')}</Link>{' '}
              {t('to join the conversation.')}
            </p>
          )}
          {repo.permissions.admin && (
            <div className="issue-danger">
              <InlineConfirm
                label={t('Delete issue')}
                confirmLabel={t('Delete issue #{n} for good', {
                  n: issue.number,
                })}
                pendingLabel={t('Deleting…')}
                onConfirm={() =>
                  void api
                    .deleteIssue(o, repo.name, num)
                    .then(async () => {
                      await queryClient.invalidateQueries({
                        queryKey: ['repo', o, repo.name, 'issues'],
                      });
                      await queryClient.invalidateQueries({
                        queryKey: qk.repo(o, repo.name),
                      });
                      navigate(`${base}/issues`);
                    })
                    .catch((e) => setError(errorMessage(e)))
                }
              />
            </div>
          )}
        </section>
        <Side
          repo={repo}
          d={d}
          canTriage={canTriage}
          onChange={(body) => update(body)}
        />
      </div>
    </div>
  );
}
