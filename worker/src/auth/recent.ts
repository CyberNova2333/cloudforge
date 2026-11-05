// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { GenericEndpointContext } from '@better-auth/core';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { DrizzleDB } from '../db/middleware';
import type { AppEnv } from '../variables';
import { POLICY_VERSION_SQL } from './policy';

export const RECENT_AUTHENTICATION_MS = 5 * 60_000;
export const RECENT_SESSION_HEADER = 'X-CloudForge-Session';
export const RECENT_AUTHENTICATION_REQUIRED = 'RECENT_AUTHENTICATION_REQUIRED';

export type RecentAuthorization = {
  sessionId: string;
  userId: string;
  authVersion: number;
};

/** Actual password/factor evidence, never a session's creation or sliding refresh time. */
export function recentAuthorizationGuard(
  sessionId: string,
  userId: string,
  now = Date.now(),
  authVersion?: number
) {
  return sql`EXISTS (SELECT 1 FROM sessions recent_session
    JOIN users recent_user ON recent_user.id = recent_session.user_id
    WHERE recent_session.id = ${sessionId} AND recent_session.user_id = ${userId}
      AND recent_session.expires_at > ${now}
      AND recent_session.auth_version = recent_user.auth_version
      AND recent_session.policy_version = ${sql.raw(POLICY_VERSION_SQL)}
      AND ${authVersion === undefined ? sql`1` : sql`recent_session.auth_version = ${authVersion}`}
      AND coalesce(recent_user.banned, 0) = 0
      AND coalesce(recent_session.impersonated_by, '') = ''
      AND recent_session.auth_method = 'password'
      AND recent_session.auth_time BETWEEN ${now - RECENT_AUTHENTICATION_MS} AND ${now}
      AND (coalesce(recent_user.two_factor_enabled, 0) = 0 OR
        (recent_session.second_factor_method IN ('totp', 'recovery_code')
          AND recent_session.second_factor_time BETWEEN ${now - RECENT_AUTHENTICATION_MS} AND ${now})))`;
}

export async function recentAuthorization(
  db: DrizzleDB,
  sessionId: string,
  userId: string,
  now = Date.now()
): Promise<RecentAuthorization | null> {
  const row = await db.get<{ authVersion: number }>(sql`
    SELECT auth_version AS authVersion FROM sessions
    WHERE id = ${sessionId} AND ${recentAuthorizationGuard(sessionId, userId, now)}
  `);
  return row ? { sessionId, userId, authVersion: row.authVersion } : null;
}

/** Browser credential issuance, access management, repository settings and site administration. */
export function needsRecentRestAuthentication(method: string, path: string) {
  const p = path.replace(/\/$/, '');
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
    return false;
  return (
    (method === 'POST' && p === '/api/tokens') ||
    (method === 'PATCH' && /^\/api\/repos\/[^/]+\/[^/]+$/.test(p)) ||
    (method === 'POST' &&
      /^\/api\/repos\/[^/]+\/[^/]+\/deploy-tokens$/.test(p)) ||
    ((method === 'PUT' || method === 'DELETE') &&
      /^\/api\/repos\/[^/]+\/[^/]+\/collaborators\/[^/]+$/.test(p)) ||
    (method === 'PUT' &&
      /^\/api\/mcp\/connections\/[^/]+\/moderator$/.test(p)) ||
    (method === 'POST' && (p === '/api/invites' || p === '/api/agents')) ||
    (method === 'POST' &&
      /^\/api\/me\/oidc\/(?:preview|start|confirm|revoke)$/.test(p)) ||
    p === '/api/team' ||
    (p.startsWith('/api/admin/') && !p.startsWith('/api/admin/setup/'))
  );
}

export const recentAuthentication: MiddlewareHandler<AppEnv> = async (
  c,
  next
) => {
  if (!needsRecentRestAuthentication(c.req.method, c.req.path)) return next();
  const sessionId = c.get('browserSession')?.id;
  const userId = c.get('user')?.id;
  // Let the route's own ordinary authentication produce its existing unauthorized response.
  if (!sessionId || !userId) return next();
  c.header('Cache-Control', 'no-store');
  const expected = c.req.header(RECENT_SESSION_HEADER);
  if (expected !== undefined && expected !== sessionId)
    return c.json(
      { code: 'SESSION_CHANGED', error: 'The signed-in account changed.' },
      401
    );
  const permit = await recentAuthorization(c.get('db'), sessionId, userId);
  if (!permit)
    return c.json(
      {
        code: RECENT_AUTHENTICATION_REQUIRED,
        error: 'Verify your identity again to continue.',
        sessionId,
      },
      403
    );
  c.set('recentAuthorization', permit);
  return next();
};

const SENSITIVE_NATIVE_PATHS = new Set([
  '/admin/set-role',
  '/admin/create-user',
  '/admin/update-user',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/remove-user',
  '/admin/set-user-password',
  '/admin/impersonate-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/change-password',
  '/change-email',
  '/delete-user',
  '/link-social',
  '/unlink-account',
  '/oauth2/authorize',
  '/oauth2/consent',
  '/oauth2/continue',
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/update-consent',
]);

/** Native admin and OAuth endpoints bypass the Hono member routers. */
export async function requireRecentNativeAuthentication(
  ctx: GenericEndpointContext,
  db: DrizzleDB
) {
  if (!ctx.request || !SENSITIVE_NATIVE_PATHS.has(ctx.path)) return;
  // Declining a signed authorization request grants nothing; the native session/signature checks still apply.
  if (ctx.path === '/oauth2/consent' && ctx.body?.accept === false) return;
  const active = await getSessionFromCtx(ctx);
  // Login, registration, invitation acceptance and OAuth's unauthenticated redirects keep their own flow.
  if (!active) return;
  const sessionId = active.session.id;
  const expected = ctx.request.headers.get(RECENT_SESSION_HEADER);
  if (expected !== null && expected !== sessionId)
    throw new APIError('UNAUTHORIZED', {
      code: 'SESSION_CHANGED',
      message: 'The signed-in account changed.',
    });
  if (await recentAuthorization(db, sessionId, active.user.id)) return;
  if (ctx.path === '/oauth2/authorize' && ctx.method === 'GET') {
    const url = new URL(ctx.request.url);
    if (url.pathname.endsWith('/oauth2/authorize'))
      throw ctx.redirect(
        `/login/verify?return_to=${encodeURIComponent(url.pathname + url.search)}`
      );
  }
  throw new APIError('FORBIDDEN', {
    code: RECENT_AUTHENTICATION_REQUIRED,
    message: 'Verify your identity again to continue.',
    sessionId,
  });
}
