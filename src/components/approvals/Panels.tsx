// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookIcon,
  CheckIcon,
  PersonIcon,
  ShieldIcon,
  SyncIcon,
  XIcon,
} from '@primer/octicons-react';
import { api, qk } from '@/lib/uiApi';
import { askCandidates } from '@/lib/approvalsInbox';
import { errorMessage } from '@/lib/api';
import { t, tx } from '@/lib/i18n';
import { PendingButton } from '@/components/ui/PendingButton';

/** The server's limits for a note, a reason and a teach note. */
export const TEXT_MAX = 1000;

/** Escape inside an open panel closes it (the list's own shortcuts ignore keys typed in fields). */
const escapeCloses =
  (onCancel: () => void) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onCancel();
  };

export function PanelError({ error }: { error: string | null | undefined }) {
  return error ? (
    <p className="ap-error" role="alert">
      {error}
    </p>
  ) : null;
}

const optional = () => <span className="muted">{t('(optional)')}</span>;

/**
 * "Remember this for next time": a rule in the person's words, which the agent learns when the pull request
 * closes. `label` is the checkbox's words.
 */
export function TeachField({
  agentName,
  pull,
  on,
  text,
  onToggle,
  onText,
  label,
}: {
  agentName: string;
  pull: number;
  on: boolean;
  text: string;
  onToggle(on: boolean): void;
  onText(text: string): void;
  label?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="ap-teach">
      <label className="ap-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {label ??
          t('Save a rule so {agent} doesn’t ask again', { agent: agentName })}
      </label>
      {on && (
        <>
          <label className="ap-label" htmlFor={id}>
            {t('The rule {agent} learns', { agent: agentName })}
          </label>
          <textarea
            id={id}
            className="ap-input"
            rows={2}
            maxLength={TEXT_MAX}
            value={text}
            placeholder={t(
              'For example: links marked public may skip sign-in.'
            )}
            onChange={(e) => onText(e.target.value)}
          />
          <p className="ap-small">
            <BookIcon size={13} />
            {t(
              '{agent} learns it when #{pull} closes. Undoing your answer drops it.',
              {
                agent: agentName,
                pull,
              }
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** A teach note as the API takes it: only when the box is ticked and something is written. */
export const teachText = (on: boolean, text: string) =>
  on && text.trim() ? text.trim() : null;

/** Request changes: a note for the pull request's author, and an optional rule. */
export function ChangesPanel({
  id,
  agentName,
  pull,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  id: string;
  agentName: string;
  pull: number;
  pending: boolean;
  error?: string | null;
  onSubmit(note: string, teach: string | null): void;
  onCancel(): void;
}) {
  const [note, setNote] = useState('');
  const [teachOn, setTeachOn] = useState(false);
  const [teach, setTeach] = useState('');
  return (
    <div className="ap-panel" id={id} onKeyDown={escapeCloses(onCancel)}>
      <label className="ap-label" htmlFor={`${id}-note`}>
        {tx('What should change? {optional}', { optional: optional() })}
      </label>
      <textarea
        id={`${id}-note`}
        className="ap-input"
        rows={2}
        maxLength={TEXT_MAX}
        value={note}
        autoFocus
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="ap-small">
        {t('The pull request’s author gets this with {agent}’s finding.', {
          agent: agentName,
        })}
      </p>
      <TeachField
        agentName={agentName}
        pull={pull}
        on={teachOn}
        text={teach}
        onToggle={setTeachOn}
        onText={setTeach}
      />
      <div className="ap-actions">
        <PendingButton
          className="primary small"
          pending={pending}
          pendingLabel={t('Sending…')}
          disabled={teachOn && !teach.trim()}
          onClick={() => onSubmit(note, teachText(teachOn, teach))}
        >
          <SyncIcon size={14} />
          {t('Request changes')}
        </PendingButton>
        <button type="button" className="btn quiet small" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
      <PanelError error={error} />
    </div>
  );
}

/**
 * Dismiss: the finding needs no change. A reason (required for a guarded agent, where it goes in the audit log)
 * and an optional rule so the agent doesn't ask again.
 */
export function DismissPanel({
  id,
  agentName,
  pull,
  guarded,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  id: string;
  agentName: string;
  pull: number;
  guarded: boolean;
  pending: boolean;
  error?: string | null;
  onSubmit(reason: string, teach: string | null): void;
  onCancel(): void;
}) {
  const [reason, setReason] = useState('');
  const [teachOn, setTeachOn] = useState(false);
  const [teach, setTeach] = useState('');
  const missing = (guarded && !reason.trim()) || (teachOn && !teach.trim());
  return (
    <div className="ap-panel" id={id} onKeyDown={escapeCloses(onCancel)}>
      <label className="ap-label" htmlFor={`${id}-why`}>
        {guarded
          ? t('Reason')
          : tx('Reason {optional}', { optional: optional() })}
      </label>
      <textarea
        id={`${id}-why`}
        className="ap-input"
        rows={2}
        maxLength={TEXT_MAX}
        value={reason}
        autoFocus
        aria-required={guarded}
        placeholder={t('Why doesn’t this need a change?')}
        onChange={(e) => setReason(e.target.value)}
      />
      {guarded && (
        <p className="ap-small">
          <ShieldIcon size={13} />
          {t(
            '{agent} findings need a reason. It goes in the audit log with your name.',
            { agent: agentName }
          )}
        </p>
      )}
      <TeachField
        agentName={agentName}
        pull={pull}
        on={teachOn}
        text={teach}
        onToggle={setTeachOn}
        onText={setTeach}
      />
      <div className="ap-actions">
        <PendingButton
          className="primary small"
          pending={pending}
          pendingLabel={t('Dismissing…')}
          disabled={missing}
          onClick={() => onSubmit(reason, teachText(teachOn, teach))}
        >
          {teachOn ? <BookIcon size={14} /> : <XIcon size={14} />}
          {teachOn ? t('Dismiss and save a rule') : t('Dismiss')}
        </PendingButton>
        <button type="button" className="btn quiet small" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
      <PanelError error={error} />
    </div>
  );
}

/** `value` is what the API records (English, like its other fields); `label` and `help` are what people read. */
const REASONS: { value: string; label: string; help: string }[] = [
  {
    value: 'False positive',
    label: t('False positive'),
    help: t('The finding is wrong.'),
  },
  {
    value: 'Accepted risk',
    label: t('Accepted risk'),
    help: t('The risk is real and you accept it.'),
  },
  {
    value: 'Intended behaviour',
    label: t('Intended behaviour'),
    help: t('It works this way on purpose.'),
  },
];

/** The reason sent for a guarded approval: the choice, then the note. */
export const approvalReason = (choice: string, note: string) =>
  note.trim() ? `${choice}. ${note.trim()}` : choice;

/** Approve a guarded agent's finding: a reason is required and goes in the audit log. */
export function ApproveReasonPanel({
  id,
  agentName,
  pull,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  id: string;
  agentName: string;
  pull: number;
  pending: boolean;
  error?: string | null;
  onSubmit(reason: string, teach: string | null): void;
  onCancel(): void;
}) {
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [teachOn, setTeachOn] = useState(false);
  const [teach, setTeach] = useState('');
  return (
    <fieldset className="ap-panel" id={id} onKeyDown={escapeCloses(onCancel)}>
      <legend className="ap-label">{t('Reason for approving')}</legend>
      {REASONS.map((r, i) => (
        <label className="ap-radio" key={r.value}>
          <input
            type="radio"
            name={`${id}-reason`}
            value={r.value}
            checked={choice === r.value}
            autoFocus={i === 0}
            onChange={() => setChoice(r.value)}
          />
          <span>
            <b>{r.label}</b>
            <small>{r.help}</small>
          </span>
        </label>
      ))}
      <label className="ap-label" htmlFor={`${id}-note`}>
        {tx('Note for the audit log {optional}', { optional: optional() })}
      </label>
      <textarea
        id={`${id}-note`}
        className="ap-input"
        rows={2}
        maxLength={TEXT_MAX - 40}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="ap-small">
        <ShieldIcon size={13} />
        {t('Recorded in the audit log with your name and reason.')}
      </p>
      <TeachField
        agentName={agentName}
        pull={pull}
        on={teachOn}
        text={teach}
        onToggle={setTeachOn}
        onText={setTeach}
      />
      <div className="ap-actions">
        <PendingButton
          className="primary small"
          pending={pending}
          pendingLabel={t('Approving…')}
          disabled={!choice || (teachOn && !teach.trim())}
          onClick={() =>
            onSubmit(approvalReason(choice, note), teachText(teachOn, teach))
          }
        >
          <CheckIcon size={14} />
          {t('Approve')}
        </PendingButton>
        <button type="button" className="btn quiet small" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
      <PanelError error={error} />
    </fieldset>
  );
}

/** The people who can push to a repository (and so decide its findings), for "Ask someone". */
export function useAskCandidates(
  owner: string,
  name: string,
  me: string | null
) {
  const members = useQuery({ queryKey: qk.members, queryFn: api.members });
  const collaborators = useQuery({
    queryKey: qk.collaborators(owner, name),
    queryFn: () => api.collaborators(owner, name),
  });
  return {
    people:
      members.data && collaborators.data
        ? askCandidates({
            members: members.data,
            collaborators: collaborators.data,
            owner,
            me,
          })
        : null,
    error: members.error ?? collaborators.error,
    retry: () => {
      void members.refetch();
      void collaborators.refetch();
    },
  };
}

/** Ask someone with push rights to decide; or take the question back from whoever has it. */
export function AskPanel({
  id,
  owner,
  name,
  me,
  assignee,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  id: string;
  owner: string;
  name: string;
  me: string | null;
  /** Who has it now. */
  assignee: { login: string; name: string | null } | null;
  pending: boolean;
  error?: string | null;
  onSubmit(login: string | null): void;
  onCancel(): void;
}) {
  const { people, error: loadError, retry } = useAskCandidates(owner, name, me);
  const [pick, setPick] = useState('');
  const chosen = people?.find((p) => p.login === pick);
  return (
    <fieldset className="ap-panel" id={id} onKeyDown={escapeCloses(onCancel)}>
      <legend className="ap-label">{t('Who should decide?')}</legend>
      <p className="ap-small">
        <PersonIcon size={13} />
        {t('Anyone who can push to {owner}/{name} can decide its findings.', {
          owner,
          name,
        })}
      </p>
      {loadError ? (
        <p className="ap-error" role="alert">
          {errorMessage(loadError)}{' '}
          <button type="button" className="btn quiet small" onClick={retry}>
            {t('Retry')}
          </button>
        </p>
      ) : !people ? (
        <div
          className="sk sk-row"
          role="status"
          aria-label={t('Loading people')}
        />
      ) : !people.length ? (
        <p className="ap-small">
          {t('Nobody else can push to this repository.')}
        </p>
      ) : (
        <div className="ap-people">
          {people.map((p, i) => (
            <label className="ap-radio" key={p.login}>
              <input
                type="radio"
                name={`${id}-who`}
                value={p.login}
                checked={pick === p.login}
                autoFocus={i === 0}
                onChange={() => setPick(p.login)}
              />
              <span>
                <b>{p.name}</b>
                <small>
                  @{p.login}
                  {assignee?.login === p.login && <> · {t('has it now')}</>}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="ap-actions">
        <PendingButton
          className="primary small"
          pending={pending}
          pendingLabel={t('Asking…')}
          disabled={!chosen || chosen.login === assignee?.login}
          onClick={() => chosen && onSubmit(chosen.login)}
        >
          <PersonIcon size={14} />
          {chosen ? t('Ask {name}', { name: chosen.name }) : t('Ask')}
        </PendingButton>
        {assignee && (
          <button
            type="button"
            className="btn small"
            disabled={pending}
            onClick={() => onSubmit(null)}
          >
            {assignee.login === me
              ? t('Unassign yourself')
              : t('Take it back from {name}', {
                  name: assignee.name || assignee.login,
                })}
          </button>
        )}
        <button type="button" className="btn quiet small" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
      <PanelError error={error} />
    </fieldset>
  );
}
