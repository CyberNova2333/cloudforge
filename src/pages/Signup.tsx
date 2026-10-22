import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/uiApi';
import { authClient, signIn, useSession } from '@/lib/auth';
import { useAppName } from '@/lib/appName';
import { t, tServer, tx } from '@/lib/i18n';
import { PendingButton } from '@/components/ui/PendingButton';
import { Notice } from '@/components/Notice';
import { AuthLoading, AuthShell, FlashError } from './AuthShell';

/**
 * Self sign-up, while Site admin → Settings → Accounts allows it. The account is a plain member. When email
 * verification is required the page ends at "check your inbox" (the emailed link signs in); otherwise it signs in.
 */
export default function Signup() {
  const appName = useAppName();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session, isPending } = useSession();
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const [form, setForm] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (status.isPending || isPending) return <AuthLoading />;
  if (status.data?.setupRequired) return <Navigate to="/setup" replace />;
  if (session) return <Navigate to="/" replace />;
  const signup = status.data?.signup;

  if (!signup?.enabled)
    return (
      <AuthShell title={t('Sign-up is closed')} docTitle={t('Sign up')}>
        <Notice tone="warn">
          {t(
            'This instance doesn’t take sign-ups. Ask an administrator for an invitation.'
          )}
        </Notice>
        <Link to="/login" className="btn block">
          {t('Go to sign in')}
        </Link>
      </AuthShell>
    );

  if (sentTo)
    return (
      <AuthShell title={t('Check your inbox')} docTitle={t('Sign up')}>
        <Notice tone="ok">
          {tx(
            'We sent a link to {email}. Open it to confirm your email; it signs you in.',
            { email: <b>{sentTo}</b> }
          )}
        </Notice>
        <p className="auth-foot">
          {tx(
            'No email after a few minutes? Check your spam folder, or {link} with your email address to send it again.',
            { link: <Link to="/login">{t('sign in')}</Link> }
          )}
        </p>
      </AuthShell>
    );

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const email = form.email.trim();
    const res = await authClient.signUp.email({
      name: form.name.trim(),
      email,
      password: form.password,
      username: form.username.trim(),
      callbackURL: '/',
    });
    if (res.error) {
      setBusy(false);
      setError(
        tServer(res.error.message ?? t('Could not create the account.'))
      );
      return;
    }
    if (signup.verification) {
      setBusy(false);
      setSentTo(email);
      return;
    }
    const signedIn = await signIn.email({ email, password: form.password });
    setBusy(false);
    if (signedIn.error) {
      navigate('/login');
      return;
    }
    await qc.invalidateQueries();
    navigate('/');
  };

  return (
    <AuthShell
      title={t('Join {name}', { name: appName })}
      docTitle={t('Sign up')}
      lede={
        signup.domains.length
          ? t('Sign up with an email address at {domains}.', {
              domains: signup.domains.join(', '),
            })
          : t('Create your account.')
      }
      wide
    >
      <FlashError message={error} />
      <form className="auth-fields" onSubmit={submit}>
        <div className="fld">
          <label htmlFor="signup-email">{t('Email address')}</label>
          <input
            id="signup-email"
            type="email"
            className="form-control"
            required
            value={form.email}
            onChange={set('email')}
            autoComplete="email"
            autoFocus
          />
          {signup.verification && (
            <p className="hint">
              {t('We’ll send a link to confirm it before your first sign-in.')}
            </p>
          )}
        </div>
        <div className="fld">
          <label htmlFor="name">{t('Full name')}</label>
          <input
            id="name"
            className="form-control"
            required
            value={form.name}
            onChange={set('name')}
          />
        </div>
        <div className="fld">
          <label htmlFor="username">{t('Username')}</label>
          <input
            id="username"
            className="form-control"
            required
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
          />
        </div>
        <div className="fld">
          <label htmlFor="password">{t('Password')}</label>
          <input
            id="password"
            type="password"
            minLength={8}
            className="form-control"
            required
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="hint">
            {t('Make sure it is at least 8 characters.')}
          </p>
        </div>
        <PendingButton
          type="submit"
          className="primary block"
          pending={busy}
          pendingLabel={t('Creating account…')}
        >
          {t('Create account')}
        </PendingButton>
      </form>
      <p className="auth-foot">
        {t('Already have an account?')} <Link to="/login">{t('Sign in')}</Link>
      </p>
    </AuthShell>
  );
}
