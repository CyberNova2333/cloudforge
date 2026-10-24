import { APIError } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { users } from '../db/auth.schema';
import { isAgentUser } from '../agents/identity';
import type { DrizzleDB } from '../db/middleware';
import { emailConfigured } from '../lib/email';
import { namespaceTaken } from '../lib/namespaces';
import { getSetting, getSettings, signupDomains } from '../lib/settings';

/**
 * Self sign-up (`POST /api/auth/sign-up/email`), governed by Site admin → Settings → Accounts: refused while it is
 * off, before the first admin exists, for an email outside the allowed domains, and for a username the URL
 * namespace already holds. Throws the APIError better-auth answers with; returns when the sign-up may go ahead.
 */
export async function checkSignup(
  db: DrizzleDB,
  env: CloudflareBindings,
  body: unknown
): Promise<void> {
  const b = (body ?? {}) as { email?: unknown; username?: unknown };
  const someone = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(users)
    .get();
  if (!Number(someone?.n ?? 0))
    throw new APIError('FORBIDDEN', { message: 'Set up the instance first.' });
  const s = await getSettings(db, env, [
    'signup.enabled',
    'signup.allowed_domains',
  ]);
  if (!s['signup.enabled'])
    throw new APIError('FORBIDDEN', {
      message: 'Self sign-up is off. Ask an administrator for an invitation.',
    });
  // Without outbound email nobody could confirm an address, so an address (and its allowed domain) would be taken on
  // trust: sign-up that requires confirming one stays closed instead.
  if ((await verificationNeeded(db, env)) && !emailConfigured(env))
    throw new APIError('FORBIDDEN', {
      message: SIGNUP_NEEDS_EMAIL,
    });
  const domains = signupDomains(s['signup.allowed_domains']);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (domains.length && !domains.includes(domain))
    throw new APIError('FORBIDDEN', {
      message: 'Accounts with this email domain can’t sign up here.',
    });
  if (typeof b.username !== 'string' || !b.username.trim())
    throw new APIError('BAD_REQUEST', { message: 'Choose a username.' });
  // Usernames share the URL namespace with the team slug (better-auth checks other users itself).
  if (await namespaceTaken(db, b.username))
    throw new APIError('BAD_REQUEST', {
      message: 'Username is not available.',
    });
}

export const SIGNUP_NEEDS_EMAIL =
  "Sign-up needs a confirmed email address, but this instance can't send email yet. Ask an administrator for an invitation.";

/**
 * Whether a self sign-up must confirm its email address before it signs in: Site admin requires it, or limits sign-up
 * to some domains (an address at a domain says nothing until its mailbox answers). Whether email can be sent doesn't
 * change it: without email, such sign-ups are refused (`checkSignup`).
 */
export async function verificationNeeded(
  db: DrizzleDB,
  env: CloudflareBindings
): Promise<boolean> {
  const s = await getSettings(db, env, [
    'signup.require_verification',
    'signup.allowed_domains',
  ]);
  return (
    s['signup.require_verification'] ||
    signupDomains(s['signup.allowed_domains']).length > 0
  );
}

/** Whether verification emails go out: a confirmed address is needed and outbound email is set up. */
export async function verificationRequired(
  db: DrizzleDB,
  env: CloudflareBindings
): Promise<boolean> {
  return emailConfigured(env) && (await verificationNeeded(db, env));
}

/** Whether self sign-up is open right now: on, and able to confirm addresses when it must. */
export async function signupOpen(
  db: DrizzleDB,
  env: CloudflareBindings
): Promise<boolean> {
  if (!(await getSetting(db, env, 'signup.enabled'))) return false;
  return emailConfigured(env) || !(await verificationNeeded(db, env));
}

/**
 * `POST /api/auth/send-verification-email` (sending the link again): only for a self sign-up still waiting to
 * confirm its email. Anyone else (an invited member, an agent's `.invalid` address, no account) is refused before
 * better-auth makes a token or sends anything, so the endpoint can't be used to mail arbitrary members.
 */
export async function checkResend(
  db: DrizzleDB,
  env: CloudflareBindings,
  body: unknown
): Promise<void> {
  const email = (body as { email?: unknown } | undefined)?.email;
  const user =
    typeof email === 'string'
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email.trim().toLowerCase()))
          .get()
      : undefined;
  if (
    !user ||
    !emailConfigured(env) ||
    !(await mustVerifyEmail(db, env, user.id))
  )
    throw new APIError('BAD_REQUEST', {
      message: 'No sign-up is waiting for this email to be confirmed.',
    });
}

/**
 * Whether `userId` may not sign in yet: an account whose email isn't verified, while verification is required.
 * Only self sign-ups are ever unverified people: every other way in (setup, invitations, the admin API) marks the
 * account verified as it is created (see the user.create hook), and migration 0032 did so for older accounts.
 * Agents are never asked (they can't sign in at all, and their `.invalid` addresses can't receive mail).
 */
export async function mustVerifyEmail(
  db: DrizzleDB,
  env: CloudflareBindings,
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ verified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row || row.verified) return false;
  if (await isAgentUser(db, userId)) return false;
  // Not only while email works: an unconfirmed self sign-up never signs in while a confirmed address is needed.
  return verificationNeeded(db, env);
}
