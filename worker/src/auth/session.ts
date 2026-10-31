// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/middleware';
import { sessions, users } from '../db/auth.schema';
import type { BrowserSession, SessionUser } from '../variables';
import {
  durableSessionAssurance,
  isCurrentSession,
  oidcSessionSourceSql,
} from './assurance';
import { evaluatePolicyAccess, POLICY_VERSION_SQL } from './policy';

/**
 * Who a request is signed in as, read straight from `sessions`: every request of every page needs it,
 * so it is read here instead of through better-auth's `getSession`, whose endpoint machinery (context,
 * cookie parsing, validation, a signed-cookie crypto key per call) costs several times the two D1
 * reads. What must not drift from better-auth is the signed cookie and the row and its expiry, each noted
 * below. The sliding refresh stays better-auth's: its `get-session` (which the SPA calls on load and focus)
 * extends the row and sends the cookie again with a new Max-Age, together. Extending the row here would make it
 * see nothing to refresh, and the cookie would still expire 7 days after sign-in. better-auth's rate limiting only
 * covers its own routes (`/api/auth/*`), which still go through it.
 */

/**
 * better-auth's session cookie, signed (`<token>.<base64 HMAC-SHA256 of the token>`). Over HTTPS (a
 * `https://` BASE_URL) better-auth names it with the `__Secure-` prefix and its `get-session` reads only that
 * name: so does this, so a plain-named cookie (which any page on the same site could set) never signs anyone in.
 */
const COOKIE = 'cloudforge.session_token';
const cookieName = (env: CloudflareBindings) =>
  env.BASE_URL?.startsWith('https://') ? `__Secure-${COOKIE}` : COOKIE;

/** Whether `signature` is `base64(hmacSHA256(secret, value))`, as better-call signs cookies; constant time. */
async function verifies(secret: string, value: string, signature: string) {
  let mac: Uint8Array;
  try {
    mac = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    mac,
    new TextEncoder().encode(value)
  );
}

/** The raw signed cookie under `name`, if the request carries one. */
function signedCookie(headers: Headers, name: string) {
  const cookie = headers.get('cookie');
  if (!cookie?.includes(`${name}=`)) return null;
  const part = cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}

/**
 * Signed cookies already verified in this isolate, for 30 s: a page makes many requests with one
 * cookie, and each signature is an HMAC. Entries include a fingerprint of the current signing secret:
 * Cloudflare can reuse an isolate after bindings change. An expired token is not special-cased — the session row
 * decides — and the entry only spares the HMAC, never a read.
 */
const verified = new Map<string, number>();
const VERIFIED_MS = 30_000;
const VERIFIED_MAX = 1000;

async function sessionToken(secret: string, cookie: string) {
  const keyDigest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  );
  const cacheKey =
    Array.from(keyDigest, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    ) +
    ':' +
    cookie;
  const seenUntil = verified.get(cacheKey);
  let value: string;
  try {
    value = decodeURIComponent(cookie);
  } catch {
    return null; // A malformed escape is a bad cookie, not a server error.
  }
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  if (!(seenUntil && seenUntil > Date.now()))
    if (!(await verifies(secret, token, value.slice(dot + 1)))) return null;
  verified.delete(cacheKey);
  verified.set(cacheKey, Date.now() + VERIFIED_MS);
  if (verified.size > VERIFIED_MAX)
    for (const [k, until] of verified)
      if (until <= Date.now() || verified.size > VERIFIED_MAX)
        verified.delete(k);
  return token;
}

/** One authoritative browser-session read, shared by request identity and the member's proof display. */
export async function currentSession(
  db: DrizzleDB,
  env: CloudflareBindings,
  headers: Headers
): Promise<{ user: SessionUser; browserSession: BrowserSession } | null> {
  const cookie = signedCookie(headers, cookieName(env));
  if (!cookie) return null;
  const token = await sessionToken(env.BETTER_AUTH_SECRET, cookie);
  if (!token) return null;
  const row = await db
    .select({
      session: {
        id: sessions.id,
        expiresAt: sessions.expiresAt,
        authVersion: sessions.authVersion,
        policyVersion: sessions.policyVersion,
        impersonatedBy: sessions.impersonatedBy,
        authMethod: sessions.authMethod,
        authTime: sessions.authTime,
        secondFactorMethod: sessions.secondFactorMethod,
        secondFactorTime: sessions.secondFactorTime,
        oidcBindingId: sql<string | null>`sessions.oidc_binding_id`,
        oidcBindingRevision: sql<number | null>`sessions.oidc_binding_revision`,
        oidcConfigurationGeneration: sql<
          number | null
        >`sessions.oidc_configuration_generation`,
      },
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        username: users.username,
        role: users.role,
        image: users.image,
        banned: users.banned,
        authVersion: users.authVersion,
        enrolled: users.twoFactorEnabled,
      },
      policy: {
        version: sql<number>`${sql.raw(POLICY_VERSION_SQL)}`,
        requireMfa: sql<number>`COALESCE((SELECT require_mfa FROM authentication_policy WHERE id = 1), 0)`,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.token, token), sql.raw(oidcSessionSourceSql('sessions')))
    )
    .get();
  if (!row) return null;
  const { session, user } = row;
  const policy = {
    version: row.policy.version,
    requireMfa: !!row.policy.requireMfa,
  };
  if (
    user.banned ||
    session.expiresAt <= new Date() ||
    !isCurrentSession(session, user)
  )
    return null;
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      image: user.image,
      banned: user.banned,
    },
    browserSession: {
      id: session.id,
      authentication: durableSessionAssurance(session),
      policy: {
        ...policy,
        enrolled: !!user.enrolled,
        access: evaluatePolicyAccess(session, !!user.enrolled, policy),
      },
    },
  };
}

/** Compatibility for callers that only need the request's member identity. */
export async function currentUser(
  db: DrizzleDB,
  env: CloudflareBindings,
  headers: Headers
): Promise<SessionUser | null> {
  return (await currentSession(db, env, headers))?.user ?? null;
}
