import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthLoading, AuthShell } from './AuthShell';
import { FactorCode } from '@/components/FactorCode';
import { Notice } from '@/components/Notice';
import { PendingButton } from '@/components/ui/PendingButton';
import { useOidcMemory } from '@/lib/useOidcMemory';
import {
  readSignInSession,
  SignInError,
  supportsSignInLock,
} from '@/lib/signInLock';
import {
  oidcSignInApi,
  signInActionId,
  signInReturnTo,
  type OidcSignInAction,
} from '@/lib/oidcSignInApi';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/auth';

export default function OIDCSignIn() {
  const location = useLocation();
  const { data: session } = useSession();
  const actionId = signInActionId(location.search);
  return (
    <SignInAction
      key={`${actionId ?? 'invalid'}:${session?.user.id ?? ''}:${session?.session.id ?? ''}`}
      actionId={actionId}
    />
  );
}
function SignInAction({ actionId }: { actionId: string | null }) {
  const [action, setAction] = useState<OidcSignInAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const reads = useRef(0);
  const supported = supportsSignInLock();
  const memory = useOidcMemory(
    actionId ?? '',
    () => {
      reads.current++;
      locked.current = false;
      setAction(null);
      setLoading(true);
      setCode('');
      setRecovery(false);
      setError(null);
      setBusy(false);
    },
    () => void load()
  );
  const load = async () => {
    const count = ++reads.current;
    if (!actionId) {
      setLoading(false);
      return;
    }
    const request = memory.begin();
    setLoading(true);
    try {
      const result = await oidcSignInApi.action(actionId, request.signal);
      if (!request.current() || count !== reads.current) return;
      if (result.status === 'signed_in') {
        const destination = await oidcSignInApi.destination(
          result,
          request.signal
        );
        if (request.current() && count === reads.current)
          window.location.replace(destination);
        return;
      }
      if (await readSignInSession(request.signal))
        throw new SignInError('SESSION_CHANGED');
      if (request.current() && count === reads.current) {
        setAction(result);
        setCode('');
      }
    } catch (caught) {
      if (request.current() && count === reads.current) {
        setAction(null);
        setCode('');
        setError(errorMessage(caught));
      }
    } finally {
      request.done();
      if (request.current() && count === reads.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [actionId]);
  useEffect(() => {
    if (!action?.expiresAt || !['pending', 'ready'].includes(action.status))
      return;
    const expire = () => {
      setCode('');
      setAction((value) =>
        value ? { ...value, status: 'expired', user: null } : null
      );
    };
    const remaining = Date.parse(action.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [action]);
  const run = async (operation: 'complete' | 'cancel') => {
    if (locked.current || !action || !actionId) return;
    if (
      operation === 'complete' &&
      (!supported || action.status !== 'ready' || !action.user)
    )
      return;
    const request = memory.begin();
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      if (operation === 'complete') {
        await oidcSignInApi.complete(
          action,
          action.factorRequired
            ? { method: recovery ? 'recovery_code' : 'totp', code: code.trim() }
            : {},
          request.signal
        );
        if (!request.current()) return;
        setCode('');
        await load();
      } else {
        await oidcSignInApi.cancel(actionId, request.signal);
        if (!request.current()) return;
        setCode('');
        setAction(null);
        window.location.replace(
          '/login?return_to=' +
            encodeURIComponent(signInReturnTo(action.returnTo) ?? '/')
        );
      }
    } catch (caught) {
      if (!request.current()) return;
      setCode('');
      setError(errorMessage(caught));
      // A factor/recovery code may have committed. Read the receipt instead of repeating the request.
      await load();
    } finally {
      request.done();
      if (request.current()) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  if (loading) return <AuthLoading />;
  const returnTo = signInReturnTo(action?.returnTo ?? null) ?? '/';
  const passwordTarget =
    action?.status === 'enrollment_required'
      ? '/settings/security?return_to=' + encodeURIComponent(returnTo)
      : returnTo;
  return (
    <AuthShell
      title={t('Complete single sign-on')}
      docTitle={t('Single sign-on')}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      {!supported && (
        <Notice>
          {t(
            'This browser cannot safely coordinate single sign-on. Use your password instead.'
          )}
        </Notice>
      )}
      {action?.status === 'ready' && action.user ? (
        <>
          <p>
            {t('Identity provider')}: <strong>{action.provider.name}</strong>
          </p>
          <p className="small muted">{action.provider.issuer}</p>
          <p>
            {t('Local account')}:{' '}
            <strong>{action.user.username ?? action.user.name}</strong>
          </p>
          <p>
            {action.factorRequired
              ? t(
                  'Your external identity is verified. Enter your local second factor to finish signing in.'
                )
              : t(
                  'Your external identity is verified. Confirm this local account to finish signing in.'
                )}
          </p>
          <form
            className="auth-fields"
            onSubmit={(event) => {
              event.preventDefault();
              void run('complete');
            }}
          >
            {action.factorRequired && (
              <FactorCode
                id="oidc-sign-in-code"
                value={code}
                onChange={setCode}
                recovery={recovery}
                onRecoveryChange={(value) => {
                  setRecovery(value);
                  setCode('');
                  setError(null);
                }}
                disabled={busy || !supported}
                autoFocus
              />
            )}
            <PendingButton
              type="submit"
              className="primary block"
              pending={busy}
              disabled={!supported}
              pendingLabel={t('Verifying…')}
            >
              {t('Confirm and sign in')}
            </PendingButton>
          </form>
          <button
            type="button"
            className="btn-link"
            disabled={busy}
            onClick={() => void run('cancel')}
          >
            {t('Cancel single sign-on')}
          </button>
        </>
      ) : action?.status === 'pending' ? (
        <Notice>
          {t(
            'Single sign-on is still pending. Refresh its status before continuing.'
          )}
        </Notice>
      ) : action?.status === 'enrollment_required' ? (
        <Notice tone="warn">
          {t(
            'This instance requires a local second factor. Sign in with your password to set it up, then try single sign-on again.'
          )}
        </Notice>
      ) : (
        <Notice>
          {t(
            'This sign-in action cannot be completed. Start a new sign-in if needed.'
          )}
        </Notice>
      )}
      {action && ['pending', 'enrollment_required'].includes(action.status) && (
        <button
          className="btn-link"
          type="button"
          disabled={busy}
          onClick={() => void run('cancel')}
        >
          {t('Cancel single sign-on')}
        </button>
      )}
      {action && (
        <button
          className="btn small"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          {t('Refresh sign-in status')}
        </button>
      )}
      <p className="auth-foot">
        <Link to={'/login?return_to=' + encodeURIComponent(passwordTarget)}>
          {t('Sign in with your password')}
        </Link>
      </p>
    </AuthShell>
  );
}
