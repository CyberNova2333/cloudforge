import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { currentSession, currentUser } from '../auth/session';
import { schema } from '../db/schema';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  signIn,
  type TestEnv,
} from './helpers/app';

const ENDPOINT = '/api/me/authentication';
const unknown = {
  sessionId: expect.any(String),
  strength: 'unknown',
  primary: null,
  secondFactor: null,
};
const get = (t: TestEnv, cookie?: string, headers?: Record<string, string>) =>
  call(t, ENDPOINT, { cookie, headers });

describe('当前浏览器的认证证明', () => {
  it('密码会话展示实际证明，统一 reader 保持用户身份兼容且不泄漏内部字段', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const response = await get(t, cookie);
    expect(response.status).toBe(200);
    const authentication = (await response.json()) as {
      sessionId: string;
      strength: string;
      primary: { method: string; verifiedAt: string };
      secondFactor: null;
    };
    expect(authentication).toEqual({
      sessionId: expect.any(String),
      strength: 'password',
      primary: { method: 'password', verifiedAt: expect.any(String) },
      secondFactor: null,
    });
    expect(Date.parse(authentication.primary.verifiedAt)).toBeGreaterThan(
      Date.now() - 60_000
    );
    expect(Date.parse(authentication.primary.verifiedAt)).toBeLessThanOrEqual(
      Date.now()
    );
    const db = drizzle(t.env.DB, { schema });
    const headers = new Headers({ cookie });
    const current = await currentSession(db, t.env, headers);
    const { sessionId, ...evidence } = authentication;
    expect(current?.browserSession.authentication).toEqual(evidence);
    expect(current?.browserSession.id).toBe(sessionId);
    expect(current?.user).toEqual(await currentUser(db, t.env, headers));
    expect(current?.user.username).toBe('octocat');
    expect(Object.keys(authentication).sort()).toEqual([
      'primary',
      'secondFactor',
      'sessionId',
      'strength',
    ]);
    expect(Object.keys(authentication.primary).sort()).toEqual([
      'method',
      'verifiedAt',
    ]);
    const native = (await (
      await call(t, '/api/auth/get-session', { cookie })
    ).json()) as {
      user: Record<string, unknown>;
      session: Record<string, unknown>;
    };
    for (const field of [
      'authVersion',
      'authMethod',
      'authTime',
      'secondFactorMethod',
      'secondFactorTime',
    ]) {
      expect(native.session).not.toHaveProperty(field);
      expect(native.user).not.toHaveProperty(field);
    }
  });

  it('旧版本零会话维持普通访问，缺少证明只展示 unknown', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_version = 0, auth_method = NULL, auth_time = NULL, second_factor_method = NULL, second_factor_time = NULL'
    ).run();
    await t.env.DB.prepare('UPDATE users SET auth_version = 0').run();
    const response = await get(t, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(unknown);
    expect((await call(t, '/api/me/preferences', { cookie })).status).toBe(200);
  });

  it('认证版本变化立即拒绝普通 REST，已缓存的 cookie 签名也不能绕过', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    expect((await get(t, cookie)).status).toBe(200);
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_version = auth_version + 1'
    ).run();
    for (const path of [
      ENDPOINT,
      '/api/me/preferences',
      '/api/notifications',
    ]) {
      expect((await call(t, path, { cookie })).status).toBe(401);
    }
    expect(
      await currentUser(
        drizzle(t.env.DB, { schema }),
        t.env,
        new Headers({ cookie })
      )
    ).toBeNull();
  });

  it('过期、封禁和缺失会话不给认证证明', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const expiry = await t.env.DB.prepare(
      'SELECT expires_at FROM sessions'
    ).first<{ expires_at: number }>();
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(Date.now() - 1)
      .run();
    expect((await get(t, cookie)).status).toBe(401);
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(expiry!.expires_at)
      .run();
    await t.env.DB.prepare('UPDATE users SET banned = 1').run();
    expect((await get(t, cookie)).status).toBe(401);
    expect((await get(t)).status).toBe(401);
  });

  it('成功和未认证响应都禁止缓存，真实 PAT 不能替代浏览器会话', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const created = await call(t, '/api/tokens', {
      cookie,
      json: { name: 'CI', scope: 'read' },
    });
    expect(created.status).toBe(201);
    const { plaintext } = (await created.json()) as { plaintext: string };
    const valid = await get(t, cookie);
    const anonymous = await get(t);
    const pat = await get(t, undefined, {
      Authorization: `Bearer ${plaintext}`,
    });
    const forged = await get(t, undefined, {
      Authorization: 'Bearer arbitrary-jwt',
    });
    expect(valid.status).toBe(200);
    for (const response of [anonymous, pat, forged])
      expect(response.status).toBe(401);
    for (const response of [valid, anonymous, pat, forged]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Pragma')).toBe('no-cache');
    }
  });

  it('不接受 userId 参数读取其他成员的会话证明', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    const bobId = (await t.env.DB.prepare(
      "SELECT id FROM users WHERE username='bob'"
    ).first<{ id: string }>())!.id;
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_method = NULL, auth_time = NULL, second_factor_method = NULL, second_factor_time = NULL WHERE user_id = ?'
    )
      .bind(bobId)
      .run();
    const result = await call(t, `${ENDPOINT}?userId=${bobId}`, {
      cookie: admin,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ strength: 'password' });
    expect(await (await get(t, bob)).json()).toEqual(unknown);
  });

  it('同一成员的两个浏览器会话各自回显公开 id 并绑定自己的证明', async () => {
    const t = makeEnv();
    const first = await bootstrapAdmin(t);
    const firstEvidence = (await (await get(t, first)).json()) as {
      sessionId: string;
    };
    const second = await signIn(t, 'octocat', 'password123');
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_method = NULL, auth_time = NULL WHERE id = ?'
    )
      .bind(firstEvidence.sessionId)
      .run();
    const older = (await (await get(t, first)).json()) as {
      sessionId: string;
      strength: string;
    };
    const newer = (await (await get(t, second)).json()) as {
      sessionId: string;
      strength: string;
    };
    expect(older).toMatchObject({
      sessionId: firstEvidence.sessionId,
      strength: 'unknown',
    });
    expect(newer.strength).toBe('password');
    expect(newer.sessionId).not.toBe(older.sessionId);
  });
});
