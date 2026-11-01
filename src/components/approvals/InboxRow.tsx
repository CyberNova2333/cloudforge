// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertIcon,
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  ClockIcon,
  GitMergeIcon,
  PeopleIcon,
  PersonIcon,
  PlayIcon,
  ShieldCheckIcon,
  ShieldIcon,
  StackIcon,
  SyncIcon,
  UndoIcon,
  XIcon,
} from '@primer/octicons-react';
import type { User } from '@/lib/api/uiApi';
import {
  findingSentence,
  isDecided,
  isOwnerQuestion,
  selectable,
  type InboxRow,
} from '@/lib/approvals/approvalsInbox';
import { reasonText, blocking, stateText } from '@/lib/pulls/pullState';
import { decidedByText } from '@/lib/actions/claudeLog';
import { timeAgo } from '@/lib/utils/format';
import { t } from '@/lib/i18n/i18n';
import type { AgentStatus } from '@/lib/agents/agentLook';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { CoderChip } from '@/components/ui/CoderChip';
import { PendingButton } from '@/components/ui/PendingButton';
import { ChangesPanel, DismissPanel, PanelError } from './Panels';
import { ClaudeTile } from './ClaudePanel';

export type RowPanel = 'changes' | 'dismiss';

/** What a row's buttons ask the page to do. */
export type RowAction =
  | { kind: 'approve' }
  | { kind: 'changes'; note: string; teach: string | null }
  | { kind: 'dismiss'; reason: string; teach: string | null }
  | { kind: 'undo' }
  | { kind: 'retry-review' }
  | { kind: 'retry-reviewer' }
  | { kind: 'retry-stack' }
  | { kind: 'approve-pull' };

export type ReceiptIcon = 'check' | 'x' | 'sync' | 'book' | 'person' | 'play';
const RECEIPT_ICON: Record<ReceiptIcon, ReactNode> = {
  check: <CheckIcon size={15} />,
  x: <XIcon size={15} />,
  sync: <SyncIcon size={15} />,
  book: <BookIcon size={15} />,
  person: <PersonIcon size={15} />,
  play: <PlayIcon size={15} />,
};

/** A decided row, kept in place with its one-line receipt (and Undo) until you leave the page. */
export type Receipt = {
  key: string;
  /** Where it was in the list when decided. */
  index: number;
  row: InboxRow;
  /** The agent's avatar state afterwards. */
  status: AgentStatus;
  icon: ReceiptIcon;
  tone: 'good' | 'change' | 'muted';
  text: string;
  toast: string;
  undo?: () => Promise<unknown>;
};

export const agentName = (u: User) => u.name || `@${u.username}`;

/** Where a row leads: a finding's page, or the pull request. */
export const rowHref = (r: InboxRow) =>
  r.type === 'finding'
    ? `/approvals/${encodeURIComponent(r.flag.id)}`
    : r.type === 'stack-stale'
      ? `/${r.repo}/pull/${r.pr}`
      : r.prUrl;

/** "Security on #80": what a receipt was about. */
export const rowContext = (r: InboxRow) =>
  r.type === 'finding' || r.type === 'reviewer-failed'
    ? t('{agent} on #{n}', {
        agent: agentName(r.agent),
        n: r.pull.number,
      })
    : `${r.repo} #${r.pull.number}`;

/** An agent's name, linking to its profile. */
function AgentLink({ agent }: { agent: User }) {
  return (
    <Link
      className="ap-agent"
      to={`/${agent.username}`}
      title={`@${agent.username}`}
    >
      {agentName(agent)}
    </Link>
  );
}

const domId = (key: string) => `ap-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

function Meta({ who, row }: { who: ReactNode; row: InboxRow }) {
  return (
    <div className="ap-top">
      <p className="ap-meta">
        <b>{who}</b> <span className="ap-repo">{row.repo}</span>{' '}
        <Link className="ap-pr" to={row.prUrl}>
          #{row.pull.number}
        </Link>{' '}
        <Link className="ap-title" to={rowHref(row)}>
          {row.pull.title}
        </Link>{' '}
        <CoderChip
          createdVia={row.pull.createdVia}
          sessionLabel={row.pull.sessionLabel}
          sessionId={row.pull.sessionId}
          base={`/${row.repo}`}
          person={row.pull.author?.name || row.pull.author?.username}
        />
      </p>
      <span
        className="ap-wait"
        title={t('Updated {when}', { when: row.pull.updatedAt })}
      >
        <ClockIcon size={13} />
        <span className="sr">{t('Updated')} </span>
        {timeAgo(row.pull.updatedAt)}
      </span>
    </div>
  );
}

/** "Opened by Cho" (or "you"), on every row: the old page named each pull request's author. */
function Author({ row, me }: { row: InboxRow; me: string | null }) {
  const a = row.pull.author;
  if (!a) return null;
  return (
    <span className="ap-auth">
      {t('Opened by {who}', {
        who: a.username === me ? t('you') : a.name || a.username,
      })}
    </span>
  );
}

function IconTile({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`ap-icon ${tone}`} aria-hidden="true">
      {children}
    </span>
  );
}

export function InboxRowView({
  row,
  current,
  picked,
  panel,
  busy,
  locked,
  error,
  me,
  color,
  claudeLeft,
  setRef,
  onFocus,
  onPick,
  onPanel,
  onAct,
}: {
  row: InboxRow;
  current: boolean;
  picked: boolean;
  panel: RowPanel | null;
  /** The action running on this row. */
  busy: RowAction['kind'] | null;
  /** Another action is running somewhere: this row's buttons wait. */
  locked: boolean;
  error: string | null;
  me: string | null;
  /** The agent's colour (from the delegations list), when known. */
  color?: string;
  /** Claude left this finding for you today, with this reason. */
  claudeLeft?: string;
  setRef(el: HTMLLIElement | null): void;
  onFocus(): void;
  onPick(on: boolean): void;
  onPanel(p: RowPanel | null): void;
  onAct(a: RowAction): void;
}) {
  const id = domId(row.key);
  const textId = `${id}-t`;
  const panelId = `${id}-panel`;
  const owner = row.type === 'finding' && isOwnerQuestion(row);
  const cls = [
    'ap-item',
    current && 'ap-current',
    picked && 'ap-picked',
    owner && 'ap-owner',
    busy && 'ap-busy',
  ]
    .filter(Boolean)
    .join(' ');
  const disabled = locked && !busy;
  const btn = (
    kind: RowAction['kind'],
    label: ReactNode,
    pendingLabel: string,
    opts: { primary?: boolean; quiet?: boolean; aria?: string } = {}
  ) => (
    <PendingButton
      className={`small${opts.primary ? ' primary' : ''}${opts.quiet ? ' quiet' : ''}`}
      pending={busy === kind}
      pendingLabel={pendingLabel}
      disabled={disabled || (busy !== null && busy !== kind)}
      aria-label={opts.aria}
      onClick={() => onAct({ kind } as RowAction)}
    >
      {label}
    </PendingButton>
  );
  const toggle = (p: RowPanel, label: ReactNode, primary = false) => (
    <button
      type="button"
      className={`btn small${primary ? ' primary' : ''}`}
      aria-expanded={panel === p}
      aria-controls={panelId}
      disabled={disabled || busy !== null}
      onClick={() => onPanel(panel === p ? null : p)}
    >
      {label}
    </button>
  );

  let lead: ReactNode = <span />;
  let avatar: ReactNode;
  let body: ReactNode;

  if (row.type === 'finding') {
    const f = row.flag;
    const name = agentName(row.agent);
    const decided = isDecided(f);
    const asked = !!f.changesRequestedAt;
    const mine = asked && f.changesRequestedBy?.username === me;
    const sentence = findingSentence(f);
    if (owner)
      lead = (
        <span className="ap-lock" title={t('A question for a person')}>
          <PersonIcon size={14} />
          <span className="sr">{t('A question for a person')}</span>
        </span>
      );
    else if (f.guarded)
      lead = (
        <span
          className="ap-lock"
          title={t('{agent} findings can’t be approved in bulk', {
            agent: name,
          })}
        >
          <ShieldIcon size={14} />
          <span className="sr">
            {t('{agent} findings can’t be approved in bulk', { agent: name })}
          </span>
        </span>
      );
    else if (selectable(row))
      lead = (
        <label className="ap-pick">
          <input
            type="checkbox"
            checked={picked}
            disabled={locked}
            onChange={(e) => onPick(e.target.checked)}
          />
          <span className="sr">
            {t('Select {agent}’s finding on #{n}', {
              agent: name,
              n: row.pull.number,
            })}
          </span>
        </label>
      );
    avatar = (
      <AgentAvatar
        handle={row.agent.username}
        color={color}
        status={asked ? 'changes_requested' : 'needs'}
        size={32}
      />
    );
    const href = rowHref(row);
    const actions: ReactNode = owner ? (
      <Link className="btn small primary" to={href}>
        {t('Answer')}
        <ArrowRightIcon size={14} />
      </Link>
    ) : f.guarded ? (
      <>
        {!asked &&
          toggle(
            'changes',
            <>
              <SyncIcon size={14} />
              {t('Request changes')}
            </>,
            true
          )}
        <Link className="btn small" to={href}>
          {t('Review and decide')}
          <ArrowRightIcon size={14} />
        </Link>
      </>
    ) : (
      <>
        {btn(
          'approve',
          <>
            <CheckIcon size={14} />
            {asked ? t('Approve instead') : t('Approve')}
          </>,
          t('Approving…'),
          { primary: true }
        )}
        {!asked &&
          toggle(
            'changes',
            <>
              <SyncIcon size={14} />
              {t('Request changes')}
            </>
          )}
        {toggle(
          'dismiss',
          <>
            <XIcon size={14} />
            {t('Dismiss')}
          </>
        )}
      </>
    );
    body = (
      <>
        <Meta who={<AgentLink agent={row.agent} />} row={row} />
        <p className={owner ? 'ap-text ap-q' : 'ap-text'} id={textId}>
          {owner ? f.question : f.title}
        </p>
        {(owner || sentence) && (
          <p className="ap-text ap-soft">{owner ? f.title : sentence}</p>
        )}
        <p className="ap-by">
          {owner && (
            <span className="ap-tag ap-tag-accent">
              {t('Needs your answer')}
            </span>
          )}
          {f.guarded && !owner && (
            <span className="ap-tag">
              <ShieldIcon size={11} />
              {t('Needs a reason to approve')}
            </span>
          )}
          {asked && (
            <span className="ap-tag ap-tag-change">
              <SyncIcon size={11} />
              {t('Changes requested by {who}', {
                who: decidedByText(
                  f.changesRequestedBy
                    ? {
                        login: f.changesRequestedBy.username,
                        name: f.changesRequestedBy.name,
                        isAgent: false,
                        color: null,
                      }
                    : null,
                  f.decidedVia,
                  me
                ),
              })}
            </span>
          )}
          {f.assignee && (
            <span className="ap-tag">
              <PeopleIcon size={11} />
              {f.assignee.login === me
                ? t('Assigned to you')
                : t('Assigned to {who}', {
                    who: f.assignee.name || `@${f.assignee.login}`,
                  })}
            </span>
          )}
          <Author row={row} me={me} />
          {claudeLeft && !decided && (
            <span className="ap-auto">
              <ClaudeTile />
              {t('Claude left this for you: {reason}', {
                reason: claudeLeft,
              })}
            </span>
          )}
        </p>
        {asked && f.changesRequestedNote && (
          <p className="ap-note-text">“{f.changesRequestedNote}”</p>
        )}
        <div className="ap-actions">
          {actions}
          {mine &&
            btn(
              'undo',
              <>
                <UndoIcon size={14} />
                {t('Undo request')}
              </>,
              t('Reopening…'),
              { quiet: true }
            )}
        </div>
        {panel === 'changes' && (
          <ChangesPanel
            id={panelId}
            agentName={name}
            pull={row.pull.number}
            pending={busy === 'changes'}
            onCancel={() => onPanel(null)}
            onSubmit={(note, teach) => onAct({ kind: 'changes', note, teach })}
          />
        )}
        {panel === 'dismiss' && !f.guarded && (
          <DismissPanel
            id={panelId}
            agentName={name}
            pull={row.pull.number}
            guarded={f.guarded}
            pending={busy === 'dismiss'}
            onCancel={() => onPanel(null)}
            onSubmit={(reason, teach) =>
              onAct({ kind: 'dismiss', reason, teach })
            }
          />
        )}
      </>
    );
  } else if (row.type === 'reviewer-failed') {
    const name = agentName(row.agent);
    avatar = (
      <AgentAvatar
        handle={row.agent.username}
        color={color}
        status="failed"
        size={32}
      />
    );
    body = (
      <>
        <Meta who={<AgentLink agent={row.agent} />} row={row} />
        <p className="ap-text" id={textId}>
          {t('{agent}’s review failed.', { agent: name })}
        </p>
        <p className="ap-text ap-soft">{row.error ?? t('Unknown error.')}</p>
        {row.pull.author && (
          <p className="ap-by">
            <Author row={row} me={me} />
          </p>
        )}
        <div className="ap-actions">
          {btn(
            'retry-reviewer',
            <>
              <SyncIcon size={14} />
              {t('Retry')}
            </>,
            t('Starting…'),
            {
              aria: t('Retry {agent}’s review', { agent: name }),
            }
          )}
        </div>
      </>
    );
  } else {
    const n = row.pull.number;
    const look: {
      tone: string;
      icon: ReactNode;
      who: string;
      text: ReactNode;
      soft?: ReactNode;
      actions: ReactNode;
    } =
      row.type === 'review-failed'
        ? {
            tone: 'critical',
            icon: <AlertIcon size={16} />,
            who: t('Review'),
            text: t('The review of #{n} failed.', { n }),
            soft: row.error,
            actions: btn(
              'retry-review',
              <>
                <SyncIcon size={14} />
                {t('Try the review again')}
              </>,
              t('Starting…')
            ),
          }
        : row.type === 'resolution-failed'
          ? {
              tone: 'serious',
              icon: <GitMergeIcon size={16} />,
              who: t('Conflicts'),
              text: row.message,
              actions: (
                <Link className="btn small" to={row.prUrl}>
                  {t('Decide on the pull request')}
                </Link>
              ),
            }
          : row.type === 'stack-stale'
            ? {
                tone: 'warn',
                icon: <StackIcon size={16} />,
                who: t('Stack'),
                text: t('Still must account for #{n}.', { n: row.pr }),
                soft: t('Nothing new since {when}.', {
                  when: timeAgo(row.since),
                }),
                actions: (
                  <Link
                    className="btn small"
                    to={`/${row.repo}/pull/${row.pr}`}
                  >
                    {t('View #{n}', { n: row.pr })}
                  </Link>
                ),
              }
            : row.type === 'stack-unchecked'
              ? {
                  tone: 'warn',
                  icon: <StackIcon size={16} />,
                  who: t('Stack'),
                  text: t('Couldn’t check against {prs}.', {
                    prs: row.prs.map((p) => `#${p}`).join(', '),
                  }),
                  actions: btn(
                    'retry-stack',
                    <>
                      <SyncIcon size={14} />
                      {t('Check again')}
                    </>,
                    t('Starting…')
                  ),
                }
              : row.type === 'needs-approval'
                ? {
                    tone: 'info',
                    icon: <ShieldCheckIcon size={16} />,
                    who: t('Approval'),
                    text: t(
                      'No agent reviewed this commit: a person approves it.'
                    ),
                    soft: row.changeRequested
                      ? t(
                          'Approving does not override an agent’s change request: dismiss it, or wait for a fix.'
                        )
                      : undefined,
                    actions: (
                      <>
                        <PendingButton
                          className="small primary"
                          pending={busy === 'approve-pull'}
                          pendingLabel={t('Approving…')}
                          disabled={
                            disabled ||
                            (busy !== null && busy !== 'approve-pull') ||
                            !row.pull.headSha
                          }
                          aria-label={t('Approve this commit')}
                          onClick={() => onAct({ kind: 'approve-pull' })}
                        >
                          <CheckIcon size={14} />
                          {t('Approve')}
                        </PendingButton>
                        <Link className="btn small" to={row.prUrl}>
                          {t('Review the changes')}
                        </Link>
                      </>
                    ),
                  }
                : {
                    tone: 'warn',
                    icon: <PersonIcon size={16} />,
                    who: t('Needs a person'),
                    text: stateText(row.state).label,
                    soft:
                      row.state.reasons
                        .filter(blocking)
                        .map(reasonText)
                        .join('; ') || undefined,
                    actions: (
                      <Link className="btn small" to={row.prUrl}>
                        {t('Decide on the pull request')}
                      </Link>
                    ),
                  };
    avatar = <IconTile tone={look.tone}>{look.icon}</IconTile>;
    body = (
      <>
        <Meta who={look.who} row={row} />
        <p className="ap-text" id={textId}>
          {look.text}
        </p>
        {look.soft && <p className="ap-text ap-soft">{look.soft}</p>}
        {row.pull.author && (
          <p className="ap-by">
            <Author row={row} me={me} />
          </p>
        )}
        <div className="ap-actions">{look.actions}</div>
      </>
    );
  }

  return (
    <li
      ref={setRef}
      className={cls}
      id={id}
      tabIndex={-1}
      aria-labelledby={textId}
      aria-busy={busy ? true : undefined}
      onFocus={onFocus}
    >
      {lead}
      <div className="ap-lead">{avatar}</div>
      <div className="ap-body">
        {body}
        <PanelError error={error} />
      </div>
    </li>
  );
}

/** A row you just decided: one line, what happens next, and Undo. */
export function ReceiptView({
  receipt,
  undoing,
  locked,
  error,
  color,
  setRef,
  onUndo,
}: {
  receipt: Receipt;
  undoing: boolean;
  locked: boolean;
  error: string | null;
  color?: string;
  setRef(el: HTMLLIElement | null): void;
  onUndo(): void;
}) {
  const r = receipt.row;
  return (
    <li
      ref={setRef}
      className={`ap-item ap-done ap-${receipt.tone}`}
      id={domId(r.key)}
      tabIndex={-1}
    >
      <span />
      <div className="ap-lead">
        {r.type === 'finding' || r.type === 'reviewer-failed' ? (
          <AgentAvatar
            handle={r.agent.username}
            color={color}
            status={receipt.status}
            size={32}
          />
        ) : (
          <IconTile tone="good">
            <CheckIcon size={16} />
          </IconTile>
        )}
      </div>
      <div className="ap-body">
        <div className="ap-rline">
          <p className="ap-receipt">
            {RECEIPT_ICON[receipt.icon]}
            <span>
              {receipt.text} <span className="ap-ctxt">{rowContext(r)}</span>
            </span>
          </p>
          <span className="ap-rbtns">
            <Link className="btn quiet small" to={rowHref(r)}>
              {t('View')}
            </Link>
            {receipt.undo && (
              <PendingButton
                className="quiet small"
                pending={undoing}
                pendingLabel={t('Undoing…')}
                disabled={locked && !undoing}
                onClick={onUndo}
              >
                <UndoIcon size={14} />
                {t('Undo')}
              </PendingButton>
            )}
          </span>
        </div>
        <PanelError error={error} />
      </div>
    </li>
  );
}
