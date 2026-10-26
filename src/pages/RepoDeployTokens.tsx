import { useEffect, useId, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GearIcon, KeyIcon, LinkIcon } from '@primer/octicons-react';
import type { RepoDetail } from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/format';
import { t } from '@/lib/i18n';
import {
  deployTokenKeys,
  deployTokensApi,
  type DeployToken,
} from '@/lib/deployTokensApi';
import { CopyButton } from '@/components/CopyButton';
import { InlineConfirm } from '@/components/InlineConfirm';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { NotFound } from './NotFound';

function DeployTokenRow({
  token,
  repo,
  onRevoked,
}: {
  token: DeployToken;
  repo: RepoDetail;
  onRevoked: (id: string) => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      deployTokensApi.remove(repo.owner.username, repo.name, token.id),
    onSuccess: () => {
      onRevoked(token.id);
      return qc.invalidateQueries({
        queryKey: deployTokenKeys.list(repo.owner.username, repo.name),
      });
    },
  });
  return (
    <li className="deploy-token-row">
      <KeyIcon className="muted" size={20} />
      <div className="deploy-token-info">
        <strong>{token.name}</strong>
        <span className="muted small">
          {token.scope === 'read' ? t('Read only') : t('Read and write')}
          {' · '}
          {new Date(token.expiresAt).getTime() <= Date.now()
            ? t('Expired')
            : t('Expires {date}', {
                date: new Date(token.expiresAt).toLocaleDateString(),
              })}
        </span>
        <span className="muted small" title={fullDate(token.createdAt)}>
          {t('Created {when}', { when: timeAgo(token.createdAt) })}
          {' · '}
          {token.lastUsedAt
            ? t('Last used {when}', { when: timeAgo(token.lastUsedAt) })
            : t('Never used')}
        </span>
      </div>
      <InlineConfirm
        label={t('Revoke')}
        confirmLabel={t('Revoke token')}
        pendingLabel={t('Revoking…')}
        accessibleName={t('Revoke deploy token {name}', { name: token.name })}
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

function DeployTokensContent({ repo }: { repo: RepoDetail }) {
  const id = useId();
  const qc = useQueryClient();
  const owner = repo.owner.username;
  const queryKey = deployTokenKeys.list(owner, repo.name);
  const tokens = useQuery({
    queryKey,
    queryFn: () => deployTokensApi.list(owner, repo.name),
  });
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [scope, setScope] = useState<DeployToken['scope']>('read');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    plaintext: string;
  } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const atLimit = (tokens.data?.length ?? 0) >= 50;
  const valid =
    name.trim().length > 0 &&
    Number.isInteger(Number(days)) &&
    Number(days) >= 1 &&
    Number(days) <= 366;

  async function create() {
    if (pending || !valid || atLimit) return;
    setCreated(null);
    setError(null);
    setPending(true);
    try {
      // Keep plaintext out of React Query's mutation cache as well as its query cache.
      const result = await deployTokensApi.create(owner, repo.name, {
        name: name.trim(),
        scope,
        expiresInDays: Number(days),
      });
      if (mounted.current) {
        setCreated({ id: result.token.id, plaintext: result.plaintext });
        setName('');
        setScope('read');
        setDays('30');
        await qc.invalidateQueries({ queryKey });
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <>
      <PageHead
        icon="key"
        crumbs={[
          { label: t('Settings'), to: `/${repo.fullName}/settings` },
          { label: t('Deploy tokens') },
        ]}
        title={t('Deploy tokens')}
        tab="settings"
        lede={t(
          'Give a deployment machine HTTPS access to this repository only.'
        )}
      />
      <div className="webhooks-layout deploy-tokens-layout">
        <nav
          className="menu webhook-settings-nav"
          aria-label={t('Repository settings')}
        >
          <Link className="menu-item" to={`/${repo.fullName}/settings`}>
            <GearIcon size={16} /> {t('General')}
          </Link>
          <Link
            className="menu-item"
            to={`/${repo.fullName}/settings/webhooks`}
          >
            <LinkIcon size={16} /> {t('Webhooks')}
          </Link>
          <Link
            className="menu-item selected"
            to={`/${repo.fullName}/settings/deploy-tokens`}
            aria-current="page"
          >
            <KeyIcon size={16} /> {t('Deploy tokens')}
          </Link>
        </nav>
        <div className="deploy-tokens-main">
          <section className="panel" aria-label={t('Repository deploy tokens')}>
            <div className="pad">
              <h3>{t('Repository deploy tokens')}</h3>
              <p className="small muted">
                {t(
                  'For Git and Git LFS only. Tokens cannot sign in or call REST or MCP APIs.'
                )}
              </p>
            </div>
            {tokens.isError ? (
              <QueryError
                error={tokens.error}
                title={t('Deploy tokens did not load')}
                onRetry={() => void tokens.refetch()}
              />
            ) : !tokens.data ? (
              <div className="pad">
                <RowsSkeleton rows={2} />
              </div>
            ) : !tokens.data.length ? (
              <EmptyState
                picture={<KeyIcon size={24} />}
                title={t('No deploy tokens yet')}
                body={t(
                  'Create a read-only token for a machine that only needs to fetch code.'
                )}
              />
            ) : (
              <ul className="deploy-token-list">
                {tokens.data.map((token) => (
                  <DeployTokenRow
                    key={token.id}
                    token={token}
                    repo={repo}
                    onRevoked={(revokedId) =>
                      setCreated((value) =>
                        value?.id === revokedId ? null : value
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </section>
          {created && (
            <section
              className="newtoken deploy-token-created"
              role="status"
              aria-label={t('New deploy token')}
            >
              <p>
                <strong>{t('Copy your new token now.')}</strong>{' '}
                {t(
                  'It is only shown once. Store it in your credential manager.'
                )}
              </p>
              <div className="copyrow">
                <input
                  className="form-control mono"
                  readOnly
                  value={created.plaintext}
                  aria-label={t('Your new deploy token')}
                  autoComplete="off"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton
                  text={created.plaintext}
                  className="btn small"
                  label={t('Copy the token')}
                />
              </div>
              <button
                type="button"
                className="btn small"
                onClick={() => setCreated(null)}
              >
                {t('I have saved the token')}
              </button>
            </section>
          )}
          <section className="panel">
            <form
              className="deploy-token-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <h3>{t('Create deploy token')}</h3>
              {atLimit && (
                <p className="flash flash-warn" role="status">
                  {t(
                    'This repository has 50 deploy tokens. Revoke an unused or expired token first.'
                  )}
                </p>
              )}
              <fieldset disabled={pending || !tokens.data || atLimit}>
                <label className="fld" htmlFor={`${id}-name`}>
                  <span className="lbl">{t('Note')}</span>
                  <input
                    id={`${id}-name`}
                    className="form-control"
                    maxLength={100}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('For example: production deploy machine')}
                  />
                </label>
                <div className="deploy-token-fields">
                  <label className="fld" htmlFor={`${id}-scope`}>
                    <span className="lbl">{t('Access')}</span>
                    <select
                      id={`${id}-scope`}
                      className="form-select"
                      value={scope}
                      onChange={(e) =>
                        setScope(e.target.value as DeployToken['scope'])
                      }
                    >
                      <option value="read">{t('Read only')}</option>
                      <option value="write">{t('Read and write')}</option>
                    </select>
                  </label>
                  <label className="fld" htmlFor={`${id}-days`}>
                    <span className="lbl">{t('Expires in days')}</span>
                    <input
                      id={`${id}-days`}
                      className="form-control"
                      type="number"
                      min={1}
                      max={366}
                      step={1}
                      required
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      aria-describedby={`${id}-expiry-help`}
                    />
                    <span id={`${id}-expiry-help`} className="small muted">
                      {t('1–366 days. Default: 30 days.')}
                    </span>
                  </label>
                </div>
              </fieldset>
              {scope === 'write' && (
                <p className="flash flash-warn" role="note">
                  {t(
                    'A write token can push workflows that use this repository’s Actions secrets. It cannot push the default or protected branches. An admin must initialize the default branch first.'
                  )}
                </p>
              )}
              <PendingButton
                type="submit"
                className="primary"
                pending={pending}
                pendingLabel={t('Generating…')}
                disabled={!valid || !tokens.data || atLimit}
                error={error}
              >
                {t('Create deploy token')}
              </PendingButton>
            </form>
          </section>
          <section
            className="panel pad deploy-token-help"
            aria-label={t('Using deploy tokens')}
          >
            <h3>{t('Using deploy tokens')}</h3>
            <p>
              {t(
                'Use the normal HTTPS clone URL. Enter deploy as the username and the token as the password; Git LFS uses the same credentials. Keep the token out of the URL.'
              )}
            </p>
            <p>
              {t(
                'Tokens work while their creator remains an active repository admin. Revoke a token to disable it permanently.'
              )}
            </p>
            <p className="small muted">
              {t(
                'Revocation blocks new Git and LFS requests. Transfers already started and previously signed LFS links can remain valid; LFS links expire within 15 minutes.'
              )}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

export default function RepoDeployTokens() {
  const repo = useOutletContext<RepoDetail>();
  if (!repo.permissions.admin) return <NotFound />;
  return <DeployTokensContent key={repo.id} repo={repo} />;
}
