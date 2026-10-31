import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { fullDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Chip } from '@/components/ui/Chip';
import { Notice } from '@/components/Notice';

type Authentication = {
  sessionId: string;
  strength:
    | 'unknown'
    | 'password'
    | 'oidc'
    | 'multi_factor'
    | 'email_verification'
    | 'impersonated';
  primary: {
    method: 'password' | 'oidc' | 'email_verification' | 'impersonation';
    verifiedAt: string;
  } | null;
  secondFactor: {
    method: 'totp' | 'recovery_code';
    verifiedAt: string;
  } | null;
  source?: { method: 'oidc' };
};
type Result =
  | { key: string; status: 'ready'; data: Authentication }
  | { key: string; status: 'error' };

const methodName = (method: string) => {
  switch (method) {
    case 'password':
      return t('Password');
    case 'oidc':
      return t('External identity');
    case 'email_verification':
      return t('Email verification');
    case 'impersonation':
      return t('Administrator impersonation');
    case 'totp':
      return t('Authenticator code');
    case 'recovery_code':
      return t('Recovery code');
    default:
      return t('No verification record');
  }
};

/** A description of this browser's proof, never a client-side permission decision. */
export function CurrentAuthentication({
  userId,
  sessionId,
  refreshKey,
}: {
  userId?: string;
  sessionId?: string;
  refreshKey: number;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = JSON.stringify([userId, sessionId, refreshKey, retry]);
  useEffect(() => {
    if (!userId || !sessionId) return;
    const controller = new AbortController();
    let active = true;
    apiFetch<Authentication>('/api/me/authentication', {
      signal: controller.signal,
      cache: 'no-store',
    }).then(
      (data) => {
        if (active)
          setResult(
            data?.sessionId === sessionId
              ? { key, status: 'ready', data }
              : { key, status: 'error' }
          );
      },
      () => {
        if (active) setResult({ key, status: 'error' });
      }
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, userId, sessionId]);
  if (!userId || !sessionId) return null;
  // Props change before effects run. Do not show another account or session's prior result even for one frame.
  const current = result?.key === key ? result : null;
  const data = current?.status === 'ready' ? current.data : null;
  const label =
    data?.strength === 'multi_factor'
      ? data.primary?.method === 'oidc'
        ? t('External identity and local second factor')
        : t('Password and second factor')
      : data?.strength === 'password'
        ? t('Password verified')
        : data?.strength === 'oidc'
          ? t('External identity verified')
          : data?.strength === 'email_verification'
            ? t('Email verified')
            : data?.strength === 'impersonated'
              ? t('Administrator impersonation')
              : t('Incomplete verification record');
  return (
    <section className="panel formpad" aria-label={t('Current sign-in')}>
      <div className="security-session-heading">
        <h2 className="security-heading">
          {t('Current sign-in')}{' '}
          {data && (
            <Chip tone={data.strength === 'multi_factor' ? 'good' : 'off'}>
              {label}
            </Chip>
          )}
        </h2>
        <button
          type="button"
          className="btn"
          onClick={() => setRetry((value) => value + 1)}
          disabled={!current}
        >
          {t('Refresh sign-in details')}
        </button>
      </div>
      <p className="small muted">
        {t(
          'These details show what this browser actually verified. Refreshing a session does not repeat verification.'
        )}
      </p>
      {data?.source?.method === 'oidc' && (
        <Notice>
          {t(
            'This session originated from a linked external identity. Revoking that identity or changing its published provider can end this session, including after password verification.'
          )}
        </Notice>
      )}
      {!current ? (
        <p role="status">{t('Loading sign-in details…')}</p>
      ) : current.status === 'error' ? (
        <Notice tone="warn">
          {t('Sign-in details could not be loaded. Refresh to try again.')}
        </Notice>
      ) : (
        <>
          {data?.strength === 'unknown' && (
            <Notice tone="info">
              {t(
                'This sign-in has no complete primary verification record. Signing in again will record one.'
              )}
            </Notice>
          )}
          <dl className="security-session-details">
            <div>
              <dt>{t('Primary verification')}</dt>
              <dd>
                {data?.primary ? (
                  <>
                    {methodName(data.primary.method)}
                    <time dateTime={data.primary.verifiedAt}>
                      {fullDate(data.primary.verifiedAt)}
                    </time>
                  </>
                ) : (
                  t('No verification record')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('Second-factor verification')}</dt>
              <dd>
                {data?.secondFactor ? (
                  <>
                    {methodName(data.secondFactor.method)}
                    <time dateTime={data.secondFactor.verifiedAt}>
                      {fullDate(data.secondFactor.verifiedAt)}
                    </time>
                  </>
                ) : (
                  t('No verification record')
                )}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
