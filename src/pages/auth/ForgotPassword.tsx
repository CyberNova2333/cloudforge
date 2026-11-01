import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qk } from '@/lib/api/uiApi';
import { authClient } from '@/lib/auth/auth';
import { PendingButton } from '@/components/ui/PendingButton';
import { AuthLoading, AuthShell, FlashError } from './AuthShell';
import { Notice } from '@/components/ui/Notice';
import { t } from '@/lib/i18n/i18n';

/** Forgot password: emails a one-time link to the reset page (only while the instance can send email). */
export default function ForgotPassword() {
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (status.isPending) return <AuthLoading />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    setError(null);
    const res = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: '/reset-password',
    });
    if (res.error) {
      setState('idle');
      setError(t('Could not send it. Try again'));
      return;
    }
    setState('sent');
  };

  return (
    <AuthShell
      title={t('Reset your password')}
      docTitle={t('Reset your password')}
    >
      {!status.data?.passwordReset ? (
        <Notice tone="info">
          {t(
            'This instance cannot send email. Ask a site admin for a password reset link.'
          )}
        </Notice>
      ) : state === 'sent' ? (
        <Notice tone="ok">
          {t(
            'If an account uses that address, a link to choose a new password is on its way. It works once, for an hour.'
          )}
        </Notice>
      ) : (
        <>
          <FlashError message={error} />
          <form className="auth-fields" onSubmit={submit}>
            <div className="fld">
              <label htmlFor="reset_email">
                {t("Enter your account's email address")}
              </label>
              <input
                id="reset_email"
                type="email"
                className="form-control"
                autoFocus
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <PendingButton
              type="submit"
              className="primary block"
              pending={state === 'sending'}
              pendingLabel={t('Sending…')}
            >
              {t('Send the reset link')}
            </PendingButton>
          </form>
        </>
      )}
      <p className="auth-foot">
        <Link to="/login">{t('Back to sign in')}</Link>
      </p>
    </AuthShell>
  );
}
