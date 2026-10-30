import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useOidcMemory } from '@/lib/useOidcMemory';
import {
  oidcApi,
  oidcActionId,
  oidcAuthorizationUrl,
  liveOidcPreview,
  candidateOidcAction,
  type OidcIdentity,
  type OidcStatus,
  type OidcPreview,
  type OidcAction,
  type OidcBinding,
} from '@/lib/oidcApi';
import { Notice } from '@/components/Notice';
import { RowsSkeleton } from '@/components/SetFrame';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';

/** Provider-controlled profile text is never HTML, an image, or a navigation target. */
export function OIDCIdentityDetails({ identity }: { identity: OidcIdentity }) {
  return (
    <dl className="oidc-details">
      <dt>{t('Identity issuer')}</dt>
      <dd>{identity.issuer}</dd>
      <dt>{t('Identity subject')}</dt>
      <dd>
        <code>{identity.subject}</code>
      </dd>
      <dt>{t('External email')}</dt>
      <dd>{identity.email ?? t('Not supplied')}</dd>
      <dt>{t('External display name')}</dt>
      <dd>{identity.name ?? t('Not supplied')}</dd>
    </dl>
  );
}

export function OIDCIdentities() {
  const { data: session } = useSession();
  return (
    <IdentityForm
      key={`${session?.user.id ?? ''}:${session?.session.id ?? ''}`}
    />
  );
}

function IdentityForm() {
  const { data: session } = useSession();
  const sessionId = session?.session.id;
  const userId = session?.user.id;
  const location = useLocation();
  const navigate = useNavigate();
  const actionId = oidcActionId(location.search);
  const [status, setStatus] = useState<OidcStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedActionId, setLoadedActionId] = useState<
    string | null | undefined
  >(undefined);
  const [preview, setPreview] = useState<OidcPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [action, setAction] = useState<OidcAction | null>(null);
  const [confirmAcknowledged, setConfirmAcknowledged] = useState(false);
  const [revoking, setRevoking] = useState<OidcBinding | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  const loadVersion = useRef(0);
  const clear = () => {
    loadVersion.current++;
    locked.current = false;
    setStatus(null);
    setLoading(true);
    setLoadedActionId(undefined);
    setPreview(null);
    setAcknowledged(false);
    setAction(null);
    setConfirmAcknowledged(false);
    setRevoking(null);
    setBusy(null);
    setError(null);
    setNotice(null);
  };
  const memory = useOidcMemory(
    `${userId}:${sessionId}`,
    clear,
    () => void load()
  );
  const load = async () => {
    if (!sessionId) return;
    const version = ++loadVersion.current;
    const request = memory.begin();
    setLoading(true);
    try {
      const [state, receipt] = await Promise.allSettled([
        oidcApi.status(sessionId, request.signal),
        actionId
          ? oidcApi.action(sessionId, actionId, request.signal)
          : Promise.resolve(null),
      ]);
      if (!request.current() || version !== loadVersion.current) return;
      if (state.status === 'fulfilled') setStatus(state.value);
      else {
        setStatus(null);
        setError(errorMessage(state.reason));
      }
      if (receipt.status === 'fulfilled') setAction(receipt.value);
      else {
        setAction(null);
        setError(errorMessage(receipt.reason));
      }
      setConfirmAcknowledged(false);
      setLoadedActionId(actionId);
    } finally {
      request.done();
      if (request.current() && version === loadVersion.current)
        setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [sessionId, actionId]);
  useEffect(() => {
    setPreview(null);
    setAcknowledged(false);
    setRevoking(null);
  }, [
    status?.provider?.id,
    status?.provider?.issuer,
    status?.provider?.version,
    status?.provider?.clientId,
    status?.provider?.callbackUrl,
    status?.ready,
  ]);
  useEffect(() => {
    if (!preview) return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    const expire = () => {
      setPreview(null);
      setAcknowledged(false);
    };
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [preview]);
  useEffect(() => {
    if (!action?.expiresAt || action.status !== 'candidate') return;
    const remaining = Date.parse(action.expiresAt) - Date.now();
    const expire = () => {
      setAction((value) =>
        value?.actionId === action.actionId
          ? { ...value, status: 'expired', identity: null }
          : value
      );
      setConfirmAcknowledged(false);
    };
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [action]);
  const clearActionQuery = () => {
    const search = new URLSearchParams(location.search);
    search.delete('oidc_action');
    search.delete('oidc_status');
    navigate(
      {
        pathname: location.pathname,
        search: search.toString(),
        hash: location.hash,
      },
      { replace: true }
    );
  };
  const run = async (operation: string) => {
    if (locked.current || !sessionId || !session) return;
    if (
      operation === 'start' &&
      (!status?.ready ||
        !acknowledged ||
        !liveOidcPreview(preview, status?.provider ?? null))
    )
      return;
    if (
      operation === 'confirm' &&
      (!status?.ready ||
        loadedActionId !== actionId ||
        !confirmAcknowledged ||
        !candidateOidcAction(action))
    )
      return;
    locked.current = true;
    setBusy(operation);
    setError(null);
    setNotice(null);
    const request = memory.begin();
    try {
      if (operation === 'preview') {
        setPreview(null);
        setAcknowledged(false);
        const result = await oidcApi.preview(sessionId, request.signal);
        if (!request.current()) return;
        if (!liveOidcPreview(result, status?.provider ?? null))
          throw new Error(
            'The identity preview expired or the provider changed. Preview again.'
          );
        setPreview(result);
      } else if (operation === 'start') {
        const result = await oidcApi.start(sessionId, preview!, request.signal);
        if (!request.current()) return;
        setPreview(null);
        setAcknowledged(false);
        window.location.assign(oidcAuthorizationUrl(result.authorizationUrl));
      } else if (operation === 'confirm' && action) {
        await oidcApi.confirm(sessionId, action.actionId, request.signal);
        if (!request.current()) return;
        setAction(null);
        setConfirmAcknowledged(false);
        clearActionQuery();
        setNotice(
          t('External identity linked. This did not enable single sign-on.')
        );
        await load();
      } else if (operation === 'cancel' && action) {
        await oidcApi.cancel(sessionId, action.actionId, request.signal);
        if (!request.current()) return;
        setAction(null);
        setConfirmAcknowledged(false);
        clearActionQuery();
        setNotice(t('Identity linking cancelled.'));
        await load();
      } else if (operation === 'revoke' && revoking) {
        await oidcApi.revoke(sessionId, revoking, request.signal);
        if (!request.current()) return;
        setRevoking(null);
        setNotice(t('External identity revoked.'));
        await load();
      }
    } catch (caught) {
      if (!request.current()) return;
      setPreview(null);
      setAcknowledged(false);
      setConfirmAcknowledged(false);
      setRevoking(null);
      setError(errorMessage(caught));
      // A lost reply is not permission to repeat a write. Read its current receipt instead.
      await load();
    } finally {
      request.done();
      if (request.current()) {
        locked.current = false;
        setBusy(null);
      }
    }
  };
  const validPreview =
    !!status?.ready && liveOidcPreview(preview, status.provider);
  const candidate = !!status?.ready && candidateOidcAction(action);
  const alreadyLinked = status?.bindings.some(
    (binding) => binding.providerId === status.provider?.id
  );
  return (
    <Section title={t('External identities')} className="oidc-section">
      <p>
        {t(
          'Link an external identity to this local account. Single sign-on remains unavailable; keep using your password and configured factors.'
        )}
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {loading || loadedActionId !== actionId ? (
        <RowsSkeleton rows={3} />
      ) : !status ? (
        <button className="btn" type="button" onClick={() => void load()}>
          {t('Refresh identity status')}
        </button>
      ) : (
        <>
          <p>
            {t('Local account')}: <strong>{session?.user.name}</strong>{' '}
            <span>{session?.user.email}</span>
          </p>
          {!status.provider ? (
            <Notice>{t('No external identity provider is configured.')}</Notice>
          ) : (
            <>
              <dl className="oidc-details">
                <dt>{t('Identity provider')}</dt>
                <dd>{status.provider.name}</dd>
                <dt>{t('Identity issuer')}</dt>
                <dd>{status.provider.issuer}</dd>
              </dl>
              {!status.ready ? (
                <Notice tone="warn">
                  {t(
                    'The deployed identity provider has not been published by an administrator. Linking is unavailable.'
                  )}
                </Notice>
              ) : (
                <PendingButton
                  pending={busy === 'preview'}
                  disabled={!!busy || !!action || alreadyLinked}
                  pendingLabel={t('Preparing preview…')}
                  onClick={() => void run('preview')}
                >
                  {t('Preview identity linking')}
                </PendingButton>
              )}
            </>
          )}
          {alreadyLinked && (
            <p className="small muted">
              {t(
                'Revoke the existing identity from this provider before linking another.'
              )}
            </p>
          )}
          {validPreview && preview && (
            <section
              className="panel formpad"
              aria-label={t('Identity linking preview')}
            >
              <h3>{t('Identity linking preview')}</h3>
              <p>
                {t(
                  'Continue to this provider to prove ownership, then review the returned identity before linking. Returning from the provider does not link it automatically.'
                )}
              </p>
              <dl className="oidc-details">
                <dt>{t('Local account')}</dt>
                <dd>{session?.user.email}</dd>
                <dt>{t('Identity provider')}</dt>
                <dd>{preview.provider.name}</dd>
                <dt>{t('Identity issuer')}</dt>
                <dd>{preview.provider.issuer}</dd>
              </dl>
              <label className="security-saved">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={!!busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />{' '}
                {t(
                  'I want to link an identity from this provider to this local account.'
                )}
              </label>
              <div className="security-actions">
                <PendingButton
                  className="primary"
                  pending={busy === 'start'}
                  disabled={!!busy || !acknowledged}
                  pendingLabel={t('Continuing…')}
                  onClick={() => void run('start')}
                >
                  {t('Continue to identity provider')}
                </PendingButton>
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() => {
                    setPreview(null);
                    setAcknowledged(false);
                  }}
                >
                  {t('Cancel')}
                </button>
              </div>
            </section>
          )}
          {action && (
            <section
              className="panel formpad"
              aria-label={t('Returned external identity')}
            >
              <h3>{t('Returned external identity')}</h3>
              {candidate && action.identity ? (
                <>
                  <Notice tone="warn">
                    {t(
                      'Review the immutable issuer and subject. Email and display name are profile text and do not select a local account.'
                    )}
                  </Notice>
                  <OIDCIdentityDetails identity={action.identity} />
                  <p>
                    {t('Local account')}: <strong>{session?.user.email}</strong>
                  </p>
                  <label className="security-saved">
                    <input
                      type="checkbox"
                      checked={confirmAcknowledged}
                      disabled={!!busy}
                      onChange={(event) =>
                        setConfirmAcknowledged(event.target.checked)
                      }
                    />{' '}
                    {t(
                      'I confirm that this external identity belongs to me and should be linked to this local account.'
                    )}
                  </label>
                  <div className="security-actions">
                    <PendingButton
                      className="primary"
                      pending={busy === 'confirm'}
                      disabled={!!busy || !confirmAcknowledged}
                      pendingLabel={t('Linking…')}
                      onClick={() => void run('confirm')}
                    >
                      {t('Confirm identity linking')}
                    </PendingButton>
                    <PendingButton
                      pending={busy === 'cancel'}
                      disabled={!!busy}
                      pendingLabel={t('Cancelling…')}
                      onClick={() => void run('cancel')}
                    >
                      {t('Cancel identity linking')}
                    </PendingButton>
                  </div>
                </>
              ) : (
                <>
                  <Notice tone={action.status === 'confirmed' ? 'ok' : 'info'}>
                    {action.status === 'confirmed'
                      ? t(
                          'This identity action is already confirmed. Check the linked identities below.'
                        )
                      : action.status === 'pending'
                        ? t(
                            'Identity verification is still pending. Refresh its status before continuing.'
                          )
                        : t(
                            'This identity action cannot be confirmed. Start again if you still want to link an identity.'
                          )}
                  </Notice>
                  <div className="security-actions">
                    {(action.status === 'pending' ||
                      action.status === 'candidate') && (
                      <PendingButton
                        pending={busy === 'cancel'}
                        disabled={!!busy}
                        pendingLabel={t('Cancelling…')}
                        onClick={() => void run('cancel')}
                      >
                        {t('Cancel identity linking')}
                      </PendingButton>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      onClick={() => void load()}
                    >
                      {t('Refresh identity status')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      onClick={() => {
                        setAction(null);
                        clearActionQuery();
                      }}
                    >
                      {t('Dismiss')}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
          <h3>{t('Linked identities')}</h3>
          {!status.bindings.length && (
            <p className="muted">{t('No external identities are linked.')}</p>
          )}
          {status.bindings.map((binding) => (
            <section
              key={`${binding.id}:${binding.revision}`}
              className="panel formpad"
              aria-label={t('Linked external identity')}
            >
              <OIDCIdentityDetails identity={binding} />
              <button
                type="button"
                className="btn danger"
                disabled={!!busy}
                onClick={() => {
                  setRevoking(binding);
                  setError(null);
                }}
              >
                {t('Revoke identity')}
              </button>
            </section>
          ))}
          {revoking && (
            <section
              className="panel formpad"
              aria-label={t('Confirm identity revocation')}
            >
              <h3>{t('Confirm identity revocation')}</h3>
              <OIDCIdentityDetails identity={revoking} />
              <p>
                {t(
                  'Revocation removes this active link. It does not change your password, factors, or existing machine credentials, and does not transfer the identity to another member.'
                )}
              </p>
              <div className="security-actions">
                <PendingButton
                  className="danger"
                  pending={busy === 'revoke'}
                  disabled={!!busy}
                  pendingLabel={t('Revoking…')}
                  onClick={() => void run('revoke')}
                >
                  {t('Confirm identity revocation')}
                </PendingButton>
                <button
                  className="btn"
                  type="button"
                  disabled={!!busy}
                  onClick={() => setRevoking(null)}
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
