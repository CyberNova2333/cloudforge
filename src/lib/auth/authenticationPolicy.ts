import { safeReturnTo } from './returnTo';

export type AuthenticationPolicy = { version: number; requireMfa: boolean };
export type BrowserAuthenticationPolicy = {
  sessionId: string;
  policy: AuthenticationPolicy;
  access: 'full' | 'enroll_mfa' | 'reauthenticate';
  enrolled: boolean;
};
export type AuthenticationPolicyPreview = {
  previewId: string;
  digest: string;
  expiresAt: string;
  policy: AuthenticationPolicy;
  target: { requireMfa: boolean };
  impact: {
    members: number;
    unenrolledMembers: number;
    sessionsToReverify: number;
    oauthConnections: number;
    personalTokens: number;
    deployTokens: number;
  };
  recoveryAcknowledgementRequired: true;
};

const listeners = new Set<(sessionId: string) => void>();
export function subscribeAuthenticationPolicy(
  listener: (sessionId: string) => void
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyAuthenticationPolicyChanged(sessionId: string) {
  for (const listener of listeners) listener(sessionId);
}

/** A policy rejection refreshes authority only: it never retries an interrupted business request. */
export function reportAuthenticationPolicyChallenge(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  if (
    body.code !== 'AUTHENTICATION_POLICY_REQUIRED' ||
    typeof body.sessionId !== 'string' ||
    !body.sessionId ||
    body.sessionId.length > 256 ||
    (body.access !== 'enroll_mfa' && body.access !== 'reauthenticate')
  )
    return false;
  notifyAuthenticationPolicyChanged(body.sessionId);
  return true;
}

/** A late response for another cookie session must never unlock the current account's interface. */
export function matchesAuthenticationPolicy(
  value: unknown,
  sessionId: string
): value is BrowserAuthenticationPolicy {
  if (!value || typeof value !== 'object') return false;
  const state = value as BrowserAuthenticationPolicy;
  return (
    state.sessionId === sessionId &&
    !!state.policy &&
    Number.isSafeInteger(state.policy.version) &&
    state.policy.version >= 0 &&
    typeof state.policy.requireMfa === 'boolean' &&
    typeof state.enrolled === 'boolean' &&
    ['full', 'enroll_mfa', 'reauthenticate'].includes(state.access)
  );
}

export function currentPolicyPreview(
  preview: AuthenticationPolicyPreview | null,
  requireMfa: boolean,
  version: number,
  now = Date.now()
) {
  return (
    !!preview &&
    preview.target.requireMfa === requireMfa &&
    preview.policy.version === version &&
    Number.isFinite(Date.parse(preview.expiresAt)) &&
    Date.parse(preview.expiresAt) > now
  );
}

/** Preserve an internal signed authorization query through enrollment and verification without double encoding. */
export function authenticationPolicyReturn(
  pathname: string,
  search: string,
  hash: string
) {
  return safeReturnTo(
    pathname === '/settings/security' || pathname === '/login/verify'
      ? new URLSearchParams(search).get('return_to')
      : pathname + search + hash
  );
}
