import { describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { hashPassword } from 'better-auth/crypto';
import { createEmailVerificationToken } from 'better-auth/api';
import { authFor } from '../auth';
import {
  durableSessionAssurance,
  readSessionAuthentication,
} from '../auth/assurance';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';
import {
  register,
  pkce,
  REDIRECT,
  ORIGIN,
  raw,
  connect,
  rpc,
} from './helpers/mcp';

const PASSWORD = 'password123';
let ip = 0;
function request(t: TestEnv, path: string, json: unknown, cookie?: string) {
  return call(t, `/api/auth/${path}`, {
    json,
    cookie,
    headers: { 'cf-connecting-ip': `192.0.2.${(++ip % 250) + 1}` },
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
async function proof(t: TestEnv, cookie: string) {
  const result = await call(t, '/api/auth/get-session', { cookie });
  const body = (await result.json()) as {
    session: { id: string };
    user: { id: string };
  } | null;
  return body ? readSessionAuthentication(t.env, body.session.id) : null;
}
async function setup(enabled = true) {
  const t = makeEnv();
  const initial = await bootstrapAdmin(t);
  const begin = await request(
    t,
    'two-factor/enable',
    { password: PASSWORD },
    initial
  );
  expect(begin.status).toBe(200);
  const data = (await begin.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = new TextDecoder().decode(
    base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
  );
  const otp = createOTP(secret);
  if (!enabled) return { t, cookie: initial, otp, ...data };
  const response = await request(
    t,
    'two-factor/verify-totp',
    { code: await otp.hotp(Math.floor(Date.now() / 30000) - 1) },
    initial
  );
  expect(response.status).toBe(200);
  return { t, cookie: cookies(response), otp, ...data };
}
async function challenge(t: TestEnv) {
  const response = await request(t, 'sign-in/username', {
    username: 'octocat',
    password: PASSWORD,
  });
  expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
  return cookies(response);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('持久会话认证证明', () => {
  it('密码成功后记录真实证明，输入不能注入方法、时间或版本', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const before = Date.now();
    const response = await request(t, 'sign-in/username', {
      username: 'octocat',
      password: PASSWORD,
      authVersion: 999,
      authMethod: 'impersonation',
      authTime: 1,
      secondFactorMethod: 'totp',
      secondFactorTime: 1,
    });
    expect(response.status).toBe(200);
    const record = await proof(t, cookies(response));
    expect(record).toMatchObject({
      authVersion: 0,
      userAuthVersion: 0,
      authMethod: 'password',
      secondFactorMethod: null,
      secondFactorTime: null,
    });
    expect(Number(record?.authTime)).toBeGreaterThanOrEqual(before);
    expect(durableSessionAssurance(record!)).toMatchObject({
      strength: 'password',
      secondFactor: null,
    });
    const publicSession = (await (
      await call(t, '/api/auth/get-session', { cookie: cookies(response) })
    ).json()) as {
      session: Record<string, unknown>;
      user: Record<string, unknown>;
    };
    expect(publicSession.session).not.toHaveProperty('authVersion');
    expect(publicSession.session).not.toHaveProperty('authMethod');
    expect(publicSession.user).not.toHaveProperty('authVersion');
  });

  it('MFA 密码阶段不留下会话，挑战保留原密码证明时间', async () => {
    const { t } = await setup();
    const before = (await t.env.DB.prepare(
      'SELECT count(*) AS n FROM sessions'
    ).first())!.n;
    const pending = await challenge(t);
    expect(await proof(t, pending)).toBeNull();
    expect(
      (await t.env.DB.prepare('SELECT count(*) AS n FROM sessions').first())?.n
    ).toBe(before);
    const old = Date.now() - 120000;
    await t.env.DB.prepare(
      "UPDATE verifications SET created_at = ? WHERE identifier LIKE '2fa-generation-v1-%'"
    )
      .bind(old)
      .run();
    const factor = await t.env.DB.prepare(
      'SELECT backup_codes FROM two_factors'
    ).first();
    expect(factor).not.toBeNull();
    // Complete with the still valid authenticator, well after the password proof represented by the companion.
    const { symmetricDecrypt } = await import('better-auth/crypto');
    const row = await t.env.DB.prepare('SELECT secret FROM two_factors').first<{
      secret: string;
    }>();
    const secret = await symmetricDecrypt({
      key: t.env.BETTER_AUTH_SECRET,
      data: row!.secret,
    });
    const response = await request(
      t,
      'two-factor/verify-totp',
      { code: await createOTP(secret).totp() },
      pending
    );
    expect(response.status).toBe(200);
    const record = await proof(t, cookies(response));
    expect(record?.authTime).toBe(old);
    expect(Number(record?.secondFactorTime)).toBeGreaterThan(old);
    expect(durableSessionAssurance(record!)).toMatchObject({
      strength: 'multi_factor',
      secondFactor: { method: 'totp' },
    });
  });

  for (const method of ['totp', 'recovery_code']) {
    it(`真实 ${method} 挑战完成后记录方法，单码消费不推进恢复码组版本`, async () => {
      const { t, backupCodes, otp } = await setup();
      const pending = await challenge(t);
      const response = await request(
        t,
        method === 'totp'
          ? 'two-factor/verify-totp'
          : 'two-factor/verify-backup-code',
        {
          code: method === 'totp' ? await otp.totp() : backupCodes[0],
        },
        pending
      );
      expect(response.status).toBe(200);
      const record = await proof(t, cookies(response));
      expect(record).toMatchObject({
        authVersion: 1,
        authMethod: 'password',
        secondFactorMethod: method,
      });
      expect(durableSessionAssurance(record!).strength).toBe('multi_factor');
      expect(
        (
          await t.env.DB.prepare(
            'SELECT recovery_version FROM two_factors'
          ).first()
        )?.recovery_version
      ).toBe(0);
    });
  }

  it('恢复码重生成消费一次性证明，持久因子方法和时间保留', async () => {
    const { t, cookie } = await setup();
    const before = await proof(t, cookie);
    const generated = await request(
      t,
      'two-factor/generate-backup-codes',
      { password: PASSWORD },
      cookie
    );
    expect(generated.status).toBe(200);
    expect(
      (await t.env.DB.prepare('SELECT mfa_verified_at FROM sessions').first())
        ?.mfa_verified_at
    ).toBeNull();
    const after = await proof(t, cookie);
    expect(after?.secondFactorMethod).toBe(before?.secondFactorMethod);
    expect(after?.secondFactorTime).toBe(before?.secondFactorTime);
    expect(after?.authVersion).toBe(before?.authVersion);
    expect(durableSessionAssurance(after!).strength).toBe('multi_factor');
    expect(
      (
        await t.env.DB.prepare(
          'SELECT recovery_version FROM two_factors'
        ).first()
      )?.recovery_version
    ).toBe(1);
  });

  it('未知旧会话只验证第二因子时不推断过去已证明密码', async () => {
    const { t, cookie, backupCodes } = await setup();
    await t.env.DB.prepare(
      'UPDATE sessions SET auth_method = NULL, auth_time = NULL, second_factor_method = NULL, second_factor_time = NULL'
    ).run();
    const response = await request(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0] },
      cookie
    );
    expect(response.status).toBe(200);
    expect(durableSessionAssurance((await proof(t, cookie))!)).toMatchObject({
      strength: 'unknown',
      primary: null,
      secondFactor: { method: 'recovery_code' },
    });
  });

  it('原生滑动续期不刷新任何认证证明时间', async () => {
    const { t, cookie } = await setup();
    const before = await proof(t, cookie);
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ?, updated_at = ?')
      .bind(Date.now() + 86400000, Date.now() - 4 * 86400000)
      .run();
    expect((await call(t, '/api/auth/get-session', { cookie })).status).toBe(
      200
    );
    const after = await proof(t, cookie);
    expect(after?.authTime).toBe(before?.authTime);
    expect(after?.secondFactorTime).toBe(before?.secondFactorTime);
  });

  it('单独完成密码写入即使旧会话尚未删除，内部敏感会话也已经失效', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const before = await proof(t, cookie);
    const clientId = await register(t, 'Browser version guard');
    const challenge = await pkce();
    await t.env.DB.prepare(
      "UPDATE accounts SET password = ? WHERE provider_id = 'credential'"
    )
      .bind(await hashPassword('replacement-password'))
      .run();
    expect(
      await t.env.DB.prepare('SELECT id FROM sessions WHERE id = ?')
        .bind(before!.id)
        .first()
    ).not.toBeNull();
    expect(
      (await t.env.DB.prepare('SELECT auth_version FROM users').first())
        ?.auth_version
    ).toBe(1);
    expect(await proof(t, cookie)).toBeNull();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid',
      code_challenge: challenge.challenge,
      code_challenge_method: 'S256',
      resource: `${ORIGIN}/mcp`,
    });
    const authorization = await raw(t, `/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    expect(authorization.status).toBe(302);
    expect(
      new URL(authorization.headers.get('Location')!, ORIGIN).pathname
    ).toBe('/login');
    expect(
      (
        await request(
          t,
          'change-password',
          {
            currentPassword: 'replacement-password',
            newPassword: 'another-password',
          },
          cookie
        )
      ).status
    ).toBe(401);
    const response = await request(t, 'sign-in/username', {
      username: 'octocat',
      password: 'replacement-password',
    });
    expect(response.status).toBe(200);
    expect((await proof(t, cookies(response)))?.authVersion).toBe(1);
  });

  it('浏览器版本撤销不改写已有 MCP 授权规则，撤销 consent 仍立即生效', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const connection = await connect(t, cookie, 'Existing authorization');
    await t.env.DB.prepare(
      "UPDATE accounts SET password = ? WHERE provider_id = 'credential'"
    )
      .bind(await hashPassword('replacement-password'))
      .run();
    expect(await proof(t, cookie)).toBeNull();
    expect((await rpc(t, connection.access_token, 'tools/list')).status).toBe(
      200
    );
    const refreshed = await raw(t, '/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: connection.clientId,
        refresh_token: connection.refresh_token!,
        resource: `${ORIGIN}/mcp`,
      }),
    });
    expect(refreshed.status).toBe(200);
    await t.env.DB.prepare('DELETE FROM oauth_consents').run();
    expect((await rpc(t, connection.access_token, 'tools/list')).status).toBe(
      401
    );
  });

  it('会话读取后发生版本撤销，第二因子验证不能盲继承新版本复活旧会话', async () => {
    const { t, cookie, backupCodes } = await setup();
    const before = await proof(t, cookie);
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ?, updated_at = ?')
      .bind(Date.now() + 86400000, Date.now() - 4 * 86400000)
      .run();
    const context = await authFor(t.env).$context;
    const original = context.internalAdapter.updateSession;
    const reached = deferred();
    const resume = deferred();
    const spy = vi
      .spyOn(context.internalAdapter, 'updateSession')
      .mockImplementation(async (...args) => {
        const updated = await original(...args);
        reached.resolve();
        await resume.promise;
        return updated;
      });
    let pending: Promise<Response> | undefined;
    try {
      pending = request(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        cookie
      );
      await reached.promise;
      await t.env.DB.prepare(
        "UPDATE accounts SET password = ? WHERE provider_id = 'credential'"
      )
        .bind(await hashPassword('replacement-password'))
        .run();
      resume.resolve();
      expect((await pending).status).toBe(401);
      expect(
        (
          await t.env.DB.prepare(
            'SELECT auth_version FROM sessions WHERE id = ?'
          )
            .bind(before!.id)
            .first()
        )?.auth_version
      ).toBe(before?.authVersion);
      expect(
        (await t.env.DB.prepare('SELECT auth_version FROM users').first())
          ?.auth_version
      ).toBe(before!.authVersion! + 1);
      expect(await proof(t, cookie)).toBeNull();
    } finally {
      resume.resolve();
      await pending;
      spy.mockRestore();
    }
  });

  for (const enabled of [false, true]) {
    it(`${enabled ? '已启用' : '待绑定'}因子的离线恢复只推进一代`, async () => {
      const { t, cookie } = await setup(enabled);
      const record = await proof(t, cookie);
      await t.env.DB.prepare(
        'INSERT INTO mfa_recovery_events (id,user_id,reason,created_at) VALUES (?,?,?,?)'
      )
        .bind(
          crypto.randomUUID(),
          record!.userId,
          'lost second factor',
          Date.now()
        )
        .run();
      expect(
        (await t.env.DB.prepare('SELECT auth_version FROM users').first())
          ?.auth_version
      ).toBe(record!.authVersion! + 1);
      expect(await proof(t, cookie)).toBeNull();
      expect(
        await t.env.DB.prepare('SELECT id FROM two_factors').first()
      ).toBeNull();
    });
  }

  it('旧版本密码登录不能跨越保留密码的离线因子恢复', async () => {
    const { t, cookie } = await setup(false);
    const before = await proof(t, cookie);
    const context = await authFor(t.env).$context;
    const original = context.password.verify;
    const reached = deferred();
    const resume = deferred();
    const spy = vi
      .spyOn(context.password, 'verify')
      .mockImplementation(async (input) => {
        const result = await original(input);
        reached.resolve();
        await resume.promise;
        return result;
      });
    let pending: Promise<Response> | undefined;
    try {
      pending = request(t, 'sign-in/username', {
        username: 'octocat',
        password: PASSWORD,
      });
      await reached.promise;
      await t.env.DB.prepare(
        'INSERT INTO mfa_recovery_events (id,user_id,reason,created_at) VALUES (?,?,?,?)'
      )
        .bind(
          crypto.randomUUID(),
          before!.userId,
          'lost pending setup',
          Date.now()
        )
        .run();
      resume.resolve();
      const response = await pending;
      expect(response.status).toBe(401);
      expect(await proof(t, cookies(response))).toBeNull();
    } finally {
      resume.resolve();
      await pending;
      spy.mockRestore();
    }
  });

  it('自助密码轮换显式继承已知因子证明并推进会话版本', async () => {
    const { t, cookie } = await setup();
    const before = await proof(t, cookie);
    const response = await request(
      t,
      'change-password',
      {
        currentPassword: PASSWORD,
        newPassword: 'changed-password',
        revokeOtherSessions: true,
      },
      cookie
    );
    expect(response.status).toBe(200);
    const after = await proof(t, cookies(response));
    expect(after?.authVersion).toBe(before!.authVersion! + 1);
    expect(after?.authMethod).toBe('password');
    expect(after?.secondFactorMethod).toBe(before?.secondFactorMethod);
    expect(after?.secondFactorTime).toBe(before?.secondFactorTime);
    expect(await proof(t, cookie)).toBeNull();
  });

  it('邮箱验证会话记录邮箱证明，不标记密码或第二因子', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    await t.env.DB.prepare(
      "UPDATE users SET email_verified = 0 WHERE username = 'bob'"
    ).run();
    const context = await authFor(t.env).$context;
    const token = await createEmailVerificationToken(
      context.secret,
      'bob@example.com'
    );
    const response = await call(
      t,
      `/api/auth/verify-email?token=${token}&callbackURL=/`
    );
    const record = await proof(t, cookies(response));
    expect(durableSessionAssurance(record!)).toMatchObject({
      strength: 'email_verification',
      primary: { method: 'email_verification' },
      secondFactor: null,
    });
  });

  it('管理员模拟经过密码轮换和因子准备仍保留模拟来源', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    const user = await t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'bob'"
    ).first<{ id: string }>();
    const impersonation = await request(
      t,
      'admin/impersonate-user',
      { userId: user!.id },
      admin
    );
    expect(impersonation.status).toBe(200);
    const response = (await impersonation.clone().json()) as {
      session: Record<string, unknown>;
    };
    for (const field of [
      'authVersion',
      'authMethod',
      'authTime',
      'secondFactorMethod',
      'secondFactorTime',
      'mfaVerifiedAt',
    ])
      expect(response.session).not.toHaveProperty(field);
    const first = await proof(t, cookies(impersonation));
    expect(durableSessionAssurance(first!).strength).toBe('impersonated');
    const rotated = await request(
      t,
      'change-password',
      {
        currentPassword: PASSWORD,
        newPassword: 'bob-new-password',
        revokeOtherSessions: true,
      },
      cookies(impersonation)
    );
    expect(rotated.status).toBe(200);
    const nextCookie = cookies(rotated);
    expect(
      durableSessionAssurance((await proof(t, nextCookie))!).strength
    ).toBe('impersonated');
    expect(
      (
        await request(
          t,
          'two-factor/enable',
          { password: 'bob-new-password' },
          nextCookie
        )
      ).status
    ).toBe(200);
    const after = await proof(t, nextCookie);
    expect(durableSessionAssurance(after!).strength).toBe('impersonated');
    expect(
      (
        await t.env.DB.prepare(
          'SELECT impersonated_by FROM sessions WHERE id = ?'
        )
          .bind(after!.id)
          .first()
      )?.impersonated_by
    ).toBeTruthy();
  });
});
