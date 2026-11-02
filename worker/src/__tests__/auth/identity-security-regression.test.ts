// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import type { OAuthOptions, Scope } from '@better-auth/oauth-provider';
import { authFor } from '../../auth';
import { RECENT_AUTHENTICATION_MS } from '../../auth/recent';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  signIn,
  type TestEnv,
} from '../helpers/app';
import { ORIGIN, REDIRECT, pkce, raw, register } from '../helpers/mcp';

async function session(t: TestEnv, cookie: string) {
  const response = await call(t, '/api/auth/get-session', { cookie });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    session: { id: string; token: string };
    user: { id: string };
  }>;
}

describe('管理员撤销会话的近期认证', () => {
  for (const endpoint of ['revoke-user-session', 'revoke-user-sessions'])
    it.each(['password', 'factor'])(
      `${endpoint} 拒绝过期的 %s，重验后才删除目标会话`,
      async (evidence) => {
        const t = makeEnv();
        let cookie = await bootstrapAdmin(t);
        const memberCookie = await addMember(t, cookie, 'target');
        const member = await session(t, memberCookie);
        let recoveryCode: string | undefined;
        if (evidence === 'factor') {
          const enable = await call(t, '/api/auth/two-factor/enable', {
            cookie,
            json: { password: 'password123' },
          });
          expect(enable.status).toBe(200);
          const data = (await enable.json()) as {
            totpURI: string;
            backupCodes: string[];
          };
          recoveryCode = data.backupCodes[0];
          const secret = new TextDecoder().decode(
            base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
          );
          const verify = await call(t, '/api/auth/two-factor/verify-totp', {
            cookie,
            json: { code: await createOTP(secret).totp() },
          });
          expect(verify.status).toBe(200);
          cookie = verify.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
        }
        const admin = await session(t, cookie);
        await t.env.DB.prepare(
          `UPDATE sessions SET ${evidence === 'factor' ? 'second_factor_time' : 'auth_time'} = ? WHERE id = ?`
        )
          .bind(
            Date.now() - RECENT_AUTHENTICATION_MS - 10_000,
            admin.session.id
          )
          .run();
        const json =
          endpoint === 'revoke-user-sessions'
            ? { userId: member.user.id }
            : { sessionToken: member.session.token };
        const blocked = await call(t, `/api/auth/admin/${endpoint}`, {
          cookie,
          json,
        });
        expect(blocked.status).toBe(403);
        expect(await blocked.json()).toMatchObject({
          code: 'RECENT_AUTHENTICATION_REQUIRED',
          sessionId: admin.session.id,
        });
        expect(blocked.headers.get('cache-control')).toBe('no-store');
        expect(
          (await call(t, '/api/me/authentication', { cookie: memberCookie }))
            .status
        ).toBe(200);
        const verified = await call(t, '/api/auth/reauthenticate', {
          cookie,
          json: {
            sessionId: admin.session.id,
            password: 'password123',
            ...(recoveryCode
              ? { method: 'recovery_code', code: recoveryCode }
              : {}),
          },
        });
        expect(verified.status).toBe(200);
        expect(
          (
            await call(t, `/api/auth/admin/${endpoint}`, {
              cookie,
              json,
              headers: { 'X-CloudForge-Session': 'another-session' },
            })
          ).status
        ).toBe(401);
        expect(
          (await call(t, '/api/me/authentication', { cookie: memberCookie }))
            .status
        ).toBe(200);
        const revoked = await call(t, `/api/auth/admin/${endpoint}`, {
          cookie,
          json,
          headers: { 'X-CloudForge-Session': admin.session.id },
        });
        expect(revoked.status).toBe(200);
        expect(await revoked.json()).toEqual({ success: true });
        expect(
          await t.env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
            .bind(member.session.id)
            .first()
        ).toBeNull();
        expect(
          (await call(t, '/api/me/authentication', { cookie: memberCookie }))
            .status
        ).toBe(401);
      }
    );

  it.each([
    'sign-out',
    'revoke-session',
    'revoke-sessions',
    'revoke-other-sessions',
  ])('过期的近期证明仍可通过 %s 撤销自己的会话', async (endpoint) => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const current = await session(t, cookie);
    const otherCookie = await signIn(t, 'octocat', 'password123');
    const other = await session(t, otherCookie);
    await t.env.DB.prepare('UPDATE sessions SET auth_time = ?')
      .bind(Date.now() - RECENT_AUTHENTICATION_MS - 10_000)
      .run();
    const response = await call(t, `/api/auth/${endpoint}`, {
      cookie,
      json: endpoint === 'revoke-session' ? { token: other.session.token } : {},
    });
    expect(response.status).toBe(200);
    const deletedId =
      endpoint === 'sign-out' ? current.session.id : other.session.id;
    expect(
      await t.env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
        .bind(deletedId)
        .first()
    ).toBeNull();
  });
});

describe('已打开 OAuth 同意页的会话绑定重验', () => {
  it('原签名同意请求在过期时不写入，重验后仅同会话可继续', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const current = await session(t, cookie);
    const clientId = await register(t);
    const { challenge } = await pkce();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${ORIGIN}/mcp`,
    });
    const page = await raw(t, `/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    expect(page.status).toBe(302);
    const location = new URL(page.headers.get('Location')!, ORIGIN);
    const json = { accept: true, oauth_query: location.search.slice(1) };
    await t.env.DB.prepare('UPDATE sessions SET auth_time = ? WHERE id = ?')
      .bind(Date.now() - RECENT_AUTHENTICATION_MS - 10_000, current.session.id)
      .run();
    const blocked = await call(t, '/api/auth/oauth2/consent', { cookie, json });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      code: 'RECENT_AUTHENTICATION_REQUIRED',
      sessionId: current.session.id,
    });
    expect(
      await t.env.DB.prepare('SELECT count(*) AS n FROM oauth_consents').first()
    ).toEqual({ n: 0 });
    expect(
      (
        await call(t, '/api/auth/reauthenticate', {
          cookie,
          json: { sessionId: current.session.id, password: 'password123' },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(t, '/api/auth/oauth2/consent', {
          cookie,
          json,
          headers: { 'X-CloudForge-Session': 'another-session' },
        })
      ).status
    ).toBe(401);
    expect(
      await t.env.DB.prepare('SELECT count(*) AS n FROM oauth_consents').first()
    ).toEqual({ n: 0 });
    const accepted = await call(t, '/api/auth/oauth2/consent', {
      cookie,
      json,
      headers: { 'X-CloudForge-Session': current.session.id },
    });
    expect(accepted.status).toBe(200);
    expect(
      new URL(
        ((await accepted.json()) as { url: string }).url
      ).searchParams.has('code')
    ).toBe(true);
    expect(
      await t.env.DB.prepare('SELECT count(*) AS n FROM oauth_consents').first()
    ).toEqual({ n: 1 });
  });
});

async function confidentialGrant(legacy = false) {
  const t = makeEnv();
  const adminCookie = await bootstrapAdmin(t);
  const cookie = await addMember(t, adminCookie, 'oauthmember');
  const member = await session(t, cookie);
  const registration = await call(t, '/api/auth/oauth2/register', {
    json: {
      client_name: 'Introspection regression',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    },
  });
  expect(registration.status).toBe(201);
  const client = (await registration.json()) as {
    client_id: string;
    client_secret: string;
  };
  const options = authFor(t.env).options.plugins.find(
    (p) => p.id === 'oauth-provider'
  )!.options as OAuthOptions<Scope[]>;
  const { postLogin, extensions, storeTokens } = options;
  if (legacy) {
    options.postLogin = undefined;
    options.extensions = undefined;
    // Mint using the SDK's old default storage, then introspect using our explicit shared hasher.
    options.storeTokens = undefined;
  }
  const form = (path: string, values: Record<string, string>) =>
    raw(t, `/api/auth/oauth2/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...client, ...values }),
    });
  let tokens: { access_token: string; refresh_token: string };
  try {
    const { challenge, verifier } = await pkce();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      scope: 'openid offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${ORIGIN}/mcp`,
    });
    const page = await raw(t, `/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    expect(page.status).toBe(302);
    const location = new URL(page.headers.get('Location')!, ORIGIN);
    const consent = await call(t, '/api/auth/oauth2/consent', {
      cookie,
      json: { accept: true, oauth_query: location.search.slice(1) },
    });
    expect(consent.status).toBe(200);
    const callback = new URL(((await consent.json()) as { url: string }).url);
    const exchange = await form('token', {
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource: `${ORIGIN}/mcp`,
    });
    expect(exchange.status).toBe(200);
    tokens = (await exchange.json()) as typeof tokens;
  } finally {
    options.postLogin = postLogin;
    options.extensions = extensions;
    options.storeTokens = storeTokens;
  }
  const introspect = async (token = tokens.refresh_token, hint?: string) => {
    const response = await form('introspect', {
      token,
      ...(hint ? { token_type_hint: hint } : {}),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{ active: boolean }>;
  };
  return { t, adminCookie, member, client, tokens, form, introspect };
}

describe('刷新令牌内省的本地主体与授权权威', () => {
  it.each([false, true])(
    '封禁成员后拒绝仍在 D1 的刷新令牌（legacy=%s）',
    async (legacy) => {
      const { t, adminCookie, member, tokens, form, introspect } =
        await confidentialGrant(legacy);
      expect(await introspect()).toMatchObject({ active: true });
      expect(
        await introspect(`Bearer ${tokens.refresh_token}`, 'refresh_token')
      ).toMatchObject({ active: true });
      expect(
        (
          await call(t, '/api/auth/admin/ban-user', {
            cookie: adminCookie,
            json: { userId: member.user.id, banReason: 'Regression' },
          })
        ).status
      ).toBe(200);
      expect(
        await t.env.DB.prepare(
          'SELECT count(*) AS n FROM oauth_refresh_tokens'
        ).first()
      ).toEqual({ n: 1 });
      expect(await introspect()).toEqual({ active: false });
      expect(await introspect(tokens.refresh_token, 'refresh_token')).toEqual({
        active: false,
      });
      expect(await introspect(tokens.access_token, 'access_token')).toEqual({
        active: false,
      });
      expect(
        (
          await form('token', {
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            resource: `${ORIGIN}/mcp`,
          })
        ).status
      ).toBe(400);
    }
  );

  it('核对原始刷新行的授权代际，当前 consent 不能复活旧代刷新令牌', async () => {
    const { t, client, tokens, introspect } = await confidentialGrant();
    expect(await introspect()).toMatchObject({ active: true });
    await t.env.DB.prepare(
      'UPDATE oauth_grant_generations SET generation = lower(hex(randomblob(16))) WHERE client_id = ?'
    )
      .bind(client.client_id)
      .run();
    // Keep the old token row while moving the authoritative consent to the new generation.
    await t.env.DB.prepare(
      "UPDATE oauth_consents SET reference_id = 'cf-grant-v1:' || (SELECT generation FROM oauth_grant_generations WHERE client_id = ?) WHERE client_id = ?"
    )
      .bind(client.client_id, client.client_id)
      .run();
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM oauth_refresh_tokens'
      ).first()
    ).toEqual({ n: 1 });
    expect(await introspect(tokens.refresh_token, 'refresh_token')).toEqual({
      active: false,
    });
  });

  it('旧版刷新凭据遵守永久撤销标记，不能靠现存 consent 绕过', async () => {
    const { t, member, client, introspect } = await confidentialGrant(true);
    expect(await introspect()).toMatchObject({ active: true });
    await t.env.DB.prepare(
      'INSERT INTO oauth_grant_generations (user_id, client_id, generation, legacy_revoked) VALUES (?, ?, ?, 1)'
    )
      .bind(
        member.user.id,
        client.client_id,
        crypto.randomUUID().replaceAll('-', '')
      )
      .run();
    expect(await introspect()).toEqual({ active: false });
  });
});
