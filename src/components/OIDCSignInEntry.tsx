import { useEffect, useRef, useState } from 'react';
import { useOidcMemory } from '@/lib/useOidcMemory';
import { oidcSignInApi, type SignInProvider } from '@/lib/oidcSignInApi';
import { supportsSignInLock } from '@/lib/signInLock';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Notice } from '@/components/Notice';
import { PendingButton } from '@/components/ui/PendingButton';

export function OIDCSignInEntry({ returnTo }: { returnTo: string }) {
  const [provider, setProvider] = useState<SignInProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const supported = supportsSignInLock();
  const memory = useOidcMemory(
    returnTo,
    () => {
      locked.current = false;
      setProvider(null);
      setBusy(false);
      setError(null);
    },
    () => void load()
  );
  const load = async () => {
    const request = memory.begin();
    try {
      const result = await oidcSignInApi.status(request.signal);
      if (request.current()) setProvider(result.ready ? result.provider : null);
    } catch {
      if (request.current()) setProvider(null);
    } finally {
      request.done();
    }
  };
  useEffect(() => {
    void load();
  }, [returnTo]);
  const start = async () => {
    if (!provider || locked.current || !supported) return;
    const request = memory.begin();
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await oidcSignInApi.start(returnTo, request.signal);
      if (request.current()) window.location.assign(result.authorizationUrl);
    } catch (caught) {
      if (request.current()) setError(errorMessage(caught));
    } finally {
      request.done();
      if (request.current()) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  if (!provider) return null;
  return (
    <section className="oidc-sign-in" aria-label={t('Single sign-on')}>
      {error && <Notice tone="bad">{error}</Notice>}
      {!supported ? (
        <Notice>
          {t(
            'This browser cannot safely coordinate single sign-on. Use your password instead.'
          )}
        </Notice>
      ) : (
        <>
          <p className="small muted">
            {t(
              'Sign in with an identity already linked to your local account. Your local second factor is still required when enabled.'
            )}
          </p>
          <PendingButton
            className="block"
            pending={busy}
            pendingLabel={t('Continuing…')}
            onClick={() => void start()}
          >
            {t('Continue with {provider}', { provider: provider.name })}
          </PendingButton>
          <p className="small muted">{provider.issuer}</p>
        </>
      )}
    </section>
  );
}
