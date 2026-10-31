import { drizzle } from 'drizzle-orm/d1';
import { recordAudit } from '../lib/audit';
import { POLICY_REQUIRE_MFA_SQL, POLICY_VERSION_SQL } from '../auth/policy';
import { RECENT_AUTHENTICATION_MS } from '../auth/recent';
import { OidcError } from './errors';
import {
  authorizationRequest,
  exchangeIdentity,
  hashValue,
  openState,
  providerFrom,
  publicProvider,
  randomToken,
  sealState,
  type ProviderConfig,
} from './provider';

type Identity = {
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
};
export type BindingDTO = Identity & {
  id: string;
  providerId: string;
  revision: number;
};
type Configuration = {
  enabled: number;
  login_enabled: number;
  provider_id: string;
  issuer: string;
  version: number;
  digest: string;
  generation: number;
};
type Authority = {
  session_id: string;
  user_id: string;
  auth_version: number;
  policy_version: number;
  credential_id: string;
  factor_id: string | null;
  factor_enabled: number;
  recovery_version: number | null;
  auth_time: number;
  factor_time: number | null;
  proof_expires_at: number;
};
type Action = Authority & {
  id: string;
  kind: 'configure' | 'link' | 'retire';
  status: string;
  provider_id: string;
  issuer: string;
  provider_version: number;
  provider_digest: string;
  configuration_generation: number;
  capability_hash: string | null;
  state_hash: string | null;
  cookie_hash: string | null;
  sealed: string | null;
  expires_at: number;
  created_at: number;
  started_at: number | null;
  subject: string | null;
  email: string | null;
  name: string | null;
  binding_id: string | null;
  binding_revision: number | null;
};
type Binding = {
  id: string;
  provider_id: string;
  issuer: string;
  subject: string;
  user_id: string | null;
  active: number;
  revision: number;
  email: string | null;
  name: string | null;
};
const GENERATION =
  'COALESCE((SELECT generation FROM oidc_configuration WHERE id=1),0)';
const CLEAN =
  'capability_hash=NULL,state_hash=NULL,cookie_hash=NULL,sealed=NULL';
const JOINS = `JOIN sessions s ON s.id=a.session_id JOIN users u ON u.id=s.user_id
  JOIN accounts c ON c.id=a.credential_id AND c.user_id=u.id LEFT JOIN two_factors f ON f.user_id=u.id`;

const dto = (b: Binding): BindingDTO => ({
  id: b.id,
  providerId: b.provider_id,
  issuer: b.issuer,
  subject: b.subject,
  email: b.email,
  name: b.name,
  revision: b.revision,
});
function denied(code = 'OIDC_ACTION_CHANGED', status = 409): never {
  throw new OidcError(code, status);
}
function baseAuthority(now: number, admin: boolean) {
  return `s.expires_at>${now} AND s.auth_version=u.auth_version AND s.policy_version=${POLICY_VERSION_SQL}
  AND coalesce(u.banned,0)=0 AND coalesce(s.impersonated_by,'')='' AND s.auth_method='password'
  AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id=u.id)
  AND c.provider_id='credential' AND c.password IS NOT NULL
  AND (SELECT count(*) FROM accounts WHERE user_id=u.id AND provider_id='credential')=1
  AND s.auth_time BETWEEN ${now - RECENT_AUTHENTICATION_MS} AND ${now}
  AND (${POLICY_REQUIRE_MFA_SQL}=0 OR coalesce(u.two_factor_enabled,0)=1)
  AND (coalesce(u.two_factor_enabled,0)=0 OR (f.verified=1 AND s.second_factor_method IN ('totp','recovery_code')
    AND s.second_factor_time BETWEEN ${now - RECENT_AUTHENTICATION_MS} AND ${now}))
  ${admin ? "AND u.role='admin'" : ''}`;
}
/** This guard is evaluated inside every state transition, including writes after external network I/O. */
function actionAuthority(now: number, admin = false) {
  return `${baseAuthority(now, admin)} AND a.user_id=u.id AND a.auth_version=u.auth_version
    AND a.policy_version=${POLICY_VERSION_SQL} AND a.auth_time=s.auth_time AND a.factor_time IS s.second_factor_time
    AND a.factor_enabled=coalesce(u.two_factor_enabled,0) AND a.factor_id IS f.id
    AND a.recovery_version IS f.recovery_version AND a.proof_expires_at>${now}`;
}
async function authority(
  env: CloudflareBindings,
  sessionId: string,
  userId: string,
  admin = false
): Promise<Authority> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id,u.id AS user_id,u.auth_version,
    s.policy_version,c.id AS credential_id,f.id AS factor_id,coalesce(u.two_factor_enabled,0) AS factor_enabled,
    f.recovery_version,s.auth_time,s.second_factor_time AS factor_time
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN accounts c ON c.user_id=u.id AND c.provider_id='credential'
    LEFT JOIN two_factors f ON f.user_id=u.id WHERE s.id=? AND u.id=? AND ${baseAuthority(now, admin)}`
  )
    .bind(sessionId, userId)
    .first<Omit<Authority, 'proof_expires_at'>>();
  if (!row) denied('RECENT_AUTHENTICATION_REQUIRED', 403);
  return {
    ...row,
    proof_expires_at: Math.min(
      row.auth_time + RECENT_AUTHENTICATION_MS,
      row.factor_enabled
        ? (row.factor_time ?? 0) + RECENT_AUTHENTICATION_MS
        : Infinity
    ),
  };
}
export async function currentConfiguration(env: CloudflareBindings) {
  return env.DB.prepare(
    `SELECT c.enabled,c.login_enabled,c.provider_id,p.issuer,c.version,c.digest,c.generation FROM oidc_configuration c
    JOIN oidc_providers p ON p.id=c.provider_id WHERE c.id=1`
  ).first<Configuration>();
}
const matches = (
  c: Configuration | null,
  p: Pick<
    ProviderConfig,
    'id' | 'issuer' | 'version' | 'digest' | 'loginEnabled'
  >
) =>
  !!c &&
  !!c.enabled &&
  c.provider_id === p.id &&
  c.issuer === p.issuer &&
  c.version === p.version &&
  c.digest === p.digest &&
  !!c.login_enabled === p.loginEnabled;
async function requiredProvider(env: CloudflareBindings, ready: boolean) {
  const p = await providerFrom(env);
  if (!p) denied('OIDC_NOT_CONFIGURED', 409);
  const active = await currentConfiguration(env);
  if (ready && !matches(active, p)) denied('OIDC_PROVIDER_NOT_READY', 409);
  return { p, active };
}
function activeDTO(a: Configuration | null) {
  return a
    ? {
        id: a.provider_id,
        issuer: a.issuer,
        version: a.version,
        generation: a.generation,
        enabled: !!a.enabled,
        loginEnabled: !!a.login_enabled,
      }
    : null;
}
async function optionalProvider(env: CloudflareBindings) {
  try {
    return { provider: await providerFrom(env), configurationError: false };
  } catch (error) {
    if (!(error instanceof OidcError)) throw error;
    return { provider: null, configurationError: true };
  }
}
export async function ownStatus(
  env: CloudflareBindings,
  userId: string,
  sessionId: string
) {
  const { provider: p, configurationError } = await optionalProvider(env),
    active = await currentConfiguration(env);
  const bindings = (
    await env.DB.prepare(
      'SELECT id,provider_id,issuer,subject,user_id,active,revision,email,name FROM oidc_bindings WHERE user_id=? AND active=1 ORDER BY created_at,id'
    )
      .bind(userId)
      .all<Binding>()
  ).results.map(dto);
  return {
    sessionId,
    provider: p ? publicProvider(p) : null,
    ready: !!p && matches(active, p),
    configurationError,
    bindings,
  };
}
export async function adminStatus(env: CloudflareBindings, sessionId: string) {
  const { provider: p, configurationError } = await optionalProvider(env),
    a = await currentConfiguration(env);
  return {
    sessionId,
    configured: !!p,
    provider: p ? publicProvider(p) : null,
    ready: !!p && matches(a, p),
    configurationError,
    active: activeDTO(a),
  };
}
export async function preview(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  kind: 'link' | 'configure' | 'retire'
) {
  const configured = kind === 'retire' ? null : await providerFrom(env);
  if (kind !== 'retire' && !configured) denied('OIDC_NOT_CONFIGURED');
  const active = await currentConfiguration(env);
  if (kind === 'retire' && (!active || !active.enabled))
    denied('OIDC_ALREADY_RETIRED');
  if (kind === 'link' && (!configured || !matches(active, configured)))
    denied('OIDC_PROVIDER_NOT_READY');
  const p = configured ?? {
    id: active!.provider_id,
    issuer: active!.issuer,
    version: active!.version,
    digest: active!.digest,
    loginEnabled: !!active!.login_enabled,
  };
  if (kind === 'configure' && matches(active, p)) denied('OIDC_ALREADY_READY');
  if (kind === 'configure') {
    const known = await env.DB.prepare(
      'SELECT issuer,version FROM oidc_providers WHERE id=?'
    )
      .bind(p.id)
      .first<{ issuer: string; version: number }>();
    if (known && (known.issuer !== p.issuer || known.version >= p.version))
      denied('OIDC_PROVIDER_VERSION_CHANGED');
  }
  const a = await authority(env, sessionId, userId, kind !== 'link'),
    now = Date.now();
  const id = crypto.randomUUID(),
    capability = randomToken(),
    digest = await hashValue(capability);
  const expires = Math.min(now + 120_000, a.proof_expires_at),
    generation = active?.generation ?? 0;
  const result = await env.DB.prepare(
    `INSERT INTO oidc_link_actions
    (id,user_id,session_id,kind,status,provider_id,issuer,provider_version,provider_digest,configuration_generation,login_enabled,
    capability_hash,auth_version,policy_version,credential_id,factor_id,factor_enabled,recovery_version,
    auth_time,factor_time,proof_expires_at,expires_at,created_at)
    SELECT ?,u.id,s.id,?,'preview',?,?,?,?,?,?,?,u.auth_version,s.policy_version,c.id,f.id,coalesce(u.two_factor_enabled,0),
      f.recovery_version,s.auth_time,s.second_factor_time,?,?,? FROM sessions s JOIN users u ON u.id=s.user_id
      JOIN accounts c ON c.user_id=u.id AND c.provider_id='credential' LEFT JOIN two_factors f ON f.user_id=u.id
    WHERE s.id=? AND u.id=? AND ${baseAuthority(Date.now(), kind !== 'link')} AND ${GENERATION}=?
      AND u.auth_version=? AND s.policy_version=? AND c.id=? AND f.id IS ? AND f.recovery_version IS ?
      AND coalesce(u.two_factor_enabled,0)=? AND s.auth_time=? AND s.second_factor_time IS ?
    ON CONFLICT(user_id,kind) DO UPDATE SET id=excluded.id,session_id=excluded.session_id,status='preview',
      provider_id=excluded.provider_id,issuer=excluded.issuer,provider_version=excluded.provider_version,provider_digest=excluded.provider_digest,
      configuration_generation=excluded.configuration_generation,login_enabled=excluded.login_enabled,capability_hash=excluded.capability_hash,
      auth_version=excluded.auth_version,policy_version=excluded.policy_version,credential_id=excluded.credential_id,
      factor_id=excluded.factor_id,factor_enabled=excluded.factor_enabled,recovery_version=excluded.recovery_version,
      auth_time=excluded.auth_time,factor_time=excluded.factor_time,proof_expires_at=excluded.proof_expires_at,
      expires_at=excluded.expires_at,created_at=excluded.created_at,state_hash=NULL,cookie_hash=NULL,sealed=NULL,
      started_at=NULL,subject=NULL,email=NULL,name=NULL,binding_id=NULL,binding_revision=NULL,completed_at=NULL
    RETURNING id`
  )
    .bind(
      id,
      kind,
      p.id,
      p.issuer,
      p.version,
      p.digest,
      generation,
      Number(p.loginEnabled),
      digest,
      a.proof_expires_at,
      expires,
      now,
      sessionId,
      userId,
      generation,
      a.auth_version,
      a.policy_version,
      a.credential_id,
      a.factor_id,
      a.recovery_version,
      a.factor_enabled,
      a.auth_time,
      a.factor_time
    )
    .first();
  if (!result) denied();
  return {
    previewId: id,
    digest: capability,
    expiresAt: new Date(expires).toISOString(),
    ...(configured ? { provider: publicProvider(configured) } : {}),
    ...(kind !== 'link' ? { active: activeDTO(active) } : {}),
  };
}
function providerGuard(p: ProviderConfig, enabled = true) {
  return {
    sql: `a.provider_id=? AND a.issuer=? AND a.provider_version=? AND a.provider_digest=? AND a.configuration_generation=${GENERATION}
      ${enabled ? 'AND EXISTS (SELECT 1 FROM oidc_configuration WHERE id=1 AND enabled=1)' : ''}`,
    args: [p.id, p.issuer, p.version, p.digest],
  };
}
async function audit(
  env: CloudflareBindings,
  userId: string,
  action:
    'instance.oidc_configuration' | 'user.oidc_linked' | 'user.oidc_revoked',
  target: string,
  data: Record<string, unknown>
) {
  await recordAudit(drizzle(env.DB), {
    repositoryId: null,
    actorId: userId,
    action,
    target,
    data,
  });
}
export async function applyConfiguration(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string,
  digest: string
) {
  const { p } = await requiredProvider(env, false),
    g = providerGuard(p, false),
    now = Date.now();
  try {
    const result = await env.DB.prepare(
      `UPDATE oidc_link_actions AS a SET status='confirmed',completed_at=?,${CLEAN}
      WHERE a.id=? AND a.user_id=? AND a.session_id=? AND a.kind='configure' AND a.status='preview' AND a.capability_hash=?
      AND a.expires_at>? AND ${g.sql} AND EXISTS (SELECT 1 FROM oidc_link_actions a2 ${JOINS.replaceAll('a.', 'a2.')} WHERE a2.id=a.id AND ${actionAuthority(now, true).replaceAll('a.', 'a2.')}) RETURNING id`
    )
      .bind(now, id, userId, sessionId, await hashValue(digest), now, ...g.args)
      .first();
    if (!result) denied();
  } catch (e) {
    if (e instanceof OidcError) throw e;
    denied();
  }
  await audit(env, userId, 'instance.oidc_configuration', p.id, {
    providerId: p.id,
    version: p.version,
  });
  return { ready: true as const, provider: publicProvider(p) };
}
/** Retirement uses D1's active snapshot, so broken or missing deployment credentials cannot disable recovery. */
export async function retireConfiguration(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string,
  digest: string
) {
  const a = await env.DB.prepare(
    "SELECT * FROM oidc_link_actions WHERE id=? AND user_id=? AND session_id=? AND kind='retire'"
  )
    .bind(id, userId, sessionId)
    .first<Action>();
  if (!a) denied();
  const now = Date.now();
  try {
    const result = await env.DB.prepare(
      `UPDATE oidc_link_actions AS a SET status='confirmed',completed_at=?,${CLEAN}
      WHERE a.id=? AND a.user_id=? AND a.session_id=? AND a.kind='retire' AND a.status='preview' AND a.capability_hash=?
      AND a.expires_at>? AND a.configuration_generation=${GENERATION}
      AND EXISTS (SELECT 1 FROM oidc_configuration oc JOIN oidc_providers op ON op.id=oc.provider_id WHERE oc.id=1 AND oc.enabled=1
        AND oc.provider_id=a.provider_id AND op.issuer=a.issuer AND oc.version=a.provider_version AND oc.digest=a.provider_digest)
      AND EXISTS (SELECT 1 FROM oidc_link_actions a2 ${JOINS.replaceAll('a.', 'a2.')} WHERE a2.id=a.id AND ${actionAuthority(now, true).replaceAll('a.', 'a2.')}) RETURNING id`
    )
      .bind(now, id, userId, sessionId, await hashValue(digest), now)
      .first();
    if (!result) denied();
  } catch (error) {
    if (error instanceof OidcError) throw error;
    denied();
  }
  await audit(env, userId, 'instance.oidc_configuration', a.provider_id, {
    providerId: a.provider_id,
    enabled: false,
    generation: a.configuration_generation + 1,
  });
  return {
    ready: false as const,
    active: {
      id: a.provider_id,
      issuer: a.issuer,
      version: a.provider_version,
      generation: a.configuration_generation + 1,
      enabled: false as const,
    },
  };
}
function aad(
  a: Pick<Action, 'id' | 'user_id' | 'session_id' | 'provider_digest'>
) {
  return JSON.stringify([
    'cloudforge-oidc-link-v1',
    a.id,
    a.user_id,
    a.session_id,
    a.provider_digest,
  ]);
}
async function readAction(
  env: CloudflareBindings,
  id: string,
  userId: string,
  sessionId: string
) {
  return env.DB.prepare(
    "SELECT * FROM oidc_link_actions WHERE id=? AND user_id=? AND session_id=? AND kind='link'"
  )
    .bind(id, userId, sessionId)
    .first<Action>();
}
export function stateCookie(p: ProviderConfig, stateHash: string) {
  const secure = new URL(p.callbackUrl).protocol === 'https:';
  return {
    // HTTP responses may arrive out of order across tabs. An old start/callback must never
    // overwrite or delete a newer action's browser proof, even after its D1 slot was replaced.
    name: `${secure ? '__Secure-' : ''}cloudforge.oidc-link.${stateHash}`,
    path: new URL(p.callbackUrl).pathname,
    secure,
  };
}
async function failAction(
  env: CloudflareBindings,
  id: string,
  userId: string,
  sessionId: string,
  includeExchange = true
) {
  await env.DB.prepare(
    `UPDATE oidc_link_actions SET status='failed',${CLEAN},subject=NULL,email=NULL,name=NULL
    WHERE id=? AND user_id=? AND session_id=? AND status IN (${includeExchange ? "'await_callback','exchanging'" : "'await_callback'"})`
  )
    .bind(id, userId, sessionId)
    .run();
}
export async function start(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string,
  digest: string
) {
  const { p } = await requiredProvider(env, true),
    a = await readAction(env, id, userId, sessionId);
  if (!a) denied();
  const state = randomToken(),
    cookie = randomToken(),
    nonce = randomToken(),
    verifier = randomToken(),
    now = Date.now(),
    g = providerGuard(p);
  const sealed = await sealState(env, aad(a), { nonce, verifier });
  const stateHash = await hashValue(state);
  const expires = Math.min(now + 600_000, a.proof_expires_at);
  const result = await env.DB.prepare(
    `UPDATE oidc_link_actions AS a SET status='await_callback',state_hash=?,cookie_hash=?,sealed=?,
    capability_hash=NULL,expires_at=?,started_at=? WHERE a.id=? AND a.user_id=? AND a.session_id=? AND a.kind='link'
    AND a.status='preview' AND a.capability_hash=? AND a.expires_at>? AND ${g.sql}
    AND EXISTS (SELECT 1 FROM oidc_link_actions a2 ${JOINS.replaceAll('a.', 'a2.')} WHERE a2.id=a.id AND ${actionAuthority(now).replaceAll('a.', 'a2.')}) RETURNING id`
  )
    .bind(
      stateHash,
      await hashValue(cookie),
      sealed,
      expires,
      now,
      id,
      userId,
      sessionId,
      await hashValue(digest),
      now,
      ...g.args
    )
    .first();
  if (!result) denied();
  try {
    const authorizationUrl = await authorizationRequest(env, p, {
      state,
      nonce,
      verifier,
    });
    return {
      authorizationUrl,
      cookie: {
        ...stateCookie(p, stateHash),
        value: cookie,
        maxAge: Math.max(1, Math.floor((expires - Date.now()) / 1000)),
      },
    };
  } catch (e) {
    await failAction(env, id, userId, sessionId);
    throw e;
  }
}
export async function callback(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  providerId: string,
  state: string,
  cookie: string,
  code: string | null
) {
  const { p } = await requiredProvider(env, true);
  if (p.id !== providerId) denied('OIDC_CALLBACK_INVALID', 400);
  const a = await env.DB.prepare(
    "SELECT * FROM oidc_link_actions WHERE state_hash=? AND user_id=? AND session_id=? AND kind='link'"
  )
    .bind(await hashValue(state), userId, sessionId)
    .first<Action>();
  if (!a || !cookie || a.cookie_hash !== (await hashValue(cookie)))
    denied('OIDC_CALLBACK_INVALID', 400);
  const now = Date.now(),
    g = providerGuard(p);
  const claimed = await env.DB.prepare(
    `UPDATE oidc_link_actions AS a SET status='exchanging',capability_hash=NULL
    WHERE a.id=? AND a.status='await_callback' AND a.expires_at>? AND ${g.sql}
    AND EXISTS (SELECT 1 FROM oidc_link_actions a2 ${JOINS.replaceAll('a.', 'a2.')} WHERE a2.id=a.id AND ${actionAuthority(now).replaceAll('a.', 'a2.')}) RETURNING id`
  )
    .bind(a.id, now, ...g.args)
    .first();
  if (!claimed) {
    // A duplicate callback must not invalidate the request that already owns the exchange claim.
    await failAction(env, a.id, userId, sessionId, false);
    return { actionId: a.id, status: 'failed' as const };
  }
  try {
    if (!code || !a.sealed || !a.started_at)
      denied('OIDC_CALLBACK_INVALID', 400);
    const proof = await openState(env, aad(a), a.sealed);
    const identity = await exchangeIdentity(env, p, {
      ...proof,
      code,
      startedAt: a.started_at,
    });
    if (identity.issuer !== a.issuer || !identity.sub)
      denied('OIDC_CALLBACK_INVALID', 400);
    const at = Date.now(),
      expires = Math.min(
        a.expires_at,
        a.proof_expires_at,
        identity.expiresAt,
        at + 120_000
      );
    const saved = await env.DB.prepare(
      `UPDATE oidc_link_actions AS a SET status='candidate',subject=?,email=?,name=?,expires_at=?,${CLEAN}
      WHERE a.id=? AND a.status='exchanging' AND a.expires_at>? AND ?>? AND ${g.sql}
      AND EXISTS (SELECT 1 FROM oidc_link_actions a2 ${JOINS.replaceAll('a.', 'a2.')} WHERE a2.id=a.id AND ${actionAuthority(at).replaceAll('a.', 'a2.')}) RETURNING id`
    )
      .bind(
        identity.sub,
        identity.email,
        identity.name,
        expires,
        a.id,
        at,
        expires,
        at,
        ...g.args
      )
      .first();
    if (!saved) denied();
    return { actionId: a.id, status: 'candidate' as const };
  } catch {
    await failAction(env, a.id, userId, sessionId);
    return { actionId: a.id, status: 'failed' as const };
  }
}
export async function actionStatus(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string
) {
  const a = await readAction(env, id, userId, sessionId);
  if (!a) denied('OIDC_ACTION_NOT_FOUND', 404);
  const expired =
    a.expires_at <= Date.now() &&
    ['preview', 'await_callback', 'exchanging', 'candidate'].includes(a.status);
  const status = expired
    ? 'expired'
    : a.status === 'await_callback' ||
        a.status === 'exchanging' ||
        a.status === 'preview'
      ? 'pending'
      : a.status;
  return {
    sessionId,
    actionId: a.id,
    status,
    expiresAt: new Date(a.expires_at).toISOString(),
    identity:
      !expired && a.subject
        ? { issuer: a.issuer, subject: a.subject, email: a.email, name: a.name }
        : null,
  };
}
export async function confirm(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string
) {
  let a = await readAction(env, id, userId, sessionId);
  if (!a) denied('OIDC_ACTION_NOT_FOUND', 404);
  if (a.status !== 'confirmed') {
    const { p } = await requiredProvider(env, true),
      now = Date.now(),
      g = providerGuard(p);
    try {
      const result = await env.DB.prepare(
        `UPDATE oidc_link_actions AS a SET status='confirmed',binding_id=?,completed_at=?,${CLEAN}
        WHERE a.id=? AND a.user_id=? AND a.session_id=? AND a.status='candidate' AND a.kind='link' AND a.subject IS NOT NULL
        AND a.expires_at>? AND ${g.sql} AND EXISTS (SELECT 1 FROM oidc_link_actions a2 ${JOINS.replaceAll('a.', 'a2.')} WHERE a2.id=a.id AND ${actionAuthority(now).replaceAll('a.', 'a2.')}) RETURNING id`
      )
        .bind(crypto.randomUUID(), now, id, userId, sessionId, now, ...g.args)
        .first();
      if (!result) denied();
    } catch (e) {
      if (e instanceof OidcError) throw e;
      denied('OIDC_IDENTITY_UNAVAILABLE');
    }
    await audit(env, userId, 'user.oidc_linked', a.provider_id, {
      providerId: a.provider_id,
      actionId: id,
    });
    const receipt = await readAction(env, id, userId, sessionId);
    // A later explicit preview may replace the bounded slot. The binding already committed;
    // report a changed action so the caller reads current bindings instead of inventing a receipt.
    if (!receipt || receipt.status !== 'confirmed') denied();
    a = receipt;
  }
  const binding = await env.DB.prepare(
    'SELECT * FROM oidc_bindings WHERE id=? AND user_id=? AND revision=? AND active=1'
  )
    .bind(a.binding_id, userId, a.binding_revision)
    .first<Binding>();
  if (!binding) denied();
  return { binding: dto(binding) };
}
export async function cancel(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string
) {
  await env.DB.prepare(
    `UPDATE oidc_link_actions SET status='cancelled',${CLEAN},subject=NULL,email=NULL,name=NULL
    WHERE id=? AND user_id=? AND session_id=? AND kind='link' AND status IN ('preview','await_callback','exchanging','candidate')
      AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=oidc_link_actions.session_id
        AND u.id=oidc_link_actions.user_id AND s.expires_at>${Date.now()} AND s.auth_version=u.auth_version
        AND s.policy_version=${POLICY_VERSION_SQL} AND coalesce(u.banned,0)=0 AND coalesce(s.impersonated_by,'')=''
        AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id=u.id))`
  )
    .bind(id, userId, sessionId)
    .run();
  return { ok: true as const };
}
export async function revoke(
  env: CloudflareBindings,
  userId: string,
  sessionId: string,
  id: string,
  revision: number
) {
  const a = await authority(env, sessionId, userId),
    now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE oidc_bindings SET active=0,revision=revision+1,updated_at=?
    WHERE id=? AND user_id=? AND revision=? AND active=1 AND EXISTS
    (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN accounts c ON c.user_id=u.id AND c.provider_id='credential'
      LEFT JOIN two_factors f ON f.user_id=u.id WHERE s.id=? AND u.id=? AND ${baseAuthority(now, false)}
      AND u.auth_version=? AND s.policy_version=? AND c.id=? AND f.id IS ? AND f.recovery_version IS ?
      AND coalesce(u.two_factor_enabled,0)=? AND s.auth_time=? AND s.second_factor_time IS ?) RETURNING provider_id`
  )
    .bind(
      now,
      id,
      userId,
      revision,
      sessionId,
      userId,
      a.auth_version,
      a.policy_version,
      a.credential_id,
      a.factor_id,
      a.recovery_version,
      a.factor_enabled,
      a.auth_time,
      a.factor_time
    )
    .first<{ provider_id: string }>();
  if (!result) denied();
  await audit(env, userId, 'user.oidc_revoked', result.provider_id, {
    providerId: result.provider_id,
    bindingId: id,
  });
  return { ok: true as const };
}
