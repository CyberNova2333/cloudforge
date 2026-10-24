import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authClient } from '@/lib/auth';
import { PendingButton } from '@/components/ui/PendingButton';
import { AuthShell, FlashError } from './AuthShell';
import { Notice } from '@/components/Notice';
import { t } from '@/lib/i18n';

const MIN_LENGTH = 8; // worker/src/auth/index.ts minPasswordLength

/**
 * Choose a new password with a one-time token: from the forgot-password email (better-auth sends the browser
 * here with `?token=`, or `?error=INVALID_TOKEN`) or from a site admin's link. Using it signs out every other
 * session of that person.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(
    !token || params.get('error') === 'INVALID_TOKEN'
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      setError(t('Use at least {n} characters.', { n: MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('The two passwords do not match.'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await authClient.resetPassword({
      newPassword: password,
      token: token!,
    });
    setBusy(false);
    if (res.error) {
      if (res.error.code === 'INVALID_TOKEN') setInvalid(true);
      else setError(t('Could not change the password. Try again'));
      return;
    }
    navigate('/login?reset=1', { replace: true });
  };

  return (
    <AuthShell
      title={t('Choose a new password')}
      docTitle={t('Choose a new password')}
    >
      {invalid ? (
        <Notice tone="warn">
          {t(
            'This link is invalid or has expired, or it was already used. Ask for a new one.'
          )}
        </Notice>
      ) : (
        <>
          <FlashError message={error} />
          <form className="auth-fields" onSubmit={submit}>
            <div className="fld">
              <label htmlFor="new_password">{t('New password')}</label>
              <input
                id="new_password"
                type="password"
                className="form-control"
                autoFocus
                autoComplete="new-password"
                required
                minLength={MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="fld">
              <label htmlFor="confirm_password">
                {t('Confirm the new password')}
              </label>
              <input
                id="confirm_password"
                type="password"
                className="form-control"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <PendingButton
              type="submit"
              className="primary block"
              pending={busy}
              pendingLabel={t('Saving…')}
            >
              {t('Change password')}
            </PendingButton>
          </form>
        </>
      )}
      <p className="auth-foot">
        {invalid && (
          <>
            <Link to="/forgot-password">{t('Ask for a new link')}</Link> ·{' '}
          </>
        )}
        <Link to="/login">{t('Back to sign in')}</Link>
      </p>
    </AuthShell>
  );
}
