import { oidcActionId, oidcAuthorizationUrl } from './oidcApi';
import { safeReturnTo } from './returnTo';
import { readSignInSession, SignInError, withSignInLock } from './signInLock';

export type SignInProvider = { id: string; name: string; issuer: string };
export type OidcSignInAction = {
  actionId: string;
  status:
    | 'pending'
    | 'ready'
    | 'signed_in'
    | 'enrollment_required'
    | 'failed'
    | 'expired'
    | 'cancelled';
  expiresAt: string | null;
  provider: SignInProvider;
  user: { id: string; name: string; username: string | null } | null;
  factorRequired: boolean;
  returnTo: string;
  sessionId?: string;
};
export type OidcSignInResult = {
  status: 'signed_in';
  userId: string;
  sessionId: string;
  returnTo: string;
};
export class OidcSignInError extends Error {
  constructor(public readonly code: string) {
    super(
      'Single sign-on could not be completed. Check its status or sign in with your password.'
    );
  }
}
const BASE = '/api/auth/oidc-sign-in';
export function signInActionId(search: string) {
  const params = new URLSearchParams(search);
  const values = params.getAll('actionId');
  return values.length === 1
    ? oidcActionId('?oidc_action=' + encodeURIComponent(values[0]!))
    : null;
}
/** Preserve a signed OAuth query without reserializing it; other API and completion destinations are forbidden. */
export function signInReturnTo(value: string | null) {
  if (!value || safeReturnTo(value) !== value) return null;
  const url = new URL(value, 'https://return-to.invalid');
  if (/^\/login\/oidc(?:\/|$)/.test(url.pathname)) return null;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    if (
      url.pathname !== '/api/auth/oauth2/authorize' ||
      url.hash ||
      !url.searchParams.has('sig') ||
      !url.searchParams.has('client_id')
    )
      return null;
  }
  return value;
}
export function loginReturnTo(search: string) {
  const params = new URLSearchParams(search);
  return params.has('sig') && params.has('client_id')
    ? (signInReturnTo('/api/auth/oauth2/authorize' + search) ?? '/')
    : (signInReturnTo(params.get('return_to')) ?? '/');
}
async function request<T>(
  path: string,
  signal?: AbortSignal,
  json?: unknown
): Promise<T> {
  // Public pre-authentication must never wait for the member's recent-password prompt or retry a factor code.
  const response = await fetch(BASE + path, {
    credentials: 'include',
    cache: 'no-store',
    signal,
    ...(json === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new OidcSignInError(
      typeof body?.code === 'string' ? body.code : 'OIDC_SIGN_IN_FAILED'
    );
  return body as T;
}
export const oidcSignInApi = {
  status: (signal?: AbortSignal) =>
    request<{ ready: boolean; provider: SignInProvider | null }>(
      '/status',
      signal
    ),
  action: async (actionId: string, signal?: AbortSignal) => {
    const value = await request<OidcSignInAction>(
      '/actions/' + encodeURIComponent(actionId),
      signal
    );
    if (value?.actionId !== actionId || !signInReturnTo(value.returnTo))
      throw new OidcSignInError('OIDC_SIGN_IN_CHANGED');
    return value;
  },
  start: (returnTo: string, signal?: AbortSignal) =>
    withSignInLock(
      async () => {
        if (!signInReturnTo(returnTo))
          throw new OidcSignInError('OIDC_SIGN_IN_RETURN_INVALID');
        if (await readSignInSession(signal))
          throw new SignInError('SESSION_CHANGED');
        const value = await request<{ authorizationUrl: string }>(
          '/start',
          signal,
          { returnTo }
        );
        return {
          authorizationUrl: oidcAuthorizationUrl(value.authorizationUrl),
        };
      },
      { signal, required: true }
    ),
  complete: (
    action: OidcSignInAction,
    proof: { method?: 'totp' | 'recovery_code'; code?: string },
    signal?: AbortSignal
  ) =>
    withSignInLock(
      async () => {
        if (await readSignInSession(signal))
          throw new SignInError('SESSION_CHANGED');
        return request<OidcSignInResult>('/complete', signal, {
          actionId: action.actionId,
          ...proof,
        });
      },
      { signal, required: true }
    ),
  cancel: (actionId: string, signal?: AbortSignal) =>
    request<{ ok: true }>('/cancel', signal, { actionId }),
  destination: (action: OidcSignInAction, signal?: AbortSignal) =>
    withSignInLock(
      async () => {
        if (
          action.status !== 'signed_in' ||
          !action.user?.id ||
          !action.sessionId
        )
          throw new OidcSignInError('OIDC_SIGN_IN_CHANGED');
        const current = await readSignInSession(signal);
        const destination = signInReturnTo(action.returnTo);
        if (
          !destination ||
          current?.sessionId !== action.sessionId ||
          current.userId !== action.user.id
        )
          throw new SignInError('SESSION_CHANGED');
        return destination;
      },
      { signal, required: true }
    ),
};
