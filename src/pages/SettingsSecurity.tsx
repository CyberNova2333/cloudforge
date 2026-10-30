// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { authClient, useSession, type CurrentUser } from '@/lib/auth';
import { enrollmentSecret, factorError } from '@/lib/twoFactor';
import { t } from '@/lib/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { Chip } from '@/components/ui/Chip';
import { Notice } from '@/components/Notice';
import { RowsSkeleton, SettingsFrame } from '@/components/SetFrame';
import { FactorCode } from '@/components/FactorCode';
import { CurrentAuthentication } from '@/components/CurrentAuthentication';
import { useAuthenticationPolicy } from '@/lib/useAuthenticationPolicy';
import { notifyAuthenticationPolicyChanged } from '@/lib/authenticationPolicy';
import { OIDCIdentities } from '@/components/OIDCIdentities';

type Enrollment = { secret: string; backupCodes: string[] };
type Operation = 'enable' | 'regenerate' | 'disable';

function SecurityFrame({
  restricted,
  children,
}: {
  restricted: boolean;
  children: ReactNode;
}) {
  return restricted ? (
    <div className="policy-enrollment">{children}</div>
  ) : (
    <SettingsFrame>{children}</SettingsFrame>
  );
}

/** Secrets and newly generated codes live only in this mounted page, never the query cache or storage. */
export default function SettingsSecurity({
  restricted = false,
  onContinue,
}: { restricted?: boolean; onContinue?: () => void } = {}) {
  const { data: session, isPending, refetch } = useSession();
  const policy = useAuthenticationPolicy();
  const enabled = !!(session?.user as CurrentUser | undefined)
    ?.twoFactorEnabled;
  const [operation, setOperation] = useState<Operation | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authenticationRefresh, setAuthenticationRefresh] = useState(0);
  const generation = useRef(0);
  const accountId = session?.user.id;
  const [displayedAccountId, setDisplayedAccountId] = useState(accountId);

  const clearSecrets = () => {
    generation.current++;
    setPassword('');
    setCode('');
    setEnrollment(null);
    setCodes(null);
    setSaved(false);
    setOperation(null);
    setRecovery(false);
    setBusy(false);
  };
  useEffect(() => {
    if (displayedAccountId !== accountId) {
      clearSecrets();
      setNotice(null);
      setError(null);
      // This state change also ends the initial skeleton when all secret fields were already empty.
      setDisplayedAccountId(accountId);
    }
  }, [accountId]);
  useEffect(() => {
    // A browser restoring this document from the back/forward cache must not redisplay credentials.
    const clear = () => clearSecrets();
    window.addEventListener('pagehide', clear);
    return () => {
      generation.current++;
      window.removeEventListener('pagehide', clear);
    };
  }, []);

  const begin = (next: Operation) => {
    clearSecrets();
    setOperation(next);
    setError(null);
    setNotice(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !operation) return;
    const requestGeneration = generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (operation === 'enable') {
        const result = await authClient.twoFactor.enable({ password });
        if (requestGeneration !== generation.current) return;
        if (result.error) {
          setError(factorError(result.error));
          return;
        }
        const data = result.data as {
          totpURI?: string;
          backupCodes?: string[];
        } | null;
        const secret = data?.totpURI && enrollmentSecret(data.totpURI);
        if (!secret || !data?.backupCodes?.length) {
          setError(
            t(
              'Setup could not be displayed. Start again to create a new authenticator key.'
            )
          );
          return;
        }
        setEnrollment({ secret, backupCodes: data.backupCodes });
        setOperation(null);
        setAuthenticationRefresh((value) => value + 1);
      } else {
        // A current factor proof is single-use and bound to this browser session on the server.
        const verified = recovery
          ? await authClient.twoFactor.verifyBackupCode({
              code: code.trim(),
              trustDevice: false,
            })
          : await authClient.twoFactor.verifyTotp({
              code: code.trim(),
              trustDevice: false,
            });
        if (requestGeneration !== generation.current) return;
        if (verified.error) {
          setError(factorError(verified.error));
          return;
        }
        setAuthenticationRefresh((value) => value + 1);
        if (operation === 'regenerate') {
          const result = await authClient.twoFactor.generateBackupCodes({
            password,
          });
          if (requestGeneration !== generation.current) return;
          if (result.error) {
            setError(factorError(result.error));
            return;
          }
          setCodes(result.data!.backupCodes);
          setSaved(false);
          setOperation(null);
        } else {
          const result = await authClient.twoFactor.disable({ password });
          if (requestGeneration !== generation.current) return;
          if (result.error) {
            setError(factorError(result.error));
            return;
          }
          clearSecrets();
          setNotice(t('Two-factor authentication is now disabled.'));
          await refetch();
          setAuthenticationRefresh((value) => value + 1);
        }
      }
    } catch {
      if (requestGeneration === generation.current)
        setError(t('The request failed. Check your connection and try again.'));
    } finally {
      if (requestGeneration === generation.current) {
        setPassword('');
        setCode('');
        setBusy(false);
      }
    }
  };

  const confirmEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !enrollment) return;
    const requestGeneration = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: code.trim(),
        trustDevice: false,
      });
      if (requestGeneration !== generation.current) return;
      if (result.error) {
        setError(factorError(result.error));
        return;
      }
      setCodes(enrollment.backupCodes);
      setEnrollment(null);
      setSaved(false);
      setNotice(
        t(
          'Two-factor authentication is enabled. Other browser sessions have been signed out. Save your recovery codes now.'
        )
      );
      await refetch();
      notifyAuthenticationPolicyChanged(session?.session.id ?? '');
      setAuthenticationRefresh((value) => value + 1);
    } catch {
      if (requestGeneration === generation.current)
        setError(t('The request failed. Check your connection and try again.'));
    } finally {
      if (requestGeneration === generation.current) {
        setCode('');
        setBusy(false);
      }
    }
  };

  return (
    <>
      {!restricted && (
        <PageHead
          icon="shield"
          crumbs={[
            { label: t('Settings'), to: '/settings/tokens' },
            { label: t('Account security') },
          ]}
          title={t('Account security')}
          lede={t(
            'Protect password sign-ins with an authenticator app and keep recovery codes somewhere safe.'
          )}
        />
      )}
      <SecurityFrame restricted={restricted}>
        {policy.data?.policy.requireMfa && (
          <Notice tone="info">
            {t(
              'Your administrator requires two-factor authentication. It cannot be disabled while this policy is active.'
            )}
          </Notice>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        {notice && <Notice tone="ok">{notice}</Notice>}
        {isPending || displayedAccountId !== accountId ? (
          <RowsSkeleton rows={3} />
        ) : (
          <>
            {!restricted && (
              <CurrentAuthentication
                userId={accountId}
                sessionId={session?.session.id}
                refreshKey={authenticationRefresh}
              />
            )}
            <section
              className="panel formpad"
              aria-label={t('Two-factor authentication')}
            >
              <h2 className="security-heading">
                {t('Two-factor authentication')}{' '}
                <Chip tone={enabled ? 'good' : 'off'}>
                  {enabled ? t('Enabled') : t('Not enabled')}
                </Chip>
              </h2>
              <p>
                {t(
                  'An authenticator app generates a six-digit code. After entering your password, you will also enter this code or a single-use recovery code.'
                )}
              </p>
              {!restricted && (
                <p className="small muted">
                  {t(
                    'Existing personal access tokens, deployment tokens and MCP connections remain active. Review them separately if your account may be compromised.'
                  )}
                </p>
              )}
              {!operation && !enrollment && !codes && (
                <div className="security-actions">
                  {enabled ? (
                    restricted ? null : (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => begin('regenerate')}
                        >
                          {t('Regenerate recovery codes')}
                        </button>
                        {policy.data?.policy.requireMfa === false && (
                          <button
                            type="button"
                            className="btn danger"
                            onClick={() => begin('disable')}
                          >
                            {t('Disable two-factor authentication')}
                          </button>
                        )}
                      </>
                    )
                  ) : (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => begin('enable')}
                    >
                      {t('Set up authenticator app')}
                    </button>
                  )}
                </div>
              )}
            </section>

            {operation && (
              <form className="panel formpad" onSubmit={submit}>
                <h2 className="formtitle">
                  {operation === 'enable'
                    ? t('Set up authenticator app')
                    : operation === 'regenerate'
                      ? t('Regenerate recovery codes')
                      : t('Disable two-factor authentication')}
                </h2>
                {operation === 'regenerate' && (
                  <Notice tone="warn">
                    {t(
                      'All previous recovery codes stop working immediately when new ones are generated.'
                    )}
                  </Notice>
                )}
                {operation === 'disable' && (
                  <Notice tone="warn">
                    {t(
                      'Your next password sign-in will no longer require an authenticator or recovery code.'
                    )}
                  </Notice>
                )}
                <div className="fld">
                  <label htmlFor="security-password">
                    {t('Current password')}
                  </label>
                  <input
                    id="security-password"
                    type="password"
                    className="form-control"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                </div>
                {operation !== 'enable' && (
                  <FactorCode
                    id="security-current-code"
                    value={code}
                    onChange={setCode}
                    disabled={busy}
                    recovery={recovery}
                    onRecoveryChange={(value) => {
                      setRecovery(value);
                      setCode('');
                    }}
                  />
                )}
                {recovery && operation !== 'enable' && (
                  <p className="hint">
                    {t(
                      'This recovery code is consumed when verified, even if the next step fails. Use another code when retrying.'
                    )}
                  </p>
                )}
                <div className="security-actions">
                  <PendingButton
                    type="submit"
                    className={operation === 'disable' ? 'danger' : 'primary'}
                    pending={busy}
                    pendingLabel={t('Verifying…')}
                  >
                    {operation === 'enable'
                      ? t('Continue setup')
                      : operation === 'regenerate'
                        ? t('Generate new codes')
                        : t('Confirm disable')}
                  </PendingButton>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      clearSecrets();
                      setError(null);
                    }}
                  >
                    {t('Cancel')}
                  </button>
                </div>
              </form>
            )}

            {enrollment && (
              <form className="panel formpad" onSubmit={confirmEnrollment}>
                <h2 className="formtitle">
                  {t('Add CloudForge to your authenticator')}
                </h2>
                <Notice tone="info">
                  {t(
                    'Setup is not complete until you verify a code below. Do not share this secret key.'
                  )}
                </Notice>
                <p>
                  {t(
                    'Choose manual setup in your authenticator app. Use your account email as the name, enter this key, and select time-based codes (TOTP), six digits and a 30-second interval.'
                  )}
                </p>
                <div className="fld">
                  <label htmlFor="authenticator-secret">
                    {t('Secret key')}
                  </label>
                  <input
                    id="authenticator-secret"
                    className="form-control security-secret"
                    type="text"
                    readOnly
                    value={enrollment.secret}
                    autoComplete="off"
                    spellCheck={false}
                    onFocus={(event) => event.target.select()}
                  />
                </div>
                <FactorCode
                  id="security-enroll-code"
                  value={code}
                  onChange={setCode}
                  disabled={busy}
                  autoFocus
                />
                <div className="security-actions">
                  <PendingButton
                    type="submit"
                    className="primary"
                    pending={busy}
                    pendingLabel={t('Verifying…')}
                  >
                    {t('Verify and enable')}
                  </PendingButton>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      clearSecrets();
                      setError(null);
                    }}
                  >
                    {t('Cancel setup')}
                  </button>
                </div>
              </form>
            )}

            {codes && (
              <section
                className="panel formpad"
                aria-label={t('Save your recovery codes')}
              >
                <h2 className="formtitle">{t('Save your recovery codes')}</h2>
                <Notice tone="warn">
                  {t(
                    'These codes are shown once. Store them safely outside this browser. Each code can replace one authenticator code if you lose your device.'
                  )}
                </Notice>
                <ul className="security-recovery-codes">
                  {codes.map((value) => (
                    <li key={value}>
                      <code>{value}</code>
                    </li>
                  ))}
                </ul>
                <label className="security-saved">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(event) => setSaved(event.target.checked)}
                  />{' '}
                  {t('I have saved these recovery codes in a safe place.')}
                </label>
                <div className="security-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!saved}
                    onClick={() => {
                      setCodes(null);
                      setSaved(false);
                      setNotice(null);
                    }}
                  >
                    {t('Done, hide codes')}
                  </button>
                </div>
              </section>
            )}

            <Notice tone="info">
              {t(
                'A password reset does not remove two-factor authentication. Keep a recovery code so you can sign in if your authenticator is lost.'
              )}
            </Notice>
            {restricted &&
              !codes &&
              !enrollment &&
              !operation &&
              (enabled || policy.data?.policy.requireMfa === false) && (
                <div className="security-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={onContinue}
                  >
                    {t('Continue to verification')}
                  </button>
                </div>
              )}
          </>
        )}
        {!restricted && <OIDCIdentities />}
      </SecurityFrame>
    </>
  );
}
