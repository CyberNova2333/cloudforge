import { describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { resetMfa } from '../../../scripts/cloudforge/reset-mfa';
import type { Io } from '../../../scripts/cloudforge/collect';
import { authFor } from '../auth';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from './helpers/app';

const PASSWORD = 'password123';
const REASON = '验证器与全部恢复码遗失';
let ip = 0;
function authCall(t: TestEnv, path: string, json: unknown, cookie?: string) {
  return call(t, `/api/auth/${path}`, {
    json,
    cookie,
    headers: { 'cf-connecting-ip': `198.51.100.${(++ip % 250) + 1}` },
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function enabled() {
  const t = makeEnv();
  const initial = await bootstrapAdmin(t);
  const response = await authCall(
    t,
    'two-factor/enable',
    { password: PASSWORD },
    initial
  );
  expect(response.status).toBe(200);
  const latest = (await response.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = new TextDecoder().decode(
    base32.decode(new URL(latest.totpURI).searchParams.get('secret')!)
  );
  const verified = await authCall(
    t,
    'two-factor/verify-totp',
    {
      code: await createOTP(secret).hotp(Math.floor(Date.now() / 30_000) - 1),
    },
    initial
  );
  expect(verified.status).toBe(200);
  const user = await t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{ id: string }>();
  return {
    t,
    userId: user!.id,
    cookie: cookies(verified),
    backupCodes: latest.backupCodes,
  };
}
function recovery(t: TestEnv, beforeInsert?: () => Promise<void>) {
  const output: string[] = [];
  const statements: string[] = [];
  const io: Io = {
    tty: true,
    print: (message) => {
      output.push(message);
    },
    confirm: async () => true,
    prompt: async () => null,
    select: async (_message, options) => options[0]!.value,
  };
  return {
    output,
    statements,
    run: () =>
      resetMfa(
        {
          io,
          now: () => new Date(),
          cf: {
            queryD1: async (_account, _database, sql, params = []) => {
              statements.push(sql);
              if (/^\s*INSERT INTO mfa_recovery_events/i.test(sql))
                await beforeInsert?.();
              // A transport port forwards the production SQL to real workerd D1; no database fake.
              return (
                await t.env.DB.prepare(sql)
                  .bind(...params)
                  .all()
              ).results;
            },
          },
        },
        {
          accountId: 'offline-test-account',
          database: { uuid: 'offline-test-db', name: 'test' },
          who: 'octocat',
          reason: REASON,
          plan: false,
          yes: false,
        }
      ),
  };
}
async function signInChallenge(t: TestEnv) {
  const response = await authCall(t, 'sign-in/username', {
    username: 'octocat',
    password: PASSWORD,
  });
  expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
  return cookies(response);
}

describe('独立离线因子恢复（真实 D1）', () => {
  it('同一 SQL 撤销因子、会话、挑战及计数，保留密码和机器凭据并隔离其他成员', async () => {
    const { t, userId, cookie } = await enabled();
    const beforePassword = await t.env.DB.prepare(
      'SELECT password FROM accounts WHERE user_id = ?'
    )
      .bind(userId)
      .first();
    const session = await t.env.DB.prepare(
      'SELECT id FROM sessions WHERE user_id = ?'
    )
      .bind(userId)
      .first<{ id: string }>();
    const now = Date.now();
    await t.env.DB.batch([
      t.env.DB.prepare(
        "INSERT INTO users (id,name,email,username) VALUES ('other','Other','other@example.com','other')"
      ),
      t.env.DB.prepare(
        "INSERT INTO verifications (id,identifier,value,expires_at) VALUES ('challenge','2fa-old',?,?),('attempts','2fa-attempts-2fa-old','3',?),('trust','trust-device-old',?,?),('other-challenge','2fa-other','other',?),('other-attempts','2fa-attempts-2fa-other','2',?),('mail','reset-password:old',?,?)"
      ).bind(
        userId,
        now + 600000,
        now + 600000,
        userId,
        now + 600000,
        now + 600000,
        now + 600000,
        userId,
        now + 600000
      ),
      t.env.DB.prepare(
        "INSERT INTO personal_access_tokens (id,user_id,name,token_hash,created_at) VALUES ('pat',?,'automation','test-pat-hash',?)"
      ).bind(userId, now),
      t.env.DB.prepare(
        "INSERT INTO repositories (id,owner_id,name,artifacts_name,created_at,updated_at) VALUES ('repo',?,'repo','r_repo',?,?)"
      ).bind(userId, now, now),
      t.env.DB.prepare(
        "INSERT INTO repository_deploy_tokens (id,repository_id,created_by_id,name,token_hash,expires_at,created_at) VALUES ('deploy','repo',?,'deploy','test-deploy-hash',?,?)"
      ).bind(userId, now + 600000, now),
      t.env.DB.prepare(
        "INSERT INTO oauth_clients (id,client_id,redirect_uris) VALUES ('client','client','[]')"
      ),
      t.env.DB.prepare(
        "INSERT INTO oauth_consents (id,client_id,user_id,scopes) VALUES ('consent','client',?,'[]')"
      ).bind(userId),
      t.env.DB.prepare(
        "INSERT INTO oauth_refresh_tokens (id,token,client_id,session_id,user_id,scopes) VALUES ('refresh','test-refresh','client',?,?,'[]')"
      ).bind(session!.id, userId),
    ]);
    const h = recovery(t);
    expect(await h.run(), h.output.join('\n')).toBe(0);
    expect(
      h.statements.filter((sql) => /^\s*(INSERT|DELETE|UPDATE)/i.test(sql))
    ).toHaveLength(1);
    expect(
      await t.env.DB.prepare(
        'SELECT two_factor_enabled FROM users WHERE id = ?'
      )
        .bind(userId)
        .first()
    ).toEqual({ two_factor_enabled: 0 });
    expect(
      await t.env.DB.prepare('SELECT id FROM two_factors WHERE user_id = ?')
        .bind(userId)
        .first()
    ).toBeNull();
    expect(
      await t.env.DB.prepare('SELECT id FROM sessions WHERE user_id = ?')
        .bind(userId)
        .first()
    ).toBeNull();
    expect(
      (
        await t.env.DB.prepare('SELECT id FROM verifications ORDER BY id').all()
      ).results.map((r) => r.id)
    ).toEqual(['mail', 'other-attempts', 'other-challenge']);
    expect(
      await t.env.DB.prepare('SELECT password FROM accounts WHERE user_id = ?')
        .bind(userId)
        .first()
    ).toEqual(beforePassword);
    for (const table of [
      'personal_access_tokens',
      'repository_deploy_tokens',
      'oauth_consents',
    ]) {
      expect(
        (await t.env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first())
          ?.n
      ).toBe(1);
    }
    expect(
      await t.env.DB.prepare(
        "SELECT session_id,token FROM oauth_refresh_tokens WHERE id='refresh'"
      ).first()
    ).toEqual({ session_id: null, token: 'test-refresh' });
    const audit = await t.env.DB.prepare(
      "SELECT action,actor_kind,via,data FROM audit_events WHERE action='user.mfa_reset'"
    ).first<{ data: string }>();
    expect(audit).toMatchObject({
      action: 'user.mfa_reset',
      actor_kind: 'system',
      via: 'cloudforge reset-mfa',
    });
    expect(JSON.parse(audit!.data)).toMatchObject({ userId, reason: REASON });
    expect((await call(t, '/api/auth/get-session', { cookie })).status).toBe(
      200
    );
    expect(
      await (await call(t, '/api/auth/get-session', { cookie })).json()
    ).toBeNull();
    const login = await authCall(t, 'sign-in/username', {
      username: 'octocat',
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(await login.json()).not.toHaveProperty('twoFactorRedirect');
    const source = await t.env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='cloudforge_mfa_recovery_v1'"
    ).first();
    expect(source).not.toBeNull();
  });

  it('审计插入失败会回滚此前的因子和会话撤销以及恢复事件', async () => {
    const { t, userId } = await enabled();
    const before = await t.env.DB.prepare(
      'SELECT * FROM two_factors WHERE user_id = ?'
    )
      .bind(userId)
      .first();
    await t.env.DB.prepare(
      "CREATE TRIGGER test_fail_mfa_reset BEFORE INSERT ON audit_events WHEN NEW.action = 'user.mfa_reset' BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END"
    ).run();
    try {
      const h = recovery(t);
      expect(await h.run()).toBe(1);
      expect(
        await t.env.DB.prepare('SELECT * FROM two_factors WHERE user_id = ?')
          .bind(userId)
          .first()
      ).toEqual(before);
      expect(
        (
          await t.env.DB.prepare(
            'SELECT count(*) AS n FROM sessions WHERE user_id = ?'
          )
            .bind(userId)
            .first()
        )?.n
      ).toBe(1);
      expect(
        await t.env.DB.prepare('SELECT id FROM mfa_recovery_events').first()
      ).toBeNull();
      expect(
        (
          await t.env.DB.prepare(
            'SELECT two_factor_enabled FROM users WHERE id = ?'
          )
            .bind(userId)
            .first()
        )?.two_factor_enabled
      ).toBe(1);
    } finally {
      await t.env.DB.prepare('DROP TRIGGER test_fail_mfa_reset').run();
    }
  });

  it('预览后相同 id 的待绑定秘密更换时不撤销新的绑定', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    expect(
      (await authCall(t, 'two-factor/enable', { password: PASSWORD }, cookie))
        .status
    ).toBe(200);
    const h = recovery(t, async () => {
      expect(
        (await authCall(t, 'two-factor/enable', { password: PASSWORD }, cookie))
          .status
      ).toBe(200);
    });
    expect(await h.run()).toBe(1);
    expect(
      await t.env.DB.prepare('SELECT id FROM two_factors').first()
    ).not.toBeNull();
    expect(
      await t.env.DB.prepare('SELECT id FROM mfa_recovery_events').first()
    ).toBeNull();
  });

  it('已经消费挑战的旧验证码请求在恢复后不能重建有效会话', async () => {
    const { t, backupCodes } = await enabled();
    const challenge = await signInChallenge(t);
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
    let pending: Promise<Response> | undefined;
    try {
      pending = authCall(
        t,
        'two-factor/verify-backup-code',
        { code: backupCodes[0] },
        challenge
      );
      await reached.promise;
      const h = recovery(t);
      expect(await h.run(), h.output.join('\n')).toBe(0);
      resume.resolve();
      const response = await pending;
      expect(response.status).toBe(401);
      expect(
        await (
          await call(t, '/api/auth/get-session', { cookie: cookies(response) })
        ).json()
      ).toBeNull();
      expect(
        await t.env.DB.prepare('SELECT id FROM sessions').first()
      ).toBeNull();
    } finally {
      resume.resolve();
      await pending;
      spy.mockRestore();
    }
  });

  for (const operation of [
    'disable',
    'generate-backup-codes',
    'change-password',
  ]) {
    it(`恢复撤销旧会话后，暂停的 ${operation} 不能修改凭据或新建会话`, async () => {
      const { t, cookie, backupCodes, userId } = await enabled();
      expect(
        (
          await authCall(
            t,
            'two-factor/verify-backup-code',
            { code: backupCodes[0] },
            cookie
          )
        ).status
      ).toBe(200);
      const before = await t.env.DB.prepare(
        'SELECT password FROM accounts WHERE user_id = ?'
      )
        .bind(userId)
        .first();
      const context = await authFor(t.env).$context;
      const original = context.password.verify;
      const reached = deferred();
      const resume = deferred();
      const spy = vi
        .spyOn(context.password, 'verify')
        .mockImplementation(async (input) => {
          const valid = await original(input);
          reached.resolve();
          await resume.promise;
          return valid;
        });
      let pending: Promise<Response> | undefined;
      try {
        pending =
          operation === 'change-password'
            ? authCall(
                t,
                operation,
                {
                  currentPassword: PASSWORD,
                  newPassword: 'replacement-password',
                  revokeOtherSessions: true,
                },
                cookie
              )
            : authCall(
                t,
                `two-factor/${operation}`,
                { password: PASSWORD },
                cookie
              );
        await reached.promise;
        const h = recovery(t);
        expect(await h.run(), h.output.join('\n')).toBe(0);
        resume.resolve();
        expect((await pending).status).toBeGreaterThanOrEqual(400);
        expect(
          await t.env.DB.prepare(
            'SELECT password FROM accounts WHERE user_id = ?'
          )
            .bind(userId)
            .first()
        ).toEqual(before);
        expect(
          await t.env.DB.prepare('SELECT id FROM sessions').first()
        ).toBeNull();
        expect(
          await t.env.DB.prepare('SELECT id FROM two_factors').first()
        ).toBeNull();
      } finally {
        resume.resolve();
        await pending;
        spy.mockRestore();
      }
    });
  }
});
