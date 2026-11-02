import { eq } from 'drizzle-orm';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import type { AppEnv } from '../variables';
import { isAgentUser } from '../agents/identity';
import { recordAudit } from '../audit/service';
import { emailConfigured, sendPasswordReset } from '../notifications/email';

/** How long a site admin's reset link works: long enough to hand it over by another channel. */
export const ADMIN_RESET_HOURS = 24;

/** An unguessable token: 32 characters from [A-Za-z0-9], the alphabet of better-auth's own (`generateId`). */
function resetToken(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // 248 = 4 × 62: rejecting bytes ≥ 248 keeps every character equally likely.
  let out = '';
  while (out.length < 32) {
    for (const b of crypto.getRandomValues(new Uint8Array(48)))
      if (b < 248 && out.length < 32) out += alphabet[b % 62];
  }
  return out;
}

export type ResetLink =
  | { ok: true; url: string; expiresAt: Date; emailed: boolean }
  | { ok: false; status: 404 | 422; error: string };

/**
 * A one-time link for `username` to choose a new password, created by site admin `by`. It goes into
 * better-auth's own store (`reset-password:<token>`, as the forgot-password flow writes it), so the reset page's
 * POST /api/auth/reset-password checks, consumes and signs out the member's other sessions the same way. The link
 * is returned for the admin to hand over, and emailed to the member too when email is set up. Agents have no
 * password and are refused.
 */
export async function createResetLink(
  env: CloudflareBindings,
  db: DrizzleDB,
  auth: AppEnv['Variables']['auth'],
  opts: {
    username: string;
    by: { id: string; username: string };
    origin: string;
  }
): Promise<ResetLink> {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.username, opts.username.toLowerCase()))
    .get();
  if (!user) return { ok: false, status: 404, error: 'Not Found' };
  if (await isAgentUser(db, user.id))
    return {
      ok: false,
      status: 422,
      error: 'Agents have no password to reset.',
    };
  const token = resetToken();
  const expiresAt = new Date(Date.now() + ADMIN_RESET_HOURS * 3600_000);
  const ctx = await auth.$context;
  await ctx.internalAdapter.createVerificationValue({
    value: user.id,
    identifier: `reset-password:${token}`,
    expiresAt,
  });
  const url = `${opts.origin.replace(/\/$/, '')}/reset-password?token=${token}`;
  const emailed =
    emailConfigured(env) &&
    (await sendPasswordReset(env, db, {
      to: user.email,
      name: user.name,
      url,
      expires: `${ADMIN_RESET_HOURS} hours`,
      by: opts.by.username,
    }));
  await recordAudit(db, {
    repositoryId: null,
    actorId: opts.by.id,
    action: 'user.password_reset_link',
    target: `@${user.username ?? user.name}`,
    data: { emailed },
  });
  return { ok: true, url, expiresAt, emailed };
}
