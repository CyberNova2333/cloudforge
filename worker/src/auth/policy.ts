// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { GenericEndpointContext } from '@better-auth/core';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../variables';
import { isPublicRepoRead } from './guards';
import {
  readSessionAuthentication,
  hasOidcOrigin,
  type AuthenticationFields,
} from './assurance';

export const POLICY_VERSION_SQL =
  'COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0)';
export const POLICY_REQUIRE_MFA_SQL =
  'COALESCE((SELECT require_mfa FROM authentication_policy WHERE id = 1), 0)';
export type AuthenticationPolicy = { version: number; requireMfa: boolean };
export type PolicyAccess = 'full' | 'enroll_mfa' | 'reauthenticate';

export async function readPolicy(
  env: CloudflareBindings
): Promise<AuthenticationPolicy> {
  const row = await env.DB.prepare(
    'SELECT version, require_mfa FROM authentication_policy WHERE id = 1'
  ).first<{ version: number; require_mfa: number }>();
  return { version: row?.version ?? 0, requireMfa: !!row?.require_mfa };
}

/** Enrollment is not proof; old policy generations never acquire current privileges merely by being read. */
export function evaluatePolicyAccess(
  record: AuthenticationFields & { impersonatedBy?: string | null },
  enrolled: boolean,
  policy: AuthenticationPolicy
): PolicyAccess {
  const hasAnyOrigin =
    record.oidcBindingId != null ||
    record.oidcBindingRevision != null ||
    record.oidcConfigurationGeneration != null;
  if ((record.authMethod === 'oidc' || hasAnyOrigin) && !hasOidcOrigin(record))
    return 'reauthenticate';
  if (
    hasAnyOrigin &&
    record.authMethod !== 'oidc' &&
    record.authMethod !== 'password'
  )
    return 'reauthenticate';
  if (policy.requireMfa && !enrolled) return 'enroll_mfa';
  if (
    !Number.isSafeInteger(record.policyVersion) ||
    record.policyVersion !== policy.version
  )
    return 'reauthenticate';
  if (policy.requireMfa) {
    const validTime = (time: Date | number | null | undefined) => {
      const value = time instanceof Date ? time.getTime() : time;
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= Date.now()
      );
    };
    if (
      record.impersonatedBy ||
      !(
        record.authMethod === 'password' ||
        (record.authMethod === 'oidc' && hasOidcOrigin(record))
      ) ||
      !validTime(record.authTime) ||
      !['totp', 'recovery_code'].includes(record.secondFactorMethod ?? '') ||
      !validTime(record.secondFactorTime)
    )
      return 'reauthenticate';
  }
  return 'full';
}

const OWN_GET_PATHS = new Set([
  '/api/setup/status',
  '/api/me/authentication',
  '/api/me/authentication-policy',
  '/api/me/preferences',
  '/api/auth/get-session',
]);
const LIMITED_AUTH_POSTS = new Set([
  '/get-session',
  '/sign-out',
  '/admin/stop-impersonating',
  '/reauthenticate',
  '/two-factor/enable',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]);
const INDEPENDENT_AUTH_POSTS = new Set([
  '/sign-in/email',
  '/sign-in/username',
  '/sign-up/email',
  '/request-password-reset',
  '/reset-password',
  '/send-verification-email',
  '/oauth2/register',
  '/oauth2/token',
  '/oauth2/introspect',
  '/oauth2/revoke',
  '/oauth2/userinfo',
  '/oidc-sign-in/start',
  '/oidc-sign-in/complete',
  '/oidc-sign-in/cancel',
]);

function limitedPathAllowed(method: string, path: string) {
  const p = path.replace(/\/$/, '');
  if ((method === 'GET' || method === 'HEAD') && OWN_GET_PATHS.has(p))
    return true;
  if (p.startsWith('/api/auth/')) {
    const native = p.slice('/api/auth'.length);
    if (
      method === 'POST' &&
      (LIMITED_AUTH_POSTS.has(native) || INDEPENDENT_AUTH_POSTS.has(native))
    )
      return true;
    if (
      method === 'GET' &&
      (native === '/verify-email' ||
        native === '/oidc-sign-in/status' ||
        /^\/oidc-sign-in\/(?:callback\/[^/]+|actions\/[a-zA-Z0-9-]+)$/.test(
          native
        ) ||
        native.startsWith('/reset-password/') ||
        native === '/jwks' ||
        native === '/oauth2/userinfo' ||
        native.startsWith('/.well-known/'))
    )
      return true;
  }
  return (
    (method === 'POST' && p === '/api/invites/accept') ||
    (method === 'GET' && p.startsWith('/api/invites/token/'))
  );
}

export const enforceBrowserPolicy: MiddlewareHandler<AppEnv> = async (
  c,
  next
) => {
  const browser = c.get('browserSession');
  if (!browser || browser.policy.access === 'full') return next();
  if (limitedPathAllowed(c.req.method, c.req.path)) return next();
  // The native policy hook distinguishes signed rejection from granting consent after parsing its body.
  if (
    c.req.method === 'POST' &&
    c.req.path.replace(/\/$/, '') === '/api/auth/oauth2/consent'
  )
    return next();
  // A restricted cookie must never grant internal repository reads. Public repositories retain anonymous access.
  if (
    (c.req.method === 'GET' || c.req.method === 'HEAD') &&
    isPublicRepoRead(c.req.path)
  ) {
    c.set('user', undefined);
    c.set('browserSession', undefined);
    return next();
  }
  if (c.req.method === 'GET' && c.req.path === '/api/auth/oauth2/authorize') {
    const url = new URL(c.req.url);
    const destination =
      browser.policy.access === 'enroll_mfa'
        ? '/settings/security'
        : '/login/verify';
    c.header('Cache-Control', 'no-store');
    return c.redirect(
      `${destination}?return_to=${encodeURIComponent(url.pathname + url.search)}`
    );
  }
  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      code: 'AUTHENTICATION_POLICY_REQUIRED',
      error: 'Complete the instance authentication requirements.',
      sessionId: browser.id,
      access: browser.policy.access,
    },
    403
  );
};

/** Also protects internal OAuth continuation and native endpoints that never traverse Hono member routers. */
export async function requireNativePolicy(
  ctx: GenericEndpointContext,
  env: CloudflareBindings
) {
  // 策略检查只读会话；续期及 Set-Cookie 由实际的会话端点完成。
  const active = await getSessionFromCtx(ctx, { disableRefresh: true });
  if (!active) return;
  const live = await readSessionAuthentication(env, active.session.id);
  if (!live) return;
  const access = evaluatePolicyAccess(live, live.enrolled, live.policy);
  if (ctx.path === '/admin/impersonate-user') {
    if (hasOidcOrigin(live))
      throw new APIError('FORBIDDEN', {
        code: 'SSO_SOURCE_IMPERSONATION_FORBIDDEN',
        message:
          'Start an independent local password sign-in to impersonate a member.',
      });
    if (live.policy.requireMfa)
      throw new APIError('FORBIDDEN', {
        code: 'MFA_POLICY_IMPERSONATION_FORBIDDEN',
        message: 'Impersonation is unavailable while MFA is required.',
      });
    if (
      access === 'full' &&
      !live.impersonatedBy &&
      live.authMethod === 'password' &&
      active.user.role === 'admin'
    )
      (
        ctx.context as typeof ctx.context & {
          cloudforgeImpersonationPolicyVersion?: number;
        }
      ).cloudforgeImpersonationPolicyVersion = live.policy.version;
  }
  if (ctx.path === '/two-factor/disable' && live.policy.requireMfa)
    throw new APIError('FORBIDDEN', {
      code: 'MFA_POLICY_DISABLE_FORBIDDEN',
      message: 'The instance requires two-factor authentication.',
    });
  if (access === 'full') return;
  // Only actual HTTP requests bypassed by an independent proof may use these public flows.
  const allowed = limitedPathAllowed(
    ctx.method ?? 'POST',
    `/api/auth${ctx.path}`
  );
  if (allowed) return;
  if (ctx.path === '/oauth2/consent' && ctx.body?.accept === false) return;
  throw new APIError('FORBIDDEN', {
    code: 'AUTHENTICATION_POLICY_REQUIRED',
    sessionId: live.id,
    access,
    message: 'Complete the instance authentication requirements.',
  });
}
