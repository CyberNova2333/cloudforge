import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/auth/auth';
import { errorMessage } from '@/lib/api/api';
import { t } from '@/lib/i18n/i18n';
import {
  oidcApi,
  liveOidcPreview,
  liveOidcRetirement,
  type OidcAdminStatus,
  type OidcAdminPreview,
  type OidcProvider,
  type OidcRetirementPreview,
} from '@/lib/auth/oidcApi';
import { useOidcMemory } from '@/lib/auth/useOidcMemory';
import { Notice } from '@/components/ui/Notice';
import { RowsSkeleton } from '@/components/shell/SetFrame';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';

function ProviderDetails({ provider }: { provider: OidcProvider }) {
  return (
    <dl className="oidc-details">
      <dt>{t('Identity provider')}</dt>
      <dd>{provider.name}</dd>
      <dt>{t('Provider identifier')}</dt>
      <dd>
        <code>{provider.id}</code>
      </dd>
      <dt>{t('Identity issuer')}</dt>
      <dd>{provider.issuer}</dd>
      <dt>{t('OIDC client identifier')}</dt>
      <dd>
        <code>{provider.clientId}</code>
      </dd>
      <dt>{t('Configuration version')}</dt>
      <dd>{provider.version}</dd>
      <dt>{t('OIDC callback URL')}</dt>
      <dd>
        <code>{provider.callbackUrl}</code>
      </dd>
      <dt>{t('Single sign-on')}</dt>
      <dd>{provider.loginEnabled ? t('Enabled') : t('Disabled')}</dd>
      {provider.loginEnabled && provider.loginCallbackUrl && (
        <>
          <dt>{t('Single sign-on callback URL')}</dt>
          <dd>
            <code>{provider.loginCallbackUrl}</code>
          </dd>
        </>
      )}
    </dl>
  );
}

export function AdminOIDCProvider() {
  const { data: session } = useSession();
  return (
    <ProviderForm
      key={`${session?.user.id ?? ''}:${session?.session.id ?? ''}`}
    />
  );
}

function ProviderForm() {
  const { data: session } = useSession();
  const sessionId = session?.session.id;
  const [status, setStatus] = useState<OidcAdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<OidcAdminPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [retirementPreview, setRetirementPreview] =
    useState<OidcRetirementPreview | null>(null);
  const [retirementAcknowledged, setRetirementAcknowledged] = useState(false);
  const [busy, setBusy] = useState<
    'preview' | 'apply' | 'retire-preview' | 'retire' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [retired, setRetired] = useState(false);
  const locked = useRef(false);
  const loads = useRef(0);
  const clearPreview = () => {
    setPreview(null);
    setAcknowledged(false);
    setRetirementPreview(null);
    setRetirementAcknowledged(false);
  };
  const clear = () => {
    loads.current++;
    locked.current = false;
    setStatus(null);
    setLoading(true);
    clearPreview();
    setBusy(null);
    setError(null);
    setSaved(false);
    setRetired(false);
  };
  const memory = useOidcMemory(
    `${session?.user.id}:${sessionId}`,
    clear,
    () => void load()
  );
  const load = async () => {
    if (!sessionId) return;
    const count = ++loads.current;
    const request = memory.begin();
    setLoading(true);
    try {
      const value = await oidcApi.adminStatus(sessionId, request.signal);
      if (request.current() && count === loads.current) setStatus(value);
    } catch (caught) {
      if (request.current() && count === loads.current) {
        setStatus(null);
        setError(errorMessage(caught));
      }
    } finally {
      request.done();
      if (request.current() && count === loads.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [sessionId]);
  useEffect(clearPreview, [
    status?.provider?.id,
    status?.provider?.issuer,
    status?.provider?.clientId,
    status?.provider?.version,
    status?.provider?.callbackUrl,
    status?.active?.generation,
    status?.active?.enabled,
  ]);
  useEffect(() => {
    const expiring = retirementPreview ?? preview;
    if (!expiring) return;
    const remaining = Date.parse(expiring.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clearPreview();
      return;
    }
    const timer = window.setTimeout(clearPreview, remaining);
    return () => window.clearTimeout(timer);
  }, [preview, retirementPreview]);
  const run = async (
    operation: 'preview' | 'apply' | 'retire-preview' | 'retire'
  ) => {
    if (!sessionId || locked.current || !status) return;
    if ((operation === 'preview' || operation === 'apply') && !status.provider)
      return;
    if (
      (operation === 'retire-preview' || operation === 'retire') &&
      (!status.active || status.active.enabled === false)
    )
      return;
    if (
      operation === 'apply' &&
      (!acknowledged || !liveOidcPreview(preview, status.provider))
    )
      return;
    if (
      operation === 'retire' &&
      (!retirementAcknowledged ||
        !liveOidcRetirement(retirementPreview, status.active))
    )
      return;
    const request = memory.begin();
    locked.current = true;
    setBusy(operation);
    setError(null);
    setSaved(false);
    setRetired(false);
    try {
      if (operation === 'preview') {
        clearPreview();
        const value = await oidcApi.adminPreview(sessionId, request.signal);
        if (!request.current()) return;
        if (
          !liveOidcPreview(value, status.provider) ||
          (value.active?.generation ?? 0) !== (status.active?.generation ?? 0)
        )
          throw new Error(
            'The identity preview expired or the provider changed. Preview again.'
          );
        setPreview(value);
      } else if (operation === 'apply') {
        await oidcApi.apply(sessionId, preview!, request.signal);
        if (!request.current()) return;
        clearPreview();
        setSaved(true);
        await load();
      } else if (operation === 'retire-preview') {
        clearPreview();
        const value = await oidcApi.retirePreview(sessionId, request.signal);
        if (!request.current()) return;
        if (!liveOidcRetirement(value, status.active))
          throw new Error(
            'The identity preview expired or the provider changed. Preview again.'
          );
        setRetirementPreview(value);
      } else {
        await oidcApi.retire(sessionId, retirementPreview!, request.signal);
        if (!request.current()) return;
        clearPreview();
        setRetired(true);
        await load();
      }
    } catch (caught) {
      if (!request.current()) return;
      clearPreview();
      setError(errorMessage(caught));
      // Publishing is never retried after an uncertain response; read D1's actual state.
      await load();
    } finally {
      request.done();
      if (request.current()) {
        locked.current = false;
        setBusy(null);
      }
    }
  };
  const valid = liveOidcPreview(preview, status?.provider ?? null);
  const validRetirement = liveOidcRetirement(
    retirementPreview,
    status?.active ?? null
  );
  const needsHigherVersion =
    status?.active?.enabled === false &&
    status.active.id === status.provider?.id &&
    status.provider.version <= status.active.version;
  return (
    <Section title={t('External identity provider')} className="oidc-section">
      <p>
        {t(
          status?.provider?.loginEnabled
            ? 'This deployment explicitly enables single sign-on for already linked identities. Publishing it also requires the displayed login callback to be registered with the provider.'
            : 'Publish the provider supplied by this deployment before members can link identities. Publishing does not enable single sign-on.'
        )}
      </p>
      <p className="small muted">
        {t(
          'The client secret is managed only in deployment secrets. This page never reads, displays, or edits it.'
        )}
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {saved && (
        <Notice tone="ok">
          {t('Identity provider configuration published.')}
        </Notice>
      )}
      {retired && (
        <Notice tone="ok">
          {t('The published identity provider has been retired.')}
        </Notice>
      )}
      {loading ? (
        <RowsSkeleton rows={3} />
      ) : !status ? (
        <button type="button" className="btn" onClick={() => void load()}>
          {t('Refresh identity status')}
        </button>
      ) : (
        <>
          {status.configurationError ? (
            <Notice tone="warn">
              {t(
                'This deployment has an invalid identity provider configuration. You can still retire the published provider below.'
              )}
            </Notice>
          ) : !status.configured || !status.provider ? (
            <Notice>{t('No external identity provider is configured.')}</Notice>
          ) : (
            <>
              <h3>{t('Deployed provider')}</h3>
              <ProviderDetails provider={status.provider} />
              <Notice tone={status.ready ? 'ok' : 'warn'}>
                {status.ready
                  ? t(
                      'This deployment matches the published provider configuration.'
                    )
                  : t(
                      'This deployment is not the published provider configuration. Member linking is unavailable.'
                    )}
              </Notice>
              <PendingButton
                pending={busy === 'preview'}
                disabled={!!busy || status.ready || needsHigherVersion}
                pendingLabel={t('Preparing preview…')}
                onClick={() => void run('preview')}
              >
                {t('Preview provider publication')}
              </PendingButton>
            </>
          )}
          {status.active && (
            <>
              <h3>{t('Published provider')}</h3>
              <dl className="oidc-details">
                <dt>{t('Provider identifier')}</dt>
                <dd>{status.active.id}</dd>
                <dt>{t('Identity issuer')}</dt>
                <dd>{status.active.issuer}</dd>
                <dt>{t('Configuration version')}</dt>
                <dd>{status.active.version}</dd>
                <dt>{t('Single sign-on')}</dt>
                <dd>
                  {status.active.loginEnabled ? t('Enabled') : t('Disabled')}
                </dd>
                <dt>{t('Provider status')}</dt>
                <dd>
                  {status.active.enabled === false
                    ? t('Retired for all deployments')
                    : t('Published and active')}
                </dd>
              </dl>
              {status.active.enabled === false ? (
                <Notice>
                  {t(
                    'Linking is retired. Reactivation requires publishing a higher configuration version.'
                  )}
                </Notice>
              ) : (
                <>
                  <p className="small muted">
                    {t(
                      'Clearing deployment variables does not retire the published provider. Retire it here to reject earlier configurations and pending identity actions.'
                    )}
                  </p>
                  <PendingButton
                    className="danger"
                    pending={busy === 'retire-preview'}
                    disabled={!!busy}
                    pendingLabel={t('Preparing preview…')}
                    onClick={() => void run('retire-preview')}
                  >
                    {t('Preview provider retirement')}
                  </PendingButton>
                </>
              )}
            </>
          )}
          {valid && preview && (
            <section
              className="panel formpad"
              aria-label={t('Provider publication preview')}
            >
              <h3>{t('Provider publication preview')}</h3>
              <ProviderDetails provider={preview.provider} />
              {preview.provider.loginEnabled && (
                <Notice tone="warn">
                  {t(
                    'This publication enables single sign-on for existing linked identities. It does not register new members or match members by email. Local second factors remain required when enabled.'
                  )}
                </Notice>
              )}
              <p>
                {t('Local administrator')}:{' '}
                <strong>{session?.user.email}</strong>
              </p>
              <Notice tone="warn">
                {t(
                  'Publishing replaces the active provider generation, stops older pending identity actions, and signs out sessions originating from this provider, including after password verification. Linked identities remain owned by their original members.'
                )}
              </Notice>
              <label className="security-saved">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={!!busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />{' '}
                {t(
                  'I checked the deployed issuer, client identifier and callback URL and want to publish this configuration.'
                )}
              </label>
              <div className="security-actions">
                <PendingButton
                  className="primary"
                  pending={busy === 'apply'}
                  disabled={!!busy || !acknowledged}
                  pendingLabel={t('Publishing…')}
                  onClick={() => void run('apply')}
                >
                  {t('Confirm provider publication')}
                </PendingButton>
                <button
                  className="btn"
                  type="button"
                  disabled={!!busy}
                  onClick={clearPreview}
                >
                  {t('Cancel')}
                </button>
              </div>
            </section>
          )}
          {validRetirement && retirementPreview && (
            <section
              className="panel formpad"
              aria-label={t('Provider retirement preview')}
            >
              <h3>{t('Provider retirement preview')}</h3>
              <dl className="oidc-details">
                <dt>{t('Provider identifier')}</dt>
                <dd>{retirementPreview.active.id}</dd>
                <dt>{t('Identity issuer')}</dt>
                <dd>{retirementPreview.active.issuer}</dd>
                <dt>{t('Configuration version')}</dt>
                <dd>{retirementPreview.active.version}</dd>
              </dl>
              <p>
                {t('Local administrator')}:{' '}
                <strong>{session?.user.email}</strong>
              </p>
              <Notice tone="warn">
                {t(
                  'Retirement stops identity linking and single sign-on across deployments, invalidates pending identity actions, and signs out sessions originating from this provider. Identity ownership records remain. Reactivation requires a higher configuration version.'
                )}
              </Notice>
              <label className="security-saved">
                <input
                  type="checkbox"
                  checked={retirementAcknowledged}
                  disabled={!!busy}
                  onChange={(event) =>
                    setRetirementAcknowledged(event.target.checked)
                  }
                />{' '}
                {t(
                  'I understand the impact and want to retire this published identity provider.'
                )}
              </label>
              <div className="security-actions">
                <PendingButton
                  className="danger"
                  pending={busy === 'retire'}
                  disabled={!!busy || !retirementAcknowledged}
                  pendingLabel={t('Retiring…')}
                  onClick={() => void run('retire')}
                >
                  {t('Confirm provider retirement')}
                </PendingButton>
                <button
                  className="btn"
                  type="button"
                  disabled={!!busy}
                  onClick={clearPreview}
                >
                  {t('Cancel')}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </Section>
  );
}
