import { describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { hashPassword } from 'better-auth/crypto';
import { authFor } from '../../auth';
import {
  bootstrapAdmin,
  call,
  makeEnv,
  signIn,
  type TestEnv,
} from '../helpers/app';
import { raw } from '../helpers/mcp';

const PASSWORD = 'password123';
const ENDPOINT = '/api/auth/reauthenticate';
let ip = 0;
function request(t: TestEnv, cookie: string | undefined, json: unknown) {
  return call(t, ENDPOINT, {
    cookie,
    json,
    headers: {
      'cf-connecting-ip': `198.51.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`,
    },
  });
}
function cookies(response: Response) {
  const jar = new Map<string, string>();
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0];
    jar.set(pair.slice(0, pair.indexOf('=')), pair);
  }
  return [...jar.values()].join('; ');
}
function freshCode(otp: ReturnType<typeof createOTP>) {
  // Enrollment consumes the current step. Its successor remains in the accepted window across a period boundary.
  return otp.hotp(Math.floor(Date.now() / 30_000) + 1);
}
async function identity(t: TestEnv, cookie: string) {
  const response = await call(t, '/api/auth/get-session', { cookie });
  return (await response.json()) as {
    session: { id: string };
    user: { id: string };
  };
}
async function evidence(t: TestEnv, sessionId: string) {
  return t.env.DB.prepare(
    'SELECT id, token, auth_version, auth_method, auth_time, second_factor_method, second_factor_time, mfa_verified_at FROM sessions WHERE id = ?'
  )
    .bind(sessionId)
    .first();
}
async function age(t: TestEnv, sessionId: string) {
  await t.env.DB.prepare(
    'UPDATE sessions SET auth_time = ?, second_factor_time = CASE WHEN second_factor_time IS NULL THEN NULL ELSE ? END WHERE id = ?'
  )
    .bind(Date.now() - 600_000, Date.now() - 600_000, sessionId)
    .run();
  return evidence(t, sessionId);
}
async function setup(enabled = false) {
  const t = makeEnv();
  let cookie = await bootstrapAdmin(t);
  let otp: ReturnType<typeof createOTP> | undefined;
  let backupCodes: string[] = [];
  if (enabled) {
    const response = await call(t, '/api/auth/two-factor/enable', {
      cookie,
      json: { password: PASSWORD },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    backupCodes = data.backupCodes;
    otp = createOTP(
      new TextDecoder().decode(
        base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
      )
    );
    const confirmed = await call(t, '/api/auth/two-factor/verify-totp', {
      cookie,
      json: { code: await otp.totp() },
    });
    expect(confirmed.status).toBe(200);
    cookie = cookies(confirmed);
  }
  const { session, user } = await identity(t, cookie);
  const before = await age(t, session.id);
  return {
    t,
    cookie,
    sessionId: session.id,
    userId: user.id,
    before,
    otp,
    backupCodes,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('当前浏览器联合重新验证', () => {
  it('无因子账号验证真实密码并保留同一会话，不能凭空建立第二因子或一次性证明', async () => {
    const { t, cookie, sessionId, before } = await setup();
    const start = Date.now();
    const response = await request(t, cookie, {
      sessionId,
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true, sessionId });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(
      response.headers
        .getSetCookie()
        .filter((value) => value.startsWith('cloudforge.session_token='))
    ).toEqual([]);
    const after = await evidence(t, sessionId);
    expect(after).toMatchObject({
      id: sessionId,
      token: before!.token,
      auth_version: before!.auth_version,
      auth_method: 'password',
      second_factor_method: null,
      second_factor_time: null,
      mfa_verified_at: null,
    });
    expect(after!.auth_time).toBeGreaterThanOrEqual(start);
    const audit = await t.env.DB.prepare(
      "SELECT data FROM audit_events WHERE action = 'user.reauthenticated'"
    ).first<{ data: string }>();
    expect(JSON.parse(audit!.data)).toEqual({
      reauthentication: true,
      factor: null,
    });
  });

  it('密码错误、缺少会话、身份错配及伪造字段都不能刷新证明', async () => {
    const { t, cookie, sessionId, before } = await setup();
    for (const [json, status, code] of [
      [
        { sessionId, password: 'wrong-password' },
        401,
        'REAUTHENTICATION_INVALID_PASSWORD',
      ],
      [
        { sessionId: 'another-session', password: PASSWORD },
        403,
        'REAUTHENTICATION_SESSION_MISMATCH',
      ],
      [{ sessionId, password: PASSWORD, authTime: Date.now() }, 400, undefined],
    ] as const) {
      const response = await request(t, cookie, json);
      expect(response.status, await response.clone().text()).toBe(status);
      if (code) expect(await response.json()).toMatchObject({ code });
      expect(await evidence(t, sessionId)).toEqual(before);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const anonymous = await request(t, undefined, {
      sessionId,
      password: PASSWORD,
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('no-store');
    expect(await evidence(t, sessionId)).toEqual(before);
  });

  it('跨来源、Bearer 和未完成登录的第二因子cookie都不能作为当前浏览器重验', async () => {
    const { t, cookie, sessionId, before } = await setup(true);
    const crossed = await raw(t, ENDPOINT, {
      method: 'POST',
      headers: {
        Origin: 'http://evil.test.local',
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        password: PASSWORD,
        method: 'recovery_code',
        code: 'invalid',
      }),
    });
    expect(crossed.status).toBe(403);
    expect(
      await t.env.DB.prepare(
        "SELECT count(*) AS n FROM rate_limits WHERE key LIKE 'cloudforge:reauthentication:%'"
      ).first()
    ).toMatchObject({ n: 0 });
    const bearer = await call(t, ENDPOINT, {
      json: { sessionId, password: PASSWORD },
      headers: { Authorization: 'Bearer arbitrary-token' },
    });
    expect(bearer.status).toBe(401);
    const challenge = await call(t, '/api/auth/sign-in/username', {
      json: { username: 'octocat', password: PASSWORD },
    });
    expect(await challenge.json()).toMatchObject({ twoFactorRedirect: true });
    expect(
      (await request(t, cookies(challenge), { sessionId, password: PASSWORD }))
        .status
    ).toBe(401);
    expect(await evidence(t, sessionId)).toEqual(before);
  });

  it('启用因子时只有密码、错误验证码均不刷新任一证明', async () => {
    const { t, cookie, sessionId, before } = await setup(true);
    for (const json of [
      { sessionId, password: PASSWORD },
      { sessionId, password: PASSWORD, method: 'totp', code: 'invalid' },
      {
        sessionId,
        password: PASSWORD,
        method: 'recovery_code',
        code: 'invalid',
      },
    ]) {
      const response = await request(t, cookie, json);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await evidence(t, sessionId)).toEqual(before);
    }
  });

  it('同次密码与TOTP刷新持久证明但不刷新一次性MFA证明，原生验证拒绝复用该码', async () => {
    const { t, cookie, sessionId, otp } = await setup(true);
    await t.env.DB.prepare(
      'UPDATE sessions SET mfa_verified_at = NULL WHERE id = ?'
    )
      .bind(sessionId)
      .run();
    const before = await evidence(t, sessionId);
    const start = Date.now();
    const code = await freshCode(otp!);
    const response = await request(t, cookie, {
      sessionId,
      password: PASSWORD,
      method: 'totp',
      code,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await evidence(t, sessionId);
    expect(after).toMatchObject({
      token: before!.token,
      auth_method: 'password',
      second_factor_method: 'totp',
      mfa_verified_at: before!.mfa_verified_at,
    });
    expect(after!.auth_time).toBeGreaterThanOrEqual(start);
    expect(after!.second_factor_time).toBeGreaterThanOrEqual(start);
    const repeated = await call(t, '/api/auth/two-factor/verify-totp', {
      cookie,
      json: { code },
    });
    expect(repeated.status).toBe(403);
    expect(await repeated.json()).toMatchObject({ code: 'TOTP_ALREADY_USED' });
  });

  it('原生验证消费的TOTP也不能重新用于联合重验', async () => {
    const { t, cookie, sessionId, otp } = await setup(true);
    const code = await freshCode(otp!);
    expect(
      (
        await call(t, '/api/auth/two-factor/verify-totp', {
          cookie,
          json: { code },
        })
      ).status
    ).toBe(200);
    const before = await age(t, sessionId);
    const response = await request(t, cookie, {
      sessionId,
      password: PASSWORD,
      method: 'totp',
      code,
    });
    expect(response.status).toBe(403);
    expect(await evidence(t, sessionId)).toEqual(before);
  });

  it('恢复码联合重验只消费一次且不推进整组版本，两浏览器并发只有一次成功', async () => {
    const { t, cookie, sessionId, before, backupCodes } = await setup(true);
    const challenge = await call(t, '/api/auth/sign-in/username', {
      json: { username: 'octocat', password: PASSWORD },
    });
    const login = await call(t, '/api/auth/two-factor/verify-backup-code', {
      cookie: cookies(challenge),
      json: { code: backupCodes[9] },
    });
    expect(login.status).toBe(200);
    const secondCookie = cookies(login);
    const secondId = (await identity(t, secondCookie)).session.id;
    const results = await Promise.all([
      request(t, cookie, {
        sessionId,
        password: PASSWORD,
        method: 'recovery_code',
        code: backupCodes[0],
      }),
      request(t, secondCookie, {
        sessionId: secondId,
        password: PASSWORD,
        method: 'recovery_code',
        code: backupCodes[0],
      }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    const winner = results[0].ok ? sessionId : secondId;
    expect(await evidence(t, winner)).toMatchObject({
      second_factor_method: 'recovery_code',
    });
    expect((await evidence(t, sessionId))!.mfa_verified_at).toBe(
      before!.mfa_verified_at
    );
    expect(
      await t.env.DB.prepare('SELECT recovery_version FROM two_factors').first()
    ).toMatchObject({ recovery_version: 0 });
    const replay = await call(t, '/api/auth/two-factor/verify-backup-code', {
      cookie,
      json: { code: backupCodes[0] },
    });
    expect(replay.status).toBe(401);
  });

  it('密码预算在并发请求及不同IP和浏览器间共享，时间窗口结束才能再试', async () => {
    const { t, cookie, sessionId, before } = await setup();
    const secondCookie = await signIn(t, 'octocat', PASSWORD);
    const secondId = (await identity(t, secondCookie)).session.id;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        request(t, index % 2 ? secondCookie : cookie, {
          sessionId: index % 2 ? secondId : sessionId,
          password: 'wrong-password',
        })
      )
    );
    expect(results.filter((response) => response.status === 401)).toHaveLength(
      10
    );
    expect(results.filter((response) => response.status === 429)).toHaveLength(
      2
    );
    expect(await evidence(t, sessionId)).toEqual(before);
    const locked = await request(t, cookie, { sessionId, password: PASSWORD });
    expect(locked.status).toBe(429);
    await t.env.DB.prepare(
      "UPDATE rate_limits SET last_request = ? WHERE key LIKE 'cloudforge:reauthentication:%'"
    )
      .bind(Date.now() - 901_000)
      .run();
    expect(
      (await request(t, cookie, { sessionId, password: PASSWORD })).status
    ).toBe(200);
  });

  it('因子预算与原生验证共享，不能通过联合重验绕过已有账号锁', async () => {
    const { t, cookie, sessionId, before, backupCodes } = await setup(true);
    await t.env.DB.prepare(
      'UPDATE two_factors SET failed_verification_count = 10, locked_until = ?'
    )
      .bind(Date.now() + 900_000)
      .run();
    const response = await request(t, cookie, {
      sessionId,
      password: PASSWORD,
      method: 'recovery_code',
      code: backupCodes[0],
    });
    expect(response.status).toBe(429);
    expect(await evidence(t, sessionId)).toEqual(before);
  });

  it('完整成功后原子清理密码预算，正确用户连续重验不会累计锁定', async () => {
    const { t, cookie, sessionId } = await setup();
    for (let index = 0; index < 12; index++) {
      const response = await request(t, cookie, {
        sessionId,
        password: PASSWORD,
      });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    expect(
      await t.env.DB.prepare(
        "SELECT count FROM rate_limits WHERE key LIKE 'cloudforge:reauthentication:%'"
      ).first()
    ).toMatchObject({ count: 0 });
  });

  it('模拟身份即便提供目标密码也不能升级为真实密码证明', async () => {
    const { t, cookie, sessionId } = await setup();
    await t.env.DB.prepare(
      "UPDATE sessions SET auth_method = 'impersonation', impersonated_by = 'administrator' WHERE id = ?"
    )
      .bind(sessionId)
      .run();
    const before = await evidence(t, sessionId);
    const response = await request(t, cookie, {
      sessionId,
      password: PASSWORD,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'REAUTHENTICATION_IMPERSONATION_FORBIDDEN',
    });
    expect(await evidence(t, sessionId)).toEqual(before);
  });

  for (const change of ['封禁', '恢复码组变化'] as const)
    it(`恢复码已消费后${change}，最终提交仍不能刷新证明或清理失败预算`, async () => {
      const { t, cookie, sessionId, userId, before, backupCodes } =
        await setup(true);
      const originalCodes = await t.env.DB.prepare(
        'SELECT backup_codes FROM two_factors WHERE user_id = ?'
      )
        .bind(userId)
        .first<{ backup_codes: string }>();
      const batch = t.env.DB.batch.bind(t.env.DB);
      let intercepted = false;
      const spy = vi
        .spyOn(t.env.DB, 'batch')
        .mockImplementation(async (statements) => {
          intercepted = true;
          const consumed = await t.env.DB.prepare(
            'SELECT backup_codes FROM two_factors WHERE user_id = ?'
          )
            .bind(userId)
            .first<{ backup_codes: string }>();
          expect(consumed?.backup_codes).not.toBe(originalCodes!.backup_codes);
          expect(await evidence(t, sessionId)).toEqual(before);
          if (change === '封禁')
            await t.env.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?')
              .bind(userId)
              .run();
          else
            await t.env.DB.prepare(
              'UPDATE two_factors SET recovery_version = recovery_version + 1 WHERE user_id = ?'
            )
              .bind(userId)
              .run();
          return batch(statements);
        });
      try {
        const response = await request(t, cookie, {
          sessionId,
          password: PASSWORD,
          method: 'recovery_code',
          code: backupCodes[0],
        });
        expect(response.status, await response.clone().text()).toBe(401);
        expect(intercepted).toBe(true);
        expect(await evidence(t, sessionId)).toEqual(before);
        expect(
          await t.env.DB.prepare('SELECT count FROM rate_limits WHERE key = ?')
            .bind(`cloudforge:reauthentication:${userId}`)
            .first()
        ).toEqual({ count: 1 });
        expect(
          await t.env.DB.prepare(
            'SELECT failed_verification_count FROM two_factors WHERE user_id = ?'
          )
            .bind(userId)
            .first()
        ).toEqual({ failed_verification_count: 1 });
      } finally {
        spy.mockRestore();
      }
    });

  for (const enabled of [false, true]) {
    const mutations = [
      '撤销会话',
      '会话过期',
      '封禁账号',
      '更换密码',
      ...(enabled ? ['更新因子代', '更新恢复码组'] : []),
    ];
    for (const mutation of mutations) {
      it(`${enabled ? '有因子' : '无因子'}密码验证期间${mutation}，延迟请求不能刷新任何证明`, async () => {
        const { t, cookie, sessionId, userId, before, backupCodes } =
          await setup(enabled);
        const context = await authFor(t.env).$context;
        const original = context.password.verify;
        const reached = deferred();
        const resume = deferred();
        const replacement =
          mutation === '更换密码'
            ? await hashPassword('replacement-password')
            : undefined;
        const spy = vi
          .spyOn(context.password, 'verify')
          .mockImplementation(async (input) => {
            const result = await original(input);
            reached.resolve();
            await resume.promise;
            return result;
          });
        let checking: Promise<Response> | undefined;
        try {
          checking = request(t, cookie, {
            sessionId,
            password: PASSWORD,
            ...(enabled
              ? { method: 'recovery_code', code: backupCodes[0] }
              : {}),
          });
          await reached.promise;
          if (mutation === '撤销会话')
            await t.env.DB.prepare('DELETE FROM sessions WHERE id = ?')
              .bind(sessionId)
              .run();
          else if (mutation === '会话过期')
            await t.env.DB.prepare(
              'UPDATE sessions SET expires_at = ? WHERE id = ?'
            )
              .bind(Date.now() - 1, sessionId)
              .run();
          else if (mutation === '封禁账号')
            await t.env.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?')
              .bind(userId)
              .run();
          else if (mutation === '更换密码')
            await t.env.DB.prepare(
              "UPDATE accounts SET password = ? WHERE user_id = ? AND provider_id = 'credential'"
            )
              .bind(replacement!, userId)
              .run();
          else if (mutation === '更新因子代')
            await t.env.DB.prepare(
              'UPDATE two_factors SET secret = ? WHERE user_id = ?'
            )
              .bind('changed-encrypted-factor', userId)
              .run();
          else
            await t.env.DB.prepare(
              'UPDATE two_factors SET recovery_version = recovery_version + 1 WHERE user_id = ?'
            )
              .bind(userId)
              .run();
          resume.resolve();
          const response = await checking;
          expect(
            response.status,
            await response.clone().text()
          ).toBeGreaterThanOrEqual(400);
          expect(await evidence(t, sessionId)).toEqual(
            mutation === '撤销会话' ? null : before
          );
        } finally {
          resume.resolve();
          await checking;
          spy.mockRestore();
        }
      });
    }
  }
});
