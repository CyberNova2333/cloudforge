import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import {
  recentAuthorization,
  RECENT_AUTHENTICATION_MS,
} from '../../auth/recent';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from '../helpers/app';
import {
  authorize,
  register,
  pkce,
  raw,
  ORIGIN,
  REDIRECT,
} from '../helpers/mcp';

async function setup() {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  const data = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as {
    session: { id: string };
    user: { id: string };
  };
  return { t, cookie, sessionId: data.session.id, userId: data.user.id };
}
async function age(t: TestEnv, sessionId: string) {
  await t.env.DB.prepare('UPDATE sessions SET auth_time = ? WHERE id = ?')
    .bind(Date.now() - RECENT_AUTHENTICATION_MS - 10_000, sessionId)
    .run();
}

describe('敏感操作的最近身份验证', () => {
  it('重验页面沿用登录保留前缀，verify 仍是合法的既有成员名', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t, 'verify');
    const response = await call(t, '/api/users', { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: 'verify' })])
    );
  });
  it('实际密码证明可创建凭据，未知、陈旧、未来和模拟证明均被拒绝', async () => {
    const { t, cookie, sessionId, userId } = await setup();
    const db = drizzle(t.env.DB, { schema });
    expect(await recentAuthorization(db, sessionId, userId)).not.toBeNull();
    expect(
      (await call(t, '/api/tokens', { cookie, json: { name: 'fresh' } })).status
    ).toBe(201);
    for (const [method, time, impersonatedBy] of [
      [null, null, null],
      ['password', Date.now() - RECENT_AUTHENTICATION_MS - 10_000, null],
      ['password', Date.now() + 60_000, null],
      ['email_verification', Date.now(), null],
      ['password', Date.now(), 'other-user'],
    ] as const) {
      await t.env.DB.prepare(
        'UPDATE sessions SET auth_method = ?, auth_time = ?, impersonated_by = ? WHERE id = ?'
      )
        .bind(method, time, impersonatedBy, sessionId)
        .run();
      expect(await recentAuthorization(db, sessionId, userId)).toBeNull();
      const response = await call(t, '/api/tokens/', {
        cookie,
        json: { name: 'blocked' },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
        sessionId,
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM personal_access_tokens'
      ).first()
    ).toEqual({ n: 1 });
  });

  it('因子已开启时必须同时具有最近的真实密码和第二因子', async () => {
    const { t, sessionId, userId } = await setup();
    const db = drizzle(t.env.DB, { schema });
    await t.env.DB.prepare(
      'UPDATE users SET two_factor_enabled = 1 WHERE id = ?'
    )
      .bind(userId)
      .run();
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_version = (SELECT auth_version FROM users WHERE id = ?) WHERE id = ?'
    )
      .bind(userId, sessionId)
      .run();
    expect(await recentAuthorization(db, sessionId, userId)).toBeNull();
    await t.env.DB.prepare(
      "UPDATE sessions SET second_factor_method = 'totp', second_factor_time = ? WHERE id = ?"
    )
      .bind(Date.now(), sessionId)
      .run();
    expect(await recentAuthorization(db, sessionId, userId)).not.toBeNull();
    await age(t, sessionId);
    expect(await recentAuthorization(db, sessionId, userId)).toBeNull();
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_time = ?, second_factor_time = ? WHERE id = ?'
    )
      .bind(Date.now(), Date.now() + 60_000, sessionId)
      .run();
    expect(await recentAuthorization(db, sessionId, userId)).toBeNull();
  });

  it('重验旧会话后可继续原操作，重试绑定原会话而不能转到另一个身份', async () => {
    const { t, cookie, sessionId } = await setup();
    await age(t, sessionId);
    expect(
      (await call(t, '/api/tokens', { cookie, json: { name: 'old' } })).status
    ).toBe(403);
    const verified = await call(t, '/api/auth/reauthenticate', {
      cookie,
      json: { sessionId, password: 'password123' },
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ status: true, sessionId });
    expect(
      (
        await call(t, '/api/tokens', {
          cookie,
          json: { name: 'same' },
          headers: { 'X-CloudForge-Session': sessionId },
        })
      ).status
    ).toBe(201);
    const changed = await call(t, '/api/tokens', {
      cookie,
      json: { name: 'changed' },
      headers: { 'X-CloudForge-Session': 'another-session' },
    });
    expect(changed.status).toBe(401);
    expect(await changed.json()).toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('原生管理员写接口与自有管理接口共享门槛，受邀注册仍可完成', async () => {
    const { t, cookie, sessionId } = await setup();
    const invite = await call(t, '/api/invites', {
      cookie,
      json: { email: 'invited@example.com' },
    });
    expect(invite.status).toBe(201);
    const invitation = (await invite.json()) as { inviteUrl: string };
    await age(t, sessionId);
    for (const path of [
      '/api/auth/admin/create-user',
      '/api/auth/admin/set-role',
      '/api/auth/admin/set-user-password',
    ]) {
      const response = await call(t, path, {
        cookie,
        json: {
          userId: 'target',
          email: 'new@example.com',
          name: 'New',
          password: 'password123',
          newPassword: 'password456',
          role: 'admin',
        },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
        sessionId,
      });
    }
    expect(
      (
        await call(t, '/api/admin/settings/signup.enabled', {
          method: 'PUT',
          cookie,
          json: { value: true },
        })
      ).status
    ).toBe(403);
    const token = invitation.inviteUrl.split('/invite/')[1];
    expect(
      (
        await call(t, '/api/invites/accept', {
          json: {
            token,
            name: 'Invited',
            username: 'invited',
            password: 'password123',
          },
        })
      ).status
    ).toBe(200);
  });

  it('部署凭据和代决授权需要最近验证，撤销机器凭据和退出不受阻', async () => {
    const { t, cookie, sessionId } = await setup();
    await call(t, '/api/repos', { cookie, json: { name: 'app' } });
    const token = (await (
      await call(t, '/api/tokens', { cookie, json: { name: 'remove' } })
    ).json()) as { token: { id: string } };
    const deployed = (await (
      await call(t, '/api/repos/octocat/app/deploy-tokens', {
        cookie,
        json: { name: 'remove' },
      })
    ).json()) as { token: { id: string } };
    await age(t, sessionId);
    expect(
      (
        await call(t, '/api/repos/octocat/app/deploy-tokens', {
          cookie,
          json: { name: 'blocked' },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(t, '/api/mcp/connections/client/moderator', {
          method: 'PUT',
          cookie,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(t, `/api/tokens/${token.token.id}`, {
          method: 'DELETE',
          cookie,
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(
          t,
          `/api/repos/octocat/app/deploy-tokens/${deployed.token.id}`,
          { method: 'DELETE', cookie }
        )
      ).status
    ).toBe(200);
    expect(
      (await call(t, '/api/auth/sign-out', { json: {}, cookie })).status
    ).toBe(200);
  });

  it('已有同意的OAuth网页授权也先重验，保留原始授权查询', async () => {
    const { t, cookie, sessionId } = await setup();
    const clientId = await register(t);
    await authorize(t, cookie, clientId);
    await age(t, sessionId);
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
    const path = `/api/auth/oauth2/authorize?${params}`;
    const response = await raw(t, path, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!, ORIGIN);
    expect(location.pathname).toBe('/login/verify');
    expect(location.searchParams.get('return_to')).toBe(path);
  });

  it('陈旧会话可以直接拒绝OAuth请求，拒绝不会签发凭据', async () => {
    const { t, cookie, sessionId } = await setup();
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
    const consent = await raw(t, `/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    expect(consent.status).toBe(302);
    const location = new URL(consent.headers.get('location')!, ORIGIN);
    expect(location.pathname).toBe('/oauth/consent');
    await age(t, sessionId);
    const response = await call(t, '/api/auth/oauth2/consent', {
      cookie,
      json: { accept: false, oauth_query: location.search.slice(1) },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirect: boolean; url: string };
    expect(body.redirect).toBe(true);
    expect(new URL(body.url).searchParams.get('error')).toBe('access_denied');
    expect(
      await t.env.DB.prepare('SELECT count(*) AS n FROM oauth_consents').first()
    ).toEqual({ n: 0 });
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM oauth_access_tokens'
      ).first()
    ).toEqual({ n: 0 });
  });

  for (const deploy of [false, true])
    it(`${deploy ? '部署令牌' : '个人令牌'}哈希运算期间撤销会话也不能完成实际凭据插入`, async () => {
      const { t, cookie, sessionId } = await setup();
      if (deploy)
        await call(t, '/api/repos', { cookie, json: { name: 'app' } });
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let paused = false;
      const spy = vi
        .spyOn(crypto.subtle, 'digest')
        .mockImplementation(async (...args) => {
          if (!paused) {
            paused = true;
            await t.env.DB.prepare('DELETE FROM sessions WHERE id = ?')
              .bind(sessionId)
              .run();
          }
          return digest(...args);
        });
      try {
        expect(
          (
            await call(
              t,
              deploy ? '/api/repos/octocat/app/deploy-tokens' : '/api/tokens',
              { cookie, json: { name: 'race' } }
            )
          ).status
        ).toBeGreaterThanOrEqual(400);
        expect(paused).toBe(true);
        expect(
          await t.env.DB.prepare(
            deploy
              ? 'SELECT count(*) AS n FROM repository_deploy_tokens'
              : 'SELECT count(*) AS n FROM personal_access_tokens'
          ).first()
        ).toEqual({ n: 0 });
      } finally {
        spy.mockRestore();
      }
    });
});
