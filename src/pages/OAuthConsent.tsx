// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  EyeIcon,
  PencilIcon,
  PersonIcon,
  PlugIcon,
  SyncIcon,
} from '@primer/octicons-react';
import { api, qk } from '@/lib/uiApi';
import { apiFetch } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { Avatar } from '@/components/Avatar';
import { Notice } from '@/components/Notice';
import { PendingButton } from '@/components/ui/PendingButton';
import { RowsSkeleton } from '@/components/SetFrame';
import { useAppName } from '@/lib/appName';
import { AuthShell } from './AuthShell';
import { t, tx } from '@/lib/i18n';

type PublicClient = {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
};

/** The host of a client's home page, or null when it is not a URL. */
function hostOf(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

/** OAuth consent: posts the decision with the signed query and follows the returned redirect. */
export default function OAuthConsent() {
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get('client_id') ?? '';
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const user = useCurrentUser();
  const appName = useAppName();
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useQuery({
    queryKey: ['oauth-client', clientId],
    queryFn: () =>
      apiFetch<PublicClient>(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`
      ),
    enabled: Boolean(clientId),
    retry: false,
  });
  const tools = useQuery({ queryKey: qk.mcp, queryFn: api.mcp });

  if (!params.has('sig') || !clientId)
    return (
      <AuthShell title={t('Authorization link')} docTitle={t('Authorize')}>
        <Notice tone="bad">
          {t(
            'This authorization link is incomplete or has expired. Start the connection again from your app.'
          )}
        </Notice>
      </AuthShell>
    );

  const name = client.data?.client_name || t('An application');

  async function decide(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const res = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accept,
          oauth_query: window.location.search.slice(1),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
        error_description?: string;
      };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(
        data.error_description ||
          data.message ||
          t('Something went wrong. Start the connection again from your app.')
      );
    } catch {
      setError(t('Network error. Try again.'));
    }
    setBusy(null);
  }

  const readOnly = tools.data?.tools.filter(
    (tool) => tool.annotations.readOnlyHint
  );
  const writes = tools.data?.tools.filter(
    (tool) => !tool.annotations.readOnlyHint
  );

  return (
    <AuthShell
      title={tx('{app} wants to access your {name} account', {
        app: <b>{name}</b>,
        name: appName,
      })}
      docTitle={t('Authorize')}
      hideBrand
      wide
    >
      <div className="consent-marks" aria-hidden="true">
        {client.data?.logo_uri ? (
          <img
            src={client.data.logo_uri}
            alt=""
            width={44}
            height={44}
            className="consent-logo"
          />
        ) : (
          <span className="consent-logo plug">
            <PlugIcon size={22} />
          </span>
        )}
        <SyncIcon className="muted" />
        <img src="/logo.png" alt="" width={44} height={44} />
      </div>
      {client.isLoading ? (
        <RowsSkeleton rows={3} />
      ) : client.isError ? (
        <Notice tone="bad">
          {t(
            'This app isn’t registered with {name}. Start the connection again from your app.',
            { name: appName }
          )}
        </Notice>
      ) : (
        <ul className="rowlist perms">
          {user && (
            <li>
              <Avatar user={user as { username: string }} size={32} />
              <div className="grow">
                <span className="small">
                  {tx('Signed in as {user}. {app} will act as you.', {
                    user: <b>{user.username}</b>,
                    app: name,
                  })}
                </span>
              </div>
            </li>
          )}
          <li className="top">
            <EyeIcon className="ic" />
            <div className="grow">
              <b>{t('Read your repositories')}</b>
              <span className="small muted">
                {t(
                  '{tools}. Includes private repositories you have access to.',
                  {
                    tools:
                      readOnly?.map((tool) => tool.title).join(', ') ||
                      t('See the repositories you can see'),
                  }
                )}
              </span>
            </div>
          </li>
          <li className="top">
            <PencilIcon className="ic" />
            <div className="grow">
              <b>{t('Make changes')}</b>
              <span className="small muted">
                {t('{tools} as you.', {
                  tools:
                    writes?.map((tool) => tool.title).join(', ') ||
                    t('Create repositories'),
                })}
              </span>
            </div>
          </li>
          {(scopes.includes('profile') || scopes.includes('email')) && (
            <li className="top">
              <PersonIcon className="ic" />
              <div className="grow">
                <b>{t('Know who you are')}</b>
                <span className="small muted">
                  {scopes.includes('email')
                    ? t('Your name, username, and email address.')
                    : t('Your name, username.')}
                </span>
              </div>
            </li>
          )}
          {scopes.includes('offline_access') && (
            <li className="small muted">
              {t(
                'Stays connected until you disconnect it in Settings → MCP server.'
              )}
            </li>
          )}
        </ul>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="consent-actions">
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => decide(false)}
        >
          {busy === 'deny' ? t('Cancelling…') : t('Cancel')}
        </button>
        <PendingButton
          className="primary"
          pending={busy === 'allow'}
          pendingLabel={t('Authorizing…')}
          disabled={busy !== null || client.isError || client.isLoading}
          onClick={() => decide(true)}
        >
          {t('Authorize {app}', { app: name })}
        </PendingButton>
      </div>
      {hostOf(client.data?.client_uri) && (
        <p className="auth-foot plain">
          {t('From {host}', { host: hostOf(client.data?.client_uri) ?? '' })}
        </p>
      )}
    </AuthShell>
  );
}
