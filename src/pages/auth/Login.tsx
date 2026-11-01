// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api/uiApi';
import { authClient, signIn, useSession } from '@/lib/auth/auth';
import { PendingButton } from '@/components/ui/PendingButton';
import { AuthLoading, AuthShell, FlashError } from './AuthShell';
import { Notice } from '@/components/ui/Notice';
import { t, tServer } from '@/lib/i18n/i18n';
import { safeReturnTo } from '@/lib/auth/returnTo';
import { FactorCode } from '@/components/auth/FactorCode';
import { factorError } from '@/lib/auth/twoFactor';
import { nativeSignIn } from '@/lib/auth/signInLock';
import { loginReturnTo } from '@/lib/auth/oidcSignInApi';
import { OIDCSignInEntry } from '@/components/auth/OIDCSignInEntry';

export default function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('return_to'));
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const appName = status.data?.appName || 'CloudForge';
  const { data: session, isPending } = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const generation = useRef(0);
  const leaving = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const clear = () => {
      generation.current++;
      controller.current?.abort();
      leaving.current = false;
      setPassword('');
      setCode('');
      setChallenge(false);
      setRecovery(false);
      setBusy(false);
    };
    window.addEventListener('pagehide', clear);
    return () => {
      generation.current++;
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
    };
  }, []);
  // A self sign-up that hasn't confirmed its email yet: offer to send the link again (needs the email address).
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState<'sending' | 'sent' | 'failed' | null>(
    null
  );
  const continueTo = (url: string) => {
    // Session refresh and the mutation response can both complete on the same tick.
    if (leaving.current) return;
    leaving.current = true;
    window.location.replace(url);
  };
  if (status.isPending || isPending) return <AuthLoading />;
  if (status.data?.setupRequired) return <Navigate to="/setup" replace />;
  // Already signed in during an OAuth flow: resume the authorization request.
  if (session && params.has('sig') && params.has('client_id')) {
    continueTo(`/api/auth/oauth2/authorize?${params.toString()}`);
    return <AuthLoading />;
  }
  if (session) return <Navigate to={returnTo} replace />;

  const complete = async (data: unknown, requestGeneration: number) => {
    // During an OAuth flow the response says where it continues.
    const next = (data as { url?: string } | null)?.url;
    if (next) {
      continueTo(next);
      return;
    }
    // The provider may leave continuation to the browser after a factor challenge.
    if (params.has('sig') && params.has('client_id')) {
      continueTo(`/api/auth/oauth2/authorize?${params.toString()}`);
      return;
    }
    await qc.invalidateQueries();
    if (requestGeneration !== generation.current) return;
    navigate(returnTo);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const requestGeneration = generation.current;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError(null);
    setUnverified(false);
    setResent(null);
    try {
      if (challenge) {
        const res = await nativeSignIn(
          async () =>
            recovery
              ? await authClient.twoFactor.verifyBackupCode(
                  {
                    code: code.trim(),
                    trustDevice: false,
                  },
                  { signal: active.signal, customFetchImpl: fetch }
                )
              : await authClient.twoFactor.verifyTotp(
                  {
                    code: code.trim(),
                    trustDevice: false,
                  },
                  { signal: active.signal, customFetchImpl: fetch }
                ),
          active.signal
        );
        if (requestGeneration !== generation.current) return;
        setCode('');
        if (res.error) {
          setError(
            res.error.code?.startsWith('SIGN_IN_') ||
              res.error.code === 'SESSION_CHANGED'
              ? tServer(res.error.message ?? '')
              : factorError(res.error)
          );
          return;
        }
        await complete(res.data, requestGeneration);
        return;
      }
      const res = login.includes('@')
        ? await signIn.email(
            { email: login, password },
            { signal: active.signal }
          )
        : await signIn.username(
            { username: login, password },
            { signal: active.signal }
          );
      if (requestGeneration !== generation.current) return;
      setPassword('');
      if (res.error) {
        if (res.error.code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(true);
          setError(tServer(res.error.message ?? ''));
        } else
          setError(
            res.error.code?.startsWith('SIGN_IN_') ||
              res.error.code === 'SESSION_CHANGED'
              ? tServer(res.error.message ?? '')
              : t('Incorrect username or password.')
          );
        return;
      }
      // A correct password is not an authenticated login until the factor succeeds.
      if (
        (res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect
      ) {
        setChallenge(true);
        setCode('');
        return;
      }
      await complete(res.data, requestGeneration);
    } catch {
      if (requestGeneration === generation.current)
        setError(t('The request failed. Check your connection and try again.'));
    } finally {
      if (requestGeneration === generation.current) setBusy(false);
    }
  };

  if (challenge)
    return (
      <AuthShell
        title={t('Two-factor authentication')}
        docTitle={t('Verify your sign-in')}
        lede={t(
          'Enter a code to finish signing in. This browser will be challenged on every password sign-in.'
        )}
      >
        <FlashError message={error} />
        <form className="auth-fields" onSubmit={submit}>
          <FactorCode
            id="login-factor"
            value={code}
            onChange={setCode}
            recovery={recovery}
            onRecoveryChange={(value) => {
              setRecovery(value);
              setCode('');
              setError(null);
            }}
            disabled={busy}
            autoFocus
          />
          <PendingButton
            type="submit"
            className="primary block"
            pending={busy}
            pendingLabel={t('Verifying…')}
          >
            {t('Verify and sign in')}
          </PendingButton>
        </form>
        <p className="auth-foot">
          <button
            type="button"
            className="btn-link"
            disabled={busy}
            onClick={() => {
              setChallenge(false);
              setRecovery(false);
              setCode('');
              setPassword('');
              setError(null);
            }}
          >
            {t('Use another account')}
          </button>
        </p>
      </AuthShell>
    );

  return (
    <AuthShell
      title={t('Sign in to {name}', { name: appName })}
      docTitle={t('Sign in')}
    >
      <FlashError message={error} />
      {params.get('reset') === '1' && !error && (
        <Notice tone="ok">
          {t('Your password was changed. Sign in with the new one.')}
        </Notice>
      )}
      {unverified && (
        <Notice tone="info">
          {login.includes('@') ? (
            resent === 'sent' ? (
              t('Sent. Open the new link in your inbox.')
            ) : (
              <button
                type="button"
                className="btn small"
                disabled={resent === 'sending'}
                onClick={async () => {
                  setResent('sending');
                  const r = await authClient.sendVerificationEmail({
                    email: login.trim(),
                    callbackURL: '/',
                  });
                  setResent(r.error ? 'failed' : 'sent');
                }}
              >
                {resent === 'failed'
                  ? t('Could not send it. Try again')
                  : t('Send the link again')}
              </button>
            )
          ) : (
            t('To get the link again, sign in with your email address.')
          )}
        </Notice>
      )}
      <form className="auth-fields" onSubmit={submit}>
        <div className="fld">
          <label htmlFor="login_field">{t('Username or email address')}</label>
          <input
            id="login_field"
            className="form-control"
            autoFocus
            autoComplete="username"
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>
        <div className="fld">
          <label htmlFor="password">{t('Password')}</label>
          <input
            id="password"
            type="password"
            className="form-control"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <PendingButton
          type="submit"
          className="primary block"
          pending={busy}
          pendingLabel={t('Signing in…')}
        >
          {t('Sign in')}
        </PendingButton>
      </form>
      <OIDCSignInEntry returnTo={loginReturnTo(window.location.search)} />
      {status.data?.passwordReset && (
        <p className="auth-foot">
          <Link to="/forgot-password">{t('Forgot password?')}</Link>
        </p>
      )}
      <p className="auth-foot">
        {status.data?.signup.enabled ? (
          <>
            {t('New to this instance?')}{' '}
            <Link to="/signup">{t('Create an account')}</Link>
          </>
        ) : (
          t('New to this instance? Ask an administrator for an invitation.')
        )}
      </p>
    </AuthShell>
  );
}
