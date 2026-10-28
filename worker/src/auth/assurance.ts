import type { GenericEndpointContext } from '@better-auth/core';

export type SessionAssurance = {
  strength:
    | 'unknown'
    | 'password'
    | 'multi_factor'
    | 'email_verification'
    | 'impersonated';
  primary: {
    method: 'password' | 'email_verification' | 'impersonation';
    verifiedAt: string;
  } | null;
  secondFactor: { method: 'totp' | 'recovery_code'; verifiedAt: string } | null;
};

export type AuthenticationFields = {
  authVersion?: number | null;
  authMethod?: string | null;
  authTime?: Date | number | null;
  secondFactorMethod?: string | null;
  secondFactorTime?: Date | number | null;
};

/** A migrated legacy session has version zero, but absent or malformed evidence is never proof. */
export function isCurrentSession(
  session: Pick<AuthenticationFields, 'authVersion'>,
  user: Pick<AuthenticationFields, 'authVersion'>
) {
  return (
    Number.isSafeInteger(session.authVersion) &&
    Number.isSafeInteger(user.authVersion) &&
    (session.authVersion as number) >= 0 &&
    session.authVersion === user.authVersion
  );
}

function instant(value: Date | number | null | undefined) {
  const number = value instanceof Date ? value.getTime() : value;
  return typeof number === 'number' &&
    Number.isFinite(number) &&
    number > 0 &&
    number <= Date.now()
    ? new Date(number).toISOString()
    : null;
}

/** Public evidence only; creation/refresh timestamps and account enrollment never invent a method. */
export function durableSessionAssurance(
  session: AuthenticationFields
): SessionAssurance {
  const time = instant(session.authTime);
  const method = session.authMethod;
  const primary: SessionAssurance['primary'] =
    time &&
    (method === 'password' ||
      method === 'email_verification' ||
      method === 'impersonation')
      ? { method, verifiedAt: time }
      : null;
  const factorTime = instant(session.secondFactorTime);
  const factor = session.secondFactorMethod;
  const secondFactor: SessionAssurance['secondFactor'] =
    primary?.method !== 'impersonation' &&
    factorTime &&
    (factor === 'totp' || factor === 'recovery_code')
      ? { method: factor, verifiedAt: factorTime }
      : null;
  const strength =
    primary?.method === 'impersonation'
      ? 'impersonated'
      : primary?.method === 'email_verification'
        ? 'email_verification'
        : primary?.method === 'password'
          ? secondFactor
            ? 'multi_factor'
            : 'password'
          : 'unknown';
  return { strength, primary, secondFactor };
}

export type SessionAuthentication = AuthenticationFields & {
  id: string;
  userId: string;
  userAuthVersion: number;
  expiresAt: Date;
  banned: boolean;
};

/** Native findSession filters returned:false fields even internally, so read authority directly from D1. */
export async function readSessionAuthentication(
  env: CloudflareBindings,
  sessionId: string
): Promise<SessionAuthentication | null> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.auth_version, s.auth_method, s.auth_time,
    s.second_factor_method, s.second_factor_time, s.expires_at, u.auth_version AS user_auth_version,
    COALESCE(u.banned, 0) AS banned FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  )
    .bind(sessionId)
    .first<{
      id: string;
      user_id: string;
      auth_version: number;
      auth_method: string | null;
      auth_time: number | null;
      second_factor_method: string | null;
      second_factor_time: number | null;
      expires_at: number;
      user_auth_version: number;
      banned: number;
    }>();
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        authVersion: row.auth_version,
        userAuthVersion: row.user_auth_version,
        authMethod: row.auth_method,
        authTime: row.auth_time,
        secondFactorMethod: row.second_factor_method,
        secondFactorTime: row.second_factor_time,
        expiresAt: new Date(row.expires_at),
        banned: !!row.banned,
      }
    : null;
}

const GUARDED = Symbol('cloudforge.session-version-guard');
/** Every native session middleware and OAuth continuation must use the same live generation as normal REST. */
export async function installSessionVersionGuard(
  ctx: GenericEndpointContext,
  env: CloudflareBindings
) {
  const state = ctx.context as GenericEndpointContext['context'] & {
    [GUARDED]?: boolean;
  };
  if (state[GUARDED]) return;
  state[GUARDED] = true;
  const current = async (sessionId: string) => {
    const record = await readSessionAuthentication(env, sessionId);
    return (
      !!record &&
      !record.banned &&
      record.expiresAt > new Date() &&
      isCurrentSession(record, { authVersion: record.userAuthVersion })
    );
  };
  const internal = ctx.context.internalAdapter;
  ctx.context.internalAdapter = {
    ...internal,
    findSession: async (...args: Parameters<typeof internal.findSession>) => {
      const result = await internal.findSession(...args);
      return result && (await current(result.session.id)) ? result : null;
    },
  };
  if (ctx.context.session && !(await current(ctx.context.session.session.id)))
    ctx.context.session = null;
}
