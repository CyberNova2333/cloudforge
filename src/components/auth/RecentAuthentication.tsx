import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession, type CurrentUser } from '@/lib/auth/auth';
import {
  finishRecentAuthentication,
  pendingRecentAuthentication,
  setRecentAuthenticationSession,
  subscribeRecentAuthentication,
} from '@/lib/auth/recentAuthentication';
import { safeReturnTo } from '@/lib/auth/returnTo';
import { factorError } from '@/lib/auth/twoFactor';
import { t } from '@/lib/i18n/i18n';
import { FactorCode } from '@/components/auth/FactorCode';
import { Notice } from '@/components/ui/Notice';
import { PendingButton } from '@/components/ui/PendingButton';
import { AuthLoading, AuthShell } from '@/pages/auth/AuthShell';

function VerificationForm({
  sessionId,
  user,
  onSuccess,
  onCancel,
}: {
  sessionId: string;
  user: CurrentUser;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [needsFactor, setNeedsFactor] = useState(!!user.twoFactorEnabled);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const clear = () => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setPassword('');
    setCode('');
    setBusy(false);
  };
  const cancel = () => {
    clear();
    onCancel();
  };
  useEffect(() => {
    const leave = () => clear();
    window.addEventListener('pagehide', leave);
    return () => {
      generation.current++;
      controller.current?.abort();
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const requestGeneration = generation.current;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError(null);
    try {
      // Deliberately bypass the shared fetch wrapper: verification cannot prompt for itself.
      const response = await fetch('/api/auth/reauthenticate', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal: active.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          password,
          ...(needsFactor
            ? { method: recovery ? 'recovery_code' : 'totp', code }
            : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (generation.current !== requestGeneration) return;
      // Codes may have been consumed even if a later step fails; do not offer an accidental replay.
      setCode('');
      if (
        response.ok &&
        body?.status === true &&
        body.sessionId === sessionId
      ) {
        clear();
        onSuccess();
        return;
      }
      setPassword('');
      if (body?.code === 'REAUTHENTICATION_FACTOR_REQUIRED')
        setNeedsFactor(true);
      setError(
        body?.code === 'REAUTHENTICATION_IMPERSONATION_FORBIDDEN'
          ? t('Stop impersonating before changing security settings.')
          : body?.code === 'REAUTHENTICATION_SESSION_MISMATCH' ||
              body?.code === 'MFA_CHALLENGE_CHANGED'
            ? t('Your sign-in changed. Close this prompt and try again.')
            : factorError({ code: body?.code, status: response.status })
      );
    } catch {
      if (generation.current === requestGeneration) {
        setPassword('');
        setCode('');
        setError(t('The request failed. Check your connection and try again.'));
      }
    } finally {
      if (generation.current === requestGeneration) setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="recent-auth-form">
      <p className="small muted recent-auth-account">{user.email}</p>
      <p>
        {t(
          'Confirm your current password before continuing. If you use two-factor authentication, enter a fresh code too.'
        )}
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="fld">
        <label htmlFor="recent-auth-password">{t('Current password')}</label>
        <input
          id="recent-auth-password"
          className="form-control"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          disabled={busy}
          autoFocus
        />
      </div>
      {needsFactor && (
        <FactorCode
          id="recent-auth-code"
          value={code}
          onChange={setCode}
          recovery={recovery}
          onRecoveryChange={(value) => {
            setRecovery(value);
            setCode('');
            setError(null);
          }}
          disabled={busy}
        />
      )}
      <div className="recent-auth-actions">
        <PendingButton
          type="submit"
          className="primary"
          pending={busy}
          pendingLabel={t('Verifying…')}
        >
          {t('Verify and continue')}
        </PendingButton>
        <button type="button" className="btn" onClick={cancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

function VerificationDialog({
  sessionId,
  user,
}: {
  sessionId: string;
  user: CurrentUser;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const cancel = () => finishRecentAuthentication(sessionId, false);
  return (
    <dialog
      ref={dialog}
      className="recent-auth-dialog"
      aria-labelledby="recent-auth-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h2 id="recent-auth-title">{t('Verify your identity')}</h2>
      <VerificationForm
        sessionId={sessionId}
        user={user}
        onSuccess={() => finishRecentAuthentication(sessionId, true)}
        onCancel={cancel}
      />
    </dialog>
  );
}

/** One prompt for all protected browser requests; changing accounts cancels every waiting operation. */
export function RecentAuthentication() {
  const { data: session } = useSession();
  const sessionId = session?.session.id ?? null;
  const pendingId = useSyncExternalStore(
    subscribeRecentAuthentication,
    pendingRecentAuthentication,
    () => null
  );
  useEffect(() => {
    setRecentAuthenticationSession(sessionId);
    const leave = () => {
      const id = pendingRecentAuthentication();
      if (id) finishRecentAuthentication(id, false);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      setRecentAuthenticationSession(null);
    };
  }, [sessionId]);
  if (!session || !sessionId || pendingId !== sessionId) return null;
  return (
    <VerificationDialog
      key={sessionId}
      sessionId={sessionId}
      user={session.user as CurrentUser}
    />
  );
}

/** A top-level OAuth navigation can resume its exact internal request after verification. */
export function VerifyAuthentication() {
  const { data: session, isPending } = useSession();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('return_to'));
  const target = new URL(returnTo, window.location.origin);
  const destination = target.pathname === '/login/verify' ? '/' : returnTo;
  if (isPending) return <AuthLoading />;
  return (
    <AuthShell
      title={t('Verify your identity')}
      docTitle={t('Verify your identity')}
    >
      {session ? (
        <VerificationForm
          key={session.session.id}
          sessionId={session.session.id}
          user={session.user as CurrentUser}
          onSuccess={() => window.location.assign(destination)}
          onCancel={() => window.location.assign('/')}
        />
      ) : (
        <p>
          <Link
            to={`/login?return_to=${encodeURIComponent('/login/verify' + window.location.search)}`}
          >
            {t('Sign in')}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
