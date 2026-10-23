// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertIcon,
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  FileIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  InboxIcon,
  PeopleIcon,
  PersonIcon,
  ShieldIcon,
  SyncIcon,
  UndoIcon,
  XIcon,
} from '@primer/octicons-react';
import { api, qk, type Finding as FindingData } from '@/lib/uiApi';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { useApprovalPages } from '@/lib/approvals';
import {
  dedupeItems,
  inboxRows,
  isDecided,
  splitFindingDetail,
} from '@/lib/approvalsInbox';
import {
  AI_NAME,
  decidedByText,
  findingEventText,
  possessive,
} from '@/lib/claudeLog';
import { shortSha, timeAgo } from '@/lib/format';
import { lang, t, tx } from '@/lib/i18n';
import { agentColor, type AgentStatus } from '@/lib/agentLook';
import { AgentAvatar } from '@/components/AgentAvatar';
import { Markdown } from '@/components/Markdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { Verdict } from '@/components/ui/Verdict';
import { QueryError } from '@/components/actions/states';
import { failure, useRefresh } from '@/components/approvals/actions';
import { ClaudeTile } from '@/components/approvals/ClaudePanel';
import { agentName as userAgentName } from '@/components/approvals/InboxRow';
import {
  ApproveReasonPanel,
  AskPanel,
  ChangesPanel,
  DismissPanel,
  PanelError,
  TEXT_MAX,
  TeachField,
  teachText,
  useAskCandidates,
} from '@/components/approvals/Panels';

const nameOf = (f: FindingData) => f.agent?.name ?? t('A removed agent');
const handleOf = (f: FindingData) => f.agent?.login ?? 'agent';
/** An agent's name as the owner of its finding: "Security's" in English; Chinese says "Security 的" in the sentence. */
const whose = (name: string) => (lang === 'zh' ? name : possessive(name));
/** An owner question: a plain yes/no for the person, answered with Yes / No, fix it / Ask someone. */
const isQuestion = (f: FindingData) =>
  f.kind === 'needs_person' && !!f.question;

/** The agent's face for the finding's state. */
function statusOf(f: FindingData): AgentStatus {
  if (f.state === 'open') return 'needs';
  if (f.state === 'changes_requested') return 'changes_requested';
  return f.teach ? 'learned' : 'approved';
}

/** One finding (`/approvals/:flagId`): an owner question or a developer finding, its decision, teaching, asking
 * someone, letting Claude decide, and its history. */
export default function Finding() {
  const { flagId = '' } = useParams();
  const q = useQuery({
    queryKey: qk.approvalFlag(flagId),
    queryFn: () => api.approvalFlag(flagId),
  });
  const f = q.data;
  const notFound = !f && q.error instanceof ApiError && q.error.status === 404;
  usePageHead({
    icon: 'inbox',
    crumbs: [
      { label: t('Approvals'), to: '/approvals' },
      {
        label: f
          ? t('{agent} on #{n}', { agent: nameOf(f), n: f.pull.number })
          : notFound
            ? t('Not found')
            : t('Finding'),
      },
    ],
    title: f
      ? isQuestion(f)
        ? f.question!
        : f.title
      : notFound
        ? t('Finding not found')
        : t('Finding'),
    documentTitle: f
      ? t('{agent} on #{n}', { agent: nameOf(f), n: f.pull.number })
      : undefined,
  });

  if (notFound)
    return (
      <div className="ap">
        <div className="panel">
          <EmptyState
            picture={<InboxIcon size={24} />}
            title={t('Finding not found')}
            body={t(
              'This finding doesn’t exist, or you can’t see its repository.'
            )}
            action={
              <Link className="btn small" to="/approvals">
                {t('Back to Approvals')}
              </Link>
            }
          />
        </div>
      </div>
    );
  if (q.isError && !f)
    return (
      <div className="ap">
        <div className="panel">
          <QueryError
            error={q.error}
            onRetry={() => void q.refetch()}
            title={t('This finding did not load')}
          />
        </div>
      </div>
    );
  if (!f) return <Skeleton kind="detail" />;
  return <FindingView f={f} />;
}

function FindingView({ f }: { f: FindingData }) {
  const me = useCurrentUser()?.username ?? null;
  const name = nameOf(f);
  const handle = handleOf(f);
  const color = agentColor(handle, f.agent?.color);
  const question = isQuestion(f);
  const parts = splitFindingDetail(f.detail);
  const n = f.pull.number;
  const repo = f.repo.fullName;
  const prLink = (
    <Link to={`/${repo}/pull/${n}`} className="mono">
      #{n}
    </Link>
  );
  const sha = <span className="mono">{shortSha(f.headSha)}</span>;
  const waiting = f.state === 'open' || f.state === 'changes_requested';
  const md = (source: string | null) =>
    source ? <Markdown source={source} className="ap-md" /> : null;

  return (
    <div className="ap" style={{ '--agent': color } as CSSProperties}>
      <header className="ap-fhead">
        <AgentAvatar
          handle={handle}
          color={color}
          status={statusOf(f)}
          size={56}
        />
        <div className="ap-fhead-main">
          <span className="eyebrow">
            {f.kind === 'change_requested'
              ? t('{agent} asked for a change', { agent: name })
              : t('{agent} is asking', { agent: name })}{' '}
            · {repo} · #{n}
          </span>
          <h2 className="ph-title">{question ? f.question : f.title}</h2>
          <p className="lede">
            {question
              ? tx(
                  '{agent} is asking about {pr} {title}. You’re answering for commit {sha}.',
                  {
                    agent: name,
                    pr: prLink,
                    title: f.pull.title,
                    sha,
                  }
                )
              : tx('{agent} raised this on {pr} {title}, at commit {sha}.', {
                  agent: name,
                  pr: prLink,
                  title: f.pull.title,
                  sha,
                })}
          </p>
        </div>
      </header>

      <div className="ap-cols">
        <div className="ap-col">
          {(parts.sentence || question) && (
            <p className="ap-plain">{parts.sentence ?? f.title}</p>
          )}
          <div className="ap-advice">
            {f.guarded ? <ShieldIcon size={16} /> : <PersonIcon size={16} />}
            <span>
              {question ? (
                <>
                  <b>{t('{whose} finding.', { whose: whose(name) })}</b>{' '}
                  {f.title}
                </>
              ) : f.kind === 'change_requested' ? (
                <>
                  <b>{t('{agent} asked for a change.', { agent: name })}</b>
                  {waiting && (
                    <>
                      {' '}
                      {t(
                        'The pull request’s author makes it, or you can dismiss it.'
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <b>
                    {t('{agent} wants a person to decide.', { agent: name })}
                  </b>
                  {waiting && (
                    <>
                      {' '}
                      {t(
                        'Approve it if this is intended. Otherwise request changes.'
                      )}
                    </>
                  )}
                </>
              )}
            </span>
          </div>
          {md(parts.table)}
          {md(parts.diagram)}
          {/* A developer reads the cited lines first: excerpts start open here. */}
          {!question &&
            parts.excerpts.map((x, i) => (
              <div key={i}>{md(x.replace(/^<details>/, '<details open>'))}</div>
            ))}
          {md(parts.rest)}
          {!f.detail && (
            <p className="ap-small">
              {t('No further detail: the review model didn’t answer.')}
            </p>
          )}
          {f.state !== 'open' && <Outcome f={f} me={me} />}
          {waiting && f.can.decide ? (
            question ? (
              <OwnerAnswer f={f} me={me} />
            ) : (
              <DevAnswer f={f} me={me} />
            )
          ) : waiting ? (
            <p className="ap-small ap-cant">
              <ShieldIcon size={13} />
              {f.pull.state !== 'open'
                ? f.pull.state === 'merged'
                  ? t(
                      '#{n} is merged, so its findings can’t be decided any more.',
                      { n }
                    )
                  : t(
                      '#{n} is closed, so its findings can’t be decided any more.',
                      { n }
                    )
                : t('Only people who can push to {repo} decide its findings.', {
                    repo,
                  })}
            </p>
          ) : null}
        </div>
        <aside className="ap-col ap-aside" aria-label={t('About this finding')}>
          <Facts f={f} me={me} />
          <details className="ap-box ap-tech" open={!question}>
            <summary>{t('Technical details')}</summary>
            <div className="ap-tech-body">
              {f.agent && (
                <p>
                  <Verdict
                    handle={handle}
                    name={name}
                    color={f.agent.color}
                    status={statusOf(f)}
                  />
                </p>
              )}
              {question &&
                parts.excerpts.map((x, i) => <div key={i}>{md(x)}</div>)}
              {f.paths.length > 0 && (
                <ul className="ap-files" aria-label={t('Files')}>
                  {f.paths.map((p) => (
                    <li key={p}>
                      <FileIcon size={14} />
                      <Link to={`/${repo}/pull/${n}/files#diff-${p}`}>{p}</Link>
                    </li>
                  ))}
                </ul>
              )}
              {f.agentSha && f.agent?.repository && (
                <p className="ap-small">
                  <BookIcon size={13} />
                  <span>
                    {tx('{agent} reviewed with its instructions at {sha}.', {
                      agent: name,
                      sha: (
                        <Link
                          className="mono"
                          to={`/${f.agent.repository}/commit/${f.agentSha}`}
                        >
                          {shortSha(f.agentSha)}
                        </Link>
                      ),
                    })}
                  </span>
                </p>
              )}
              {f.detailModel && (
                <p className="ap-small">
                  {t('Written by {model}.', { model: f.detailModel })}
                </p>
              )}
              <div className="ap-actions">
                <Link className="btn small" to={`/${repo}/pull/${n}`}>
                  {t('Open #{n}', { n })}
                </Link>
                {f.agent && (
                  <Link className="btn small quiet" to={`/${handle}`}>
                    {t('About {agent}', { agent: name })}
                  </Link>
                )}
              </div>
            </div>
          </details>
          <History f={f} me={me} />
        </aside>
      </div>
    </div>
  );
}

function Facts({ f, me }: { f: FindingData; me: string | null }) {
  const n = f.pull.number;
  const waiting = f.state === 'open' || f.state === 'changes_requested';
  const name = nameOf(f);
  const author = f.pull.author.name || `@${f.pull.author.login}`;
  const moved = f.pull.headSha && f.pull.headSha !== f.headSha;
  const items: [ReactNode, ReactNode][] = [
    [
      <GitPullRequestIcon size={14} />,
      tx('{pr} by {author}, in {repo}{state}.', {
        pr: (
          <Link to={`/${f.repo.fullName}/pull/${n}`}>
            #{n} {f.pull.title}
          </Link>
        ),
        author: f.pull.author.login === me ? t('you') : author,
        repo: f.repo.fullName,
        state: f.pull.state !== 'open' ? ` (${f.pull.state})` : '',
      }),
    ],
    [
      <GitCommitIcon size={14} />,
      <>
        {tx('Raised on commit {sha}.', {
          sha: <span className="mono">{shortSha(f.headSha)}</span>,
        })}
        {moved && (
          <>
            {' '}
            {tx('The branch has moved on to {sha} since.', {
              sha: <span className="mono">{shortSha(f.pull.headSha!)}</span>,
            })}
          </>
        )}
      </>,
    ],
  ];
  if (f.guarded)
    items.push([
      <ShieldIcon size={14} />,
      f.kind === 'change_requested'
        ? t(
            'Dismissing needs a reason. It goes in the audit log with your name. {ai} never decides {agent} findings.',
            { ai: AI_NAME, agent: name }
          )
        : t(
            'Approving needs a reason. It goes in the audit log with your name. {ai} never decides {agent} findings.',
            { ai: AI_NAME, agent: name }
          ),
    ]);
  if (f.assignee) {
    const who =
      f.assignee.login === me
        ? t('you')
        : f.assignee.name || `@${f.assignee.login}`;
    const by = f.assignedBy
      ? f.assignedBy.login === me
        ? t('you')
        : f.assignedBy.name || `@${f.assignedBy.login}`
      : null;
    const when = f.assignedAt ? timeAgo(new Date(f.assignedAt)) : null;
    items.push([
      <PeopleIcon size={14} />,
      by && when
        ? t('Assigned to {who} by {by}, {when}.', { who, by, when })
        : by
          ? t('Assigned to {who} by {by}.', { who, by })
          : when
            ? t('Assigned to {who}, {when}.', { who, when })
            : t('Assigned to {who}.', { who }),
    ]);
  }
  if (f.delegated)
    items.push([
      <ClaudeTile />,
      t('You let {ai} decide {whose} findings on your pull requests.', {
        ai: AI_NAME,
        whose: whose(name),
      }),
    ]);
  if (f.pull.state === 'open' && waiting)
    items.push([
      <UndoIcon size={14} />,
      t('You can change your answer while #{n} is open.', { n }),
    ]);
  return (
    <section className="ap-box" aria-labelledby="ap-facts-h">
      <div className="ap-box-head">
        <h2 id="ap-facts-h">
          {waiting ? t('Before you answer') : t('About this finding')}
        </h2>
      </div>
      <ul className="ap-facts">
        {items.map(([icon, text], i) => (
          <li key={i}>
            {icon}
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ f, me }: { f: FindingData; me: string | null }) {
  return (
    <section className="ap-box" aria-labelledby="ap-hist-h">
      <div className="ap-box-head">
        <h2 id="ap-hist-h">{t('History')}</h2>
      </div>
      <ol className="ap-log">
        <li>
          <time
            className="ap-time"
            dateTime={new Date(f.createdAt).toISOString()}
          >
            {timeAgo(new Date(f.createdAt))}
          </time>
          <div className="ap-log-body">
            <p>{t('{agent} raised it.', { agent: nameOf(f) })}</p>
          </div>
        </li>
        {f.history.map((e) => (
          <li key={e.id}>
            <time className="ap-time" dateTime={new Date(e.at).toISOString()}>
              {timeAgo(new Date(e.at))}
            </time>
            <div className="ap-log-body">
              <p>{findingEventText(e, { me, agentName: nameOf(f) })}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The next finding waiting on you, from the Approvals list. */
function useNextFinding(id: string) {
  const q = useApprovalPages();
  const next = inboxRows(dedupeItems(q.data?.pages ?? [])).find(
    (r) => r.type === 'finding' && r.flag.id !== id && !isDecided(r.flag)
  );
  return next && next.type === 'finding'
    ? {
        to: `/approvals/${encodeURIComponent(next.flag.id)}`,
        label: t('Next: {agent} on #{n}', {
          agent: userAgentName(next.agent),
          n: next.pull.number,
        }),
      }
    : null;
}

function NextLink({ id }: { id: string }) {
  const next = useNextFinding(id);
  return next ? (
    <Link className="btn primary small" to={next.to}>
      {next.label}
      <ArrowRightIcon size={14} />
    </Link>
  ) : (
    <Link className="btn primary small" to="/approvals">
      {t('Back to Approvals')}
    </Link>
  );
}

/** What a decision changes on the finding, shown before the server answers. */
type Shown = Pick<FindingData, 'state'> &
  Partial<Pick<FindingData, 'reason' | 'note' | 'teach'>>;

/**
 * Runs one answer: the toast (with Undo when it can be undone), the refresh, and the refusal. A decision (`opts.show`)
 * shows at once: the finding's cached page takes the new state before the request, and gets it back if refused.
 * Anything else (asking someone) shows a pending state until it is saved.
 */
function useAnswer(f: FindingData) {
  const toast = useToast();
  const refresh = useRefresh();
  const qc = useQueryClient();
  const me = useCurrentUser();
  const [owner, repo] = f.repo.fullName.split('/');
  const n = f.pull.number;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const act = async (
    key: string,
    fn: () => Promise<unknown>,
    done: { toast: string; undo?: () => Promise<unknown> },
    opts: { sendingNote?: boolean; show?: Shown } = {}
  ) => {
    // One answer at a time: a decision shows at once, so a second click before re-render must not send it again.
    if (pending || inFlight.current) return false;
    inFlight.current = true;
    const queryKey = qk.approvalFlag(f.id);
    const before = qc.getQueryData<FindingData>(queryKey);
    const undoToast = () => {
      const undo = done.undo;
      toast(
        done.toast,
        undo
          ? {
              undo: () =>
                void undo()
                  .catch((e) => toast(failure(e)))
                  .finally(() => void refresh(owner, repo)),
            }
          : undefined
      );
    };
    if (opts.show && before) {
      qc.setQueryData<FindingData>(queryKey, {
        ...before,
        reason: null,
        note: null,
        teach: null,
        ...opts.show,
        decidedBy: me
          ? {
              login: me.username ?? me.name,
              name: me.name,
              isAgent: false,
              color: null,
            }
          : null,
        decidedAt: Date.now(),
        decidedVia: null,
        can: { ...before.can, undo: true },
      });
      undoToast();
    } else setPending(key);
    setError(null);
    try {
      await fn();
      if (!(opts.show && before)) undoToast();
      return true;
    } catch (e) {
      const message = failure(e, opts);
      if (opts.show && before) {
        qc.setQueryData(queryKey, before);
        toast(t('Not saved: {error}', { error: message }), {
          icon: <AlertIcon size={16} />,
        });
      }
      setError(message);
      return false;
    } finally {
      // Also after a refusal (409: the branch moved): the page shows the new state.
      await refresh(owner, repo);
      setPending(null);
      inFlight.current = false;
    }
  };
  return { owner, repo, n, pending, error, setError, act };
}

function Outcome({ f, me }: { f: FindingData; me: string | null }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owner, repo] = f.repo.fullName.split('/');
  const undo = async () => {
    setUndoing(true);
    setError(null);
    try {
      await api.undoFlag(owner, repo, f.pull.number, f.id);
      toast(t('Answer withdrawn. The finding is open again.'), {
        icon: <UndoIcon size={16} />,
      });
    } catch (e) {
      setError(failure(e));
    } finally {
      await refresh(owner, repo);
      setUndoing(false);
    }
  };
  const name = nameOf(f);
  const n = f.pull.number;
  const by = decidedByText(f.decidedBy, f.decidedVia, me);
  const ai = by.startsWith(AI_NAME);
  const when = f.decidedAt ? timeAgo(new Date(f.decidedAt)) : null;
  const head =
    f.state === 'approved'
      ? when
        ? t('Approved by {by}, {when}', { by, when })
        : t('Approved by {by}', { by })
      : f.state === 'dismissed'
        ? when
          ? t('Dismissed by {by}, {when}', { by, when })
          : t('Dismissed by {by}', { by })
        : when
          ? t('Changes requested by {by}, {when}', { by, when })
          : t('Changes requested by {by}', { by });
  const next =
    f.state === 'changes_requested'
      ? t(
          'The pull request’s author makes the change, and {agent} reviews the new commit.',
          { agent: name }
        )
      : f.pull.state === 'open'
        ? t('#{n} no longer waits for this finding.', { n })
        : f.pull.state === 'merged'
          ? t(
              '#{n} merged, so this decision stays. Revert it from the pull request if you need to.',
              { n }
            )
          : t('#{n} is closed, so this decision stays.', { n });
  return (
    <section
      className={`panel ap-outcome ap-${f.state}`}
      aria-labelledby="ap-out-h"
    >
      {f.state === 'changes_requested' ? (
        <SyncIcon size={16} />
      ) : f.state === 'dismissed' ? (
        <XIcon size={16} />
      ) : (
        <CheckIcon size={16} />
      )}
      <div>
        <h2 id="ap-out-h">{head}</h2>
        {ai && (
          <p className="ap-small">
            <ClaudeTile />
            {t('{ai} answered this for {who}.', {
              ai: AI_NAME,
              who:
                f.decidedBy?.login === me
                  ? t('you')
                  : f.decidedBy?.name || t('them'),
            })}
          </p>
        )}
        {f.reason && (
          <p>
            <b>
              {ai
                ? t('{whose} reason.', { whose: whose(AI_NAME) })
                : t('Reason.')}
            </b>{' '}
            {f.reason}
          </p>
        )}
        {f.note && (
          <p>
            <b>{t('Note.')}</b> “{f.note}”
          </p>
        )}
        {f.teach && (
          <>
            <figure className="ap-diff ap-diff-compact">
              <figcaption className="ap-diff-path">
                <BookIcon size={13} />
                <span>{f.agent?.repository ?? name} · AGENT.md</span>
              </figcaption>
              <div className="ap-line ap-add">
                <span aria-hidden="true">+</span>
                <span>
                  <span className="sr">{t('Rule:')} </span>
                  {f.teach}
                </span>
              </div>
            </figure>
            <p className="ap-small">
              {f.teachBy
                ? t('{agent} learns this when #{n} closes, from {who}.', {
                    agent: name,
                    n,
                    who:
                      f.teachBy.login === me
                        ? t('you')
                        : f.teachBy.name || `@${f.teachBy.login}`,
                  })
                : t('{agent} learns this when #{n} closes.', {
                    agent: name,
                    n,
                  })}
            </p>
          </>
        )}
        <p className="ap-small">{next}</p>
        <div className="ap-actions">
          {f.state !== 'changes_requested' && <NextLink id={f.id} />}
          {f.can.undo && (
            <PendingButton
              className="small"
              pending={undoing}
              pendingLabel={t('Reopening…')}
              onClick={() => void undo()}
            >
              <UndoIcon size={14} />
              {t('Change answer')}
            </PendingButton>
          )}
        </div>
        <PanelError error={error} />
      </div>
    </section>
  );
}

/** "Let Claude decide this one": CloudForge AI answers as you, now. */
function DelegateOne({ f }: { f: FindingData }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [owner, repo] = f.repo.fullName.split('/');
  const n = f.pull.number;
  const [pending, setPending] = useState(false);
  const [left, setLeft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await api.delegateFlag(owner, repo, n, f.id);
      if (!r.applied) setLeft(r.reason);
      else
        toast(
          r.decision === 'approve'
            ? t('{ai} approved it for you', { ai: AI_NAME })
            : t('{ai} requested changes for you', { ai: AI_NAME }),
          {
            icon: <ClaudeTile />,
            // A failed undo (the pull request closed, the network) says why instead of failing silently.
            undo: () =>
              void api
                .undoFlag(owner, repo, n, f.id)
                .then(() =>
                  toast(t('Answer withdrawn. The finding is open again.'), {
                    icon: <UndoIcon size={16} />,
                  })
                )
                .catch((e) => toast(failure(e)))
                .finally(() => void refresh(owner, repo)),
          }
        );
    } catch (e) {
      setError(failure(e));
    } finally {
      await refresh(owner, repo);
      setPending(false);
    }
  };
  return (
    <div className="ap-delegate">
      <PendingButton
        className="quiet small"
        pending={pending}
        pendingLabel={t('{ai} is deciding…', { ai: AI_NAME })}
        onClick={() => void go()}
      >
        <ClaudeTile />
        {t('Let {ai} decide this one', { ai: AI_NAME })}
      </PendingButton>
      <span className="ap-small">
        {t('{ai} answers as you, and you can undo it while #{n} is open.', {
          ai: AI_NAME,
          n,
        })}
      </span>
      {left && (
        <p className="ap-small ap-left" role="status">
          <ClaudeTile />
          {t('{ai} left this for you: {reason}', {
            ai: AI_NAME,
            reason: left,
          })}
        </p>
      )}
      <PanelError error={error} />
    </div>
  );
}

/** Who was asked to decide, shown above the answers. */
function AssignedLine({ f, me }: { f: FindingData; me: string | null }) {
  if (!f.assignee) return null;
  const who = (p: { login: string; name: string | null } | null) =>
    !p ? null : p.login === me ? t('you') : p.name || `@${p.login}`;
  const by = who(f.assignedBy);
  return (
    <p className="ap-assigned">
      <PeopleIcon size={14} />
      {f.assignee.login === me ? (
        <span>
          {by && by !== t('you')
            ? t('{who} asked you to decide this.', { who: by })
            : t('You have this one.')}
        </span>
      ) : (
        <span>
          {by
            ? t(
                '{who} has this question now, asked by {by}. You can still answer it yourself.',
                { who: who(f.assignee) ?? '', by }
              )
            : t(
                '{who} has this question now. You can still answer it yourself.',
                { who: who(f.assignee) ?? '' }
              )}
        </span>
      )}
    </p>
  );
}

type Choice = 'yes' | 'no' | 'ask';

/** The owner question's answers: Yes / No, fix it / Ask someone, a rule for next time, and a guarded reason. */
function OwnerAnswer({ f, me }: { f: FindingData; me: string | null }) {
  const { owner, repo, n, pending, error, setError, act } = useAnswer(f);
  const name = nameOf(f);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [teachOn, setTeachOn] = useState(false);
  const [teach, setTeach] = useState('');
  const [ask, setAsk] = useState('');
  const asked = f.state === 'changes_requested';
  const people = useAskCandidates(owner, repo, me);
  const askName =
    people.people?.find((p) => p.login === ask)?.name ?? (ask || '');
  const undoDecision = () => api.undoFlag(owner, repo, n, f.id);
  const opts: [Choice, string, string][] = [
    [
      'yes',
      t('Yes'),
      f.guarded
        ? t(
            'Approve it. {agent} findings need your reason, recorded in the audit log.',
            { agent: name }
          )
        : t('Approve it. #{n} can merge when nothing else holds it up.', { n }),
    ],
    ...(asked
      ? []
      : ([
          [
            'no',
            t('No, fix it'),
            t(
              'Ask for a change before #{n} merges. Its author gets your note.',
              { n }
            ),
          ],
        ] as [Choice, string, string][])),
    [
      'ask',
      t('Ask someone'),
      t('Pass the question to someone who can push to {repo}.', {
        repo: f.repo.fullName,
      }),
    ],
  ];
  const missing =
    !choice ||
    (choice === 'yes' && f.guarded && !reason.trim()) ||
    (choice === 'ask' && (!ask || ask === f.assignee?.login)) ||
    (choice !== 'ask' && teachOn && !teach.trim());
  const submit = () => {
    if (!choice || missing) return;
    const rule = teachText(teachOn, teach);
    if (choice === 'yes')
      void act(
        'submit',
        () =>
          api.approveFlag(owner, repo, n, f.id, {
            reason: f.guarded ? reason : null,
            teach: rule,
          }),
        { toast: t('Approved'), undo: undoDecision },
        {
          show: {
            state: 'approved',
            reason: f.guarded ? reason.trim() || null : null,
            teach: rule,
          },
        }
      );
    else if (choice === 'no')
      void act(
        'submit',
        () => api.requestFlagChanges(owner, repo, n, f.id, note, rule),
        { toast: t('Sent back for a change'), undo: undoDecision },
        {
          sendingNote: true,
          show: {
            state: 'changes_requested',
            note: note.trim() || null,
            teach: rule,
          },
        }
      );
    else {
      const before = f.assignee?.login ?? null;
      void act('submit', () => api.assignFlag(owner, repo, n, f.id, ask), {
        toast: t('Asked {name}', { name: askName }),
        undo: () => api.assignFlag(owner, repo, n, f.id, before),
      }).then((ok) => {
        if (!ok) return;
        setChoice(null);
        setAsk('');
      });
    }
  };
  return (
    <section className="panel ap-answer" aria-labelledby="ap-ans-h">
      <h2 id="ap-ans-h">
        {asked ? t('Change your answer') : t('Your answer')}
      </h2>
      <AssignedLine f={f} me={me} />
      <fieldset className="ap-choices">
        <legend className="sr">{t('Your answer')}</legend>
        {opts.map(([v, label, sub]) => (
          <label className={`ap-choice${choice === v ? ' on' : ''}`} key={v}>
            <input
              type="radio"
              name="ap-answer"
              value={v}
              checked={choice === v}
              onChange={() => {
                setChoice(v);
                setError(null);
              }}
            />
            <span>
              <b>{label}</b>
              <small>{sub}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {choice === 'yes' && f.guarded && (
        <div className="ap-teach">
          <label className="ap-label" htmlFor="ap-owner-reason">
            {tx('Why is this right? {required}', {
              required: <span className="muted">{t('(required)')}</span>,
            })}
          </label>
          <textarea
            id="ap-owner-reason"
            className="ap-input"
            rows={2}
            maxLength={TEXT_MAX}
            value={reason}
            aria-required
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="ap-small">
            <ShieldIcon size={13} />
            {t(
              '{agent} findings need a reason. It goes in the audit log with your name.',
              { agent: name }
            )}
          </p>
        </div>
      )}
      {choice === 'no' && (
        <div className="ap-teach">
          <label className="ap-label" htmlFor="ap-owner-note">
            {tx('What should change? {optional}', {
              optional: <span className="muted">{t('(optional)')}</span>,
            })}
          </label>
          <textarea
            id="ap-owner-note"
            className="ap-input"
            rows={2}
            maxLength={TEXT_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
      {choice === 'ask' && (
        <div className="ap-teach">
          <label className="ap-label" htmlFor="ap-owner-ask">
            {t('Who should answer?')}
          </label>
          {people.error ? (
            <p className="ap-error" role="alert">
              {t('The people who can answer did not load.')}{' '}
              <button
                type="button"
                className="btn quiet small"
                onClick={people.retry}
              >
                {t('Retry')}
              </button>
            </p>
          ) : !people.people ? (
            <div
              className="sk sk-row"
              role="status"
              aria-label={t('Loading people')}
            />
          ) : !people.people.length ? (
            <p className="ap-small">
              {t('Nobody else can push to {repo}.', {
                repo: f.repo.fullName,
              })}
            </p>
          ) : (
            <select
              id="ap-owner-ask"
              className="ap-input ap-select"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
            >
              <option value="">{t('Choose someone')}</option>
              {people.people.map((p) => (
                <option key={p.login} value={p.login}>
                  {p.name} (@{p.login})
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {(choice === 'yes' || choice === 'no') && (
        <TeachField
          agentName={name}
          pull={n}
          on={teachOn}
          text={teach}
          onToggle={setTeachOn}
          onText={setTeach}
          label={t('Remember this for next time')}
        />
      )}
      <div className="ap-actions">
        <PendingButton
          className="primary"
          pending={pending === 'submit'}
          pendingLabel={
            choice === 'no'
              ? t('Sending…')
              : choice === 'ask'
                ? t('Asking…')
                : t('Approving…')
          }
          disabled={missing}
          onClick={submit}
        >
          {choice === 'no'
            ? t('Send')
            : choice === 'ask'
              ? askName
                ? t('Ask {name}', { name: askName })
                : t('Ask')
              : t('Approve')}
        </PendingButton>
      </div>
      <PanelError error={error} />
      {/* Never a guarded agent's finding, whatever the server says. */}
      {f.can.delegate && !f.guarded && <DelegateOne f={f} />}
    </section>
  );
}

type Mode = 'changes' | 'dismiss' | 'approve' | 'ask';

/** A developer finding's answers: Approve (with a reason when guarded), Request changes, Dismiss, Ask someone. */
function DevAnswer({ f, me }: { f: FindingData; me: string | null }) {
  const { owner, repo, n, pending, error, act } = useAnswer(f);
  const [mode, setMode] = useState<Mode | null>(null);
  const name = nameOf(f);
  const change = f.kind === 'change_requested';
  const asked = f.state === 'changes_requested';
  const undoDecision = () => api.undoFlag(owner, repo, n, f.id);
  const panelId = 'ap-answer-panel';
  // Decisions show at once, so their panel closes at once; a refusal comes back as a toast.
  const done = (sent: Promise<boolean>) => {
    setMode(null);
    return sent;
  };
  const toggle = (m: Mode, label: ReactNode, primary = false) => (
    <button
      type="button"
      className={`btn small${primary ? ' primary' : ''}`}
      aria-expanded={mode === m}
      aria-controls={panelId}
      disabled={!!pending}
      onClick={() => setMode(mode === m ? null : m)}
    >
      {label}
    </button>
  );
  const approveDirect = (
    <PendingButton
      className="small primary"
      pending={pending === 'approve'}
      pendingLabel={t('Approving…')}
      onClick={() =>
        void act(
          'approve',
          () => api.approveFlag(owner, repo, n, f.id),
          { toast: t('Approved #{n}', { n }), undo: undoDecision },
          { show: { state: change ? 'dismissed' : 'approved' } }
        )
      }
    >
      <CheckIcon size={14} />
      {asked ? t('Approve instead') : t('Approve')}
    </PendingButton>
  );
  const changesBtn = toggle(
    'changes',
    <>
      <SyncIcon size={14} />
      {t('Request changes')}
    </>,
    f.guarded
  );
  const dismissBtn = toggle(
    'dismiss',
    <>
      <XIcon size={14} />
      {t('Dismiss')}
    </>,
    change
  );
  const askBtn = toggle(
    'ask',
    <>
      <PeopleIcon size={14} />
      {t('Ask someone')}
    </>
  );
  return (
    <section className="panel ap-answer" aria-labelledby="ap-ans-h">
      <h2 id="ap-ans-h">
        {asked ? t('Change your answer') : t('Your answer')}
      </h2>
      <AssignedLine f={f} me={me} />
      {f.guarded && (
        <p className="ap-small">
          <ShieldIcon size={13} />
          <span>
            {change
              ? t('Dismissing a {whose} change request needs a reason.', {
                  whose: whose(name),
                })
              : t(
                  '{agent} findings can’t be approved in bulk. Approving needs a reason.',
                  { agent: name }
                )}
          </span>
        </p>
      )}
      <div className="ap-actions">
        {change ? (
          <>
            {dismissBtn}
            {askBtn}
          </>
        ) : f.guarded ? (
          <>
            {!asked && changesBtn}
            {toggle(
              'approve',
              <>
                <CheckIcon size={14} />
                {t('Approve with a reason')}
              </>,
              asked
            )}
            {dismissBtn}
            {askBtn}
          </>
        ) : (
          <>
            {approveDirect}
            {!asked && changesBtn}
            {dismissBtn}
            {askBtn}
          </>
        )}
      </div>
      {mode === 'changes' && (
        <ChangesPanel
          id={panelId}
          agentName={name}
          pull={n}
          pending={pending === 'changes'}
          onCancel={() => setMode(null)}
          onSubmit={(note, teach) =>
            void done(
              act(
                'changes',
                () => api.requestFlagChanges(owner, repo, n, f.id, note, teach),
                {
                  toast: t('Changes requested on #{n}', { n }),
                  undo: undoDecision,
                },
                {
                  sendingNote: true,
                  show: {
                    state: 'changes_requested',
                    note: note.trim() || null,
                    teach,
                  },
                }
              )
            )
          }
        />
      )}
      {mode === 'dismiss' && (
        <DismissPanel
          id={panelId}
          agentName={name}
          pull={n}
          guarded={f.guarded}
          pending={pending === 'dismiss'}
          onCancel={() => setMode(null)}
          onSubmit={(reason, teach) =>
            void done(
              act(
                'dismiss',
                () => api.approveFlag(owner, repo, n, f.id, { reason, teach }),
                {
                  toast: teach
                    ? t('Dismissed. {agent} learns your rule', { agent: name })
                    : t('Dismissed'),
                  undo: undoDecision,
                },
                {
                  show: {
                    state: change ? 'dismissed' : 'approved',
                    reason: reason.trim() || null,
                    teach,
                  },
                }
              )
            )
          }
        />
      )}
      {mode === 'approve' && (
        <ApproveReasonPanel
          id={panelId}
          agentName={name}
          pull={n}
          pending={pending === 'approve-reason'}
          onCancel={() => setMode(null)}
          onSubmit={(reason, teach) =>
            void done(
              act(
                'approve-reason',
                () => api.approveFlag(owner, repo, n, f.id, { reason, teach }),
                {
                  toast: t('Approved. Reason recorded in the audit log.'),
                  undo: undoDecision,
                },
                {
                  show: {
                    state: change ? 'dismissed' : 'approved',
                    reason: reason.trim() || null,
                    teach,
                  },
                }
              )
            )
          }
        />
      )}
      {mode === 'ask' && (
        <AskPanel
          id={panelId}
          owner={owner}
          name={repo}
          me={me}
          assignee={f.assignee}
          pending={pending === 'ask'}
          onCancel={() => setMode(null)}
          onSubmit={(login) => {
            const before = f.assignee?.login ?? null;
            // Asking someone isn't a decision: the panel waits for it to be saved.
            void act('ask', () => api.assignFlag(owner, repo, n, f.id, login), {
              toast: login ? t('Asked @{login}', { login }) : t('Taken back'),
              undo: () => api.assignFlag(owner, repo, n, f.id, before),
            }).then((ok) => ok && setMode(null));
          }}
        />
      )}
      <PanelError error={error} />
      {/* Never a guarded agent's finding, whatever the server says. */}
      {f.can.delegate && !f.guarded && <DelegateOne f={f} />}
    </section>
  );
}
