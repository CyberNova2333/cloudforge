import { POLICY_VERSION_SQL, readPolicy } from './policy';
import { RECENT_AUTHENTICATION_MS } from './recent';

export type PolicyImpact = {
  members: number;
  unenrolledMembers: number;
  sessionsToReverify: number;
  oauthConnections: number;
  personalTokens: number;
  deployTokens: number;
};
const HUMAN = 'NOT EXISTS (SELECT 1 FROM agents WHERE agents.user_id = u.id)';
function impactSql(now: number, target: string, session: string) {
  return `json_object(
    'members', (SELECT count(*) FROM users u WHERE coalesce(u.banned,0) = 0 AND ${HUMAN}),
    'unenrolledMembers', (CASE WHEN ${target} = 1 THEN (SELECT count(*) FROM users u WHERE coalesce(u.banned,0) = 0 AND coalesce(u.two_factor_enabled,0) = 0 AND ${HUMAN}) ELSE 0 END),
    'sessionsToReverify', (SELECT count(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at > ${now} AND s.id != ${session} AND coalesce(u.banned,0) = 0 AND ${HUMAN}),
    'oauthConnections', (SELECT count(*) FROM oauth_consents WHERE user_id IS NOT NULL),
    'personalTokens', (SELECT count(*) FROM personal_access_tokens WHERE expires_at IS NULL OR expires_at > ${Math.floor(now / 1000)}),
    'deployTokens', (SELECT count(*) FROM repository_deploy_tokens WHERE expires_at > ${now}))`;
}

type Authority = {
  user_id: string;
  auth_version: number;
  factor_id: string;
  recovery_version: number;
  auth_time: number;
  second_factor_time: number;
  policy_version: number;
};
const strongAuthority = (
  now: number
) => `u.role = 'admin' AND coalesce(u.banned,0) = 0
  AND NOT EXISTS (SELECT 1 FROM agents WHERE agents.user_id = u.id)
  AND s.expires_at > ${now} AND s.auth_version = u.auth_version
  AND s.policy_version = ${POLICY_VERSION_SQL} AND coalesce(s.impersonated_by,'') = ''
  AND s.auth_method = 'password' AND s.auth_time BETWEEN ${now - RECENT_AUTHENTICATION_MS} AND ${now}
  AND s.second_factor_method IN ('totp','recovery_code') AND s.second_factor_time BETWEEN ${now - RECENT_AUTHENTICATION_MS} AND ${now}
  AND coalesce(u.two_factor_enabled,0) = 1 AND f.verified = 1`;

/** The preview is an action-bound, one-use capability issued only under current joint verification. */
export async function previewPolicy(
  env: CloudflareBindings,
  sessionId: string,
  userId: string,
  requireMfa: boolean
) {
  const now = Date.now();
  const authority = await env.DB.prepare(
    `SELECT u.id AS user_id, u.auth_version, f.id AS factor_id,
    f.recovery_version, s.auth_time, s.second_factor_time, s.policy_version
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN two_factors f ON f.user_id=u.id
    WHERE s.id = ? AND u.id = ? AND ${strongAuthority(now)}`
  )
    .bind(sessionId, userId)
    .first<Authority>();
  if (!authority) return null;
  const policy = await readPolicy(env);
  if (
    policy.version !== authority.policy_version ||
    policy.requireMfa === requireMfa
  )
    return null;
  const raw = await env.DB.prepare(
    `SELECT ${impactSql(now, '?', '?')} AS impact`
  )
    .bind(requireMfa ? 1 : 0, sessionId)
    .first<{ impact: string }>();
  if (!raw) return null;
  const previewId = crypto.randomUUID();
  const digestBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify({
        previewId,
        sessionId,
        authority,
        requireMfa,
        impact: raw.impact,
      })
    )
  );
  const digest = Array.from(new Uint8Array(digestBytes), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  const expires = now + 120_000;
  // Recheck the exact proof at the preview write too; a stale read cannot create a usable action capability.
  const inserted = await env.DB.prepare(
    `INSERT INTO authentication_policy_previews
    (session_id,id,user_id,policy_version,require_mfa,auth_version,factor_id,recovery_version,auth_time,factor_time,digest,impact,expires_at,used_at)
    SELECT s.id,?,u.id,s.policy_version,?,u.auth_version,f.id,f.recovery_version,s.auth_time,s.second_factor_time,?,?,?,NULL
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN two_factors f ON f.user_id=u.id
    WHERE s.id=? AND u.id=? AND ${strongAuthority(Date.now())}
      AND u.auth_version=? AND f.id=? AND f.recovery_version=? AND s.auth_time=? AND s.second_factor_time=? AND s.policy_version=?
    ON CONFLICT(session_id) DO UPDATE SET id=excluded.id,user_id=excluded.user_id,policy_version=excluded.policy_version,
      require_mfa=excluded.require_mfa,auth_version=excluded.auth_version,factor_id=excluded.factor_id,
      recovery_version=excluded.recovery_version,auth_time=excluded.auth_time,factor_time=excluded.factor_time,
      digest=excluded.digest,impact=excluded.impact,expires_at=excluded.expires_at,used_at=NULL RETURNING id`
  )
    .bind(
      previewId,
      requireMfa ? 1 : 0,
      digest,
      raw.impact,
      expires,
      sessionId,
      userId,
      authority.auth_version,
      authority.factor_id,
      authority.recovery_version,
      authority.auth_time,
      authority.second_factor_time,
      authority.policy_version
    )
    .first();
  if (!inserted) return null;
  return {
    previewId,
    digest,
    expiresAt: new Date(expires).toISOString(),
    policy,
    target: { requireMfa },
    impact: JSON.parse(raw.impact) as PolicyImpact,
    recoveryAcknowledgementRequired: true as const,
  };
}

/** CAS, action consumption, OAuth revocation, actor migration and audit all commit in one D1 statement+trigger. */
export async function applyPolicy(
  env: CloudflareBindings,
  sessionId: string,
  userId: string,
  previewId: string,
  digest: string
) {
  const now = Date.now();
  const changed = await env.DB.prepare(
    `INSERT INTO authentication_policy
    (id,version,require_mfa,change_id,preview_id,actor_session_id,updated_by_id,updated_at)
    SELECT 1,p.policy_version+1,p.require_mfa,?,p.id,s.id,u.id,?
    FROM authentication_policy_previews p JOIN sessions s ON s.id=p.session_id
    JOIN users u ON u.id=s.user_id JOIN two_factors f ON f.user_id=u.id
    WHERE p.id=? AND p.digest=? AND s.id=? AND u.id=? AND p.user_id=u.id AND p.used_at IS NULL AND p.expires_at > ?
      AND ${strongAuthority(now)} AND p.policy_version=${POLICY_VERSION_SQL}
      AND p.require_mfa != COALESCE((SELECT require_mfa FROM authentication_policy WHERE id=1),0)
      AND p.auth_version=u.auth_version AND p.factor_id=f.id AND p.recovery_version=f.recovery_version
      AND p.auth_time=s.auth_time AND p.factor_time=s.second_factor_time
      AND p.impact=${impactSql(now, 'p.require_mfa', 'p.session_id')}
    ON CONFLICT(id) DO UPDATE SET version=excluded.version,require_mfa=excluded.require_mfa,change_id=excluded.change_id,
      preview_id=excluded.preview_id,actor_session_id=excluded.actor_session_id,updated_by_id=excluded.updated_by_id,updated_at=excluded.updated_at
    WHERE authentication_policy.version=excluded.version-1
    RETURNING version,require_mfa`
  )
    .bind(crypto.randomUUID(), now, previewId, digest, sessionId, userId, now)
    .first<{ version: number; require_mfa: number }>();
  return changed
    ? { version: changed.version, requireMfa: !!changed.require_mfa }
    : null;
}
