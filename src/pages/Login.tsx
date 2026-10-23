// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/uiApi';
import { authClient, signIn, useSession } from '@/lib/auth';
import { PendingButton } from '@/components/ui/PendingButton';
import { AuthLoading, AuthShell, FlashError } from './AuthShell';
import { Notice } from '@/components/Notice';
import { t, tServer } from '@/lib/i18n';

export default function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const returnTo = params.get('return_to')?.startsWith('/')
    ? params.get('return_to')!
    : '/';
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const appName = status.data?.appName || 'CloudForge';
  const { data: session, isPending } = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A self sign-up that hasn't confirmed its email yet: offer to send the link again (needs the email address).
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState<'sending' | 'sent' | 'failed' | null>(
    null
  );
  if (status.isPending || isPending) return <AuthLoading />;
  if (status.data?.setupRequired) return <Navigate to="/setup" replace />;
  // Already signed in during an OAuth flow: resume the authorization request.
  if (session && params.has('sig') && params.has('client_id')) {
    window.location.replace(`/api/auth/oauth2/authorize?${params.toString()}`);
    return <AuthLoading />;
  }
  if (session) return <Navigate to={returnTo} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = login.includes('@')
      ? await signIn.email({ email: login, password })
      : await signIn.username({ username: login, password });
    setBusy(false);
    setUnverified(false);
    setResent(null);
    if (res.error) {
      if (res.error.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
        setError(tServer(res.error.message ?? ''));
      } else setError(t('Incorrect username or password.'));
      return;
    }
    // During an OAuth flow the response says where it continues.
    const next = (res.data as { url?: string } | null)?.url;
    if (next) {
      window.location.href = next;
      return;
    }
    await qc.invalidateQueries();
    navigate(returnTo);
  };

  return (
    <AuthShell
      title={t('Sign in to {name}', { name: appName })}
      docTitle={t('Sign in')}
    >
      <FlashError message={error} />
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
