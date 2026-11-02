import { createHash } from 'node:crypto';
import {
  RECOVERY_TRIGGER_NAME,
  RECOVERY_TRIGGER_SQL,
} from '../../../worker/src/db/recovery-trigger.ts';
import { AUTH_TRIGGERS } from '../../../worker/src/db/auth-triggers.ts';
import type { Cloudflare } from '../platform/cloudflare.ts';
import type { Io } from '../ui/collect.ts';

type Member = {
  id: string;
  username: string | null;
  email: string;
  enabled: number;
  auth_version: number;
  banned: number;
  agent: number;
  credential_id: string | null;
  password: string | null;
  factor_id: string | null;
  secret: string | null;
  recovery_version: number | null;
};
type Marker = { installation_id: string; ownership_nonce: string };

export type ResetMfaOptions = {
  accountId: string;
  database: { uuid: string; name: string };
  who: string;
  reason: string;
  installation?: { id: string; ownershipNonce: string; name: string };
  plan: boolean;
  expectPlan?: string;
  yes: boolean;
};

/** This reason is public audit data, never a place for passwords or recovery codes. */
export function recoveryReasonProblem(value: string) {
  const reason = value.trim();
  return reason.length < 1 ||
    reason.length > 500 ||
    /[\p{Cc}\p{Cf}]/u.test(reason)
    ? '--reason must contain 1–500 characters, without control characters.'
    : undefined;
}

const normalizeTrigger = (sql: string) =>
  sql.replaceAll('\r', '').trim().replace(/;\s*$/, '');
const TRIGGER_GUARD = `EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ? AND rtrim(replace(sql, char(13), ''), char(10) || char(9) || ' ;') = ?)`;
const requiredTriggers = [
  { name: RECOVERY_TRIGGER_NAME, sql: RECOVERY_TRIGGER_SQL },
  ...AUTH_TRIGGERS,
];
const quote = (value: string) => JSON.stringify(value);

/** A single INSERT and its AFTER trigger own every mutation; no REST batch transaction is assumed. */
export async function resetMfa(
  ctx: { cf: Pick<Cloudflare, 'queryD1'>; io: Io; now(): Date },
  opts: ResetMfaOptions
): Promise<number> {
  const { io } = ctx;
  const problem = recoveryReasonProblem(opts.reason);
  if (problem) {
    io.print(`${problem} Nothing was changed.`);
    return 2;
  }
  if (!opts.plan && opts.yes && !opts.expectPlan) {
    io.print(
      '--yes requires --expect-plan from a prior --plan. Nothing was changed.'
    );
    return 2;
  }
  if (!opts.plan && !io.tty && (!opts.yes || !opts.expectPlan)) {
    io.print(
      'Outside a terminal, apply with --yes --expect-plan after reviewing --plan. Nothing was changed.'
    );
    return 2;
  }
  const q = (sql: string, params: unknown[] = []) =>
    ctx.cf.queryD1(opts.accountId, opts.database.uuid, sql, params);
  const markers = (await q(
    'SELECT installation_id, ownership_nonce FROM install_state'
  )) as Marker[];
  const marker = markers[0] ?? null;
  if (
    markers.length > 1 ||
    (opts.installation &&
      (!marker ||
        marker.installation_id !== opts.installation.id ||
        marker.ownership_nonce !== opts.installation.ownershipNonce))
  ) {
    io.print(
      'The database installation marker does not match the selected installation. Nothing was changed.'
    );
    return 1;
  }
  const triggers = await q(
    `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (${requiredTriggers.map(() => '?').join(',')})`,
    requiredTriggers.map((trigger) => trigger.name)
  );
  if (
    triggers.length !== requiredTriggers.length ||
    !requiredTriggers.every((expected) =>
      triggers.some(
        (actual) =>
          actual.name === expected.name &&
          typeof actual.sql === 'string' &&
          normalizeTrigger(actual.sql) === normalizeTrigger(expected.sql)
      )
    )
  ) {
    io.print(
      'The database is missing the expected MFA recovery migration/trigger. Nothing was changed.'
    );
    return 1;
  }
  const who = opts.who.trim().replace(/^@/, '').toLowerCase();
  const members = (await q(
    `SELECT u.id, u.username, u.email, COALESCE(u.two_factor_enabled, 0) AS enabled,
       COALESCE(u.banned, 0) AS banned, u.auth_version,
       EXISTS (SELECT 1 FROM agents a WHERE a.user_id = u.id) AS agent,
       c.id AS credential_id, c.password, f.id AS factor_id, f.secret, f.recovery_version
     FROM users u
     LEFT JOIN accounts c ON c.user_id = u.id AND c.provider_id = 'credential'
     LEFT JOIN two_factors f ON f.user_id = u.id
     WHERE lower(u.username) = ? OR lower(u.email) = ?`,
    [who, who]
  )) as Member[];
  if (members.length !== 1) {
    io.print(
      `Expected exactly one member matching ${quote(opts.who)}; found ${members.length}. Nothing was changed.`
    );
    return 1;
  }
  const member = members[0];
  if (
    member.agent ||
    member.banned ||
    !member.password ||
    !member.credential_id
  ) {
    io.print(
      'Recovery requires a non-banned person with a password account. Nothing was changed.'
    );
    return 1;
  }
  if (!member.enabled && !member.factor_id) {
    io.print(
      'This member has no enabled or pending second factor. Nothing was changed.'
    );
    return 1;
  }
  const reason = opts.reason.trim();
  // Only the digest is displayed. Password hashes and encrypted factor material remain in memory.
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        account: opts.accountId,
        database: { uuid: opts.database.uuid, name: opts.database.name },
        installation: opts.installation
          ? {
              id: opts.installation.id,
              ownershipNonce: opts.installation.ownershipNonce,
              name: opts.installation.name,
            }
          : null,
        marker: marker
          ? {
              installation_id: marker.installation_id,
              ownership_nonce: marker.ownership_nonce,
            }
          : null,
        member: {
          id: member.id,
          username: member.username,
          email: member.email,
          enabled: member.enabled,
          auth_version: member.auth_version,
          banned: member.banned,
          agent: member.agent,
          credential_id: member.credential_id,
          password: member.password,
          factor_id: member.factor_id,
          secret: member.secret,
          recovery_version: member.recovery_version,
        },
        reason,
        triggers: requiredTriggers.map((trigger) => ({
          name: trigger.name,
          sql: normalizeTrigger(trigger.sql),
        })),
      })
    )
    .digest('hex');
  io.print(
    [
      'MFA recovery plan',
      `  Account       ${quote(opts.accountId)}`,
      `  Database      ${quote(opts.database.name)} (${quote(opts.database.uuid)})`,
      `  Installation  ${opts.installation ? quote(opts.installation.name) : 'unrecorded/manual'} (${marker ? quote(marker.installation_id) : 'no ownership marker'})`,
      `  Member        ${quote(member.id)} @${quote(member.username ?? member.email)} (${quote(member.email)})`,
      `  Reason        ${quote(reason)}`,
      '  Revoke        authenticator, recovery codes, all browser sessions, factor proofs and pending challenges',
      '  Preserve      password, ban/role, PATs, deploy tokens and existing OAuth authorizations',
      `  Plan digest   ${digest}`,
    ].join('\n')
  );
  if (opts.expectPlan !== undefined && opts.expectPlan !== digest) {
    io.print(
      'The recovery plan changed. Review a new --plan; nothing was changed.'
    );
    return 1;
  }
  if (opts.plan) {
    io.print(
      'Read-only plan: nothing was changed. Apply the same target/reason with --expect-plan <digest> (and --yes outside a terminal).'
    );
    return 0;
  }
  if (
    !opts.yes &&
    !(await io.confirm(
      'Remove this member’s second factor and sign out all browser sessions?',
      false
    ))
  ) {
    io.print('Nothing was changed.');
    return 1;
  }
  const id = crypto.randomUUID();
  const at = ctx.now().getTime();
  const factorGuard = member.factor_id
    ? 'EXISTS (SELECT 1 FROM two_factors WHERE user_id = u.id AND id = ? AND secret = ? AND recovery_version = ?)'
    : 'NOT EXISTS (SELECT 1 FROM two_factors WHERE user_id = u.id)';
  const markerGuard = marker
    ? 'EXISTS (SELECT 1 FROM install_state WHERE installation_id = ? AND ownership_nonce = ?) AND (SELECT count(*) FROM install_state) = 1'
    : 'NOT EXISTS (SELECT 1 FROM install_state)';
  const params: unknown[] = [
    id,
    reason,
    at,
    member.id,
    member.username,
    member.email,
    member.enabled,
    member.auth_version,
    member.credential_id,
    member.password,
    ...(member.factor_id
      ? [member.factor_id, member.secret, member.recovery_version]
      : []),
    ...(marker ? [marker.installation_id, marker.ownership_nonce] : []),
    ...requiredTriggers.flatMap((trigger) => [
      trigger.name,
      normalizeTrigger(trigger.sql),
    ]),
  ];
  const sql = `INSERT INTO mfa_recovery_events (id, user_id, reason, created_at)
    SELECT ?, u.id, ?, ? FROM users u WHERE u.id = ? AND u.username IS ? AND u.email = ?
      AND COALESCE(u.two_factor_enabled, 0) = ? AND u.auth_version = ? AND COALESCE(u.banned, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id = u.id)
      AND EXISTS (SELECT 1 FROM accounts WHERE user_id = u.id AND provider_id = 'credential' AND id = ? AND password = ?)
      AND (SELECT count(*) FROM accounts WHERE user_id = u.id AND provider_id = 'credential') = 1
      AND ${factorGuard} AND ${markerGuard} AND ${requiredTriggers.map(() => TRIGGER_GUARD).join(' AND ')}
    RETURNING id`;
  let rows: Record<string, unknown>[] | undefined;
  let emptyResult = false;
  try {
    rows = await q(sql, params);
    if (Array.isArray(rows) && rows.length === 0) {
      // Some transports turn a malformed response into an empty result. Read back the
      // immutable event before claiming that the compare-and-swap did not apply.
      emptyResult = true;
    }
    if (Array.isArray(rows) && rows.length === 1 && rows[0].id === id) {
      io.print(
        `Done: MFA was removed for member ${quote(member.id)}. Sign in with the existing password and enroll again. Recovery event: ${id}`
      );
      return 0;
    }
  } catch {
    // A lost response can follow a committed statement. Never retry this mutation automatically.
  }
  try {
    const committed = await q(
      'SELECT EXISTS (SELECT 1 FROM mfa_recovery_events WHERE id = ? AND user_id = ? AND reason = ? AND created_at = ?) AS committed',
      [id, member.id, reason, at]
    );
    if (committed.length === 1 && committed[0].committed === 1) {
      io.print(
        `Done: the response was interrupted, but recovery event ${id} confirms MFA was removed for member ${quote(member.id)}.`
      );
      return 0;
    }
    if (emptyResult && committed.length === 1 && committed[0].committed === 0) {
      io.print(
        'The account, factor or installation changed after preview. Nothing was changed; review a new --plan.'
      );
      return 1;
    }
  } catch {
    // The next step is read-only verification, not a second recovery attempt.
  }
  io.print(
    `Recovery status is unknown. Do not repeat the write blindly; verify event ${id} in database ${quote(opts.database.uuid)} using a read-only query.`
  );
  return 1;
}
