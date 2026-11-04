// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { drizzle } from 'drizzle-orm/d1';
import { authFor } from '../../auth';
import { readSessionAuthentication } from '../../auth/assurance';
import { currentSession } from '../../auth/session';
import { schema } from '../../db/schema';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';

const PASSWORD = 'password123';
let ip = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // D1's write-time clock stays real: keep the fixed TOTP midpoint in the past.
  vi.setSystemTime(
    Math.floor((Date.now() - 15_000) / 30_000) * 30_000 + 15_000
  );
});
afterEach(() => vi.useRealTimers());
const request = (t: TestEnv, path: string, cookie?: string, json?: unknown) =>
  call(t, `/api/auth/${path}`, {
    cookie,
    json,
    headers: {
      'cf-connecting-ip': `192.0.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`,
    },
  });
function cookies(response: Response) {
  const values = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const value = header.split(';')[0];
    values.set(value.slice(0, value.indexOf('=')), value);
  }
  return [...values.values()].join('; ');
}
async function identity(t: TestEnv, cookie: string) {
  const response = await request(t, 'get-session', cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    session: { id: string };
    user: { id: string };
  } | null;
}
async function read(t: TestEnv, cookie: string) {
  return currentSession(
    drizzle(t.env.DB, { schema }),
    t.env,
    new Headers({ cookie })
  );
}
async function policy(t: TestEnv, version: number, required: boolean) {
  await t.env.DB.prepare(
    `INSERT INTO authentication_policy (id, version, require_mfa)
    VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, require_mfa = excluded.require_mfa`
  )
    .bind(version, required ? 1 : 0)
    .run();
}
async function changePolicy(t: TestEnv, cookie: string, required: boolean) {
  const preview = await call(t, '/api/admin/authentication-policy/preview', {
    cookie,
    json: { requireMfa: required },
  });
  expect(preview.status, await preview.clone().text()).toBe(200);
  const value = (await preview.json()) as { previewId: string; digest: string };
  const applied = await call(t, '/api/admin/authentication-policy/apply', {
    cookie,
    json: {
      previewId: value.previewId,
      digest: value.digest,
      recoveryAcknowledged: true,
    },
  });
  expect(applied.status, await applied.clone().text()).toBe(200);
  return (await applied.json()) as {
    policy: { version: number; requireMfa: boolean };
  };
}
async function enrollment(t: TestEnv, cookie: string) {
  const response = await request(t, 'two-factor/enable', cookie, {
    password: PASSWORD,
  });
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const otp = createOTP(
    new TextDecoder().decode(
      base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
    )
  );
  return { ...data, otp };
}
async function setup(enabled = false) {
  const t = makeEnv();
  let cookie = await bootstrapAdmin(t);
  let backupCodes: string[] = [];
  if (enabled) {
    const value = await enrollment(t, cookie);
    backupCodes = value.backupCodes;
    const response = await request(t, 'two-factor/verify-totp', cookie, {
      code: await value.otp.totp(),
    });
    expect(response.status).toBe(200);
    cookie = cookies(response);
  }
  const active = (await identity(t, cookie))!;
  return {
    t,
    cookie,
    backupCodes,
    sessionId: active.session.id,
    userId: active.user.id,
  };
}
async function challenge(t: TestEnv) {
  const response = await request(t, 'sign-in/username', undefined, {
    username: 'octocat',
    password: PASSWORD,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
  return cookies(response);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('认证策略的浏览器证明代际', () => {
  it('唯一管理员在强制策略下完成实际离线撤销、重新绑定及联合重验后恢复管理', async () => {
    const { t, cookie, userId } = await setup(true);
    expect(await changePolicy(t, cookie, true)).toEqual({
      policy: { version: 1, requireMfa: true },
    });
    expect((await read(t, cookie))?.browserSession.policy.access).toBe('full');
    expect(
      await t.env.DB.prepare(
        "SELECT count(*) AS n FROM users WHERE role = 'admin'"
      ).first()
    ).toEqual({ n: 1 });
    await t.env.DB.prepare(
      'INSERT INTO mfa_recovery_events (id,user_id,reason,created_at) VALUES (?,?,?,?)'
    )
      .bind(
        crypto.randomUUID(),
        userId,
        'only administrator lost authenticator',
        Date.now()
      )
      .run();
    expect(await identity(t, cookie)).toBeNull();
    const signedIn = await request(t, 'sign-in/username', undefined, {
      username: 'octocat',
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
    const limited = cookies(signedIn);
    expect((await read(t, limited))?.browserSession.policy.access).toBe(
      'enroll_mfa'
    );
    expect(
      (await call(t, '/api/admin/settings', { cookie: limited })).status
    ).toBe(403);
    const value = await enrollment(t, limited);
    expect(value.backupCodes).toHaveLength(10);
    const stored = await t.env.DB.prepare(
      'SELECT backup_codes FROM two_factors'
    ).first<{ backup_codes: string }>();
    expect(stored?.backup_codes).not.toContain(value.backupCodes[0]);
    const confirmed = await request(t, 'two-factor/verify-totp', limited, {
      code: await value.otp.totp(),
    });
    expect(confirmed.status).toBe(200);
    const restored = cookies(confirmed);
    const active = (await identity(t, restored))!;
    expect(
      (
        await request(t, 'reauthenticate', restored, {
          sessionId: active.session.id,
          password: PASSWORD,
          method: 'recovery_code',
          code: value.backupCodes[0],
        })
      ).status
    ).toBe(200);
    expect((await read(t, restored))?.browserSession.policy).toMatchObject({
      version: 1,
      requireMfa: true,
      enrolled: true,
      access: 'full',
    });
    expect(
      (await call(t, '/api/admin/settings', { cookie: restored })).status
    ).toBe(200);
    expect(
      await t.env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action = 'user.mfa_reset'"
      ).first()
    ).toEqual({ n: 1 });
  });

  it('策略再次关闭后的管理员模拟保留当前策略但不能重验洗白，且可退出模拟', async () => {
    const { t, cookie, userId } = await setup(true);
    await addMember(t, cookie, 'bob');
    await changePolicy(t, cookie, true);
    expect(await changePolicy(t, cookie, false)).toEqual({
      policy: { version: 2, requireMfa: false },
    });
    const bob = (await t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'bob'"
    ).first<{ id: string }>())!;
    const response = await request(t, 'admin/impersonate-user', cookie, {
      userId: bob.id,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()) as object).not.toHaveProperty(
      'session.policyVersion'
    );
    const simulated = cookies(response);
    const active = (await identity(t, simulated))!;
    expect((await read(t, simulated))?.browserSession.policy).toEqual({
      version: 2,
      requireMfa: false,
      enrolled: false,
      access: 'full',
    });
    expect(
      await readSessionAuthentication(t.env, active.session.id)
    ).toMatchObject({
      policyVersion: 2,
      authMethod: 'impersonation',
      impersonatedBy: userId,
    });
    expect((await call(t, '/api/repos', { cookie: simulated })).status).toBe(
      200
    );
    const proof = await request(t, 'reauthenticate', simulated, {
      sessionId: active.session.id,
      password: PASSWORD,
    });
    expect(proof.status).toBe(403);
    expect(await proof.json()).toMatchObject({
      code: 'REAUTHENTICATION_IMPERSONATION_FORBIDDEN',
    });
    expect(
      await readSessionAuthentication(t.env, active.session.id)
    ).toMatchObject({
      policyVersion: 2,
      authMethod: 'impersonation',
      secondFactorMethod: null,
    });
    const stopped = await request(t, 'admin/stop-impersonating', simulated, {});
    expect(stopped.status).toBe(200);
    expect((await identity(t, cookies(stopped)))?.user.id).toBe(userId);
  });
  it('默认零代策略兼容旧会话，策略读取不会升级旧证明或污染用户身份', async () => {
    const { t, cookie, sessionId } = await setup();
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_method = NULL, auth_time = NULL WHERE id = ?'
    )
      .bind(sessionId)
      .run();
    expect((await read(t, cookie))?.browserSession.policy).toEqual({
      version: 0,
      requireMfa: false,
      enrolled: false,
      access: 'full',
    });
    await policy(t, 2, false);
    const current = await read(t, cookie);
    expect(current?.browserSession.policy).toEqual({
      version: 2,
      requireMfa: false,
      enrolled: false,
      access: 'reauthenticate',
    });
    expect(current?.user).not.toHaveProperty('policyVersion');
    expect(current?.user).not.toHaveProperty('twoFactorEnabled');
    expect(await readSessionAuthentication(t.env, sessionId)).toMatchObject({
      policyVersion: 0,
      enrolled: false,
      policy: { version: 2, requireMfa: false },
    });
  });

  it('强制策略下的新密码会话只得到绑定通道，输入不能注入策略版本', async () => {
    const { t } = await setup();
    await policy(t, 1, true);
    const response = await request(t, 'sign-in/username', undefined, {
      username: 'octocat',
      password: PASSWORD,
      policyVersion: 999,
    });
    expect(response.status).toBe(200);
    const cookie = cookies(response);
    const active = (await identity(t, cookie))!;
    expect((await read(t, cookie))?.browserSession.policy).toMatchObject({
      version: 1,
      access: 'enroll_mfa',
    });
    expect(
      await readSessionAuthentication(t.env, active.session.id)
    ).toMatchObject({
      policyVersion: 1,
      authMethod: 'password',
      secondFactorMethod: null,
    });
    const publicSession = (await (
      await request(t, 'get-session', cookie)
    ).json()) as { session: object };
    expect(publicSession.session).not.toHaveProperty('policyVersion');
  });

  it('已有会话的单因子验证不能升级策略代际，联合重验才可恢复完整访问', async () => {
    const { t, cookie, sessionId, backupCodes } = await setup(true);
    await policy(t, 1, true);
    const factor = await request(t, 'two-factor/verify-backup-code', cookie, {
      code: backupCodes[0],
    });
    expect(factor.status).toBe(200);
    expect(await readSessionAuthentication(t.env, sessionId)).toMatchObject({
      policyVersion: 0,
    });
    expect((await read(t, cookie))?.browserSession.policy.access).toBe(
      'reauthenticate'
    );
    expect(
      (
        await request(t, 'reauthenticate', cookie, {
          sessionId,
          password: PASSWORD,
          method: 'recovery_code',
          code: backupCodes[1],
        })
      ).status
    ).toBe(200);
    expect((await read(t, cookie))?.browserSession.policy.access).toBe('full');
    expect(await readSessionAuthentication(t.env, sessionId)).toMatchObject({
      policyVersion: 1,
      authMethod: 'password',
      secondFactorMethod: 'recovery_code',
    });
  });

  it('策略切换使旧MFA挑战失效，新挑战完成后带当前版本', async () => {
    const { t, backupCodes } = await setup(true);
    await policy(t, 1, true);
    const old = await challenge(t);
    await policy(t, 2, true);
    const stale = await request(t, 'two-factor/verify-backup-code', old, {
      code: backupCodes[0],
    });
    expect(stale.status).toBe(401);
    const next = await challenge(t);
    const response = await request(t, 'two-factor/verify-backup-code', next, {
      code: backupCodes[0],
    });
    expect(response.status).toBe(200);
    expect(
      (await read(t, cookies(response)))?.browserSession.policy
    ).toMatchObject({ version: 2, access: 'full' });
  });

  it('密码验证期间切换策略，旧登录不能继承新版本', async () => {
    const { t } = await setup();
    const context = await authFor(t.env).$context;
    const original = context.password.verify;
    const reached = deferred(),
      resume = deferred();
    const spy = vi
      .spyOn(context.password, 'verify')
      .mockImplementation(async (input) => {
        const valid = await original(input);
        reached.resolve();
        await resume.promise;
        return valid;
      });
    let checking: Promise<Response> | undefined;
    try {
      checking = request(t, 'sign-in/username', undefined, {
        username: 'octocat',
        password: PASSWORD,
      });
      await reached.promise;
      await policy(t, 1, true);
      resume.resolve();
      const response = await checking;
      expect(response.status).toBe(401);
      expect(await identity(t, cookies(response))).toBeNull();
    } finally {
      resume.resolve();
      await checking;
      spy.mockRestore();
    }
  });

  for (const enabled of [false, true])
    it(`${enabled ? '有因子' : '无因子'}联合重验期间策略再变化，失败不得刷新或升级证明`, async () => {
      const { t, cookie, sessionId, backupCodes } = await setup(enabled);
      await policy(t, 1, enabled);
      const before = await t.env.DB.prepare(
        'SELECT policy_version, auth_time, second_factor_time FROM sessions WHERE id = ?'
      )
        .bind(sessionId)
        .first();
      const context = await authFor(t.env).$context;
      const original = context.password.verify;
      const reached = deferred(),
        resume = deferred();
      const spy = vi
        .spyOn(context.password, 'verify')
        .mockImplementation(async (input) => {
          const valid = await original(input);
          reached.resolve();
          await resume.promise;
          return valid;
        });
      let checking: Promise<Response> | undefined;
      try {
        checking = request(t, 'reauthenticate', cookie, {
          sessionId,
          password: PASSWORD,
          ...(enabled ? { method: 'recovery_code', code: backupCodes[0] } : {}),
        });
        await reached.promise;
        await policy(t, 2, enabled);
        resume.resolve();
        expect((await checking).status).toBe(401);
        expect(
          await t.env.DB.prepare(
            'SELECT policy_version, auth_time, second_factor_time FROM sessions WHERE id = ?'
          )
            .bind(sessionId)
            .first()
        ).toEqual(before);
      } finally {
        resume.resolve();
        await checking;
        spy.mockRestore();
      }
    });

  it('跨策略完成首次绑定保留旧版本，随后联合重验才完整进入', async () => {
    const { t, cookie } = await setup();
    const value = await enrollment(t, cookie);
    await policy(t, 1, true);
    const response = await request(t, 'two-factor/verify-totp', cookie, {
      code: await value.otp.totp(),
    });
    expect(response.status).toBe(200);
    const nextCookie = cookies(response);
    const active = (await identity(t, nextCookie))!;
    expect((await read(t, nextCookie))?.browserSession.policy).toMatchObject({
      version: 1,
      enrolled: true,
      access: 'reauthenticate',
    });
    expect(
      await readSessionAuthentication(t.env, active.session.id)
    ).toMatchObject({ policyVersion: 0 });
    expect(
      (
        await request(t, 'reauthenticate', nextCookie, {
          sessionId: active.session.id,
          password: PASSWORD,
          method: 'recovery_code',
          code: value.backupCodes[0],
        })
      ).status
    ).toBe(200);
    expect((await read(t, nextCookie))?.browserSession.policy.access).toBe(
      'full'
    );
  });

  it('强制策略阻止网页关闭因子，关闭事务前的策略切换也保留原因子', async () => {
    const { t, cookie, sessionId, backupCodes } = await setup(true);
    await policy(t, 1, true);
    expect(
      (
        await request(t, 'reauthenticate', cookie, {
          sessionId,
          password: PASSWORD,
          method: 'recovery_code',
          code: backupCodes[0],
        })
      ).status
    ).toBe(200);
    expect(
      (await request(t, 'two-factor/disable', cookie, { password: PASSWORD }))
        .status
    ).toBe(403);
    await policy(t, 2, false);
    expect(
      (
        await request(t, 'reauthenticate', cookie, {
          sessionId,
          password: PASSWORD,
          method: 'recovery_code',
          code: backupCodes[1],
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request(t, 'two-factor/verify-backup-code', cookie, {
          code: backupCodes[2],
        })
      ).status
    ).toBe(200);
    const batch = t.env.DB.batch.bind(t.env.DB);
    let intercepted = false;
    const spy = vi
      .spyOn(t.env.DB, 'batch')
      .mockImplementation(async (statements) => {
        intercepted = true;
        await policy(t, 3, true);
        return batch(statements);
      });
    try {
      const response = await request(t, 'two-factor/disable', cookie, {
        password: PASSWORD,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(intercepted).toBe(true);
      expect(
        await t.env.DB.prepare('SELECT verified FROM two_factors').first()
      ).toEqual({ verified: 1 });
      expect(
        await t.env.DB.prepare(
          "SELECT two_factor_enabled FROM users WHERE username = 'octocat'"
        ).first()
      ).toEqual({ two_factor_enabled: 1 });
    } finally {
      spy.mockRestore();
    }
  });
});
