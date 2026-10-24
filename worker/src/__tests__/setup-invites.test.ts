// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import appRoutes from '../../../src/App.tsx?raw';
import { isReservedUsername } from '../lib/usernames';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  signIn,
} from './helpers/app';

describe('首次初始化', () => {
  it('首个管理员创建前报告需要初始化，之后关闭入口', async () => {
    const t = makeEnv();
    expect(await (await call(t, '/api/setup/status')).json()).toMatchObject({
      setupRequired: true,
      codeRequired: false,
      appName: 'CloudForge',
      // Nobody can sign up before the first admin exists.
      signup: { enabled: false },
    });
    await bootstrapAdmin(t);
    expect(await (await call(t, '/api/setup/status')).json()).toMatchObject({
      setupRequired: false,
      codeRequired: false,
      appName: 'CloudForge',
    });

    const again = await call(t, '/api/setup', {
      json: {
        name: 'Evil',
        username: 'evil',
        email: 'evil@example.com',
        password: 'password123',
      },
    });
    expect(again.status).toBe(403);
  });

  it('将首个用户设为站点管理员', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const res = await call(t, '/api/auth/get-session', { cookie });
    const session = (await res.json()) as {
      user: { role: string; username: string };
    };
    expect(session.user.role).toBe('admin');
    expect(session.user.username).toBe('octocat');
  });

  it('拒绝保留用户名', async () => {
    const t = makeEnv();
    const res = await call(t, '/api/setup', {
      json: {
        name: 'X',
        username: 'settings',
        email: 'x@example.com',
        password: 'password123',
      },
    });
    expect(res.status).toBe(400);
  });

  it('保留所有网页应用和 Worker 路由的首个路径段', async () => {
    // The web app's top-level routes (src/App.tsx), plus what the worker serves at the root.
    const routes = [
      ...new Set(
        [...appRoutes.matchAll(/path="\/([^/":*]+)/g)].map((m) => m[1])
      ),
    ];
    expect(routes).toEqual(
      expect.arrayContaining(['repos', 'agents', 'oauth', 'approvals'])
    );
    for (const name of [...routes, 'api', 'mcp'])
      expect(isReservedUsername(name), name).toBe(true);
    const t = makeEnv();
    const res = await call(t, '/api/setup', {
      json: {
        name: 'X',
        username: 'repos',
        email: 'x@example.com',
        password: 'password123',
      },
    });
    expect(res.status).toBe(400);
  });

  it('不允许公开注册', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const res = await call(t, '/api/auth/sign-up/email', {
      json: { name: 'X', email: 'x@example.com', password: 'password123' },
    });
    expect(res.ok).toBe(false);
  });
});

describe('邀请', () => {
  it('通过邮件发送邀请链接，且只能创建一次成员', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const res = await call(t, '/api/invites', {
      cookie: admin,
      json: { email: 'Bob@Example.com', role: 'user' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      inviteUrl: string;
      emailed: boolean;
      invitation: { email: string };
    };
    expect(body.emailed).toBe(true);
    expect(body.invitation.email).toBe('bob@example.com');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].text).toContain(body.inviteUrl);
    // Usage & cost: each accepted email is counted for today.
    const counted = await t.env.DB.prepare(
      "SELECT quantity, source FROM usage_daily WHERE metric = 'email.sends'"
    ).first<{ quantity: number; source: string }>();
    expect(counted).toEqual({ quantity: 1, source: 'cloudforge' });

    const token = body.inviteUrl.split('/invite/')[1];
    expect((await call(t, `/api/invites/token/${token}`)).status).toBe(200);
    const accept = await call(t, '/api/invites/accept', {
      json: { token, name: 'Bob', username: 'bob', password: 'password123' },
    });
    expect(accept.status).toBe(200);
    expect(await signIn(t, 'bob', 'password123')).toContain('session_token');

    const reuse = await call(t, '/api/invites/accept', {
      json: {
        token,
        name: 'Mallory',
        username: 'mallory',
        password: 'password123',
      },
    });
    expect(reuse.status).toBe(400);
  });

  it('只存储邀请令牌的哈希值', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const res = await call(t, '/api/invites', {
      cookie: admin,
      json: { email: 'c@example.com' },
    });
    const { inviteUrl } = (await res.json()) as { inviteUrl: string };
    const token = inviteUrl.split('/invite/')[1];
    const row = await t.env.DB.prepare(
      'SELECT token_hash FROM invitations'
    ).first<{ token_hash: string }>();
    expect(row!.token_hash).not.toContain(token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('禁止普通成员发送邀请', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    expect(
      (
        await call(t, '/api/invites', {
          cookie: bob,
          json: { email: 'z@example.com' },
        })
      ).status
    ).toBe(403);
    expect(
      (await call(t, '/api/invites', { json: { email: 'z@example.com' } }))
        .status
    ).toBe(401);
  });

  it('拒绝邀请已有用户', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const res = await call(t, '/api/invites', {
      cookie: admin,
      json: { email: 'octocat@example.com' },
    });
    expect(res.status).toBe(409);
  });
});

describe('用户名', () => {
  it('拒绝通过 better-auth 改为保留用户名', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const res = await call(t, '/api/auth/update-user', {
      cookie,
      json: { username: 'settings' },
    });
    expect(res.ok).toBe(false);
    const session = (await (
      await call(t, '/api/auth/get-session', { cookie })
    ).json()) as { user: { username: string } };
    expect(session.user.username).toBe('octocat');
  });

  it('仍允许改为普通用户名', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const res = await call(t, '/api/auth/update-user', {
      cookie,
      json: { username: 'hubot' },
    });
    expect(res.ok).toBe(true);
  });
});
