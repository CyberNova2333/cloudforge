import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { createEmailVerificationToken } from 'better-auth/api';
import { authFor } from '../../auth';
import {
  bootstrapAdmin,
  addMember,
  call,
  makeEnv,
  signIn,
  type TestEnv,
} from '../helpers/app';
import {
  connect,
  ORIGIN,
  REDIRECT,
  pkce,
  raw,
  register,
  rpc,
} from '../helpers/mcp';

const PASSWORD = 'password123';
// Keep the real async D1/crypto work, while preventing a period boundary between enrollment and login.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
});
afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let ip = 0;
function authCall(t: TestEnv, path: string, json: unknown, cookie?: string) {
  // Each browser has an independent test IP; account/challenge budgets remain real D1 state.
  return call(t, `/api/auth/${path}`, {
    cookie,
    json,
    headers: {
      'cf-connecting-ip': `203.0.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`,
    },
  });
}
function cookies(res: Response) {
  // A browser applies repeated Set-Cookie names in order (impersonation first clears,
  // then sets the session). Preserve its final value rather than sending duplicate names.
  const jar = new Map<string, string>();
  for (const value of res.headers.getSetCookie()) {
    const pair = value.split(';')[0];
    jar.set(pair.slice(0, pair.indexOf('=')), pair);
  }
  return [...jar.values()].join('; ');
}
async function body<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}
async function begin(t: TestEnv, cookie: string) {
  const res = await authCall(
    t,
    'two-factor/enable',
    { password: PASSWORD },
    cookie
  );
  expect(res.headers.get('cache-control')).toBe('no-store');
  const setup = await body<{ totpURI: string; backupCodes: string[] }>(res);
  const secret = new TextDecoder().decode(
    base32.decode(new URL(setup.totpURI).searchParams.get('secret')!)
  );
  return { ...setup, secret, otp: createOTP(secret) };
}
async function enabled() {
  const t = makeEnv();
  const initialCookie = await bootstrapAdmin(t);
  const setup = await begin(t, initialCookie);
  // Consume the previous step during enrollment; current code remains usable for the subsequent login.
  const res = await authCall(
    t,
    'two-factor/verify-totp',
    {
      code: await setup.otp.hotp(Math.floor(Date.now() / 30_000) - 1),
    },
    initialCookie
  );
  await body(res);
  return { t, ...setup, initialCookie, cookie: cookies(res) };
}
async function challenge(t: TestEnv) {
  const res = await authCall(t, 'sign-in/username', {
    username: 'octocat',
    password: PASSWORD,
  });
  expect(await body(res)).toMatchObject({
    twoFactorRedirect: true,
    twoFactorMethods: ['totp'],
  });
  return cookies(res);
}
async function session(t: TestEnv, cookie: string) {
  return (
    await call(t, '/api/auth/get-session', { cookie })
  ).json() as Promise<null | {
    session: { id: string };
    user: { id: string; twoFactorEnabled: boolean };
  }>;
}

describe('双因素认证与恢复码', () => {
  it('已经消费旧组恢复码的登录请求不能跨越恢复码重生成建立会话', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const pending = await challenge(t);
    const context = await authFor(t.env).$context;
    const original = context.internalAdapter.createSession;
    const reached = deferred();
    const resume = deferred();
    const spy = vi
      .spyOn(context.internalAdapter, 'createSession')
      .mockImplementation(async (...args) => {
        reached.resolve();
        await resume.promise;
        return original(...args);
      });
    let verifying: Promise<Response> | undefined;
    try {
      verifying = authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        pending
      );
      await reached.promise;
      await body(
        await authCall(
          t,
          'two-factor/generate-backup-codes',
          { password: PASSWORD },
          cookie
        )
      );
      resume.resolve();
      const response = await verifying;
      expect({
        status: response.status,
        authenticated: (await session(t, cookies(response))) !== null,
      }).toEqual({ status: 401, authenticated: false });
    } finally {
      resume.resolve();
      await verifying;
      spy.mockRestore();
    }
  });
  it('跨来源的第二因子请求在消耗恢复码或账号尝试预算之前被拒绝', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const before = await t.env.DB.prepare(
      'SELECT backup_codes, failed_verification_count FROM two_factors'
    ).first();
    const response = await raw(t, '/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      headers: {
        Origin: 'http://evil.test.local',
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: backupCodes[0] }),
    });
    expect(response.status).toBe(403);
    expect(
      await t.env.DB.prepare(
        'SELECT backup_codes, failed_verification_count FROM two_factors'
      ).first()
    ).toEqual(before);
  });

  it('只在验证后启用，秘密加密保存，撤销旧会话并保留新的当前会话', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    expect(
      (
        await authCall(
          t,
          'two-factor/enable',
          { password: 'incorrect' },
          cookie
        )
      ).status
    ).toBe(400);
    const other = await signIn(t, 'octocat', PASSWORD);
    const setup = await begin(t, cookie);
    expect((await session(t, cookie))?.user.twoFactorEnabled).toBe(false);
    expect(setup.backupCodes).toHaveLength(10);
    const row = (await t.env.DB.prepare(
      'SELECT secret, backup_codes FROM two_factors'
    ).first<{ secret: string; backup_codes: string }>())!;
    expect(row.secret).not.toContain(setup.secret);
    expect(row.backup_codes).not.toContain(setup.backupCodes[0]);
    const verified = await authCall(
      t,
      'two-factor/verify-totp',
      { code: await setup.otp.totp() },
      cookie
    );
    await body(verified);
    expect((await session(t, cookies(verified)))?.user.twoFactorEnabled).toBe(
      true
    );
    expect(await session(t, cookie)).toBeNull();
    expect(await session(t, other)).toBeNull();
    expect(
      (
        await t.env.DB.prepare('SELECT verified FROM two_factors').first<{
          verified: number;
        }>()
      )?.verified
    ).toBe(1);
    const audits = (
      await t.env.DB.prepare(
        "SELECT action, data FROM audit_events WHERE action LIKE 'user.mfa_%'"
      ).all()
    ).results;
    expect(audits.map((a) => a.action)).toContain('user.mfa_enabled');
    expect(JSON.stringify(audits)).not.toContain(setup.secret);
    expect(JSON.stringify(audits)).not.toContain(setup.backupCodes[0]);
  });

  it('密码正确仍无可用会话，TOTP 成功后才可访问，并阻止相同步数跨挑战重放', async () => {
    const { t, otp } = await enabled();
    const pending = await challenge(t);
    expect(await session(t, pending)).toBeNull();
    expect((await call(t, '/api/tokens', { cookie: pending })).status).toBe(
      401
    );
    const code = await otp.totp();
    const verified = await authCall(
      t,
      'two-factor/verify-totp',
      { code, trustDevice: false },
      pending
    );
    await body(verified);
    expect(await session(t, cookies(verified))).not.toBeNull();
    const second = await challenge(t);
    const replay = await authCall(
      t,
      'two-factor/verify-totp',
      { code },
      second
    );
    expect(await body(replay, 403)).toMatchObject({
      code: 'TOTP_ALREADY_USED',
    });
    expect(await session(t, second)).toBeNull();
  });

  it('恢复码仅可消费一次，包括来自不同登录挑战的并发使用', async () => {
    const { t, backupCodes } = await enabled();
    const a = await challenge(t);
    const b = await challenge(t);
    const replies = await Promise.all(
      [a, b].map((cookie) =>
        authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0] },
          cookie
        )
      )
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => [401, 409].includes(r.status))).toHaveLength(
      1
    );
    const replay = await authCall(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0] },
      await challenge(t)
    );
    expect(replay.status).toBe(401);
  });

  it('错误密码不能开始设置，匿名和已启用账户不能提取或替换秘密', async () => {
    const { t, cookie } = await enabled();
    for (const path of [
      'two-factor/enable',
      'two-factor/disable',
      'two-factor/generate-backup-codes',
    ])
      expect(
        (await authCall(t, path, { password: PASSWORD })).status
      ).toBeGreaterThanOrEqual(400);
    expect(
      (await authCall(t, 'two-factor/enable', { password: PASSWORD }, cookie))
        .status
    ).toBe(403);
    expect(
      (
        await authCall(
          t,
          'two-factor/get-totp-uri',
          { password: PASSWORD },
          cookie
        )
      ).status
    ).toBe(404);
    expect(
      (
        await authCall(
          t,
          'two-factor/enable',
          { password: PASSWORD, method: 'otp' },
          cookie
        )
      ).status
    ).toBe(403);
  });

  it('禁用与重新生成需要当前会话单次第二因子证明和密码，新恢复码替换旧码', async () => {
    const { t, cookie, backupCodes } = await enabled();
    // Enrollment proves the new session once; consume that proof by regenerating.
    const regenerated = await authCall(
      t,
      'two-factor/generate-backup-codes',
      { password: PASSWORD },
      cookie
    );
    const next = await body<{ backupCodes: string[] }>(regenerated);
    expect(next.backupCodes).toHaveLength(10);
    expect(
      (await authCall(t, 'two-factor/disable', { password: PASSWORD }, cookie))
        .status
    ).toBe(403);
    expect(
      (
        await authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0] },
          cookie
        )
      ).status
    ).toBe(401);
    await body(
      await authCall(
        t,
        'two-factor/verify-backup-code',
        { code: next.backupCodes[0] },
        cookie
      )
    );
    expect(
      (
        await authCall(
          t,
          'two-factor/disable',
          { password: 'incorrect' },
          cookie
        )
      ).status
    ).toBe(400);
    expect(
      (await authCall(t, 'two-factor/disable', { password: PASSWORD }, cookie))
        .status
    ).toBe(403);
    await body(
      await authCall(
        t,
        'two-factor/verify-backup-code',
        { code: next.backupCodes[1] },
        cookie
      )
    );
    const disabled = await authCall(
      t,
      'two-factor/disable',
      { password: PASSWORD },
      cookie
    );
    await body(disabled);
    expect((await session(t, cookies(disabled)))?.user.twoFactorEnabled).toBe(
      false
    );
    expect(await session(t, cookie)).toBeNull();
    expect(
      await t.env.DB.prepare('SELECT id FROM two_factors').first()
    ).toBeNull();
    const audits = (
      await t.env.DB.prepare(
        "SELECT action FROM audit_events WHERE action LIKE 'user.mfa_%'"
      ).all()
    ).results.map((r) => r.action);
    expect(audits).toContain('user.mfa_recovery_regenerated');
    expect(audits).toContain('user.mfa_recovery_used');
    expect(audits).toContain('user.mfa_disabled');
  });

  it('证明过期或属于另一会话不能修改 MFA，禁用并发只成功一次', async () => {
    const { t, cookie, backupCodes } = await enabled();
    await t.env.DB.prepare('UPDATE sessions SET mfa_verified_at = ?')
      .bind(Date.now() - 301_000)
      .run();
    expect(
      (await authCall(t, 'two-factor/disable', { password: PASSWORD }, cookie))
        .status
    ).toBe(403);
    const other = await authCall(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0] },
      await challenge(t)
    );
    await body(other);
    expect(
      (await authCall(t, 'two-factor/disable', { password: PASSWORD }, cookie))
        .status
    ).toBe(403);
    const responses = await Promise.all(
      [1, 2].map(() =>
        authCall(
          t,
          'two-factor/disable',
          { password: PASSWORD },
          cookies(other)
        )
      )
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
  });

  it('拒绝受信设备和跳过会话选项，失效挑战不能消费恢复码', async () => {
    const { t, backupCodes } = await enabled();
    const pending = await challenge(t);
    expect(
      (
        await authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0], trustDevice: true },
          pending
        )
      ).status
    ).toBe(403);
    expect(
      (
        await authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0], disableSession: true },
          pending
        )
      ).status
    ).toBe(403);
    await t.env.DB.prepare(
      "UPDATE verifications SET expires_at = 0 WHERE identifier LIKE '2fa-%'"
    ).run();
    expect(
      (
        await authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0] },
          pending
        )
      ).status
    ).toBe(401);
    await body(
      await authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        await challenge(t)
      )
    );
  });

  it('即使带有以前签发的合法受信设备凭据也必须完成第二因子', async () => {
    const { t, cookie } = await enabled();
    const user = (await session(t, cookie))!.user;
    const identifier = 'trust-device-old-device';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(t.env.BETTER_AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = async (value: string) =>
      btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.sign(
              'HMAC',
              key,
              new TextEncoder().encode(value)
            )
          )
        )
      );
    const token = (await mac(`${user.id}!${identifier}`))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const value = `${token}!${identifier}`;
    await t.env.DB.prepare(
      'INSERT INTO verifications (id, identifier, value, expires_at) VALUES (?, ?, ?, ?)'
    )
      .bind('old-trusted', identifier, user.id, Date.now() + 3600_000)
      .run();
    const trustedCookie = `cloudforge.trust_device=${encodeURIComponent(`${value}.${await mac(value)}`)}`;
    const response = await authCall(
      t,
      'sign-in/username',
      { username: 'octocat', password: PASSWORD },
      trustedCookie
    );
    expect(await body(response)).toMatchObject({ twoFactorRedirect: true });
    expect(await session(t, cookies(response))).toBeNull();
    expect(
      await t.env.DB.prepare(
        'SELECT id FROM verifications WHERE identifier = ?'
      )
        .bind(identifier)
        .first()
    ).toBeNull();
  });

  it('一个挑战最多五次失败，重新登录不能绕过跨挑战账户锁定', async () => {
    const { t, backupCodes } = await enabled();
    for (let round = 0; round < 2; round++) {
      const pending = await challenge(t);
      for (let attempt = 0; attempt < 5; attempt++)
        expect(
          (
            await authCall(
              t,
              'two-factor/verify-backup-code',
              { code: 'invalid' },
              pending
            )
          ).status
        ).toBe(401);
      expect(
        (
          await authCall(
            t,
            'two-factor/verify-backup-code',
            { code: backupCodes[0] },
            pending
          )
        ).status
      ).toBeGreaterThanOrEqual(400);
    }
    const locked = await authCall(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0] },
      await challenge(t)
    );
    expect(locked.status).toBe(429);
  });

  it('修改密码使旧密码的待验证挑战失效，MFA 配置及恢复码保留', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const pending = await challenge(t);
    await body(
      await authCall(
        t,
        'change-password',
        { currentPassword: PASSWORD, newPassword: 'newpassword123' },
        cookie
      )
    );
    expect(
      (
        await authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0] },
          pending
        )
      ).status
    ).toBe(401);
    const next = await authCall(t, 'sign-in/username', {
      username: 'octocat',
      password: 'newpassword123',
    });
    expect(await body(next)).toMatchObject({ twoFactorRedirect: true });
    await body(
      await authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        cookies(next)
      )
    );
  });

  it('MFA 账户拒绝管理员模拟登录及直接修改 twoFactorEnabled', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const initial = await addMember(t, admin, 'bob');
    const setup = await begin(t, initial);
    const activation = await authCall(
      t,
      'two-factor/verify-totp',
      { code: await setup.otp.totp() },
      initial
    );
    await body(activation);
    const cookie = cookies(activation);
    const member = (await session(t, cookie))!.user;
    const update = await authCall(
      t,
      'admin/update-user',
      { userId: member.id, data: { twoFactorEnabled: false } },
      admin
    );
    expect(update.status).toBeGreaterThanOrEqual(400);
    expect((await session(t, cookie))?.user.twoFactorEnabled).toBe(true);
    const impersonate = await authCall(
      t,
      'admin/impersonate-user',
      { userId: member.id },
      admin
    );
    expect(await body(impersonate, 403)).toMatchObject({
      code: 'MFA_SIGN_IN_REQUIRED',
    });
    // A plain member is impersonatable with this admin's actual permissions. The rejection
    // above therefore exercises CloudForge's MFA guard, not the plugin's refusal to impersonate admins.
    const carol = await addMember(t, admin, 'carol');
    const control = (await session(t, carol))!.user;
    const allowed = await authCall(
      t,
      'admin/impersonate-user',
      { userId: control.id },
      admin
    );
    await body(allowed);
    expect((await session(t, cookies(allowed)))?.user.id).toBe(control.id);
  });

  it('历史未验证的 MFA 账户确认邮箱只能验证地址，不能自动取得登录会话', async () => {
    const { t, cookie } = await enabled();
    const user = (await session(t, cookie))!.user;
    // Enrollment normally starts from a verified account. Simulate a legacy/unverified MFA
    // row to test the integration boundary of better-auth's autoSignInAfterVerification.
    await t.env.DB.prepare('UPDATE users SET email_verified = 0 WHERE id = ?')
      .bind(user.id)
      .run();
    const token = await createEmailVerificationToken(
      t.env.BETTER_AUTH_SECRET,
      'octocat@example.com'
    );
    const before = await t.env.DB.prepare(
      'SELECT count(*) AS n FROM sessions'
    ).first();
    const response = await raw(
      t,
      `/api/auth/verify-email?${new URLSearchParams({ token, callbackURL: '/' })}`,
      { redirect: 'manual' }
    );
    expect(await body(response, 403)).toMatchObject({
      code: 'MFA_SIGN_IN_REQUIRED',
    });
    expect(await session(t, cookies(response))).toBeNull();
    expect(
      await t.env.DB.prepare('SELECT count(*) AS n FROM sessions').first()
    ).toEqual(before);
    expect(
      (
        await t.env.DB.prepare('SELECT email_verified FROM users WHERE id = ?')
          .bind(user.id)
          .first()
      )?.email_verified
    ).toBe(1);
  });

  it('OAuth 登录续接在第二因子成功前不签发授权码', async () => {
    const { t, backupCodes } = await enabled();
    const clientId = await register(t);
    const { challenge: codeChallenge } = await pkce();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'mfa',
      resource: `${ORIGIN}/mcp`,
    });
    const authorize = await raw(t, `/api/auth/oauth2/authorize?${params}`, {
      redirect: 'manual',
    });
    const login = new URL(authorize.headers.get('Location')!, ORIGIN);
    expect(login.pathname).toBe('/login');
    const password = await authCall(t, 'sign-in/username', {
      username: 'octocat',
      password: PASSWORD,
      oauth_query: login.search.slice(1),
    });
    const passwordBody = await body<Record<string, unknown>>(password);
    expect(passwordBody).toMatchObject({ twoFactorRedirect: true });
    expect(passwordBody.url).toBeUndefined();
    expect(await session(t, cookies(password))).toBeNull();
    const verified = await authCall(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0], oauth_query: login.search.slice(1) },
      cookies(password)
    );
    const verifiedBody = await body<{ url?: string }>(verified);
    expect(new URL(verifiedBody.url!, ORIGIN).pathname).toBe('/oauth/consent');
  });

  it('启用 MFA 保留既有 OAuth 授权并清空会话关联，撤销 consent 立即拒绝旧 JWT', async () => {
    const t = makeEnv();
    const initial = await bootstrapAdmin(t);
    const connection = await connect(t, initial);
    const setup = await begin(t, initial);
    await body(
      await authCall(
        t,
        'two-factor/verify-totp',
        { code: await setup.otp.totp() },
        initial
      )
    );
    expect(
      await t.env.DB.prepare(
        'SELECT session_id FROM oauth_refresh_tokens'
      ).first()
    ).toMatchObject({ session_id: null });
    const refreshed = await raw(t, '/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: connection.clientId,
        refresh_token: connection.refresh_token!,
        resource: `${ORIGIN}/mcp`,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect((await rpc(t, connection.access_token, 'tools/list')).status).toBe(
      200
    );
    await t.env.DB.prepare('DELETE FROM oauth_consents').run();
    expect((await rpc(t, connection.access_token, 'tools/list')).status).toBe(
      401
    );
  });

  it('密码验证开始后才启用 MFA，旧版本登录必须重新开始', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const setup = await begin(t, cookie);
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
    try {
      const signing = authCall(t, 'sign-in/username', {
        username: 'octocat',
        password: PASSWORD,
      });
      await reached.promise;
      await body(
        await authCall(
          t,
          'two-factor/verify-totp',
          { code: await setup.otp.totp() },
          cookie
        )
      );
      resume.resolve();
      const response = await signing;
      expect(await body(response, 401)).toMatchObject({
        code: 'MFA_CHALLENGE_CHANGED',
      });
      expect(await session(t, cookies(response))).toBeNull();
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
  });

  it('重新设置的延迟写入不能覆盖刚验证并启用的秘密', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const setup = await begin(t, cookie);
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
    try {
      const replacing = authCall(
        t,
        'two-factor/enable',
        { password: PASSWORD },
        cookie
      );
      await reached.promise;
      await body(
        await authCall(
          t,
          'two-factor/verify-totp',
          { code: await setup.otp.totp() },
          cookie
        )
      );
      const proven = await t.env.DB.prepare(
        'SELECT secret FROM two_factors'
      ).first();
      resume.resolve();
      expect((await replacing).status).toBeGreaterThanOrEqual(400);
      expect(
        await t.env.DB.prepare('SELECT secret FROM two_factors').first()
      ).toEqual(proven);
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
  });

  it('验证码验证和激活之间被替换的秘密不会被错误标为已验证', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const setup = await begin(t, cookie);
    const context = await authFor(t.env).$context;
    const original = context.adapter.findOne;
    const reached = deferred();
    const resume = deferred();
    let paused = false;
    const spy = vi
      .spyOn(context.adapter, 'findOne')
      .mockImplementation(async (input) => {
        const result = await original(input);
        if (input.model === 'twoFactor' && !paused) {
          paused = true;
          reached.resolve();
          await resume.promise;
        }
        return result;
      });
    try {
      const verifying = authCall(
        t,
        'two-factor/verify-totp',
        { code: await setup.otp.totp() },
        cookie
      );
      await reached.promise;
      const replacement = await begin(t, cookie);
      expect(replacement.secret).not.toBe(setup.secret);
      resume.resolve();
      expect((await verifying).status).toBe(403);
      expect((await session(t, cookie))?.user.twoFactorEnabled).toBe(false);
      expect(
        (
          await t.env.DB.prepare('SELECT verified FROM two_factors').first<{
            verified: number;
          }>()
        )?.verified
      ).toBe(0);
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
  });

  it('已登录的第二因子验证也按账号原子限次，跨 IP 不可绕过', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const replies = await Promise.all(
      Array.from({ length: 14 }, () =>
        authCall(
          t,
          'two-factor/verify-backup-code',
          { code: 'incorrect' },
          cookie
        )
      )
    );
    expect(replies.filter((response) => response.status === 401)).toHaveLength(
      10
    );
    expect(replies.filter((response) => response.status === 429)).toHaveLength(
      4
    );
    expect(
      (
        await authCall(
          t,
          'two-factor/verify-backup-code',
          { code: backupCodes[0] },
          cookie
        )
      ).status
    ).toBe(429);
    await t.env.DB.prepare('UPDATE two_factors SET locked_until = ?')
      .bind(Date.now() - 1)
      .run();
    await body(
      await authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        cookie
      )
    );
    expect(
      await t.env.DB.prepare(
        'SELECT failed_verification_count, locked_until FROM two_factors'
      ).first()
    ).toMatchObject({ failed_verification_count: 0, locked_until: null });
  });

  it('旧密码验证后才更换密码，保留的当前会话也不能用旧请求开始绑定', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const context = await authFor(t.env).$context;
    const original = context.password.verify;
    const reached = deferred();
    const resume = deferred();
    let paused = false;
    const spy = vi
      .spyOn(context.password, 'verify')
      .mockImplementation(async (input) => {
        const result = await original(input);
        if (!paused) {
          paused = true;
          reached.resolve();
          await resume.promise;
        }
        return result;
      });
    try {
      const starting = authCall(
        t,
        'two-factor/enable',
        { password: PASSWORD },
        cookie
      );
      await reached.promise;
      await body(
        await authCall(
          t,
          'change-password',
          { currentPassword: PASSWORD, newPassword: 'new-password-123' },
          cookie
        )
      );
      expect(await session(t, cookie)).not.toBeNull();
      resume.resolve();
      expect((await starting).status).toBe(401);
      expect(
        await t.env.DB.prepare('SELECT id FROM two_factors').first()
      ).toBeNull();
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
  });

  it('已消费挑战但还没创建会话时改密码，旧证明不能重新登录', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const pending = await challenge(t);
    const context = await authFor(t.env).$context;
    const original = context.internalAdapter.createSession;
    const reached = deferred();
    const resume = deferred();
    let paused = false;
    const spy = vi
      .spyOn(context.internalAdapter, 'createSession')
      .mockImplementation(async (...args) => {
        if (!paused) {
          paused = true;
          reached.resolve();
          await resume.promise;
        }
        return original(...args);
      });
    try {
      const verifying = authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        pending
      );
      await reached.promise;
      await body(
        await authCall(
          t,
          'change-password',
          { currentPassword: PASSWORD, newPassword: 'new-password-123' },
          cookie
        )
      );
      resume.resolve();
      const response = await verifying;
      expect(response.status).toBe(401);
      expect(await session(t, cookies(response))).toBeNull();
      expect(
        (
          await t.env.DB.prepare('SELECT count(*) AS n FROM sessions').first<{
            n: number;
          }>()
        )?.n
      ).toBe(1);
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
  });

  for (const operation of ['disable', 'generate-backup-codes']) {
    it(`延迟 ${operation} 请求不能修改另一次关闭后重新绑定的新因子`, async () => {
      const { t, cookie, backupCodes } = await enabled();
      const other = await authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        await challenge(t)
      );
      await body(other);
      const context = await authFor(t.env).$context;
      const original = context.password.verify;
      const reached = deferred();
      const resume = deferred();
      let paused = false;
      const spy = vi
        .spyOn(context.password, 'verify')
        .mockImplementation(async (input) => {
          const result = await original(input);
          if (!paused) {
            paused = true;
            reached.resolve();
            await resume.promise;
          }
          return result;
        });
      try {
        const stale = authCall(
          t,
          `two-factor/${operation}`,
          { password: PASSWORD },
          cookie
        );
        await reached.promise;
        const disabled = await authCall(
          t,
          'two-factor/disable',
          { password: PASSWORD },
          cookies(other)
        );
        await body(disabled);
        const newCookie = cookies(disabled);
        const next = await begin(t, newCookie);
        await body(
          await authCall(
            t,
            'two-factor/verify-totp',
            { code: await next.otp.totp() },
            newCookie
          )
        );
        const expected = await t.env.DB.prepare(
          'SELECT id, secret, backup_codes FROM two_factors'
        ).first();
        resume.resolve();
        expect((await stale).status).toBeGreaterThanOrEqual(400);
        expect(
          await t.env.DB.prepare(
            'SELECT id, secret, backup_codes FROM two_factors'
          ).first()
        ).toEqual(expected);
        expect(
          (
            await t.env.DB.prepare(
              'SELECT two_factor_enabled FROM users'
            ).first()
          )?.two_factor_enabled
        ).toBe(1);
      } finally {
        resume.resolve();
        spy.mockRestore();
      }
    });
  }

  it('陈旧的更改密码请求不能跨重新绑定因子恢复未验证的新会话', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const other = await authCall(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0] },
      await challenge(t)
    );
    await body(other);
    const context = await authFor(t.env).$context;
    const original = context.password.verify;
    const reached = deferred();
    const resume = deferred();
    let paused = false;
    const spy = vi
      .spyOn(context.password, 'verify')
      .mockImplementation(async (input) => {
        const result = await original(input);
        if (!paused) {
          paused = true;
          reached.resolve();
          await resume.promise;
        }
        return result;
      });
    try {
      const stale = authCall(
        t,
        'change-password',
        {
          currentPassword: PASSWORD,
          newPassword: 'stale-new-password-123',
          revokeOtherSessions: true,
        },
        cookie
      );
      await reached.promise;
      const disabled = await authCall(
        t,
        'two-factor/disable',
        { password: PASSWORD },
        cookies(other)
      );
      await body(disabled);
      const newCookie = cookies(disabled);
      const next = await begin(t, newCookie);
      const activation = await authCall(
        t,
        'two-factor/verify-totp',
        { code: await next.otp.totp() },
        newCookie
      );
      await body(activation);
      const expected = await t.env.DB.prepare(
        'SELECT id, secret, backup_codes FROM two_factors'
      ).first();
      resume.resolve();
      const response = await stale;
      const createdSession = await session(t, cookies(response));
      expect(
        response.status,
        JSON.stringify({ status: response.status, createdSession })
      ).toBe(401);
      expect(createdSession).toBeNull();
      expect(await session(t, cookies(activation))).not.toBeNull();
      expect(
        await t.env.DB.prepare(
          'SELECT id, secret, backup_codes FROM two_factors'
        ).first()
      ).toEqual(expected);
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
  });

  it('当前 MFA 会话正常更改密码并撤销其他会话时可安全轮换登录，因子仍有效', async () => {
    const { t, cookie, backupCodes } = await enabled();
    const other = await authCall(
      t,
      'two-factor/verify-backup-code',
      { code: backupCodes[0] },
      await challenge(t)
    );
    await body(other);
    const expected = await t.env.DB.prepare(
      'SELECT id, secret, backup_codes FROM two_factors'
    ).first();
    const response = await authCall(
      t,
      'change-password',
      {
        currentPassword: PASSWORD,
        newPassword: 'updated-password-123',
        revokeOtherSessions: true,
      },
      cookie
    );
    const changed = await body<{ token: string }>(response);
    expect(changed.token).toBeTruthy();
    expect((await session(t, cookies(response)))?.user.twoFactorEnabled).toBe(
      true
    );
    expect(await session(t, cookie)).toBeNull();
    expect(await session(t, cookies(other))).toBeNull();
    expect(
      await t.env.DB.prepare(
        'SELECT id, secret, backup_codes FROM two_factors'
      ).first()
    ).toEqual(expected);
    expect(
      (
        await authCall(t, 'sign-in/username', {
          username: 'octocat',
          password: PASSWORD,
        })
      ).status
    ).toBe(401);
    const nextLogin = await authCall(t, 'sign-in/username', {
      username: 'octocat',
      password: 'updated-password-123',
    });
    expect(await body(nextLogin)).toMatchObject({ twoFactorRedirect: true });
    expect(await session(t, cookies(nextLogin))).toBeNull();
  });
});
