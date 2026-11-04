// CloudForge fork addition (2026-11-04). SPDX-License-Identifier: GPL-3.0-or-later.
import { describe, expect, it, vi } from 'vitest';
import { authFor } from '../../auth';
import { addMember, bootstrapAdmin, call, makeEnv } from '../helpers/app';

describe('原生管理员写点授权', () => {
  it.each(['demote', 'revoke'] as const)(
    'checks authority again after %s',
    async (kind) => {
      const t = makeEnv();
      const cookie = await bootstrapAdmin(t);
      const memberCookie = await addMember(t, cookie, 'target');
      const actor = (await (
        await call(t, '/api/auth/get-session', { cookie })
      ).json()) as { user: { id: string }; session: { id: string } };
      const member = (await (
        await call(t, '/api/auth/get-session', { cookie: memberCookie })
      ).json()) as { user: { id: string } };
      const context = await authFor(t.env).$context;
      const prior = context.internalAdapter.updateUser;
      let changed = false;
      const barrier = vi
        .spyOn(context.internalAdapter, 'updateUser')
        .mockImplementation(async (...args) => {
          if (!changed) {
            changed = true;
            if (kind === 'demote')
              await t.env.DB.prepare("UPDATE users SET role='user' WHERE id=?")
                .bind(actor.user.id)
                .run();
            else
              await t.env.DB.prepare('DELETE FROM sessions WHERE id=?')
                .bind(actor.session.id)
                .run();
          }
          return prior(...args);
        });
      let response: Response;
      try {
        response = await call(t, '/api/auth/admin/set-role', {
          cookie,
          json: { userId: member.user.id, role: 'admin' },
        });
      } finally {
        barrier.mockRestore();
      }
      expect(changed).toBe(true);
      console.log('administrative write result', {
        kind,
        response: response!.status,
        interleaving: changed,
      });
      expect(
        await t.env.DB.prepare('SELECT role FROM users WHERE id=?')
          .bind(member.user.id)
          .first()
      ).toEqual({ role: 'user' });
      expect(response!.status).toBe(403);
    }
  );

  it.each(['demote', 'revoke'] as const)(
    'checks password write authority again after %s',
    async (kind) => {
      const t = makeEnv();
      const cookie = await bootstrapAdmin(t);
      const memberCookie = await addMember(t, cookie, 'target');
      const actor = (await (
        await call(t, '/api/auth/get-session', { cookie })
      ).json()) as { user: { id: string }; session: { id: string } };
      const member = (await (
        await call(t, '/api/auth/get-session', { cookie: memberCookie })
      ).json()) as { user: { id: string } };
      const before = await t.env.DB.prepare(
        "SELECT password FROM accounts WHERE user_id=? AND provider_id='credential'"
      )
        .bind(member.user.id)
        .first<{ password: string }>();
      const context = await authFor(t.env).$context;
      const hash = context.password.hash;
      let changed = false;
      const barrier = vi
        .spyOn(context.password, 'hash')
        .mockImplementation(async (input) => {
          const result = await hash(input);
          if (!changed) {
            changed = true;
            if (kind === 'demote')
              await t.env.DB.prepare("UPDATE users SET role='user' WHERE id=?")
                .bind(actor.user.id)
                .run();
            else
              await t.env.DB.prepare('DELETE FROM sessions WHERE id=?')
                .bind(actor.session.id)
                .run();
          }
          return result;
        });
      let response: Response;
      try {
        response = await call(t, '/api/auth/admin/set-user-password', {
          cookie,
          json: { userId: member.user.id, newPassword: 'AnotherPassword123' },
        });
      } finally {
        barrier.mockRestore();
      }
      expect(changed).toBe(true);
      console.log('administrative write result', {
        kind,
        operation: 'password',
        response: response!.status,
        interleaving: changed,
      });
      const after = await t.env.DB.prepare(
        "SELECT password FROM accounts WHERE user_id=? AND provider_id='credential'"
      )
        .bind(member.user.id)
        .first<{ password: string }>();
      expect(after?.password === before?.password).toBe(true);
      expect(response!.status).toBe(403);
    }
  );
});

async function fixture() {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  const memberCookie = await addMember(t, cookie, 'target');
  const actor = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { user: { id: string }; session: { id: string } };
  const member = (await (
    await call(t, '/api/auth/get-session', { cookie: memberCookie })
  ).json()) as { user: { id: string }; session: { id: string } };
  const token = await t.env.DB.prepare('SELECT token FROM sessions WHERE id=?')
    .bind(member.session.id)
    .first<{ token: string }>();
  return { t, cookie, actor, member, token: token!.token };
}

describe('原生管理接口在实际 D1 事务中复核权限', () => {
  it.each([
    'set-role',
    'update-user',
    'ban-user',
    'unban-user',
    'create-user',
    'set-user-password',
    'impersonate-user',
    'revoke-user-session',
    'revoke-user-sessions',
  ])('%s 在最终 batch 前撤销管理员后不执行目标写入', async (operation) => {
    const f = await fixture();
    if (operation === 'unban-user')
      await f.t.env.DB.prepare('UPDATE users SET banned=1 WHERE id=?')
        .bind(f.member.user.id)
        .run();
    const snapshot = async () => ({
      users: (
        await f.t.env.DB.prepare(
          "SELECT * FROM users WHERE id=? OR email='fresh@example.test' ORDER BY id"
        )
          .bind(f.member.user.id)
          .all()
      ).results,
      accounts: (
        await f.t.env.DB.prepare(
          'SELECT * FROM accounts WHERE user_id=? ORDER BY id'
        )
          .bind(f.member.user.id)
          .all()
      ).results,
      sessions: (
        await f.t.env.DB.prepare(
          'SELECT * FROM sessions WHERE user_id=? ORDER BY id'
        )
          .bind(f.member.user.id)
          .all()
      ).results,
    });
    const before = await snapshot();
    const batch = f.t.env.DB.batch.bind(f.t.env.DB);
    let changed = false;
    const barrier = vi
      .spyOn(f.t.env.DB, 'batch')
      .mockImplementation(async (statements) => {
        if (!changed) {
          changed = true;
          await f.t.env.DB.prepare("UPDATE users SET role='user' WHERE id=?")
            .bind(f.actor.user.id)
            .run();
        }
        return batch(statements);
      });
    const body =
      operation === 'create-user'
        ? {
            email: 'fresh@example.test',
            name: 'Fresh',
            password: 'password123',
            data: { username: 'fresh' },
          }
        : operation === 'revoke-user-session'
          ? { sessionToken: f.token }
          : {
              userId: f.member.user.id,
              role: 'admin',
              data: { name: 'Changed' },
              newPassword: 'replacement123',
            };
    let response: Response;
    try {
      response = await call(f.t, '/api/auth/admin/' + operation, {
        cookie: f.cookie,
        json: body,
      });
    } finally {
      barrier.mockRestore();
    }
    expect(changed).toBe(true);
    expect(response!.status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it('合法创建账号和连续管理操作保留 SDK 行为', async () => {
    const f = await fixture();
    const created = await call(f.t, '/api/auth/admin/create-user', {
      cookie: f.cookie,
      json: {
        email: 'fresh@example.test',
        name: 'Fresh',
        password: 'password123',
        data: { username: 'fresh' },
      },
    });
    expect(created.status).toBe(200);
    const user = (await created.json()) as { user: { id: string } };
    expect(
      await f.t.env.DB.prepare(
        "SELECT 1 AS found FROM accounts WHERE user_id=? AND provider_id='credential' AND password IS NOT NULL"
      )
        .bind(user.user.id)
        .first()
    ).toEqual({ found: 1 });
    for (const [operation, extra] of [
      ['set-role', { role: 'admin' }],
      ['update-user', { data: { name: 'Renamed' } }],
      ['ban-user', {}],
      ['unban-user', {}],
      ['set-user-password', { newPassword: 'replacement123' }],
    ] as const) {
      const response = await call(f.t, '/api/auth/admin/' + operation, {
        cookie: f.cookie,
        json: { userId: user.user.id, ...extra },
      });
      expect(
        response.status,
        operation + ': ' + (await response.clone().text())
      ).toBe(200);
    }
    const signed = await call(f.t, '/api/auth/sign-in/username', {
      json: { username: 'fresh', password: 'replacement123' },
    });
    expect(signed.status).toBe(200);
    const sessions = await call(f.t, '/api/auth/admin/revoke-user-sessions', {
      cookie: f.cookie,
      json: { userId: user.user.id },
    });
    expect(sessions.status).toBe(200);
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS count FROM sessions WHERE user_id=?'
      )
        .bind(user.user.id)
        .first()
    ).toEqual({ count: 0 });
  });

  it.each([
    'session',
    'proof',
    'policy',
    'aba-role',
    'credential',
    'factor-evidence',
  ] as const)('最终写点拒绝已改变的 %s', async (kind) => {
    const f = await fixture();
    const batch = f.t.env.DB.batch.bind(f.t.env.DB);
    let changed = false;
    const barrier = vi
      .spyOn(f.t.env.DB, 'batch')
      .mockImplementation(async (statements) => {
        if (!changed) {
          changed = true;
          if (kind === 'session')
            await f.t.env.DB.prepare('DELETE FROM sessions WHERE id=?')
              .bind(f.actor.session.id)
              .run();
          if (kind === 'proof')
            await f.t.env.DB.prepare(
              'UPDATE sessions SET auth_time=? WHERE id=?'
            )
              .bind(Date.now() - 360000, f.actor.session.id)
              .run();
          if (kind === 'policy')
            await f.t.env.DB.prepare(
              'UPDATE sessions SET policy_version=policy_version+1 WHERE id=?'
            )
              .bind(f.actor.session.id)
              .run();
          if (kind === 'credential')
            await f.t.env.DB.prepare(
              "UPDATE accounts SET password='fixture-rotated' WHERE user_id=? AND provider_id='credential'"
            )
              .bind(f.actor.user.id)
              .run();
          if (kind === 'factor-evidence')
            await f.t.env.DB.prepare(
              "UPDATE sessions SET second_factor_method='totp', second_factor_time=? WHERE id=?"
            )
              .bind(Date.now(), f.actor.session.id)
              .run();
          if (kind === 'aba-role') {
            await f.t.env.DB.prepare("UPDATE users SET role='user' WHERE id=?")
              .bind(f.actor.user.id)
              .run();
            await f.t.env.DB.prepare("UPDATE users SET role='admin' WHERE id=?")
              .bind(f.actor.user.id)
              .run();
          }
        }
        return batch(statements);
      });
    let response: Response;
    try {
      response = await call(f.t, '/api/auth/admin/set-role', {
        cookie: f.cookie,
        json: { userId: f.member.user.id, role: 'admin' },
      });
    } finally {
      barrier.mockRestore();
    }
    expect(changed).toBe(true);
    expect(response!.status).toBe(403);
    expect(
      await f.t.env.DB.prepare('SELECT role FROM users WHERE id=?')
        .bind(f.member.user.id)
        .first()
    ).toEqual({ role: 'user' });
  });
});

describe('管理员自身变更的成功回执', () => {
  it.each(['set-user-password', 'update-user', 'set-role'] as const)(
    '%s 自身变更不被后续围栏误报失败',
    async (operation) => {
      const f = await fixture();
      const body = {
        userId: f.actor.user.id,
        ...(operation === 'set-user-password'
          ? { newPassword: 'selfReplacement123' }
          : operation === 'update-user'
            ? { data: { name: 'Changed admin' } }
            : { role: 'user' }),
      };
      const response = await call(f.t, '/api/auth/admin/' + operation, {
        cookie: f.cookie,
        json: body,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      if (operation === 'set-user-password') {
        const fresh = await call(f.t, '/api/auth/sign-in/username', {
          json: { username: 'octocat', password: 'selfReplacement123' },
        });
        expect(fresh.status).toBe(200);
        const oldSession = await call(f.t, '/api/auth/get-session', {
          cookie: f.cookie,
        });
        expect(await oldSession.json()).toBeNull();
      } else if (operation === 'update-user')
        expect(
          await f.t.env.DB.prepare('SELECT name FROM users WHERE id=?')
            .bind(f.actor.user.id)
            .first()
        ).toEqual({ name: 'Changed admin' });
      else
        expect(
          await f.t.env.DB.prepare('SELECT role FROM users WHERE id=?')
            .bind(f.actor.user.id)
            .first()
        ).toEqual({ role: 'user' });
    }
  );

  it('创建成员后授权撤销，不能继续签发密码凭据', async () => {
    const f = await fixture();
    const context = await authFor(f.t.env).$context;
    const hash = context.password.hash;
    let changed = false;
    const barrier = vi
      .spyOn(context.password, 'hash')
      .mockImplementation(async (password) => {
        const result = await hash(password);
        changed = true;
        await f.t.env.DB.prepare("UPDATE users SET role='user' WHERE id=?")
          .bind(f.actor.user.id)
          .run();
        return result;
      });
    let response: Response;
    try {
      response = await call(f.t, '/api/auth/admin/create-user', {
        cookie: f.cookie,
        json: {
          email: 'partial@example.test',
          name: 'Partial',
          password: 'password123',
          data: { username: 'partial' },
        },
      });
    } finally {
      barrier.mockRestore();
    }
    expect(changed).toBe(true);
    expect(response!.status).toBe(403);
    const user = await f.t.env.DB.prepare(
      "SELECT id FROM users WHERE email='partial@example.test'"
    ).first<{ id: string }>();
    expect(user).not.toBeNull(); // The earlier, authorized write is not a request-wide transaction.
    expect(
      await f.t.env.DB.prepare('SELECT 1 FROM accounts WHERE user_id=?')
        .bind(user!.id)
        .first()
    ).toBeNull();
  });
});

it('近期证明仍有效的旧会话可以刷新并完成合法原生管理', async () => {
  const f = await fixture();
  await f.t.env.DB.prepare(
    'UPDATE sessions SET expires_at=?, updated_at=? WHERE id=?'
  )
    .bind(
      Date.now() + 2 * 86400000,
      Date.now() - 5 * 86400000,
      f.actor.session.id
    )
    .run();
  const response = await call(f.t, '/api/auth/admin/update-user', {
    cookie: f.cookie,
    json: { userId: f.member.user.id, data: { name: 'After refresh' } },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    await f.t.env.DB.prepare('SELECT name FROM users WHERE id=?')
      .bind(f.member.user.id)
      .first()
  ).toEqual({ name: 'After refresh' });
});
