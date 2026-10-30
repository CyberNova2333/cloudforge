import { describe, expect, it } from 'vitest';
import type { OAuthOptions, Scope } from '@better-auth/oauth-provider';
import { authFor } from '../auth';
import {
  currentGrantReference,
  validGrantReference,
} from '../auth/oauth-grants';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from './helpers/app';
import {
  authorize,
  connect,
  ORIGIN,
  pkce,
  raw,
  REDIRECT,
  register,
  rpc,
} from './helpers/mcp';

const PASSWORD = 'password123';
function options(t: TestEnv) {
  return authFor(t.env).options.plugins.find((p) => p.id === 'oauth-provider')!
    .options as OAuthOptions<Scope[]>;
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
function payload(token: string) {
  return JSON.parse(
    atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))
  ) as { cf_grant?: string };
}
async function setup(mfa = false) {
  const t = makeEnv();
  let cookie = await bootstrapAdmin(t);
  let backupCodes: string[] = [];
  if (mfa) {
    const enable = await call(t, '/api/auth/two-factor/enable', {
      cookie,
      json: { password: PASSWORD },
    });
    expect(enable.status).toBe(200);
    const data = (await enable.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    backupCodes = data.backupCodes;
    // Confirm enrollment with the real current code before using the returned recovery codes for policy migration.
    const { base32 } = await import('@better-auth/utils/base32');
    const { createOTP } = await import('@better-auth/utils/otp');
    const secret = new TextDecoder().decode(
      base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
    );
    const verified = await call(t, '/api/auth/two-factor/verify-totp', {
      cookie,
      json: { code: await createOTP(secret).totp() },
    });
    expect(verified.status).toBe(200);
    cookie = cookies(verified);
  }
  const session = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { session: { id: string }; user: { id: string } };
  return {
    t,
    cookie,
    backupCodes,
    sessionId: session.session.id,
    userId: session.user.id,
  };
}
async function setPolicy(t: TestEnv, version: number, required: boolean) {
  // Exercise actual policy-trigger revocation; management preview/CAS is independently covered by its own suite.
  await t.env.DB.prepare(
    `INSERT INTO authentication_policy (id, version, require_mfa) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, require_mfa = excluded.require_mfa`
  )
    .bind(version, required ? 1 : 0)
    .run();
}
async function reauthenticate(
  t: TestEnv,
  cookie: string,
  sessionId: string,
  recoveryCode?: string
) {
  const response = await call(t, '/api/auth/reauthenticate', {
    cookie,
    json: {
      sessionId,
      password: PASSWORD,
      ...(recoveryCode ? { method: 'recovery_code', code: recoveryCode } : {}),
    },
  });
  expect(response.status, await response.clone().text()).toBe(200);
}
async function legacyConnection(t: TestEnv, cookie: string) {
  const config = options(t);
  const { postLogin, extensions } = config;
  config.postLogin = undefined;
  config.extensions = undefined;
  try {
    return await connect(t, cookie);
  } finally {
    config.postLogin = postLogin;
    config.extensions = extensions;
  }
}
function userinfo(t: TestEnv, token: string) {
  return raw(t, '/api/auth/oauth2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
}
function refresh(t: TestEnv, clientId: string, token: string) {
  return raw(t, '/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: token,
      resource: `${ORIGIN}/mcp`,
    }),
  });
}
async function codeExchange(
  t: TestEnv,
  cookie: string,
  clientId: string,
  config: { clientSecret?: string; resource?: boolean } = {}
) {
  const { verifier, challenge } = await pkce();
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(config.resource === false ? {} : { resource: `${ORIGIN}/mcp` }),
  });
  const response = await raw(t, `/api/auth/oauth2/authorize?${query}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  expect(response.status).toBe(302);
  let callback = new URL(response.headers.get('location')!, ORIGIN);
  if (callback.pathname === '/oauth/consent') {
    const consent = await call(t, '/api/auth/oauth2/consent', {
      cookie,
      json: { accept: true, oauth_query: callback.search.slice(1) },
    });
    expect(consent.status).toBe(200);
    callback = new URL(((await consent.json()) as { url: string }).url);
  }
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT);
  return () =>
    raw(t, '/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        ...(config.resource === false ? {} : { resource: `${ORIGIN}/mcp` }),
      }),
    });
}
function pause(t: TestEnv, grantType: 'authorization_code' | 'refresh_token') {
  const claims = options(t).extensions![0].claims!;
  const original = claims.accessToken!;
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let first = true;
  claims.accessToken = async (input) => {
    if (first && input.grantType === grantType) {
      first = false;
      reached();
      await held;
    }
    return original(input);
  };
  return {
    entered,
    release,
    restore: () => {
      claims.accessToken = original;
    },
  };
}

describe('OAuth 的实例认证策略版本', () => {
  it('只接受规范的安全整数策略版本，旧格式和无声明仅属于默认策略', () => {
    const nonce = 'a'.repeat(32);
    expect(validGrantReference(`cf-grant-v1:${nonce}`)).toBe(true);
    expect(validGrantReference(`cf-grant-v2:2:${nonce}`)).toBe(true);
    for (const version of ['0', '-1', '01', '1e2', '9007199254740992'])
      expect(validGrantReference(`cf-grant-v2:${version}:${nonce}`)).toBe(
        false
      );
    expect(currentGrantReference(undefined, 0, undefined, false)).toBe(true);
    expect(currentGrantReference(undefined, 1, undefined, false)).toBe(false);
    expect(currentGrantReference(`cf-grant-v1:${nonce}`, 1, nonce, false)).toBe(
      false
    );
    expect(
      currentGrantReference(`cf-grant-v2:2:${nonce}`, 2, nonce, true)
    ).toBe(true);
  });

  for (const legacy of [false, true])
    it(`${legacy ? '无声明旧授权' : '默认版本授权'}在开启再关闭策略后永不复活，新授权继承实际版本`, async () => {
      const { t, cookie, sessionId, backupCodes } = await setup(true);
      const old = legacy
        ? await legacyConnection(t, cookie)
        : await connect(t, cookie);
      expect(payload(old.access_token).cf_grant).toEqual(
        legacy ? undefined : expect.stringMatching(/^cf-grant-v1:/)
      );
      expect((await rpc(t, old.access_token, 'ping')).status).toBe(200);
      await setPolicy(t, 1, true);
      expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);
      expect((await userinfo(t, old.access_token)).status).toBe(401);
      await reauthenticate(t, cookie, sessionId, backupCodes[0]);
      const current = await authorize(t, cookie, old.clientId);
      expect(payload(current.access_token).cf_grant).toMatch(/^cf-grant-v2:1:/);
      expect((await rpc(t, current.access_token, 'ping')).status).toBe(200);
      const refreshed = await refresh(t, old.clientId, current.refresh_token!);
      expect(refreshed.status).toBe(200);
      const rotated = (await refreshed.json()) as { access_token: string };
      expect(payload(rotated.access_token).cf_grant).toBe(
        payload(current.access_token).cf_grant
      );
      await setPolicy(t, 2, false);
      await reauthenticate(t, cookie, sessionId, backupCodes[1]);
      const renewed = await authorize(t, cookie, old.clientId);
      expect(payload(renewed.access_token).cf_grant).toMatch(/^cf-grant-v2:2:/);
      expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
      for (const token of [
        old.access_token,
        current.access_token,
        rotated.access_token,
      ]) {
        expect((await rpc(t, token, 'ping')).status).toBe(401);
        expect((await userinfo(t, token)).status).toBe(401);
      }
    });

  for (const grantType of ['authorization_code', 'refresh_token'] as const)
    it(`策略变化时已经读入的${grantType}不能在签发时继承现场的新策略`, async () => {
      const { t, cookie, sessionId } = await setup();
      const old = await connect(t, cookie);
      const exchange =
        grantType === 'authorization_code'
          ? await codeExchange(t, cookie, old.clientId)
          : null;
      const held = pause(t, grantType);
      const pending = exchange
        ? exchange()
        : refresh(t, old.clientId, old.refresh_token!);
      try {
        await held.entered;
        await setPolicy(t, 1, false);
        await reauthenticate(t, cookie, sessionId);
        const renewed = await authorize(t, cookie, old.clientId);
        expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
        held.release();
        expect((await pending).status).toBe(400);
      } finally {
        held.release();
        held.restore();
        await pending;
      }
    });

  for (const opaque of [false, true])
    it(`新策略的${opaque ? 'opaque' : 'JWT'}资料和内省核对原版本，关闭后只有重新授权的凭据有效`, async () => {
      const { t, cookie, sessionId, backupCodes } = await setup(true);
      const registered = await raw(t, '/api/auth/oauth2/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Policy introspection',
          redirect_uris: [REDIRECT],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
        }),
      });
      expect(registered.status).toBe(201);
      const { client_id: clientId, client_secret: clientSecret } =
        (await registered.json()) as {
          client_id: string;
          client_secret: string;
        };
      const issue = async () => {
        const exchange = await codeExchange(t, cookie, clientId, {
          clientSecret,
          resource: !opaque,
        });
        const response = await exchange();
        expect(response.status).toBe(200);
        const tokens = (await response.json()) as {
          access_token: string;
          refresh_token: string;
        };
        expect(tokens.access_token.split('.')).toHaveLength(opaque ? 1 : 3);
        return tokens;
      };
      const introspect = async (token: string, hint = 'access_token') => {
        const response = await raw(t, '/api/auth/oauth2/introspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token,
            token_type_hint: hint,
          }),
        });
        expect(response.status).toBe(200);
        return (await response.json()) as {
          active: boolean;
          cf_grant?: string;
        };
      };
      await setPolicy(t, 1, true);
      await reauthenticate(t, cookie, sessionId, backupCodes[0]);
      const first = await issue();
      expect((await userinfo(t, first.access_token)).status).toBe(200);
      expect(await introspect(first.access_token)).toMatchObject({
        active: true,
        cf_grant: expect.stringMatching(/^cf-grant-v2:1:/),
      });
      expect(
        (await introspect(first.refresh_token, 'refresh_token')).active
      ).toBe(true);
      await setPolicy(t, 2, false);
      expect((await userinfo(t, first.access_token)).status).toBe(401);
      expect((await introspect(first.access_token)).active).toBe(false);
      expect(
        (await introspect(first.refresh_token, 'refresh_token')).active
      ).toBe(false);
      await reauthenticate(t, cookie, sessionId, backupCodes[1]);
      const second = await issue();
      expect((await userinfo(t, second.access_token)).status).toBe(200);
      expect(await introspect(second.access_token)).toMatchObject({
        active: true,
        cf_grant: expect.stringMatching(/^cf-grant-v2:2:/),
      });
      expect((await introspect(first.access_token)).active).toBe(false);
    });

  it('策略切换之后的旧格式及无声明迟到授权行在真实数据库写点均被拒绝', async () => {
    const { t, cookie, sessionId, userId } = await setup();
    const old = await connect(t, cookie);
    const reference = payload(old.access_token).cf_grant!;
    await setPolicy(t, 1, false);
    await reauthenticate(t, cookie, sessionId);
    await authorize(t, cookie, old.clientId);
    for (const oldReference of [reference, null]) {
      await expect(
        t.env.DB.prepare(
          'INSERT INTO oauth_consents (id, client_id, user_id, reference_id, scopes) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(crypto.randomUUID(), old.clientId, userId, oldReference, '[]')
          .run()
      ).rejects.toThrow('OAuth authorization was revoked');
      for (const kind of ['access', 'refresh'])
        await expect(
          t.env.DB.prepare(
            `INSERT INTO oauth_${kind}_tokens (id, token, client_id, user_id, reference_id, scopes) VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(
              crypto.randomUUID(),
              crypto.randomUUID(),
              old.clientId,
              userId,
              oldReference,
              '[]'
            )
            .run()
        ).rejects.toThrow('OAuth authorization was revoked');
    }
  });

  it('已启用策略不允许未绑定浏览器从原生登录续接签发OAuth代码', async () => {
    const { t, cookie } = await setup();
    const clientId = await register(t);
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${ORIGIN}/mcp`,
    });
    const started = await raw(t, `/api/auth/oauth2/authorize?${query}`, {
      redirect: 'manual',
    });
    expect(started.status).toBe(302);
    const login = new URL(started.headers.get('location')!, ORIGIN);
    await setPolicy(t, 1, true);
    const signedIn = await call(t, '/api/auth/sign-in/username', {
      cookie,
      json: {
        username: 'octocat',
        password: PASSWORD,
        oauth_query:
          login.searchParams.get('oauth_query') ?? login.search.slice(1),
      },
    });
    const body = (await signedIn.clone().json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('code=');
    expect(
      await t.env.DB.prepare('SELECT count(*) AS n FROM oauth_consents').first()
    ).toEqual({ n: 0 });
  });
});
