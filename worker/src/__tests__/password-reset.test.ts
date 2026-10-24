import { describe, expect, it } from 'vitest';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  signIn,
  type TestEnv,
} from './helpers/app';
import { newAgent } from './helpers/agents';
import { verifyPassword } from 'better-auth/crypto';

const requestReset = (t: TestEnv, email: string) =>
  call(t, '/api/auth/request-password-reset', {
    json: { email, redirectTo: '/reset-password' },
  });

const resetPassword = (t: TestEnv, token: string, newPassword: string) =>
  call(t, '/api/auth/reset-password', { json: { token, newPassword } });

const storedHash = async (t: TestEnv, username: string) =>
  (await t.env.DB.prepare(
    "SELECT a.password FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.username = ? AND a.provider_id = 'credential'"
  )
    .bind(username)
    .first<{ password: string }>())!.password;

const signedIn = async (t: TestEnv, cookie: string) =>
  (await call(t, '/api/me/preferences', { cookie })).status === 200;

const audit = async (t: TestEnv, action: string) =>
  (
    await t.env.DB.prepare(
      `SELECT a.target, u.username AS actor, a.data FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action = ?`
    )
      .bind(action)
      .all<{ target: string; actor: string | null; data: string }>()
  ).results;

describe('忘记密码：登录页的邮件链接', () => {
  it('发出一次性链接；重置后新密码可登录、旧密码失效、其他会话被登出，并写入审计', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    expect(await signedIn(t, bob)).toBe(true);

    expect((await requestReset(t, 'bob@example.com')).status).toBe(200);
    const mail = t.sent.at(-1)!;
    expect(mail.to).toBe('bob@example.com');
    expect(mail.subject).toBe('Reset your CloudForge password');
    const token = mail.text!.match(/reset-password\/([A-Za-z0-9]+)\?/)![1];

    // The emailed link passes through better-auth, which sends the browser on to the reset page.
    const hop = await call(
      t,
      `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent('/reset-password')}`
    );
    expect(hop.status).toBe(302);
    expect(hop.headers.get('location')).toContain(
      `/reset-password?token=${token}`
    );

    expect((await resetPassword(t, token, 'brand-new-pass')).status).toBe(200);
    expect(await signedIn(t, bob)).toBe(false);
    // Sign-in is rate limited (3 per window): check the old password against the stored hash instead.
    const hash = await storedHash(t, 'bob');
    expect(await verifyPassword({ hash, password: 'password123' })).toBe(false);
    expect(await signedIn(t, await signIn(t, 'bob', 'brand-new-pass'))).toBe(
      true
    );
    // One use only.
    expect((await resetPassword(t, token, 'another-pass-1')).status).toBe(400);
    expect(await audit(t, 'user.password_reset')).toEqual([
      { target: '@bob', actor: 'bob', data: '{}' },
    ]);
  });

  it('未注册的邮箱同样返回成功（不泄露是否存在），但不发邮件', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const before = t.sent.length;
    const res = await requestReset(t, 'nobody@example.com');
    expect(res.status).toBe(200);
    expect(t.sent.length).toBe(before);
  });

  it('太短的新密码被拒绝，令牌仍可再用', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    await requestReset(t, 'bob@example.com');
    const token = t.sent
      .at(-1)!
      .text!.match(/reset-password\/([A-Za-z0-9]+)\?/)![1];
    expect((await resetPassword(t, token, 'short')).status).toBe(400);
    expect((await resetPassword(t, token, 'long-enough-1')).status).toBe(200);
  });

  it('Agent 没有密码：不发重置邮件，也不会因此获得密码', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    const email = (await t.env.DB.prepare(
      'SELECT email FROM users WHERE username = ?'
    )
      .bind(agent.username)
      .first<{ email: string }>())!.email;
    const before = t.sent.length;
    expect((await requestReset(t, email)).status).toBe(200);
    expect(t.sent.length).toBe(before);
    const tokens = await t.env.DB.prepare(
      "SELECT count(*) AS n FROM verifications WHERE identifier LIKE 'reset-password:%'"
    ).first<{ n: number }>();
    expect(tokens!.n).toBe(0);
    const credentials = await t.env.DB.prepare(
      "SELECT count(*) AS n FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.username = ? AND a.provider_id = 'credential'"
    )
      .bind(agent.username)
      .first<{ n: number }>();
    expect(credentials!.n).toBe(0);
  });

  it('登录页据实例是否配置邮件决定是否显示入口', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const status = async (env: TestEnv) =>
      (
        (await (await call(env, '/api/setup/status')).json()) as {
          passwordReset: boolean;
        }
      ).passwordReset;
    expect(await status(t)).toBe(true);
    expect(
      await status({
        ...t,
        env: { ...t.env, EMAIL: undefined } as unknown as CloudflareBindings,
      })
    ).toBe(false);
  });
});

describe('管理员为成员生成重置链接', () => {
  const createLink = (t: TestEnv, cookie: string, username: string) =>
    call(t, `/api/admin/users/${username}/password-reset`, {
      cookie,
      method: 'POST',
    });

  it('只有站点管理员可以生成；链接发给成员并返回给管理员，用后即作废', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    expect((await createLink(t, bob, 'octocat')).status).toBe(403);

    const res = await createLink(t, admin, 'bob');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      url: string;
      expiresAt: string;
      emailed: boolean;
    };
    expect(body.url).toMatch(
      /^http:\/\/test\.local\/reset-password\?token=[A-Za-z0-9]{32}$/
    );
    expect(body.emailed).toBe(true);
    const hours = (Date.parse(body.expiresAt) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const mail = t.sent.at(-1)!;
    expect(mail.to).toBe('bob@example.com');
    expect(mail.text).toContain(body.url);
    expect(mail.text).toContain('@octocat, a site admin');

    const token = new URL(body.url).searchParams.get('token')!;
    expect((await resetPassword(t, token, 'admin-given-1')).status).toBe(200);
    expect(await signedIn(t, bob)).toBe(false);
    await signIn(t, 'bob', 'admin-given-1');
    expect((await resetPassword(t, token, 'admin-given-2')).status).toBe(400);
    expect(await audit(t, 'user.password_reset_link')).toEqual([
      { target: '@bob', actor: 'octocat', data: '{"emailed":true}' },
    ]);
  });

  it('未配置邮件时仍返回链接，只是不发邮件', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    const noMail = {
      ...t,
      env: { ...t.env, EMAIL: undefined } as unknown as CloudflareBindings,
    };
    const before = t.sent.length;
    const res = await createLink(noMail, admin, 'bob');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; emailed: boolean };
    expect(body.emailed).toBe(false);
    expect(t.sent.length).toBe(before);
    const token = new URL(body.url).searchParams.get('token')!;
    expect((await resetPassword(t, token, 'no-mail-pass-1')).status).toBe(200);
  });

  it('Agent 与不存在的成员被拒绝', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    expect((await createLink(t, admin, agent.username)).status).toBe(422);
    expect((await createLink(t, admin, 'ghost')).status).toBe(404);
  });
});
