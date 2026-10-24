// `cloudforge reset-password`: a new password for a member, written straight into the installation's D1 database
// over the Cloudflare API, for when nobody can sign in to create a reset link (the last site admin forgot theirs,
// or the instance cannot send email). The hash is better-auth's own (`better-auth/crypto`), so the worker
// verifies it like any other; every session of that member is signed out, and the audit log records it.
import { hashPassword } from 'better-auth/crypto';
import type { Cloudflare } from './cloudflare.ts';
import type { Io } from './collect.ts';

/** worker/src/auth/index.ts `minPasswordLength`; better-auth's default maximum. */
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

/** The audit log's `via`: how this change was made. */
export const RESET_VIA = 'cloudforge reset-password';

const passwordProblem = (v: string) =>
  v.length < MIN_PASSWORD
    ? `Use at least ${MIN_PASSWORD} characters.`
    : v.length > MAX_PASSWORD
      ? `Use at most ${MAX_PASSWORD} characters.`
      : undefined;

type Member = {
  id: string;
  username: string | null;
  email: string;
  agent: number;
  credential: number;
};

/**
 * Sets a new password for `who` (a username or an email address) in D1 `database` of account `accountId`. Asks
 * for the password twice (masked) and confirms first. Returns the exit code; prints what happened.
 */
export async function resetPassword(
  ctx: { cf: Cloudflare; io: Io; now(): Date },
  opts: {
    accountId: string;
    database: { uuid: string; name: string };
    who: string;
    /** Where to sign in afterwards, when known. */
    baseUrl?: string;
    yes: boolean;
  }
): Promise<number> {
  const { cf, io } = ctx;
  const q = (sql: string, params: unknown[]) =>
    cf.queryD1(opts.accountId, opts.database.uuid, sql, params);
  const who = opts.who.trim().replace(/^@/, '').toLowerCase();
  const [member] = (await q(
    `SELECT u.id, u.username, u.email,
       EXISTS (SELECT 1 FROM agents a WHERE a.user_id = u.id) AS agent,
       EXISTS (SELECT 1 FROM accounts c WHERE c.user_id = u.id AND c.provider_id = 'credential') AS credential
     FROM users u WHERE u.username = ? OR lower(u.email) = ? LIMIT 1`,
    [who, who]
  )) as Member[];
  if (!member) {
    io.print(
      `No member ${opts.who} in D1 ${opts.database.name}. Nothing was changed.`
    );
    return 1;
  }
  const handle = `@${member.username ?? member.email}`;
  if (member.agent) {
    io.print(
      `${handle} is a reviewer agent: agents have no password. Nothing was changed.`
    );
    return 1;
  }
  io.print(
    `Set a new password for ${handle} (${member.email}) in D1 ${opts.database.name}. ` +
      'Every session they have is signed out.'
  );
  if (!opts.yes && !(await io.confirm('Continue?', true))) {
    io.print('Nothing was changed.');
    return 1;
  }
  const password = await io.prompt('New password', {
    mask: true,
    validate: passwordProblem,
  });
  if (password === null) {
    io.print('Nothing was changed.');
    return 1;
  }
  // A prompt without validation (or a pasted value) still gets the same rule.
  const problem = passwordProblem(password);
  if (problem) {
    io.print(`${problem} Nothing was changed.`);
    return 1;
  }
  const again = await io.prompt('Type it again', { mask: true });
  if (again !== password) {
    io.print('The two passwords do not match. Nothing was changed.');
    return 1;
  }

  const hash = await hashPassword(password);
  const now = ctx.now().getTime();
  if (member.credential) {
    await q(
      `UPDATE accounts SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = 'credential'`,
      [hash, now, member.id]
    );
  } else {
    // As better-auth creates it: the credential account's account_id is the user's id.
    await q(
      `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      [crypto.randomUUID(), member.id, member.id, hash, now, now]
    );
  }
  await q(`DELETE FROM sessions WHERE user_id = ?`, [member.id]);
  await q(
    `INSERT INTO audit_events (id, repository_id, actor_id, actor_kind, via, action, target, data, created_at)
     VALUES (?, NULL, NULL, 'system', ?, 'user.password_set', ?, '{}', ?)`,
    [crypto.randomUUID(), RESET_VIA, handle, now]
  );
  io.print(
    `Done: ${handle} can sign in with the new password${opts.baseUrl ? ` at ${opts.baseUrl}` : ''}.`
  );
  return 0;
}

/** D1 `name` (a database name or its uuid) in the account; null when there is none. */
export async function findDatabase(
  cf: Cloudflare,
  accountId: string,
  name: string
): Promise<{ uuid: string; name: string } | null> {
  const all = await cf.listD1(accountId);
  return all.find((d) => d.name === name || d.uuid === name) ?? null;
}
