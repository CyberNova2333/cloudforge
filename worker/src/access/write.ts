// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { sql, type SQL } from 'drizzle-orm';
import type { DrizzleDB } from '../db/middleware';
import { oidcSessionSourceSql } from '../auth/assurance';
import { POLICY_REQUIRE_MFA_SQL, POLICY_VERSION_SQL } from '../auth/policy';
import {
  RECENT_AUTHENTICATION_MS,
  type RecentAuthorization,
} from '../auth/recent';

export type AccessWriteTarget =
  { kind: 'instance' } | { kind: 'repository'; repositoryId: string };

type Authority = {
  generation: number;
  authVersion: number;
  policyVersion: number;
  authTime: number;
  credentialId: string;
  secondFactorMethod: string | null;
  secondFactorTime: number | null;
  enrolled: number;
  factorId: string | null;
  recoveryVersion: number | null;
  factorVerified: number;
  oidcBindingId: string | null;
  oidcBindingRevision: number | null;
  oidcConfigurationGeneration: number | null;
};

/** Internal request snapshot, never a client-supplied capability or reusable authorization receipt. */
export type AccessWriteAuthorization = Readonly<
  Authority & {
    sessionId: string;
    userId: string;
    target: Readonly<AccessWriteTarget>;
  }
>;

// SQLite holds 'now' stable within one statement. Read it when the write executes,
// not when a Worker started waiting on an earlier asynchronous operation.
const now = sql`CAST(unixepoch('subsecond') * 1000 AS INTEGER)`;
const policyVersion = sql.raw(POLICY_VERSION_SQL);
const policyRequiresMfa = sql.raw(POLICY_REQUIRE_MFA_SQL);
const source = sql.raw(oidcSessionSourceSql('s'));
const from = sql`FROM sessions s JOIN users u ON u.id = s.user_id
  JOIN access_control_state acl ON acl.id = 1
  JOIN accounts credential ON credential.user_id = u.id
    AND credential.provider_id = 'credential' AND coalesce(credential.password, '') != ''
  LEFT JOIN two_factors f ON f.user_id = u.id`;

// A flat AND chain adds one expression level per check. Keep the complete proof
// balanced so a caller's guarded DML also fits D1's expression-depth limit.
function conjunction(parts: SQL[]): SQL {
  if (parts.length === 1) return parts[0];
  const middle = Math.floor(parts.length / 2);
  return sql`(${conjunction(parts.slice(0, middle))} AND ${conjunction(parts.slice(middle))})`;
}

function currentAuthority(
  sessionId: string,
  userId: string,
  target: Readonly<AccessWriteTarget>
) {
  const permission =
    target.kind === 'instance'
      ? sql`u.role = 'admin'`
      : sql`EXISTS (SELECT 1 FROM repositories access_repo
          WHERE access_repo.id = ${target.repositoryId}
            AND (u.role = 'admin' OR access_repo.owner_id = u.id))`;
  return conjunction([
    sql`s.id = ${sessionId}`,
    sql`s.user_id = ${userId}`,
    sql`coalesce(u.banned, 0) = 0`,
    sql`NOT EXISTS (SELECT 1 FROM agents WHERE agents.user_id = u.id)`,
    permission,
    source,
    sql`s.expires_at > ${now}`,
    sql`s.auth_version = u.auth_version`,
    sql`s.policy_version = ${policyVersion}`,
    sql`coalesce(s.impersonated_by, '') = ''`,
    sql`s.auth_method = 'password'`,
    sql`s.auth_time BETWEEN ${now} - ${RECENT_AUTHENTICATION_MS} AND ${now}`,
    sql`(${policyRequiresMfa} = 0 OR coalesce(u.two_factor_enabled, 0) = 1)`,
    sql`(coalesce(u.two_factor_enabled, 0) = 0 OR
      (f.verified = 1 AND s.second_factor_method IN ('totp', 'recovery_code')
        AND s.second_factor_time BETWEEN ${now} - ${RECENT_AUTHENTICATION_MS} AND ${now}))`,
  ]);
}

const nonnegativeInteger = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Capture before target lookups; do not attach a new proof or generation to an already stale request. */
export async function captureAccessWrite(
  db: DrizzleDB,
  permit: RecentAuthorization | undefined,
  target: AccessWriteTarget
): Promise<AccessWriteAuthorization | null> {
  if (
    !permit?.sessionId ||
    !permit.userId ||
    !nonnegativeInteger(permit.authVersion) ||
    (target.kind === 'repository' && !target.repositoryId)
  )
    return null;
  const row = await db.get<Authority>(sql`
    SELECT acl.generation AS generation, s.auth_version AS authVersion,
      s.policy_version AS policyVersion, s.auth_time AS authTime, credential.id AS credentialId,
      s.second_factor_method AS secondFactorMethod, s.second_factor_time AS secondFactorTime,
      coalesce(u.two_factor_enabled, 0) AS enrolled, f.id AS factorId,
      f.recovery_version AS recoveryVersion, coalesce(f.verified, 0) AS factorVerified,
      s.oidc_binding_id AS oidcBindingId, s.oidc_binding_revision AS oidcBindingRevision,
      s.oidc_configuration_generation AS oidcConfigurationGeneration
    ${from} WHERE ${currentAuthority(permit.sessionId, permit.userId, target)}
      AND s.auth_version = ${permit.authVersion}
  `);
  if (
    !row ||
    !nonnegativeInteger(row.generation) ||
    !nonnegativeInteger(row.authVersion) ||
    !nonnegativeInteger(row.policyVersion) ||
    !nonnegativeInteger(row.authTime) ||
    (row.secondFactorTime !== null &&
      !nonnegativeInteger(row.secondFactorTime)) ||
    (row.recoveryVersion !== null && !nonnegativeInteger(row.recoveryVersion))
  )
    return null;
  return {
    ...row,
    sessionId: permit.sessionId,
    userId: permit.userId,
    target: { ...target },
  };
}

/** Embed this predicate in the mutation itself; a separate pre-read is not a write fence. */
export function accessWriteGuard(permit: AccessWriteAuthorization) {
  return sql`EXISTS (SELECT 1 ${from}
    WHERE ${conjunction([
      currentAuthority(permit.sessionId, permit.userId, permit.target),
      sql`acl.generation = ${permit.generation}`,
      sql`s.auth_version = ${permit.authVersion}`,
      sql`s.policy_version = ${permit.policyVersion}`,
      sql`s.auth_time = ${permit.authTime}`,
      sql`credential.id = ${permit.credentialId}`,
      sql`s.second_factor_method IS ${permit.secondFactorMethod}`,
      sql`s.second_factor_time IS ${permit.secondFactorTime}`,
      sql`coalesce(u.two_factor_enabled, 0) = ${permit.enrolled}`,
      sql`f.id IS ${permit.factorId}`,
      sql`f.recovery_version IS ${permit.recoveryVersion}`,
      sql`coalesce(f.verified, 0) = ${permit.factorVerified}`,
      sql`s.oidc_binding_id IS ${permit.oidcBindingId}`,
      sql`s.oidc_binding_revision IS ${permit.oidcBindingRevision}`,
      sql`s.oidc_configuration_generation IS ${permit.oidcConfigurationGeneration}`,
    ])})`;
}
