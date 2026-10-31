// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { GenericEndpointContext } from '@better-auth/core';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { createOTP } from '@better-auth/utils/otp';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { recordAudit } from '../lib/audit';
import { mustVerifyEmail } from '../auth/signup';
import { oidcSessionSourceSql } from '../auth/assurance';
import { POLICY_REQUIRE_MFA_SQL, POLICY_VERSION_SQL } from '../auth/policy';
import { loginAuthority } from '../db/oidc-sign-in-triggers';
import { currentConfiguration } from './service';
import {
  authorizationRequest,
  exchangeIdentity,
  hashValue,
  openState,
  providerFrom,
  randomToken,
  sealState,
  type ProviderConfig,
} from './provider';
import { OidcError } from './errors';

type Ctx = GenericEndpointContext;
type Action = {
  id: string;
  status: string;
  state_hash: string;
  cookie_hash: string;
  sealed: string | null;
  provider_id: string;
  provider_name: string;
  issuer: string;
  provider_version: number;
  provider_digest: string;
  configuration_generation: number;
  policy_version: number;
  return_to: string;
  created_at: number;
  expires_at: number;
  primary_time: number | null;
  user_id: string | null;
  binding_id: string | null;
  binding_revision: number | null;
  auth_version: number | null;
  factor_enabled: number | null;
  factor_id: string | null;
  factor_secret: string | null;
  recovery_version: number | null;
  session_id: string | null;
  completed_at: number | null;
};
const PREFIX = '/oidc-sign-in',
  TTL = 600_000;
const provisional = new WeakMap<object, string>();
export const isOidcProvisionalSession = (context: object, userId: string) =>
  provisional.get(context) === userId;
function fail(
  code = 'OIDC_LOGIN_CHANGED',
  status:
    | 'CONFLICT'
    | 'FORBIDDEN'
    | 'UNAUTHORIZED'
    | 'TOO_MANY_REQUESTS'
    | 'BAD_REQUEST' = 'CONFLICT'
): never {
  throw new APIError(status, {
    code,
    message:
      'The sign-in action is unavailable. Start again or use your password.',
  });
}
function origin(env: CloudflareBindings) {
  const u = new URL(env.BASE_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback))
    fail('OIDC_SECURE_ORIGIN_REQUIRED');
  return u.origin;
}
function mutation(ctx: Ctx, env: CloudflareBindings) {
  if (ctx.request?.headers.get('origin') !== origin(env))
    fail('OIDC_ORIGIN_REQUIRED', 'FORBIDDEN');
}
const cookieName = (env: CloudflareBindings, stateHash: string) =>
  (origin(env).startsWith('https:') ? '__Host-' : '') +
  'cloudforge.oidc-login.' +
  stateHash;
function cookies(ctx: Ctx) {
  return new Map(
    (ctx.headers?.get('cookie') ?? ctx.request?.headers.get('cookie') ?? '')
      .split(';')
      .map((v) => {
        const i = v.indexOf('=');
        return [v.slice(0, i).trim(), v.slice(i + 1)];
      })
  );
}
async function proof(ctx: Ctx, env: CloudflareBindings, a: Action) {
  const value = cookies(ctx).get(cookieName(env, a.state_hash));
  return !!value && (await hashValue(value)) === a.cookie_hash;
}
function clearProof(ctx: Ctx, env: CloudflareBindings, a: Action) {
  ctx.setCookie(cookieName(env, a.state_hash), '', {
    httpOnly: true,
    secure: origin(env).startsWith('https:'),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
async function action(env: CloudflareBindings, id: string) {
  return env.DB.prepare('SELECT * FROM oidc_login_actions WHERE id=?')
    .bind(id)
    .first<Action>();
}
async function anonymous(ctx: Ctx) {
  if (await getSessionFromCtx(ctx, { disableRefresh: true }))
    fail('OIDC_ALREADY_SIGNED_IN');
}
function providerMatches(a: Action, p: ProviderConfig) {
  return (
    p.loginEnabled &&
    a.provider_id === p.id &&
    a.issuer === p.issuer &&
    a.provider_version === p.version &&
    a.provider_digest === p.digest
  );
}
async function configured(env: CloudflareBindings) {
  const p = await providerFrom(env),
    c = await currentConfiguration(env);
  if (
    !p?.loginEnabled ||
    !c?.enabled ||
    !c.login_enabled ||
    c.provider_id !== p.id ||
    c.issuer !== p.issuer ||
    c.version !== p.version ||
    c.digest !== p.digest
  )
    fail('OIDC_PROVIDER_NOT_READY');
  origin(env);
  return { p, c };
}
function returnTarget(value: string) {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\x00-\x20\x7f]/.test(value) ||
    value.length > 8192
  )
    fail('OIDC_RETURN_TO_INVALID', 'BAD_REQUEST');
  const u = new URL(value, 'https://return.invalid');
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    fail('OIDC_RETURN_TO_INVALID', 'BAD_REQUEST');
  }
  if (
    path.startsWith('//') ||
    /[\\\x00-\x20\x7f]/.test(path) ||
    path === '/login/oidc' ||
    path.startsWith('/login/oidc/')
  )
    fail('OIDC_RETURN_TO_INVALID', 'BAD_REQUEST');
  if (path === '/api' || path.startsWith('/api/')) {
    if (
      path !== '/api/auth/oauth2/authorize' ||
      u.hash ||
      !u.searchParams.get('sig') ||
      !u.searchParams.get('client_id')
    )
      fail('OIDC_RETURN_TO_INVALID', 'BAD_REQUEST');
  }
  return value;
}
/** Indexed bounded cleanup; a completed native session keeps its ordinary lifetime. */
export async function cleanupOidcSignIn(env: CloudflareBindings, limit = 100) {
  const bound = Math.max(1, Math.min(100, Math.floor(limit))),
    now = Date.now();
  // Reclaim quota before checking capacity, including when every previous caller has disappeared.
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE id IN (SELECT id FROM rate_limits WHERE key >= 'cloudforge:oidc-start:' AND key < 'cloudforge:oidc-start;' AND last_request<? LIMIT ?)"
  )
    .bind(now - 600_000, bound)
    .run();
  // A receipt outlives its action proof; ordinary valid sessions retain their native lifetime.
  await env.DB.prepare(
    'DELETE FROM oidc_login_actions WHERE id IN (SELECT id FROM oidc_login_actions WHERE expires_at<=? ORDER BY expires_at LIMIT ?)'
  )
    .bind(now, bound)
    .run();
}
/** Called only after a native credential verifier has established the new principal. */
export async function supersedeOidcSignIn(ctx: Ctx, env: CloudflareBindings) {
  const prefix =
    (new URL(env.BASE_URL).protocol === 'https:' ? '__Host-' : '') +
    'cloudforge.oidc-login.';
  const presented = [...cookies(ctx)].filter(
    ([name, value]) =>
      name.startsWith(prefix) &&
      /^[-a-zA-Z0-9_]{43}$/.test(value) &&
      /^[a-f0-9]{64}$/.test(name.slice(prefix.length))
  );
  // Query only existing bounded inventory before hashing attacker-supplied cookie candidates.
  const byState = new Map(
    presented.map(([name, value]) => [name.slice(prefix.length), value])
  );
  if (byState.size) {
    const rows = (
      await env.DB.prepare(
        "SELECT state_hash,cookie_hash FROM oidc_login_actions WHERE state_hash IN (SELECT value FROM json_each(?)) AND status!='cancelled'"
      )
        .bind(JSON.stringify([...byState.keys()]))
        .all<{ state_hash: string; cookie_hash: string }>()
    ).results;
    const matched = [];
    for (const row of rows)
      if ((await hashValue(byState.get(row.state_hash)!)) === row.cookie_hash)
        matched.push(row.state_hash);
    if (matched.length)
      await env.DB.prepare(
        "UPDATE oidc_login_actions SET status='cancelled' WHERE state_hash IN (SELECT value FROM json_each(?)) AND status!='cancelled'"
      )
        .bind(JSON.stringify(matched))
        .run();
  }
  // A signed original cookie remains revocable even when its short-lived action proof has expired.
  const token = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret
  );
  if (token)
    await env.DB.prepare(
      'DELETE FROM sessions WHERE token=? AND oidc_binding_id IS NOT NULL'
    )
      .bind(token)
      .run();
}
async function view(ctx: Ctx, env: CloudflareBindings, a: Action) {
  const active = await getSessionFromCtx(ctx, { disableRefresh: true });
  if (
    !(await proof(ctx, env, a)) &&
    !(a.status === 'signed_in' && active?.session.id === a.session_id)
  )
    fail('OIDC_ACTION_NOT_FOUND', 'UNAUTHORIZED');
  let status = a.status;
  if (
    active &&
    active.session.id !== a.session_id &&
    !['cancelled', 'failed'].includes(status)
  ) {
    await env.DB.prepare(
      "UPDATE oidc_login_actions SET status='cancelled' WHERE id=? AND status!='cancelled'"
    )
      .bind(a.id)
      .run();
    clearProof(ctx, env, a);
    status = 'cancelled';
  }
  if (a.expires_at <= Date.now()) status = 'expired';
  else if (status === 'exchanging') status = 'pending';
  if (status === 'signed_in') {
    const alive = await env.DB.prepare(
      `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND s.auth_version=u.auth_version AND coalesce(u.banned,0)=0 AND ${oidcSessionSourceSql('s')}`
    )
      .bind(a.session_id, Date.now())
      .first();
    if (!alive) status = 'cancelled';
  }
  const user =
    a.user_id && ['ready', 'signed_in', 'enrollment_required'].includes(status)
      ? await env.DB.prepare(
          'SELECT id,name,username FROM users WHERE id=? AND coalesce(banned,0)=0'
        )
          .bind(a.user_id)
          .first()
      : null;
  return {
    actionId: a.id,
    status,
    expiresAt: new Date(a.expires_at).toISOString(),
    provider: { id: a.provider_id, name: a.provider_name, issuer: a.issuer },
    user,
    factorRequired: !!a.factor_enabled,
    returnTo: a.return_to,
    ...(status === 'signed_in' ? { sessionId: a.session_id } : {}),
  };
}
async function reserve(env: CloudflareBindings, ctx: Ctx) {
  await cleanupOidcSignIn(env);
  const now = Date.now(),
    key =
      'cloudforge:oidc-start:' +
      (await hashValue(
        ctx.request?.headers.get('cf-connecting-ip') ?? 'unknown'
      ));
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits(id,key,count,last_request) SELECT ?,?,1,? WHERE (SELECT count(*) FROM rate_limits WHERE key >= 'cloudforge:oidc-start:' AND key < 'cloudforge:oidc-start;')<4096 OR EXISTS(SELECT 1 FROM rate_limits WHERE key=?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN excluded.last_request ELSE last_request END
    WHERE last_request<=? OR count<10 RETURNING id`
  )
    .bind(
      crypto.randomUUID(),
      key,
      now,
      key,
      now - 60_000,
      now - 60_000,
      now - 60_000
    )
    .first();
  if (!row) fail('OIDC_RATE_LIMITED', 'TOO_MANY_REQUESTS');
}
async function verifyFactor(
  ctx: Ctx,
  env: CloudflareBindings,
  a: Action,
  method?: string,
  code?: string
) {
  if (!a.factor_enabled) {
    if (method || code) fail('OIDC_FACTOR_INVALID', 'BAD_REQUEST');
    return { method: null, step: null, before: null, after: null };
  }
  if (!method || !code) fail('MFA_VERIFICATION_REQUIRED', 'FORBIDDEN');
  const now = Date.now();
  const reserved = await env.DB.prepare(
    `UPDATE two_factors SET failed_verification_count=CASE WHEN locked_until IS NOT NULL AND locked_until<=? THEN 1 ELSE coalesce(failed_verification_count,0)+1 END,
    locked_until=CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until<=? THEN 1 ELSE coalesce(failed_verification_count,0)+1 END)>=10 THEN ? ELSE NULL END
    WHERE id=? AND secret=? AND verified=1 AND (locked_until IS NULL OR locked_until<=?) AND EXISTS (SELECT 1 FROM oidc_login_actions a WHERE a.id=? AND a.status='ready' AND ${loginAuthority('a', now)}) RETURNING backup_codes,last_totp_step`
  )
    .bind(now, now, now + 900_000, a.factor_id, a.factor_secret, now, a.id)
    .first<{ backup_codes: string; last_totp_step: number }>();
  if (!reserved) fail('ACCOUNT_TEMPORARILY_LOCKED', 'TOO_MANY_REQUESTS');
  if (method === 'totp') {
    if (!/^\d{6}$/.test(code)) fail('INVALID_TWO_FACTOR_CODE', 'FORBIDDEN');
    const secret = await symmetricDecrypt({
        key: ctx.context.secretConfig,
        data: a.factor_secret!,
      }),
      otp = createOTP(secret, { digits: 6, period: 30 }),
      step = Math.floor(now / 30_000);
    let matched = -1;
    for (let d = -1; d <= 1; d++) {
      const expected = await otp.hotp(step + d);
      let diff = code.length ^ expected.length;
      for (let i = 0; i < expected.length; i++)
        diff |= code.charCodeAt(i) ^ expected.charCodeAt(i);
      if (!diff) matched = step + d;
    }
    if (matched < 0) fail('INVALID_TWO_FACTOR_CODE', 'FORBIDDEN');
    if (matched <= reserved.last_totp_step)
      fail('TOTP_ALREADY_USED', 'FORBIDDEN');
    return { method, step: matched, before: null, after: null };
  }
  const list = JSON.parse(
    await symmetricDecrypt({
      key: ctx.context.secretConfig,
      data: reserved.backup_codes,
    })
  ) as string[];
  if (!Array.isArray(list) || !list.includes(code))
    fail('INVALID_BACKUP_CODE', 'FORBIDDEN');
  return {
    method,
    step: null,
    before: reserved.backup_codes,
    after: await symmetricEncrypt({
      key: ctx.context.secretConfig,
      data: JSON.stringify(list.filter((v) => v !== code)),
    }),
  };
}
export function oidcSignInPlugin(env?: CloudflareBindings) {
  const required = () => {
    if (!env) fail();
    return env;
  };
  return {
    id: 'cloudforge-oidc-sign-in' as const,
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => !!ctx.path?.startsWith(PREFIX),
          handler: createAuthMiddleware(async (ctx) => {
            ctx.setHeader('cache-control', 'no-store');
            ctx.setHeader('referrer-policy', 'no-referrer');
          }),
        },
      ],
    },
    endpoints: {
      oidcLoginStatus: createAuthEndpoint(
        PREFIX + '/status',
        { method: 'GET' },
        async (ctx) => {
          let provider = null;
          try {
            const { p } = await configured(required());
            provider = { id: p.id, name: p.name, issuer: p.issuer };
          } catch (error) {
            if (!(error instanceof APIError) && !(error instanceof OidcError))
              throw error;
          }
          return ctx.json({ ready: !!provider, provider });
        }
      ),
      oidcLoginStart: createAuthEndpoint(
        PREFIX + '/start',
        { method: 'POST', body: z.object({ returnTo: z.string() }).strict() },
        async (ctx) => {
          const e = required();
          mutation(ctx, e);
          await anonymous(ctx);
          const target = returnTarget(ctx.body.returnTo),
            { p, c } = await configured(e);
          await reserve(e, ctx);
          const id = crypto.randomUUID(),
            state = randomToken(),
            cookie = randomToken(),
            stateHash = await hashValue(state),
            verifier = randomToken(),
            nonce = randomToken(),
            now = Date.now();
          const aad = { id, providerId: p.id, generation: c.generation };
          const sealed = await sealState(
            e,
            JSON.stringify(aad),
            { verifier, nonce },
            'login'
          );
          const inserted = await e.DB.prepare(
            `INSERT INTO oidc_login_actions(id,status,state_hash,cookie_hash,sealed,provider_id,provider_name,issuer,provider_version,provider_digest,configuration_generation,policy_version,return_to,created_at,expires_at)
      SELECT ?,'pending',?,?,?,?,?,?,?,?,?,${POLICY_VERSION_SQL},?,?,? WHERE (SELECT count(*) FROM oidc_login_actions WHERE expires_at>?)<1024
      AND EXISTS(SELECT 1 FROM oidc_configuration WHERE id=1 AND enabled=1 AND login_enabled=1 AND generation=? AND digest=?) RETURNING id`
          )
            .bind(
              id,
              stateHash,
              await hashValue(cookie),
              sealed,
              p.id,
              p.name,
              p.issuer,
              p.version,
              p.digest,
              c.generation,
              target,
              now,
              now + TTL,
              now,
              c.generation,
              p.digest
            )
            .first();
          if (!inserted) fail('OIDC_CAPACITY', 'TOO_MANY_REQUESTS');
          let authorizationUrl: string;
          try {
            authorizationUrl = await authorizationRequest(
              e,
              p,
              { state, verifier, nonce },
              'login'
            );
          } catch (error) {
            await e.DB.prepare(
              "UPDATE oidc_login_actions SET status='failed',sealed=NULL WHERE id=? AND status='pending'"
            )
              .bind(id)
              .run();
            throw error;
          }
          ctx.setCookie(cookieName(e, stateHash), cookie, {
            httpOnly: true,
            secure: origin(e).startsWith('https:'),
            sameSite: 'lax',
            path: '/',
            maxAge: TTL / 1000,
          });
          return ctx.json({ authorizationUrl });
        }
      ),
      oidcLoginCallback: createAuthEndpoint(
        PREFIX + '/callback/:providerId',
        { method: 'GET' },
        async (ctx) => {
          const e = required(),
            u = new URL(ctx.request!.url),
            state = u.searchParams.get('state') ?? '';
          if (!/^[-a-zA-Z0-9_]{43}$/.test(state))
            fail('OIDC_CALLBACK_INVALID', 'BAD_REQUEST');
          const a = await e.DB.prepare(
            'SELECT * FROM oidc_login_actions WHERE state_hash=?'
          )
            .bind(await hashValue(state))
            .first<Action>();
          if (
            !a ||
            a.provider_id !== ctx.params?.providerId ||
            !(await proof(ctx, e, a))
          )
            fail('OIDC_CALLBACK_INVALID', 'UNAUTHORIZED');
          const redirect = () =>
            ctx.redirect('/login/oidc?actionId=' + encodeURIComponent(a.id));
          if (a.status !== 'pending') return redirect();
          try {
            await anonymous(ctx);
            const { p } = await configured(e);
            if (!providerMatches(a, p)) fail();
            const claimed = await e.DB.prepare(
              `UPDATE oidc_login_actions SET status='exchanging' WHERE id=? AND status='pending' AND expires_at>? AND policy_version=${POLICY_VERSION_SQL} RETURNING id`
            )
              .bind(a.id, Date.now())
              .first();
            if (!claimed) return redirect();
            try {
              if (u.searchParams.has('error') || !u.searchParams.get('code'))
                fail('OIDC_CALLBACK_INVALID');
              const secret = await openState(
                e,
                JSON.stringify({
                  id: a.id,
                  providerId: p.id,
                  generation: a.configuration_generation,
                }),
                a.sealed!,
                'login'
              );
              const identity = await exchangeIdentity(
                e,
                p,
                {
                  code: u.searchParams.get('code')!,
                  ...secret,
                  startedAt: a.created_at,
                },
                'login'
              );
              const candidate = await e.DB.prepare(
                `SELECT b.id AS binding_id,b.revision AS binding_revision,u.id AS user_id,u.auth_version,coalesce(u.two_factor_enabled,0) AS factor_enabled,f.id AS factor_id,f.secret AS factor_secret,f.recovery_version
          FROM oidc_bindings b JOIN users u ON u.id=b.user_id LEFT JOIN two_factors f ON f.user_id=u.id WHERE b.provider_id=? AND b.issuer=? AND b.subject=? AND b.active=1 AND coalesce(u.banned,0)=0 AND NOT EXISTS(SELECT 1 FROM agents WHERE user_id=u.id) AND (coalesce(u.two_factor_enabled,0)=0 OR f.verified=1)`
              )
                .bind(p.id, identity.issuer, identity.sub)
                .first<
                  Pick<
                    Action,
                    | 'binding_id'
                    | 'binding_revision'
                    | 'user_id'
                    | 'auth_version'
                    | 'factor_enabled'
                    | 'factor_id'
                    | 'factor_secret'
                    | 'recovery_version'
                  >
                >();
              if (
                !candidate ||
                (await mustVerifyEmail(
                  drizzle(e.DB) as any,
                  e,
                  candidate.user_id!
                ))
              )
                fail('OIDC_IDENTITY_NOT_BOUND');
              const now = Date.now();
              const saved = await e.DB.prepare(
                `UPDATE oidc_login_actions SET status=CASE WHEN ?=0 AND ${POLICY_REQUIRE_MFA_SQL}=1 THEN 'enrollment_required' ELSE 'ready' END,sealed=NULL,primary_time=?,expires_at=min(expires_at,?),user_id=?,binding_id=?,binding_revision=?,auth_version=?,factor_enabled=?,factor_id=?,factor_secret=?,recovery_version=?
          WHERE id=? AND status='exchanging' AND expires_at>? AND policy_version=${POLICY_VERSION_SQL}
          AND EXISTS(SELECT 1 FROM oidc_configuration WHERE id=1 AND enabled=1 AND login_enabled=1 AND generation=? AND digest=?) RETURNING id`
              )
                .bind(
                  candidate.factor_enabled,
                  now,
                  Math.min(identity.expiresAt, now + 120_000),
                  candidate.user_id,
                  candidate.binding_id,
                  candidate.binding_revision,
                  candidate.auth_version,
                  candidate.factor_enabled,
                  candidate.factor_id,
                  candidate.factor_secret,
                  candidate.recovery_version,
                  a.id,
                  now,
                  a.configuration_generation,
                  a.provider_digest
                )
                .first();
              if (!saved) fail();
              // Save and final issuance both recheck the exact identified generation.
              const valid = await e.DB.prepare(
                `SELECT 1 FROM oidc_login_actions a WHERE a.id=? AND ${loginAuthority('a', Date.now())}`
              )
                .bind(a.id)
                .first();
              if (!valid) fail();
            } catch (error) {
              await e.DB.prepare(
                "UPDATE oidc_login_actions SET status='failed',sealed=NULL,factor_secret=NULL WHERE id=? AND status IN ('exchanging','ready','enrollment_required')"
              )
                .bind(a.id)
                .run();
            }
          } catch (error) {
            await e.DB.prepare(
              "UPDATE oidc_login_actions SET status='failed',sealed=NULL,factor_secret=NULL WHERE id=? AND status='pending'"
            )
              .bind(a.id)
              .run();
          }
          return redirect();
        }
      ),
      oidcLoginAction: createAuthEndpoint(
        PREFIX + '/actions/:actionId',
        { method: 'GET' },
        async (ctx) => {
          const e = required(),
            a = await action(e, ctx.params?.actionId ?? '');
          if (!a) fail('OIDC_ACTION_NOT_FOUND', 'UNAUTHORIZED');
          return ctx.json(await view(ctx, e, a));
        }
      ),
      oidcLoginComplete: createAuthEndpoint(
        PREFIX + '/complete',
        {
          method: 'POST',
          body: z
            .object({
              actionId: z.string().uuid(),
              method: z.enum(['totp', 'recovery_code']).optional(),
              code: z.string().max(128).optional(),
            })
            .strict(),
        },
        async (ctx) => {
          const e = required();
          mutation(ctx, e);
          const a = await action(e, ctx.body.actionId);
          if (!a || !(await proof(ctx, e, a)))
            fail('OIDC_ACTION_NOT_FOUND', 'UNAUTHORIZED');
          const active = await getSessionFromCtx(ctx, { disableRefresh: true });
          if (a.status === 'signed_in') {
            if (active?.session.id !== a.session_id)
              fail('OIDC_ALREADY_COMPLETED');
            return ctx.json({
              status: 'signed_in',
              userId: a.user_id,
              sessionId: a.session_id,
              returnTo: a.return_to,
            });
          }
          if (active) fail('OIDC_ALREADY_SIGNED_IN');
          const { p } = await configured(e);
          if (!providerMatches(a, p) || a.status !== 'ready') fail();
          const valid = await e.DB.prepare(
            `SELECT 1 FROM oidc_login_actions a WHERE a.id=? AND ${loginAuthority('a', Date.now())}`
          )
            .bind(a.id)
            .first();
          if (
            !valid ||
            (await mustVerifyEmail(drizzle(e.DB) as any, e, a.user_id!))
          )
            fail();
          const factor = await verifyFactor(
            ctx,
            e,
            a,
            ctx.body.method,
            ctx.body.code
          );
          const user = await ctx.context.internalAdapter.findUserById(
            a.user_id!
          );
          if (!user) fail();
          provisional.set(ctx.context, a.user_id!);
          let session: Awaited<
            ReturnType<typeof ctx.context.internalAdapter.createSession>
          >;
          try {
            session = await ctx.context.internalAdapter.createSession(
              a.user_id!
            );
          } finally {
            provisional.delete(ctx.context);
          }
          if (!session) fail();
          try {
            const saved = await e.DB.prepare(
              `UPDATE oidc_login_actions SET status='signed_in',session_id=?,completed_at=?,factor_method=?,factor_step=?,backup_before=?,backup_after=? WHERE id=? AND status='ready' AND expires_at>? RETURNING id`
            )
              .bind(
                session.id,
                Date.now(),
                factor.method,
                factor.step,
                factor.before,
                factor.after,
                a.id,
                Date.now()
              )
              .first();
            if (!saved) fail();
            const formal = await ctx.context.internalAdapter.findSession(
              session.token
            );
            if (!formal) fail();
            await setSessionCookie(ctx, formal);
            clearProof(ctx, e, a);
            await recordAudit(drizzle(e.DB), {
              repositoryId: null,
              actorId: a.user_id!,
              action: 'user.oidc_signed_in',
              target: a.provider_id,
              data: {
                bindingId: a.binding_id,
                sessionId: session.id,
                factorMethod: factor.method,
              },
            });
            return ctx.json({
              status: 'signed_in',
              userId: a.user_id,
              sessionId: session.id,
              returnTo: a.return_to,
            });
          } catch (error) {
            await ctx.context.internalAdapter.deleteSession(session.token);
            if (error instanceof APIError) throw error;
            fail();
          }
        }
      ),
      oidcLoginCancel: createAuthEndpoint(
        PREFIX + '/cancel',
        {
          method: 'POST',
          body: z.object({ actionId: z.string().uuid() }).strict(),
        },
        async (ctx) => {
          const e = required();
          mutation(ctx, e);
          const a = await action(e, ctx.body.actionId);
          if (!a || !(await proof(ctx, e, a)))
            fail('OIDC_ACTION_NOT_FOUND', 'UNAUTHORIZED');
          await e.DB.prepare(
            "UPDATE oidc_login_actions SET status='cancelled' WHERE id=? AND cookie_hash=? AND status!='cancelled'"
          )
            .bind(a.id, a.cookie_hash)
            .run();
          clearProof(ctx, e, a);
          return ctx.json({ ok: true });
        }
      ),
    },
  };
}
