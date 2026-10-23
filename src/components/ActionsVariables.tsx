import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyIcon, LockIcon } from '@primer/octicons-react';
import {
  api,
  qk,
  type ActionsVariableKind,
  type ActionsVariableList,
} from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { t, tx } from '@/lib/i18n';
import { InlineConfirm } from '@/components/InlineConfirm';

/** Whose secrets and variables: a repository's, or (null) the instance-wide ones site admins manage. */
export type VariablesScope = { o: string; n: string } | null;

const calls = (scope: VariablesScope, kind: ActionsVariableKind) =>
  scope
    ? {
        key: qk.repoActionsVariables(scope.o, scope.n, kind),
        list: () => api.repoActionsVariables(scope.o, scope.n, kind),
        save: (name: string, value: string) =>
          api.saveRepoActionsVariable(scope.o, scope.n, kind, name, value),
        remove: (name: string) =>
          api.deleteRepoActionsVariable(scope.o, scope.n, kind, name),
      }
    : {
        key: qk.adminActionsVariables(kind),
        list: () => api.adminActionsVariables(kind),
        save: (name: string, value: string) =>
          api.saveAdminActionsVariable(kind, name, value),
        remove: (name: string) => api.deleteAdminActionsVariable(kind, name),
      };

/** Actions secrets and variables: add, update and delete. A secret's value is never shown once saved. */
export function ActionsVariables({ scope }: { scope: VariablesScope }) {
  return (
    <>
      <VariableList scope={scope} kind="secrets" />
      <VariableList scope={scope} kind="variables" />
    </>
  );
}

function VariableList({
  scope,
  kind,
}: {
  scope: VariablesScope;
  kind: ActionsVariableKind;
}) {
  const secret = kind === 'secrets';
  const c = calls(scope, kind);
  const qc = useQueryClient();
  const q = useQuery<ActionsVariableList>({ queryKey: c.key, queryFn: c.list });
  // The name being updated; null while adding a new one.
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setEditing(null);
    setName('');
    setValue('');
    setError(null);
  };
  const save = useMutation({
    mutationFn: () => c.save(editing ?? name.trim(), value),
    onSuccess: () => {
      reset();
      return qc.invalidateQueries({ queryKey: c.key });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (n: string) => c.remove(n),
    onSuccess: () => qc.invalidateQueries({ queryKey: c.key }),
  });
  const data = q.data;
  const off = secret && data !== undefined && !data.configured;
  const expr = secret ? '${{ secrets.NAME }}' : '${{ vars.NAME }}';

  return (
    <section className="mb-5">
      <h3
        className="f4 mb-1 d-flex flex-items-center"
        style={{ gap: 6 }}
        id={scope ? undefined : `actions-${kind}`}
      >
        {secret ? <LockIcon /> : <KeyIcon />}
        {secret ? t('Secrets') : t('Variables')}
      </h3>
      <p className="f6 color-fg-muted mb-2">
        {secret
          ? tx(
              'Encrypted, and never shown again once saved. Workflows read them as {expr}; job logs show their values as ***.',
              { expr: <code>{expr}</code> }
            )
          : tx(
              'Plain text, readable here and in job logs. Workflows read them as {expr}.',
              { expr: <code>{expr}</code> }
            )}
      </p>
      {off && (
        <div className="flash flash-warn mb-2">
          {t(
            "Secrets aren't set up on this server: a site admin needs to set the ACTIONS_SECRETS_KEY secret (Site admin → Setup checks)."
          )}
        </div>
      )}
      {q.isError ? (
        <div className="flash flash-error mb-2">{errorMessage(q.error)}</div>
      ) : (
        <div className="Box mb-2">
          {q.isPending ? (
            <div className="Box-row color-fg-muted">{t('Loading…')}</div>
          ) : data!.items.length === 0 ? (
            <div className="Box-row color-fg-muted">
              {secret ? t('No secrets yet.') : t('No variables yet.')}
            </div>
          ) : (
            data!.items.map((item) => (
              <div
                key={item.name}
                className="Box-row d-flex flex-items-center flex-wrap"
                style={{ gap: 12 }}
              >
                <code className="text-bold">{item.name}</code>
                <span
                  className="flex-1 color-fg-muted f6 text-mono"
                  style={{ minWidth: 0, overflowWrap: 'anywhere' }}
                >
                  {item.value}
                </span>
                <span className="color-fg-muted f6">
                  {item.updatedBy
                    ? t('Updated {when} by {who}', {
                        when: timeAgo(item.updatedAt),
                        who: item.updatedBy.username,
                      })
                    : t('Updated {when}', { when: timeAgo(item.updatedAt) })}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setEditing(item.name);
                    setName('');
                    setValue(secret ? '' : (item.value ?? ''));
                    setError(null);
                  }}
                >
                  {t('Update')}
                </button>
                <InlineConfirm
                  label={t('Delete')}
                  confirmLabel={
                    secret ? t('Delete secret') : t('Delete variable')
                  }
                  pendingLabel={t('Deleting…')}
                  accessibleName={t('Delete {name}', { name: item.name })}
                  pending={remove.isPending && remove.variables === item.name}
                  error={
                    remove.isError && remove.variables === item.name
                      ? errorMessage(remove.error)
                      : null
                  }
                  onConfirm={() => remove.mutate(item.name)}
                />
              </div>
            ))
          )}
        </div>
      )}
      {scope && data && data.inherited.length > 0 && (
        <p className="f6 color-fg-muted mb-2">
          {t(
            'Also available, from the instance (site admins manage these; one of this repository with the same name wins):'
          )}{' '}
          {data.inherited.map((i, k) => (
            <span key={i.name}>
              {k > 0 && ', '}
              <code title={i.value ?? undefined}>{i.name}</code>
            </span>
          ))}
        </p>
      )}
      <form
        className="d-flex flex-column"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <input
          className="form-control input-monospace"
          aria-label={t('Name')}
          placeholder={t('NAME')}
          value={editing ?? name}
          disabled={editing !== null || off}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
        />
        <textarea
          className="form-control input-monospace"
          aria-label={t('Value')}
          placeholder={
            secret ? t('Value (never shown again once saved)') : t('Value')
          }
          rows={3}
          value={value}
          disabled={off}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="d-flex" style={{ gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              off ||
              save.isPending ||
              !value ||
              (editing === null && !name.trim())
            }
          >
            {editing !== null
              ? t('Update {name}', { name: editing })
              : secret
                ? t('Add secret')
                : t('Add variable')}
          </button>
          {editing !== null && (
            <button type="button" className="btn" onClick={reset}>
              {t('Cancel')}
            </button>
          )}
        </div>
        {error && <div className="flash flash-error">{error}</div>}
      </form>
    </section>
  );
}
