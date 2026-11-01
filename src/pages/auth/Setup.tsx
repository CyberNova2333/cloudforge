// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/api/uiApi';
import { signIn } from '@/lib/auth/auth';
import { errorMessage } from '@/lib/api/api';
import { PendingButton } from '@/components/ui/PendingButton';
import { AuthLoading, AuthShell, FlashError } from './AuthShell';
import { useAppName } from '@/lib/utils/appName';
import { t, tx } from '@/lib/i18n/i18n';

/** First run: create the first administrator account. */
export default function Setup() {
  const appName = useAppName();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const [form, setForm] = useState({
    code: '',
    name: '',
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status.isPending) return <AuthLoading />;
  if (!status.data?.setupRequired) return <Navigate to="/login" replace />;
  // Reachable from the internet without a setup code: whoever got here first would own the instance.
  if (status.data.codeMissing)
    return (
      <AuthShell
        title={t('Welcome to {name}', { name: appName })}
        docTitle={t('Set up')}
        lede={t('This instance needs a setup code before it can be set up.')}
        wide
      >
        <p>
          {tx(
            'It is reachable from the internet, so the first administrator must present a one-time setup code. Set the {secret} secret to the code’s hash ({doc}), then reload this page.',
            {
              secret: <code>SETUP_CODE_HASH</code>,
              doc: <code>docs/setup.md</code>,
            }
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
    try {
      const { code, ...rest } = form;
      await api.setup(
        status.data?.codeRequired ? { ...rest, code: code.trim() } : rest
      );
      const res = await signIn.email({
        email: form.email,
        password: form.password,
      });
      if (res.error) throw new Error(res.error.message);
      await qc.invalidateQueries();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={t('Welcome to {name}', { name: appName })}
      docTitle={t('Set up')}
      lede={t(
        'Let’s set up your instance. Create the first administrator account. You can invite the rest of your team once you are in.'
      )}
      wide
    >
      <FlashError message={error} />
      <form className="auth-fields" onSubmit={submit}>
        {status.data?.codeRequired && (
          <div className="fld">
            <label htmlFor="code">{t('Setup code')}</label>
            <input
              id="code"
              className="form-control"
              required
              value={form.code}
              onChange={set('code')}
              autoComplete="one-time-code"
              autoFocus
              aria-describedby="code-hint"
            />
            <p id="code-hint" className="hint">
              {tx('Printed at the end of {command}.', {
                command: <code>yarn cloudforge install</code>,
              })}
            </p>
          </div>
        )}
        <div className="fld">
          <label htmlFor="name">{t('Full name')}</label>
          <input
            id="name"
            className="form-control"
            required
            value={form.name}
            onChange={set('name')}
            autoFocus={!status.data?.codeRequired}
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
          <label htmlFor="email">{t('Email address')}</label>
          <input
            id="email"
            type="email"
            className="form-control"
            required
            value={form.email}
            onChange={set('email')}
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
          {t('Create admin account')}
        </PendingButton>
      </form>
    </AuthShell>
  );
}
