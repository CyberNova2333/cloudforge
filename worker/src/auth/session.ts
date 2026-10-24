// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/middleware';
import { sessions, users } from '../db/auth.schema';
import type { SessionUser } from '../variables';

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
 * `https://` BASE_URL) better-auth names it with the `__Secure-` prefix and reads that name first, then
 * the plain one: so does this.
 */
const COOKIE = 'cloudforge.session_token';
const NAMES = [`__Secure-${COOKIE}`, COOKIE];

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

/** The raw signed cookie, if the request carries one. */
function signedCookie(headers: Headers) {
  const cookie = headers.get('cookie');
  if (!cookie?.includes(`${COOKIE}=`)) return null;
  const parts = cookie.split(';').map((s) => s.trim());
  for (const name of NAMES) {
    const part = parts.find((s) => s.startsWith(`${name}=`));
    if (part) return part.slice(name.length + 1);
  }
  return null;
}

/**
 * Signed cookies already verified in this isolate, for 30 s: a page makes many requests with one
 * cookie, and each signature is an HMAC. An expired token is not special-cased — the session row
 * decides — and the entry only spares the HMAC, never a read.
 */
const verified = new Map<string, number>();
const VERIFIED_MS = 30_000;
const VERIFIED_MAX = 1000;

async function sessionToken(secret: string, cookie: string) {
  const seenUntil = verified.get(cookie);
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
  verified.delete(cookie);
  verified.set(cookie, Date.now() + VERIFIED_MS);
  if (verified.size > VERIFIED_MAX)
    for (const [k, until] of verified)
      if (until <= Date.now() || verified.size > VERIFIED_MAX)
        verified.delete(k);
  return token;
}

/** The signed-in user of a request, or null (no cookie, a bad signature, no row, expired). */
export async function currentUser(
  db: DrizzleDB,
  env: CloudflareBindings,
  headers: Headers
): Promise<SessionUser | null> {
  const cookie = signedCookie(headers);
  if (!cookie) return null;
  const token = await sessionToken(env.BETTER_AUTH_SECRET, cookie);
  if (!token) return null;
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.token, token))
    .get();
  if (!row) return null;
  const { session, user } = row;
  if (session.expiresAt <= new Date()) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    image: user.image,
    banned: user.banned,
  };
}
