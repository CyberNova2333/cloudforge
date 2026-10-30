import type { GenericEndpointContext } from '@better-auth/core';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';
import { twoFactor } from 'better-auth/plugins';
import { createOTP } from '@better-auth/utils/otp';
import type { DrizzleDB } from '../db/middleware';
import { recordAudit } from '../lib/audit';
import {
  readSessionAuthentication,
  isCurrentSession,
  type SessionAuthentication,
} from './assurance';
import { POLICY_VERSION_SQL, readPolicy } from './policy';

const VERIFY_TOTP = '/two-factor/verify-totp';
const VERIFY_BACKUP = '/two-factor/verify-backup-code';
const DISABLE = '/two-factor/disable';
const REGENERATE = '/two-factor/generate-backup-codes';
const PROOF_MS = 5 * 60_000;
const ENABLE = '/two-factor/enable';
const REAUTHENTICATE = '/reauthenticate';
const REAUTHENTICATION_WINDOW_MS = 15 * 60_000;
const REAUTHENTICATION_ATTEMPTS = 10;
type TotpClaim = { id: string; secret: string; step: number };
type Generation = {
  userId: string;
  password: string;
  factorId: string | null;
  secret: string | null;
  authVersion: number;
  recoveryVersion: number | null;
  policyVersion: number;
};
type MfaContext = GenericEndpointContext['context'] & {
  cloudforgeTotp?: TotpClaim;
  cloudforgeGeneration?: Generation;
  cloudforgePasswordHash?: string;
  cloudforgePasswordVerifiedAt?: number;
  cloudforgeLoginSnapshot?: {
    userId: string;
    authVersion: number;
    policyVersion: number;
  };
  cloudforgeAuthentication?: SessionAuthentication;
  cloudforgeImpersonatedBy?: string;
  cloudforgeImpersonationPolicyVersion?: number;
  cloudforgeStepUp?: { id: string; secret: string };
  cloudforgePasswordChange?: boolean;
};

/** No browser, OAuth or administrator shortcut may replace the second factor. */
export const mfaSessionPaths = new Set([
  '/sign-in/email',
  '/sign-in/username',
  VERIFY_TOTP,
  VERIFY_BACKUP,
  DISABLE,
]);

function forbidden(message: string, code = 'MFA_VERIFICATION_REQUIRED'): never {
  throw new APIError('FORBIDDEN', { message, code });
}

async function generation(
  env: CloudflareBindings,
  userId: string
): Promise<Generation> {
  const row = await env.DB.prepare(
    `SELECT a.password, f.id AS factor_id, f.secret, u.auth_version, f.recovery_version,
    ${POLICY_VERSION_SQL} AS policy_version FROM accounts a JOIN users u ON u.id = a.user_id LEFT JOIN two_factors f ON f.user_id = a.user_id WHERE a.user_id = ? AND a.provider_id = 'credential'`
  )
    .bind(userId)
    .first<{
      password: string;
      factor_id: string | null;
      secret: string | null;
      auth_version: number;
      recovery_version: number | null;
      policy_version: number;
    }>();
  if (!row?.password) throw new APIError('UNAUTHORIZED');
  return {
    userId,
    password: row.password,
    factorId: row.factor_id,
    secret: row.secret,
    authVersion: row.auth_version,
    recoveryVersion: row.recovery_version,
    policyVersion: row.policy_version,
  };
}

async function fingerprint(value: Generation) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value))
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/** Exact credential/factor generation, checked at the write rather than only at request admission. */
function generationGuard(value: Generation) {
  return {
    sql: `${POLICY_VERSION_SQL} = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND auth_version = ? AND COALESCE(banned, 0) = 0) AND EXISTS (SELECT 1 FROM accounts WHERE user_id = ? AND provider_id = 'credential' AND password = ?) AND ${value.factorId ? 'EXISTS (SELECT 1 FROM two_factors WHERE user_id = ? AND id = ? AND secret = ? AND recovery_version = ?)' : 'NOT EXISTS (SELECT 1 FROM two_factors WHERE user_id = ?)'}`,
    args: value.factorId
      ? [
          value.policyVersion,
          value.userId,
          value.authVersion,
          value.userId,
          value.password,
          value.userId,
          value.factorId,
          value.secret,
          value.recoveryVersion,
        ]
      : [
          value.policyVersion,
          value.userId,
          value.authVersion,
          value.userId,
          value.password,
          value.userId,
        ],
  };
}

const signInPath = (path?: string) =>
  path === '/sign-in/email' || path === '/sign-in/username';
const changed = () =>
  new APIError('UNAUTHORIZED', {
    code: 'MFA_CHALLENGE_CHANGED',
    message: 'Sign in again after the account credentials changed.',
  });

/** The caller cannot inject or inherit proof through createSession overrides. */
export function authenticationForNewSession(
  context: GenericEndpointContext['context'],
  path: string | undefined,
  userId: string,
  authVersion: number,
  impersonatedBy?: string | null
) {
  const state = context as MfaContext;
  const empty = {
    authVersion,
    policyVersion: 0,
    authMethod: null as string | null,
    authTime: null as Date | null,
    secondFactorMethod: null as string | null,
    secondFactorTime: null as Date | null,
  };
  if (signInPath(path)) {
    const initial = state.cloudforgeLoginSnapshot;
    if (
      initial?.userId !== userId ||
      initial.authVersion !== authVersion ||
      !state.cloudforgePasswordHash
    )
      throw changed();
    // The native after hook may still replace this provisional row with a factor challenge.
    return empty;
  }
  if (
    impersonatedBy ||
    state.cloudforgeImpersonatedBy ||
    state.cloudforgeAuthentication?.authMethod === 'impersonation' ||
    path === '/admin/impersonate-user'
  )
    return {
      ...empty,
      authMethod: 'impersonation',
      authTime: new Date(),
      impersonatedBy: impersonatedBy ?? state.cloudforgeImpersonatedBy ?? null,
      policyVersion:
        state.cloudforgeImpersonationPolicyVersion ??
        state.cloudforgeAuthentication?.policyVersion ??
        0,
    };
  if (path === '/verify-email')
    return { ...empty, authMethod: 'email_verification', authTime: new Date() };
  const value = state.cloudforgeGeneration;
  if (value?.userId !== userId || value.authVersion !== authVersion) {
    if (
      path === VERIFY_TOTP ||
      path === VERIFY_BACKUP ||
      path === DISABLE ||
      path === '/change-password'
    )
      throw changed();
    return empty;
  }
  const previous = state.cloudforgeAuthentication;
  const policyVersion = previous?.policyVersion ?? value.policyVersion;
  const passwordTime =
    state.cloudforgePasswordVerifiedAt ??
    (previous?.authMethod === 'password' ? Number(previous.authTime) : null);
  const primary = passwordTime
    ? { authMethod: 'password', authTime: new Date(passwordTime) }
    : {
        authMethod: previous?.authMethod ?? null,
        authTime: previous?.authTime
          ? new Date(Number(previous.authTime))
          : null,
      };
  if (path === VERIFY_TOTP || path === VERIFY_BACKUP)
    return {
      ...empty,
      ...primary,
      // A signed-in single-factor step-up and first enrollment cannot acknowledge a newer policy.
      policyVersion,
      secondFactorMethod: path === VERIFY_TOTP ? 'totp' : 'recovery_code',
      secondFactorTime: new Date(),
    };
  if (path === '/change-password')
    return {
      ...empty,
      ...primary,
      policyVersion,
      secondFactorMethod: previous?.secondFactorMethod ?? null,
      secondFactorTime: previous?.secondFactorTime
        ? new Date(Number(previous.secondFactorTime))
        : null,
    };
  return { ...empty, ...primary, policyVersion };
}

function capturePassword(ctx: GenericEndpointContext, env: CloudflareBindings) {
  const password = ctx.context.password;
  ctx.context.password = {
    ...password,
    verify: async (input) => {
      const valid = await password.verify(input);
      if (!valid) return false;
      const state = ctx.context as MfaContext;
      state.cloudforgePasswordHash = input.hash;
      state.cloudforgePasswordVerifiedAt = Date.now();
      const value = state.cloudforgeGeneration;
      const active = ctx.context.session;
      if (
        !signInPath(ctx.path) &&
        value &&
        active?.user.id === value.userId &&
        !active.session.impersonatedBy &&
        state.cloudforgeAuthentication?.authMethod !== 'impersonation' &&
        input.hash === value.password
      ) {
        const guard = generationGuard(value);
        const recorded = await env.DB.prepare(
          `UPDATE sessions SET auth_method = 'password', auth_time = ?
        WHERE id = ? AND user_id = ? AND auth_version = ? AND expires_at > ? AND ${guard.sql} RETURNING id`
        )
          .bind(
            state.cloudforgePasswordVerifiedAt,
            active.session.id,
            value.userId,
            value.authVersion,
            Date.now(),
            ...guard.args
          )
          .first();
        if (!recorded) throw changed();
        if (state.cloudforgeAuthentication)
          state.cloudforgeAuthentication = {
            ...state.cloudforgeAuthentication,
            authMethod: 'password',
            authTime: state.cloudforgePasswordVerifiedAt,
          };
      }
      return true;
    },
  };
}

async function activeAuthentication(
  env: CloudflareBindings,
  sessionId: string,
  value: Generation
) {
  const record = await readSessionAuthentication(env, sessionId);
  if (
    !record ||
    record.userId !== value.userId ||
    record.banned ||
    record.expiresAt <= new Date() ||
    !isCurrentSession(record, { authVersion: record.userAuthVersion }) ||
    record.authVersion !== value.authVersion
  )
    throw changed();
  return record;
}

/** Only a guarded password update can rotate an already authenticated MFA session. */
export async function allowsMfaContinuation(
  env: CloudflareBindings,
  userId: string,
  path: string | undefined,
  context: GenericEndpointContext['context']
) {
  const state = context as MfaContext;
  const value = state.cloudforgeGeneration;
  if (
    path !== '/change-password' ||
    !state.cloudforgePasswordChange ||
    value?.userId !== userId
  )
    return false;
  const guard = generationGuard(value);
  return !!(await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`)
    .bind(...guard.args)
    .first());
}

async function preparePasswordChange(
  ctx: GenericEndpointContext,
  env: CloudflareBindings,
  db: DrizzleDB
) {
  const active = await getSessionFromCtx(ctx);
  if (!active) return;
  const initial = await generation(env, active.user.id);
  const state = ctx.context as MfaContext;
  const adapter = ctx.context.adapter;
  const internal = ctx.context.internalAdapter;
  state.cloudforgeGeneration = initial;
  state.cloudforgeAuthentication = await activeAuthentication(
    env,
    active.session.id,
    initial
  );
  state.cloudforgeImpersonatedBy = active.session.impersonatedBy ?? undefined;
  ctx.context.internalAdapter = {
    ...internal,
    updateAccount: async (
      id: string,
      data: Parameters<typeof internal.updateAccount>[1]
    ) => {
      if (typeof data.password !== 'string')
        return internal.updateAccount(id, data);
      if (
        state.cloudforgePasswordHash !== initial.password ||
        !state.cloudforgePasswordVerifiedAt
      )
        throw changed();
      const guard = generationGuard(initial);
      const next = {
        ...initial,
        password: data.password,
        authVersion: initial.authVersion + 1,
      };
      const nextGuard = generationGuard(next);
      const authentication = authenticationForNewSession(
        ctx.context,
        ctx.path,
        initial.userId,
        initial.authVersion,
        active.session.impersonatedBy
      );
      const now = Date.now();
      // Password hashing and verification can overlap an authenticator replacement. Commit
      // only while the session and both credential/factor generations that authorized it remain current.
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE accounts SET password = ?, updated_at = ? WHERE id = ? AND user_id = ? AND provider_id = 'credential' AND ${guard.sql} AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?) RETURNING id`
        ).bind(
          data.password,
          now,
          id,
          initial.userId,
          ...guard.args,
          active.session.id,
          initial.userId,
          now
        ),
        env.DB.prepare(
          `DELETE FROM verifications WHERE value = ? AND identifier LIKE '2fa-%' AND ${nextGuard.sql}`
        ).bind(initial.userId, ...nextGuard.args),
        env.DB.prepare(
          `DELETE FROM sessions WHERE user_id = ? AND id != ? AND ${nextGuard.sql}`
        ).bind(initial.userId, active.session.id, ...nextGuard.args),
        env.DB.prepare(
          `UPDATE sessions SET auth_version = ?, auth_method = ?, auth_time = ?, second_factor_method = ?, second_factor_time = ?
          WHERE id = ? AND user_id = ? AND auth_version = ? AND ${nextGuard.sql}`
        ).bind(
          next.authVersion,
          authentication.authMethod,
          authentication.authTime?.getTime() ?? null,
          authentication.secondFactorMethod,
          authentication.secondFactorTime?.getTime() ?? null,
          active.session.id,
          initial.userId,
          initial.authVersion,
          ...nextGuard.args
        ),
      ]);
      if (!results[0].results.length)
        throw new APIError('UNAUTHORIZED', {
          code: 'MFA_CHALLENGE_CHANGED',
          message: 'Sign in again after the account credentials changed.',
        });
      state.cloudforgeGeneration = next;
      state.cloudforgePasswordChange = true;
      await recordAudit(db, {
        repositoryId: null,
        actorId: initial.userId,
        action: 'user.password_set',
        target: `@${active.user.username ?? active.user.name}`,
        data: {},
      });
      return (await adapter.findOne({
        model: 'account',
        where: [{ field: 'id', value: id }],
      })) as Awaited<ReturnType<typeof internal.updateAccount>>;
    },
    deleteUserSessions: async (userId) => {
      const value = state.cloudforgeGeneration;
      if (!state.cloudforgePasswordChange || value?.userId !== userId)
        throw new APIError('UNAUTHORIZED');
      const guard = generationGuard(value);
      const removed = await env.DB.prepare(
        `DELETE FROM sessions WHERE user_id = ? AND ${guard.sql} RETURNING id`
      )
        .bind(userId, ...guard.args)
        .all();
      if (!removed.results.length)
        throw new APIError('UNAUTHORIZED', {
          code: 'MFA_CHALLENGE_CHANGED',
          message: 'Sign in again after the account credentials changed.',
        });
    },
    createSession: async (
      ...args: Parameters<typeof internal.createSession>
    ) => {
      const created = await internal.createSession(...args);
      const value = state.cloudforgeGeneration;
      if (!created || !state.cloudforgePasswordChange || !value)
        throw new APIError('UNAUTHORIZED');
      const guard = generationGuard(value);
      const valid = await env.DB.prepare(
        `SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND ${guard.sql} AND EXISTS (SELECT 1 FROM users WHERE id = sessions.user_id AND COALESCE(banned, 0) = 0)`
      )
        .bind(created.id, value.userId, ...guard.args)
        .first();
      if (!valid) {
        await internal.deleteSession(created.token);
        throw new APIError('UNAUTHORIZED', {
          code: 'MFA_CHALLENGE_CHANGED',
          message: 'Sign in again after the account credentials changed.',
        });
      }
      return created;
    },
  };
}

/** A challenge's companion expires with it and is removed by the same per-user password reset cleanup. */
export async function recordMfaChallenge(
  env: CloudflareBindings,
  verification: { identifier: string; value: string; expiresAt: Date },
  context: GenericEndpointContext['context']
) {
  if (
    !verification.identifier.startsWith('2fa-') ||
    verification.identifier.startsWith('2fa-attempts-')
  )
    return;
  const proven = (context as MfaContext).cloudforgeGeneration;
  const passwordTime = (context as MfaContext).cloudforgePasswordVerifiedAt;
  if (!proven || proven.userId !== verification.value || !passwordTime)
    throw new APIError('UNAUTHORIZED');
  await env.DB.prepare(
    'INSERT INTO verifications (id, identifier, value, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      `2fa-generation-v1-${verification.identifier}-${await fingerprint(proven)}`,
      verification.value,
      verification.expiresAt.getTime(),
      passwordTime
    )
    .run();
}

async function prepareVerification(
  ctx: GenericEndpointContext,
  env: CloudflareBindings
) {
  const session = await getSessionFromCtx(ctx);
  let userId = session?.user.id;
  let challengeId: string | undefined;
  if (!userId) {
    const cookie = ctx.context.createAuthCookie('two_factor');
    challengeId =
      (await ctx.getSignedCookie(cookie.name, ctx.context.secret)) || undefined;
    if (!challengeId) return;
    const challenge =
      await ctx.context.internalAdapter.findVerificationValue(challengeId);
    if (!challenge || challenge.expiresAt <= new Date()) return;
    userId = challenge.value;
  }
  const value = await generation(env, userId);
  if (!session && value.factorId) {
    const locked = await env.DB.prepare(
      'SELECT locked_until FROM two_factors WHERE id = ? AND secret = ?'
    )
      .bind(value.factorId, value.secret)
      .first<{ locked_until: number | null }>();
    if (locked?.locked_until && locked.locked_until > Date.now())
      throw new APIError('TOO_MANY_REQUESTS', {
        code: 'ACCOUNT_TEMPORARILY_LOCKED',
        message: 'Too many verification attempts. Try again later.',
      });
  }
  if (challengeId) {
    const companion = await env.DB.prepare(
      'SELECT id, created_at FROM verifications WHERE identifier = ? AND value = ? AND expires_at > ?'
    )
      .bind(
        `2fa-generation-v1-${challengeId}-${await fingerprint(value)}`,
        userId,
        Date.now()
      )
      .first<{ id: string; created_at: number }>();
    if (!companion)
      throw new APIError('UNAUTHORIZED', {
        code: 'MFA_CHALLENGE_CHANGED',
        message: 'Sign in again after the account credentials changed.',
      });
    (ctx.context as MfaContext).cloudforgePasswordVerifiedAt =
      companion.created_at;
  }
  (ctx.context as MfaContext).cloudforgeGeneration = value;
  if (session)
    (ctx.context as MfaContext).cloudforgeAuthentication =
      await activeAuthentication(env, session.session.id, value);
  if (session && value.factorId && value.secret) {
    // Reserve attempts before checking a code: concurrent requests cannot all pass an earlier counter read.
    const now = Date.now();
    const attempt = await env.DB.prepare(
      `UPDATE two_factors SET
      failed_verification_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1 ELSE COALESCE(failed_verification_count, 0) + 1 END,
      locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1 ELSE COALESCE(failed_verification_count, 0) + 1 END) >= 10 THEN ? ELSE NULL END
      WHERE id = ? AND secret = ? AND (locked_until IS NULL OR locked_until <= ?) AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ? AND auth_version = ?) AND ${generationGuard(value).sql} RETURNING id`
    )
      .bind(
        now,
        now,
        now + 900_000,
        value.factorId,
        value.secret,
        now,
        session.session.id,
        userId,
        now,
        value.authVersion,
        ...generationGuard(value).args
      )
      .first();
    if (!attempt)
      throw new APIError('TOO_MANY_REQUESTS', {
        code: 'ACCOUNT_TEMPORARILY_LOCKED',
        message: 'Too many verification attempts. Try again later.',
      });
    (ctx.context as MfaContext).cloudforgeStepUp = {
      id: value.factorId,
      secret: value.secret,
    };
  }
}

/** A successful TOTP is consumed once across all challenges and sessions, not merely per challenge. */
async function claimTotp(
  ctx: GenericEndpointContext,
  env: CloudflareBindings,
  live?: () => { sql: string; args: (string | number | null)[] }
) {
  const session = await getSessionFromCtx(ctx);
  let userId = session?.user.id;
  if (!userId) {
    const cookie = ctx.context.createAuthCookie('two_factor');
    const identifier = await ctx.getSignedCookie(
      cookie.name,
      ctx.context.secret
    );
    if (!identifier) return; // The upstream endpoint supplies its normal invalid-challenge error.
    const challenge =
      await ctx.context.internalAdapter.findVerificationValue(identifier);
    if (!challenge || challenge.expiresAt <= new Date()) return;
    userId = challenge.value;
  }
  const row = await env.DB.prepare(
    'SELECT id, secret, verified FROM two_factors WHERE user_id = ?'
  )
    .bind(userId)
    .first<{ id: string; secret: string; verified: number }>();
  if (!row || (!session && !row.verified) || typeof ctx.body?.code !== 'string')
    return;
  const secret = await symmetricDecrypt({
    key: ctx.context.secretConfig,
    data: row.secret,
  });
  const otp = createOTP(secret, { digits: 6, period: 30 });
  const step = Math.floor(Date.now() / 30_000);
  // Match exactly the upstream ±1 window, choosing the latest matching step if codes collide.
  let matched = -1;
  for (let offset = -1; offset <= 1; offset++) {
    const expected = await otp.hotp(step + offset);
    let difference = ctx.body.code.length ^ expected.length;
    for (let i = 0; i < expected.length; i++)
      difference |= ctx.body.code.charCodeAt(i) ^ expected.charCodeAt(i);
    if (difference === 0) matched = step + offset;
  }
  if (matched < 0) return; // Let upstream count the invalid attempt and apply its account lock.
  const value = (ctx.context as MfaContext).cloudforgeGeneration;
  if (!value) throw changed();
  const guard = generationGuard(value);
  const current = live?.();
  const consumed = await env.DB.prepare(
    `UPDATE two_factors SET last_totp_step = ? WHERE id = ? AND secret = ? AND last_totp_step < ? AND ${guard.sql}${current ? ` AND ${current.sql}` : ''} RETURNING id`
  )
    .bind(
      matched,
      row.id,
      row.secret,
      matched,
      ...guard.args,
      ...(current?.args ?? [])
    )
    .first();
  if (!consumed)
    forbidden(
      'This authenticator code was already used. Wait for the next code.',
      'TOTP_ALREADY_USED'
    );
  (ctx.context as MfaContext).cloudforgeTotp = {
    id: row.id,
    secret: row.secret,
    step: matched,
  };
}

/** Bound the expensive password verification across every browser and IP for this account. */
async function reserveReauthenticationAttempt(
  env: CloudflareBindings,
  userId: string
) {
  const now = Date.now();
  const reserved = await env.DB.prepare(
    `INSERT INTO rate_limits (id, key, count, last_request) VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN last_request <= ? THEN 1 ELSE count + 1 END,
      last_request = CASE WHEN last_request <= ? THEN excluded.last_request ELSE last_request END
    WHERE last_request <= ? OR count < ? RETURNING id`
  )
    .bind(
      crypto.randomUUID(),
      `cloudforge:reauthentication:${userId}`,
      now,
      now - REAUTHENTICATION_WINDOW_MS,
      now - REAUTHENTICATION_WINDOW_MS,
      now - REAUTHENTICATION_WINDOW_MS,
      REAUTHENTICATION_ATTEMPTS
    )
    .first();
  if (!reserved)
    throw new APIError('TOO_MANY_REQUESTS', {
      code: 'REAUTHENTICATION_RATE_LIMITED',
      message: 'Too many verification attempts. Try again later.',
    });
}

/** Every proof and factor-consumption write rechecks the original live browser and account. */
function reauthenticationGuard(
  sessionId: string,
  value: Generation,
  enabled: boolean
) {
  return {
    sql: `EXISTS (SELECT 1 FROM sessions reauth_session JOIN users reauth_user ON reauth_user.id = reauth_session.user_id
      WHERE reauth_session.id = ? AND reauth_session.user_id = ? AND reauth_session.auth_version = ?
      AND reauth_user.auth_version = ? AND reauth_session.expires_at > ? AND COALESCE(reauth_user.banned, 0) = 0
      AND COALESCE(reauth_session.impersonated_by, '') = '' AND COALESCE(reauth_session.auth_method, '') != 'impersonation'
      AND COALESCE(reauth_user.two_factor_enabled, 0) = ?)
      ${enabled ? 'AND EXISTS (SELECT 1 FROM two_factors WHERE user_id = ? AND id = ? AND secret = ? AND verified = 1)' : ''}`,
    args: [
      sessionId,
      value.userId,
      value.authVersion,
      value.authVersion,
      Date.now(),
      enabled ? 1 : 0,
      ...(enabled ? [value.userId, value.factorId, value.secret] : []),
    ],
  };
}

/** Same encrypted backup-code codec and compare-and-swap as the maintained plugin, with our live generation fence. */
async function claimReauthenticationRecoveryCode(
  ctx: GenericEndpointContext,
  env: CloudflareBindings,
  value: Generation,
  sessionId: string
) {
  const row = await env.DB.prepare(
    'SELECT backup_codes FROM two_factors WHERE id = ? AND user_id = ? AND secret = ? AND verified = 1'
  )
    .bind(value.factorId, value.userId, value.secret)
    .first<{ backup_codes: string }>();
  if (!row) throw changed();
  const unavailable = () =>
    new APIError('INTERNAL_SERVER_ERROR', {
      code: 'REAUTHENTICATION_FACTOR_UNAVAILABLE',
      message: 'The recovery codes could not be verified.',
    });
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      await symmetricDecrypt({
        key: ctx.context.secretConfig,
        data: row.backup_codes,
      })
    );
  } catch {
    throw unavailable();
  }
  if (
    !Array.isArray(decoded) ||
    !decoded.every((code) => typeof code === 'string')
  )
    throw unavailable();
  if (!decoded.includes(ctx.body?.code))
    throw new APIError('UNAUTHORIZED', {
      code: 'REAUTHENTICATION_INVALID_FACTOR',
      message: 'The authenticator or recovery code is invalid.',
    });
  const next = await symmetricEncrypt({
    key: ctx.context.secretConfig,
    data: JSON.stringify(decoded.filter((code) => code !== ctx.body?.code)),
  });
  const guard = generationGuard(value);
  const live = reauthenticationGuard(sessionId, value, true);
  const consumed = await env.DB.prepare(
    `UPDATE two_factors SET backup_codes = ? WHERE id = ? AND backup_codes = ? AND ${guard.sql} AND ${live.sql} RETURNING id`
  )
    .bind(next, value.factorId, row.backup_codes, ...guard.args, ...live.args)
    .first();
  if (!consumed) throw changed();
}

async function reauthenticate(
  ctx: GenericEndpointContext,
  env: CloudflareBindings,
  db: DrizzleDB
) {
  if (!ctx.headers?.get('cookie')) throw new APIError('UNAUTHORIZED');
  const active = await getSessionFromCtx(ctx);
  if (!active) throw new APIError('UNAUTHORIZED');
  if (ctx.body?.sessionId !== active.session.id)
    forbidden(
      'The signed-in session changed. Start verification again.',
      'REAUTHENTICATION_SESSION_MISMATCH'
    );
  const value = await generation(env, active.user.id);
  const authentication = await activeAuthentication(
    env,
    active.session.id,
    value
  );
  if (
    active.session.impersonatedBy ||
    authentication.authMethod === 'impersonation'
  )
    forbidden(
      'Stop impersonating before verifying your identity.',
      'REAUTHENTICATION_IMPERSONATION_FORBIDDEN'
    );
  const user = await env.DB.prepare(
    'SELECT two_factor_enabled FROM users WHERE id = ?'
  )
    .bind(value.userId)
    .first<{ two_factor_enabled: number }>();
  if (!user) throw changed();
  const enabled = !!user.two_factor_enabled;
  await reserveReauthenticationAttempt(env, value.userId);
  // Deliberately do not use capturePassword: a failed second factor must not refresh the primary evidence.
  if (
    !(await ctx.context.password.verify({
      hash: value.password,
      password: ctx.body.password,
    }))
  )
    throw new APIError('UNAUTHORIZED', {
      code: 'REAUTHENTICATION_INVALID_PASSWORD',
      message: 'The password is invalid.',
    });
  const passwordTime = Date.now();
  if (enabled) {
    if (!ctx.body?.method || !ctx.body?.code)
      forbidden(
        'Verify your current authenticator or a recovery code as well.',
        'REAUTHENTICATION_FACTOR_REQUIRED'
      );
    await prepareVerification(ctx, env);
    if (
      JSON.stringify((ctx.context as MfaContext).cloudforgeGeneration) !==
      JSON.stringify(value)
    )
      throw changed();
    if (ctx.body.method === 'totp') {
      await claimTotp(ctx, env, () =>
        reauthenticationGuard(active.session.id, value, true)
      );
      if (!(ctx.context as MfaContext).cloudforgeTotp)
        throw new APIError('UNAUTHORIZED', {
          code: 'REAUTHENTICATION_INVALID_FACTOR',
          message: 'The authenticator or recovery code is invalid.',
        });
    } else
      await claimReauthenticationRecoveryCode(
        ctx,
        env,
        value,
        active.session.id
      );
  }
  const guard = generationGuard(value);
  const live = reauthenticationGuard(active.session.id, value, enabled);
  const proof = env.DB.prepare(
    `UPDATE sessions SET auth_method = 'password', auth_time = ?, second_factor_method = ?, second_factor_time = ?, policy_version = ?
    WHERE id = ? AND user_id = ? AND ${guard.sql} AND ${live.sql} RETURNING id`
  ).bind(
    passwordTime,
    enabled ? ctx.body.method : null,
    enabled ? Date.now() : null,
    value.policyVersion,
    active.session.id,
    value.userId,
    ...guard.args,
    ...live.args
  );
  const statements = [proof];
  statements.push(
    env.DB.prepare(
      `UPDATE rate_limits SET count = 0, last_request = ? WHERE key = ? AND ${guard.sql} AND ${live.sql}`
    ).bind(
      Date.now(),
      `cloudforge:reauthentication:${value.userId}`,
      ...guard.args,
      ...live.args
    )
  );
  if (enabled)
    statements.push(
      env.DB.prepare(
        `UPDATE two_factors SET failed_verification_count = 0, locked_until = NULL
      WHERE id = ? AND secret = ? AND ${guard.sql} AND ${live.sql}`
      ).bind(value.factorId, value.secret, ...guard.args, ...live.args)
    );
  // Only a complete, live proof clears both budgets, in the same transaction as the evidence.
  const [verified] = await env.DB.batch(statements);
  if (!verified.results.length) throw changed();
  await recordAudit(db, {
    repositoryId: null,
    actorId: value.userId,
    action: 'user.reauthenticated',
    target: `@${active.user.username ?? active.user.name}`,
    data: { reauthentication: true, factor: enabled ? ctx.body.method : null },
  });
  return ctx.json({ status: true, sessionId: active.session.id });
}

/** Activation, its proven secret and revocation commit together in D1's transactional batch. */
export async function activateMfa(
  env: CloudflareBindings,
  userId: string,
  context: GenericEndpointContext['context']
) {
  const claim = (context as MfaContext).cloudforgeTotp;
  const active = context.session?.session;
  const proven = (context as MfaContext).cloudforgeGeneration;
  if (!claim || !active || !proven)
    forbidden('Verify the current authenticator setup first.');
  const guard = `SELECT 1 FROM two_factors WHERE id = ? AND user_id = ? AND secret = ? AND last_totp_step = ? AND ${POLICY_VERSION_SQL} = ?`;
  const args = [
    claim.id,
    userId,
    claim.secret,
    claim.step,
    proven.policyVersion,
  ];
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET two_factor_enabled = 1 WHERE id = ? AND auth_version = ? AND COALESCE(two_factor_enabled, 0) = 0 AND EXISTS (${guard} AND verified = 0) AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ? AND auth_version = ?) AND EXISTS (SELECT 1 FROM accounts WHERE user_id = ? AND provider_id = 'credential' AND password = ?) RETURNING id`
    ).bind(
      userId,
      proven.authVersion,
      ...args,
      active.id,
      userId,
      Date.now(),
      proven.authVersion,
      userId,
      proven.password
    ),
    env.DB.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND EXISTS (${guard} AND verified = 0) AND EXISTS (SELECT 1 FROM users WHERE id = ? AND two_factor_enabled = 1)`
    ).bind(userId, ...args, userId),
    env.DB.prepare(
      `DELETE FROM verifications WHERE value = ? AND identifier LIKE '2fa-%' AND EXISTS (${guard} AND verified = 0) AND EXISTS (SELECT 1 FROM users WHERE id = ? AND two_factor_enabled = 1)`
    ).bind(userId, ...args, userId),
    env.DB.prepare(
      `UPDATE two_factors SET verified = 1 WHERE id = ? AND user_id = ? AND secret = ? AND last_totp_step = ? AND ${POLICY_VERSION_SQL} = ? AND verified = 0 AND EXISTS (SELECT 1 FROM users WHERE id = ? AND two_factor_enabled = 1)`
    ).bind(...args, userId),
  ]);
  if (!results[0].results.length)
    forbidden('Authenticator setup changed. Start again.', 'MFA_SETUP_CHANGED');
  (context as MfaContext).cloudforgeGeneration = {
    ...proven,
    authVersion: proven.authVersion + 1,
  };
}

/** Extra policy around the maintained plugin; its encryption, challenge and backup-code CAS stay upstream. */
export function cloudforgeTwoFactor(db: DrizzleDB, env?: CloudflareBindings) {
  const plugin = twoFactor({
    issuer: 'CloudForge',
    twoFactorCookieMaxAge: 600,
    backupCodeOptions: { storeBackupCodes: 'encrypted', length: 20 },
  });
  return {
    ...plugin,
    endpoints: {
      ...plugin.endpoints,
      reauthenticate: createAuthEndpoint(
        REAUTHENTICATE,
        {
          method: 'POST',
          body: z
            .object({
              sessionId: z.string().min(1).max(256),
              password: z.string().min(1).max(128),
              method: z.enum(['totp', 'recovery_code']).optional(),
              code: z.string().min(1).max(128).optional(),
            })
            .strict(),
          metadata: { noStore: true },
        },
        async (ctx) => {
          if (!env) throw new APIError('UNAUTHORIZED');
          return reauthenticate(ctx, env, db);
        }
      ),
    },
    schema: {
      ...plugin.schema,
      user: {
        ...plugin.schema.user,
        fields: {
          ...plugin.schema.user.fields,
          authVersion: {
            type: 'number' as const,
            required: true,
            defaultValue: 0,
            input: false,
            returned: false,
          },
        },
      },
      session: {
        fields: {
          policyVersion: {
            type: 'number' as const,
            required: true,
            defaultValue: 0,
            input: false,
            returned: false,
          },
          authVersion: {
            type: 'number' as const,
            required: true,
            defaultValue: 0,
            input: false,
            returned: false,
          },
          authMethod: {
            type: 'string' as const,
            required: false,
            input: false,
            returned: false,
          },
          authTime: {
            type: 'date' as const,
            required: false,
            input: false,
            returned: false,
          },
          secondFactorMethod: {
            type: 'string' as const,
            required: false,
            input: false,
            returned: false,
          },
          secondFactorTime: {
            type: 'date' as const,
            required: false,
            input: false,
            returned: false,
          },
          mfaVerifiedAt: {
            type: 'date' as const,
            required: false,
            input: false,
            returned: false,
          },
        },
      },
      twoFactor: {
        ...plugin.schema.twoFactor,
        fields: {
          ...plugin.schema.twoFactor.fields,
          userId: {
            ...plugin.schema.twoFactor.fields.userId,
            unique: true,
            index: false,
          },
          lastTotpStep: {
            type: 'number' as const,
            required: true,
            defaultValue: 0,
            input: false,
            returned: false,
          },
          recoveryVersion: {
            type: 'number' as const,
            required: true,
            defaultValue: 0,
            input: false,
            returned: false,
          },
        },
      },
    },
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) =>
            !!ctx.path?.startsWith('/two-factor/') ||
            ctx.path === '/sign-in/email' ||
            ctx.path === '/sign-in/username' ||
            ctx.path === '/change-password',
          handler: createAuthMiddleware(async (ctx) => {
            if (!env) return;
            if (ctx.path === DISABLE && (await readPolicy(env)).requireMfa)
              forbidden(
                'Two-factor authentication is required by the instance policy.',
                'AUTHENTICATION_POLICY_MFA_REQUIRED'
              );
            capturePassword(ctx, env);
            if (ctx.path === '/change-password') {
              await preparePasswordChange(ctx, env, db);
              return;
            }
            if (
              ctx.path === '/sign-in/email' ||
              ctx.path === '/sign-in/username'
            ) {
              const field =
                ctx.path === '/sign-in/email' ? 'email' : 'username';
              const supplied = ctx.body?.[field];
              if (typeof supplied === 'string') {
                const snapshot = await env.DB.prepare(
                  `SELECT id, auth_version, ${POLICY_VERSION_SQL} AS policy_version FROM users WHERE ${field} = ?`
                )
                  .bind(supplied.toLowerCase())
                  .all<{
                    id: string;
                    auth_version: number;
                    policy_version: number;
                  }>();
                if (snapshot.results.length === 1)
                  (ctx.context as MfaContext).cloudforgeLoginSnapshot = {
                    userId: snapshot.results[0].id,
                    authVersion: snapshot.results[0].auth_version,
                    policyVersion: snapshot.results[0].policy_version,
                  };
              }
              // Do not honor a previously issued trusted-device exception if one exists.
              const trustCookie = ctx.context.createAuthCookie('trust_device');
              const trusted = await ctx.getSignedCookie(
                trustCookie.name,
                ctx.context.secret
              );
              const identifier =
                typeof trusted === 'string' ? trusted.split('!')[1] : undefined;
              if (identifier?.startsWith('trust-device-'))
                await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                  identifier
                );
              return;
            }
            ctx.setHeader('cache-control', 'no-store');
            if (ctx.body?.trustDevice === true)
              forbidden(
                'Trusted devices are not enabled.',
                'TRUST_DEVICE_DISABLED'
              );
            if (ctx.body?.disableSession === true)
              forbidden(
                'Complete the sign-in challenge.',
                'MFA_SESSION_REQUIRED'
              );
            if (
              ctx.path === '/two-factor/get-totp-uri' ||
              ctx.path === '/two-factor/send-otp' ||
              ctx.path === '/two-factor/verify-otp'
            )
              throw new APIError('NOT_FOUND');
            const state = ctx.context as MfaContext;
            const adapter = ctx.context.adapter;
            const internal = ctx.context.internalAdapter;
            const active = await getSessionFromCtx(ctx);
            if (ctx.path === VERIFY_TOTP || ctx.path === VERIFY_BACKUP)
              await prepareVerification(ctx, env);
            else if (active)
              state.cloudforgeGeneration = await generation(
                env,
                active.user.id
              );
            if (active && state.cloudforgeGeneration)
              state.cloudforgeAuthentication = await activeAuthentication(
                env,
                active.session.id,
                state.cloudforgeGeneration
              );
            state.cloudforgeImpersonatedBy =
              active?.session.impersonatedBy ?? undefined;
            // New sessions exist before their token is sent. Recheck the proof generation after the
            // insert, so account changes either invalidate this check or revoke the already-written row.
            ctx.context.internalAdapter = {
              ...internal,
              createSession: async (
                ...args: Parameters<typeof internal.createSession>
              ) => {
                const created = await internal.createSession(...args);
                const value = state.cloudforgeGeneration;
                if (!created || !value) throw new APIError('UNAUTHORIZED');
                const guard = generationGuard(value);
                const valid = await env.DB.prepare(
                  `SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND ${guard.sql} AND EXISTS (SELECT 1 FROM users WHERE id = sessions.user_id AND COALESCE(banned, 0) = 0)`
                )
                  .bind(created.id, value.userId, ...guard.args)
                  .first();
                if (!valid) {
                  await internal.deleteSession(created.token);
                  throw new APIError('UNAUTHORIZED', {
                    code: 'MFA_CHALLENGE_CHANGED',
                    message:
                      'Sign in again after the account credentials changed.',
                  });
                }
                return created;
              },
              updateUser: async <T extends Record<string, any>>(
                userId: string,
                data: Parameters<typeof internal.updateUser>[1]
              ) => {
                if (data.twoFactorEnabled === undefined)
                  return internal.updateUser<T>(userId, data);
                if (!active || active.user.id !== userId)
                  throw new APIError('UNAUTHORIZED');
                const value = state.cloudforgeGeneration;
                if (!value) throw new APIError('UNAUTHORIZED');
                if (
                  ctx.path === VERIFY_TOTP &&
                  data.twoFactorEnabled === true
                ) {
                  await activateMfa(env, userId, ctx.context);
                } else if (
                  ctx.path === DISABLE &&
                  data.twoFactorEnabled === false
                ) {
                  const guard = generationGuard(value);
                  const guardArgs = [...guard.args];
                  const next = { ...value, authVersion: value.authVersion + 1 };
                  const nextGuard = generationGuard(next);
                  const results = await env.DB.batch([
                    env.DB.prepare(
                      `UPDATE users SET two_factor_enabled = 0 WHERE id = ? AND two_factor_enabled = 1 AND COALESCE((SELECT require_mfa FROM authentication_policy WHERE id = 1), 0) = 0 AND ${guard.sql} AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?) RETURNING id`
                    ).bind(
                      userId,
                      ...guardArgs,
                      active.session.id,
                      userId,
                      Date.now()
                    ),
                    env.DB.prepare(
                      `DELETE FROM sessions WHERE user_id = ? AND ${nextGuard.sql} AND EXISTS (SELECT 1 FROM users WHERE id = ? AND two_factor_enabled = 0)`
                    ).bind(userId, ...nextGuard.args, userId),
                    env.DB.prepare(
                      `DELETE FROM verifications WHERE value = ? AND identifier LIKE '2fa-%' AND ${nextGuard.sql} AND EXISTS (SELECT 1 FROM users WHERE id = ? AND two_factor_enabled = 0)`
                    ).bind(userId, ...nextGuard.args, userId),
                    env.DB.prepare(
                      `DELETE FROM two_factors WHERE id = ? AND user_id = ? AND secret = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND two_factor_enabled = 0)`
                    ).bind(value.factorId, userId, value.secret, userId),
                  ]);
                  if (!results[0].results.length)
                    forbidden(
                      'The account or authenticator changed. Verify again.',
                      'MFA_SETUP_CHANGED'
                    );
                  state.cloudforgeGeneration = {
                    ...next,
                    factorId: null,
                    secret: null,
                    recoveryVersion: null,
                  };
                } else
                  forbidden(
                    'Use the two-factor authentication settings.',
                    'MFA_SETTINGS_REQUIRED'
                  );
                const updated = await adapter.findOne<typeof active.user>({
                  model: 'user',
                  where: [{ field: 'id', value: userId }],
                });
                if (!updated) throw new APIError('UNAUTHORIZED');
                await recordAudit(db, {
                  repositoryId: null,
                  actorId: userId,
                  action: data.twoFactorEnabled
                    ? 'user.mfa_enabled'
                    : 'user.mfa_disabled',
                  target: `@${updated.username ?? updated.name}`,
                  data: {},
                });
                return updated as Awaited<
                  ReturnType<typeof internal.updateUser<T>>
                >;
              },
            };
            if (ctx.path === ENABLE) {
              if (ctx.body?.method && ctx.body.method !== 'totp')
                forbidden('Use an authenticator app.', 'TOTP_REQUIRED');
              const session = await getSessionFromCtx(ctx);
              if (session?.user.twoFactorEnabled)
                forbidden(
                  'Disable two-factor authentication before replacing its secret.',
                  'TOTP_ALREADY_ENABLED'
                );
              // Upstream first reads an unverified setup and later updates it. Guard the write itself,
              // so it cannot replace a secret that a concurrent verification has just activated.
              ctx.context.adapter = {
                ...adapter,
                create: async <T extends Record<string, any>, R = T>(args: {
                  model: string;
                  data: Omit<T, 'id'>;
                  select?: string[];
                  forceAllowId?: boolean;
                }) => {
                  if (args.model !== 'twoFactor')
                    return adapter.create<T, R>(args);
                  if (!active) throw new APIError('UNAUTHORIZED');
                  const value = state.cloudforgeGeneration;
                  if (!value) throw new APIError('UNAUTHORIZED');
                  const guard = generationGuard(value);
                  const id = crypto.randomUUID();
                  const result = await env.DB.prepare(
                    `INSERT INTO two_factors (id, user_id, secret, backup_codes, verified) SELECT ?, ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?) AND EXISTS (SELECT 1 FROM users WHERE id = ? AND COALESCE(two_factor_enabled, 0) = 0) AND ${guard.sql} ON CONFLICT(user_id) DO NOTHING RETURNING id`
                  )
                    .bind(
                      id,
                      active.user.id,
                      args.data.secret,
                      args.data.backupCodes,
                      active.session.id,
                      active.user.id,
                      Date.now(),
                      active.user.id,
                      ...guard.args
                    )
                    .first();
                  if (!result)
                    forbidden(
                      'Authenticator setup changed. Start again.',
                      'MFA_SETUP_CHANGED'
                    );
                  return { ...args.data, id } as R;
                },
                update: async <T>(
                  args: Parameters<typeof adapter.update>[0]
                ) => {
                  if (args.model !== 'twoFactor')
                    return adapter.update<T>(args);
                  if (!active) throw new APIError('UNAUTHORIZED');
                  const value = state.cloudforgeGeneration;
                  if (!value) throw new APIError('UNAUTHORIZED');
                  const guard = generationGuard(value);
                  const id = args.where.find(
                    (condition) => condition.field === 'id'
                  )?.value;
                  const updated = await env.DB.prepare(
                    `UPDATE two_factors SET secret = ?, backup_codes = ?, verified = 0, last_totp_step = 0, failed_verification_count = 0, locked_until = NULL WHERE id = ? AND user_id = ? AND verified = 0 AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?) AND EXISTS (SELECT 1 FROM users WHERE id = ? AND COALESCE(two_factor_enabled, 0) = 0) AND ${guard.sql} RETURNING id`
                  )
                    .bind(
                      args.update.secret,
                      args.update.backupCodes,
                      id,
                      active.user.id,
                      active.session.id,
                      active.user.id,
                      Date.now(),
                      active.user.id,
                      ...guard.args
                    )
                    .first();
                  if (!updated)
                    forbidden(
                      'Authenticator setup changed. Start again.',
                      'MFA_SETUP_CHANGED'
                    );
                  return { ...args.update, id } as T;
                },
              };
            }
            if (ctx.path === DISABLE || ctx.path === REGENERATE) {
              const session = await getSessionFromCtx(ctx);
              if (!session) throw new APIError('UNAUTHORIZED');
              const value = state.cloudforgeGeneration;
              if (!value?.factorId || !value.secret)
                forbidden('Verify the current authenticator first.');
              const proof = await env.DB.prepare(
                'UPDATE sessions SET mfa_verified_at = NULL WHERE id = ? AND user_id = ? AND expires_at > ? AND mfa_verified_at >= ? AND auth_version = ? RETURNING id'
              )
                .bind(
                  session.session.id,
                  session.user.id,
                  Date.now(),
                  Date.now() - PROOF_MS,
                  value.authVersion
                )
                .first();
              if (!proof)
                forbidden(
                  'Verify your authenticator code or a recovery code before changing two-factor authentication.'
                );
              ctx.context.adapter = {
                ...adapter,
                delete: async (args) => {
                  // The atomic disable above already removed exactly the proven generation.
                  if (ctx.path === DISABLE && args.model === 'twoFactor')
                    return;
                  return adapter.delete(args);
                },
                update: async <T>(
                  args: Parameters<typeof adapter.update>[0]
                ) => {
                  if (ctx.path !== REGENERATE || args.model !== 'twoFactor')
                    return adapter.update<T>(args);
                  const guard = generationGuard(value);
                  const changed = await env.DB.prepare(
                    `UPDATE two_factors SET backup_codes = ?, recovery_version = recovery_version + 1 WHERE id = ? AND secret = ? AND ${guard.sql} AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?) RETURNING id`
                  )
                    .bind(
                      args.update.backupCodes,
                      value.factorId,
                      value.secret,
                      ...guard.args,
                      session.session.id,
                      session.user.id,
                      Date.now()
                    )
                    .first();
                  if (!changed)
                    forbidden(
                      'The account or authenticator changed. Verify again.',
                      'MFA_SETUP_CHANGED'
                    );
                  return { ...args.update, id: value.factorId } as T;
                },
              };
            }
            if (ctx.path === VERIFY_TOTP) {
              await claimTotp(ctx, env);
              ctx.context.adapter = {
                ...adapter,
                update: async <T>(
                  args: Parameters<typeof adapter.update>[0]
                ) => {
                  // Activation already commits verified=true together with the user's flag.
                  if (
                    args.model === 'twoFactor' &&
                    args.update.verified === true
                  )
                    return {
                      ...args.update,
                      id: state.cloudforgeTotp?.id,
                    } as T;
                  return adapter.update<T>(args);
                },
              };
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) =>
            ctx.path === '/sign-in/email' || ctx.path === '/sign-in/username',
          handler: createAuthMiddleware(async (ctx) => {
            const session = ctx.context.newSession;
            if (!env || !session) return;
            // Password hashing can overlap activation. The sign-in handler's earlier user snapshot
            // must not decide whether the session needs a challenge after activation has committed.
            const user = await env.DB.prepare(
              'SELECT two_factor_enabled FROM users WHERE id = ?'
            )
              .bind(session.user.id)
              .first<{ two_factor_enabled: number }>();
            session.user.twoFactorEnabled = !!user?.two_factor_enabled;
            const value = await generation(env, session.user.id);
            if (
              value.password !==
                (ctx.context as MfaContext).cloudforgePasswordHash ||
              value.authVersion !==
                (ctx.context as MfaContext).cloudforgeLoginSnapshot
                  ?.authVersion ||
              value.policyVersion !==
                (ctx.context as MfaContext).cloudforgeLoginSnapshot
                  ?.policyVersion
            ) {
              await ctx.context.internalAdapter.deleteSession(
                session.session.token
              );
              throw new APIError('UNAUTHORIZED', {
                code: 'MFA_CHALLENGE_CHANGED',
                message: 'Sign in again after the account credentials changed.',
              });
            }
            (ctx.context as MfaContext).cloudforgeGeneration = value;
          }),
        },
        ...plugin.hooks.after,
        {
          matcher: (ctx: { path?: string }) => signInPath(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const session = ctx.context.newSession;
            if (!env || !session || ctx.context.returned instanceof APIError)
              return;
            const state = ctx.context as MfaContext;
            const value = state.cloudforgeGeneration;
            if (!value || !state.cloudforgePasswordVerifiedAt) throw changed();
            const guard = generationGuard(value);
            const recorded = await env.DB.prepare(
              `UPDATE sessions SET auth_method = 'password', auth_time = ?, policy_version = ?,
              second_factor_method = NULL, second_factor_time = NULL WHERE id = ? AND user_id = ? AND auth_version = ?
              AND ${guard.sql} RETURNING id`
            )
              .bind(
                state.cloudforgePasswordVerifiedAt,
                value.policyVersion,
                session.session.id,
                value.userId,
                value.authVersion,
                ...guard.args
              )
              .first();
            if (!recorded) {
              await ctx.context.internalAdapter.deleteSession(
                session.session.token
              );
              throw changed();
            }
          }),
        },
        {
          matcher: (ctx: { path?: string }) =>
            [VERIFY_TOTP, VERIFY_BACKUP, DISABLE, REGENERATE].includes(
              ctx.path ?? ''
            ),
          handler: createAuthMiddleware(async (ctx) => {
            if (!env || ctx.context.returned instanceof APIError) return;
            const result = ctx.context.returned as
              | { token?: string; status?: boolean; backupCodes?: unknown }
              | undefined;
            if (
              !result ||
              (!result.token &&
                result.status !== true &&
                !Array.isArray(result.backupCodes))
            )
              return;
            const session = ctx.context.newSession ?? ctx.context.session;
            if (!session) return;
            if (ctx.path === VERIFY_TOTP || ctx.path === VERIFY_BACKUP) {
              const value = (ctx.context as MfaContext).cloudforgeGeneration;
              if (!value) throw new APIError('UNAUTHORIZED');
              const guard = generationGuard(value);
              const authentication = authenticationForNewSession(
                ctx.context,
                ctx.path,
                session.user.id,
                value.authVersion,
                session.session.impersonatedBy
              );
              const proof = await env.DB.prepare(
                `UPDATE sessions SET mfa_verified_at = ?, auth_version = ?, policy_version = ?, auth_method = ?, auth_time = ?,
                  second_factor_method = ?, second_factor_time = ? WHERE id = ? AND user_id = ? AND expires_at > ? AND auth_version = ? AND ${guard.sql} RETURNING id`
              )
                .bind(
                  Date.now(),
                  authentication.authVersion,
                  authentication.policyVersion,
                  authentication.authMethod,
                  authentication.authTime?.getTime() ?? null,
                  authentication.secondFactorMethod,
                  authentication.secondFactorTime?.getTime() ?? null,
                  session.session.id,
                  session.user.id,
                  Date.now(),
                  value.authVersion,
                  ...guard.args
                )
                .first();
              if (!proof)
                throw new APIError('UNAUTHORIZED', {
                  message:
                    'Sign in again after the account credentials changed.',
                  code: 'MFA_CHALLENGE_CHANGED',
                });
              const stepUp = (ctx.context as MfaContext).cloudforgeStepUp;
              if (stepUp)
                await env.DB.prepare(
                  `UPDATE two_factors SET failed_verification_count = 0, locked_until = NULL WHERE id = ? AND secret = ? AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?)`
                )
                  .bind(
                    stepUp.id,
                    stepUp.secret,
                    session.session.id,
                    session.user.id,
                    Date.now()
                  )
                  .run();
              // A newly established session is an authentication event; existing-session verification is step-up.
              await recordAudit(db, {
                repositoryId: null,
                actorId: session.user.id,
                action:
                  ctx.path === VERIFY_BACKUP
                    ? 'user.mfa_recovery_used'
                    : 'user.mfa_verified',
                target: `@${session.user.username ?? session.user.name}`,
                data: {},
              });
            } else if (ctx.path === REGENERATE) {
              await recordAudit(db, {
                repositoryId: null,
                actorId: session.user.id,
                action: 'user.mfa_recovery_regenerated',
                target: `@${session.user.username ?? session.user.name}`,
                data: {},
              });
            }
          }),
        },
      ],
    },
  };
}
