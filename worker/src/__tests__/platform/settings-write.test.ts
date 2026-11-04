// CloudForge fork addition (2026-11-04). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from '../helpers/app';

afterEach(() => vi.restoreAllMocks());
type Operation = 'insert' | 'update' | 'reset' | 'noop';
const operations: Operation[] = ['insert', 'update', 'reset', 'noop'];
const path = '/api/admin/settings/app.name';
const clock = "CAST(unixepoch('subsecond') * 1000 AS INTEGER)";

async function fixture(operation: Operation) {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  const identity = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { user: { id: string }; session: { id: string } };
  // Keep a distinct, genuinely recent proof for the reauthentication interleaving.
  await t.env.DB.prepare(
    `UPDATE sessions SET auth_time=${clock}-1000 WHERE id=?`
  )
    .bind(identity.session.id)
    .run();
  if (operation === 'update' || operation === 'reset')
    await t.env.DB.prepare(
      "INSERT INTO instance_settings(key,value,updated_at,updated_by_id) VALUES('app.name',?,0,?)"
    )
      .bind(JSON.stringify('Before'), identity.user.id)
      .run();
  return {
    t,
    cookie,
    operation,
    userId: identity.user.id,
    sessionId: identity.session.id,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const request = (f: Fixture) =>
  call(f.t, path, {
    cookie: f.cookie,
    method:
      f.operation === 'reset' || f.operation === 'noop' ? 'DELETE' : 'PUT',
    ...(f.operation === 'insert' || f.operation === 'update'
      ? { json: { value: 'After' } }
      : {}),
  });
async function snapshot(t: TestEnv) {
  return {
    settings: (
      await t.env.DB.prepare(
        "SELECT * FROM instance_settings WHERE key='app.name' ORDER BY key"
      ).all()
    ).results,
    audits: (
      await t.env.DB.prepare(
        "SELECT * FROM audit_events WHERE action='instance.settings' ORDER BY id"
      ).all()
    ).results,
  };
}

/** Transparent scheduling only: every statement and result still comes from real workerd D1. */
function writeBoundary(
  t: TestEnv,
  before: () => Promise<void> = async () => {}
) {
  const prepare = t.env.DB.prepare.bind(t.env.DB);
  const batch = t.env.DB.batch.bind(t.env.DB);
  const entries = new WeakMap<
    D1PreparedStatement,
    { original: D1PreparedStatement; query: string }
  >();
  let calls = 0;
  const isWrite = (query: string) =>
    /(?:insert\s+into|update|delete\s+from)\s+["`]?instance_settings\b/i.test(
      query
    );
  const enter = async (queries: string[]) => {
    if (!queries.some(isWrite)) return;
    calls++;
    if (calls === 1) await before();
  };
  const wrap = (
    original: D1PreparedStatement,
    query: string
  ): D1PreparedStatement => {
    const statement = new Proxy(original, {
      get(target, property) {
        if (property === 'bind')
          return (...args: unknown[]) => wrap(target.bind(...args), query);
        if (['all', 'run', 'raw', 'first'].includes(String(property)))
          return async (...args: unknown[]) => {
            await enter([query]);
            return Reflect.apply(Reflect.get(target, property), target, args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    entries.set(statement, { original, query });
    return statement;
  };
  const prepared = vi
    .spyOn(t.env.DB, 'prepare')
    .mockImplementation((query) => wrap(prepare(query), query));
  const batched = vi
    .spyOn(t.env.DB, 'batch')
    .mockImplementation(async (statements) => {
      await enter(
        statements.map((statement) => entries.get(statement)?.query ?? '')
      );
      return batch(
        statements.map(
          (statement) => entries.get(statement)?.original ?? statement
        )
      );
    });
  return {
    calls: () => calls,
    restore: () => {
      prepared.mockRestore();
      batched.mockRestore();
    },
  };
}

async function denied(f: Fixture, invalidate: () => Promise<void>) {
  const before = await snapshot(f.t);
  const boundary = writeBoundary(f.t, invalidate);
  let response: Response;
  try {
    response = await request(f);
  } finally {
    boundary.restore();
  }
  expect(boundary.calls()).toBe(1);
  expect(response!.status).toBe(409);
  expect(response!.headers.get('Cache-Control')).toBe('no-store');
  expect(await response!.text()).not.toMatch(
    /RECENT_AUTHENTICATION_REQUIRED|SQLITE|INSERT INTO|DELETE FROM|auth_version|password123|fixture-secret/
  );
  expect(await snapshot(f.t)).toEqual(before);
}
const run = (f: Fixture, query: string) =>
  f.t.env.DB.prepare(query)
    .run()
    .then(() => {});

describe('站点设置在真实 D1 写入时复核原授权', () => {
  for (const operation of operations) {
    it.each(['role', 'role-aba', 'session'] as const)(
      `${operation} 在 %s 改变后拒绝且不审计成功`,
      async (change) => {
        const f = await fixture(operation);
        await denied(f, async () => {
          if (change === 'session') await run(f, 'DELETE FROM sessions');
          else {
            await run(
              f,
              "UPDATE users SET role='user' WHERE username='octocat'"
            );
            if (change === 'role-aba')
              await run(
                f,
                "UPDATE users SET role='admin' WHERE username='octocat'"
              );
          }
        });
      }
    );
  }

  const changes = [
    ['banned', "UPDATE users SET banned=1 WHERE username='octocat'"],
    ['session-expired', 'UPDATE sessions SET expires_at=0'],
    ['proof-expired', `UPDATE sessions SET auth_time=${clock}-360000`],
    ['proof-replaced', 'UPDATE sessions SET auth_time=auth_time-1'],
    [
      'credential-removed',
      "DELETE FROM accounts WHERE provider_id='credential'",
    ],
    [
      'credential-rotated',
      "UPDATE accounts SET password=password||'-rotated' WHERE provider_id='credential'",
    ],
    [
      'policy-generation',
      'INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,0) ON CONFLICT(id) DO UPDATE SET version=version+1',
    ],
  ] as const;
  for (const operation of ['update', 'noop'] as const) {
    it.each(changes)(`${operation} 保留 %s 的权威边界`, async (_, sql) => {
      const f = await fixture(operation);
      await denied(f, () => run(f, sql));
    });
    it(`${operation} 不把并发成功重验的新证明接到旧请求上`, async () => {
      const f = await fixture(operation);
      await denied(f, async () => {
        const reauthenticated = await call(f.t, '/api/auth/reauthenticate', {
          cookie: f.cookie,
          json: { sessionId: f.sessionId, password: 'password123' },
        });
        expect(reauthenticated.status).toBe(200);
      });
    });
  }
});

// These are D1 authority fixtures; real enrollment and SSO issuance have dedicated suites.
async function withFactor(f: Fixture) {
  await f.t.env.DB.batch([
    f.t.env.DB.prepare(
      'INSERT INTO two_factors(id,user_id,secret,backup_codes,verified) VALUES(?,?,?, ?,1)'
    ).bind('settings-factor', f.userId, 'fixture-secret', '[]'),
    f.t.env.DB.prepare('UPDATE users SET two_factor_enabled=1 WHERE id=?').bind(
      f.userId
    ),
    f.t.env.DB.prepare(
      `UPDATE sessions SET auth_version=(SELECT auth_version FROM users WHERE id=?),auth_time=${clock}-1000,second_factor_method='totp',second_factor_time=${clock}-1000 WHERE id=?`
    ).bind(f.userId, f.sessionId),
  ]);
}
async function withSource(f: Fixture) {
  const now = Date.now();
  await f.t.env.DB.batch([
    f.t.env.DB.prepare(
      'INSERT INTO oidc_providers(id,issuer,version,digest,created_at) VALUES(?,?,1,?,?)'
    ).bind(
      'settings-provider',
      'https://identity.example/settings',
      'settings-digest',
      now
    ),
    f.t.env.DB.prepare(
      'INSERT INTO oidc_configuration(id,enabled,login_enabled,provider_id,version,digest,generation,action_id,updated_at) VALUES(1,1,1,?,1,?,1,?,?)'
    ).bind('settings-provider', 'settings-digest', crypto.randomUUID(), now),
    f.t.env.DB.prepare(
      'INSERT INTO oidc_bindings(id,provider_id,issuer,subject,user_id,active,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)'
    ).bind(
      'settings-binding',
      'settings-provider',
      'https://identity.example/settings',
      'settings-subject',
      f.userId,
      now,
      now
    ),
    f.t.env.DB.prepare(
      'UPDATE sessions SET oidc_binding_id=?,oidc_binding_revision=1,oidc_configuration_generation=1 WHERE id=?'
    ).bind('settings-binding', f.sessionId),
  ]);
}

describe('站点设置复核因子与外部身份来源', () => {
  const factors = [
    ['removed', 'DELETE FROM two_factors'],
    [
      'recovery-version',
      'UPDATE two_factors SET recovery_version=recovery_version+1',
    ],
    ['unverified', 'UPDATE two_factors SET verified=0'],
    [
      'proof-replaced',
      'UPDATE sessions SET second_factor_time=second_factor_time-1',
    ],
  ] as const;
  for (const operation of ['update', 'noop'] as const)
    it.each(factors)(`${operation} 拒绝因子 %s 的迟到写入`, async (_, sql) => {
      const f = await fixture(operation);
      await withFactor(f);
      await denied(f, () => run(f, sql));
    });
  const sources = [
    ['binding-revision', 'UPDATE oidc_bindings SET revision=revision+1'],
    [
      'configuration-generation',
      'UPDATE oidc_configuration SET generation=generation+1',
    ],
    ['configuration-disabled', 'UPDATE oidc_configuration SET enabled=0'],
  ] as const;
  for (const operation of ['insert', 'reset'] as const)
    it.each(sources)(
      `${operation} 拒绝外部来源 %s 的迟到写入`,
      async (_, sql) => {
        const f = await fixture(operation);
        await withSource(f);
        await denied(f, () => run(f, sql));
      }
    );
  it.each(['factor', 'source'] as const)(
    '合法 %s 证明可以保存并恢复设置',
    async (proof) => {
      const f = await fixture('insert');
      await (proof === 'factor' ? withFactor(f) : withSource(f));
      expect((await request(f)).status).toBe(200);
      expect((await request({ ...f, operation: 'reset' })).status).toBe(200);
      expect((await snapshot(f.t)).settings).toEqual([]);
    }
  );
});

describe('设置成功、输入校验与审计兼容', () => {
  it('首次保存、覆盖及重复恢复保持旧 DTO、默认值与成功审计', async () => {
    const f = await fixture('insert');
    for (const operation of operations) {
      const response = await request({ ...f, operation });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    const current = await snapshot(f.t);
    expect(current.settings).toEqual([]);
    expect(current.audits).toHaveLength(4);
    expect(
      current.audits.map((row) => (row as { actor_id: string }).actor_id)
    ).toEqual(Array(4).fill(f.userId));
    const status = await call(f.t, '/api/setup/status');
    expect(await status.json()).toMatchObject({ appName: 'CloudForge' });
  });

  it('未知键包含原型属性仍返回404，非法值不写入且合法值保持规范化', async () => {
    const f = await fixture('insert');
    const before = await snapshot(f.t);
    for (const key of ['unknown', 'toString', 'constructor', '__proto__'])
      for (const method of ['PUT', 'DELETE'])
        expect(
          (
            await call(f.t, '/api/admin/settings/' + key, {
              cookie: f.cookie,
              method,
              ...(method === 'PUT' ? { json: { value: 'After' } } : {}),
            })
          ).status
        ).toBe(404);
    for (const value of ['', null, 12, 'x'.repeat(61)])
      expect(
        (
          await call(f.t, path, {
            cookie: f.cookie,
            method: 'PUT',
            json: { value },
          })
        ).status
      ).toBe(400);
    expect(await snapshot(f.t)).toEqual(before);
    expect(
      (
        await call(f.t, path, {
          cookie: f.cookie,
          method: 'PUT',
          json: { value: '  Normalized  ' },
        })
      ).status
    ).toBe(200);
    expect(
      await f.t.env.DB.prepare(
        "SELECT value,updated_by_id FROM instance_settings WHERE key='app.name'"
      ).first()
    ).toEqual({ value: JSON.stringify('Normalized'), updated_by_id: f.userId });
    expect(
      (
        await call(f.t, '/api/admin/settings/actions.retention_days', {
          cookie: f.cookie,
          method: 'PUT',
          json: { value: null },
        })
      ).status
    ).toBe(200);
  });

  it.each(operations)(
    '%s 审计存储失败仍返回业务成功且不重放写入',
    async (operation) => {
      const f = await fixture(operation);
      // Real D1 failure inside recordAudit; production tables, guards and writes remain active.
      await f.t.env.DB.exec(
        "CREATE TRIGGER settings_test_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END;"
      );
      const boundary = writeBoundary(f.t);
      let response: Response;
      try {
        response = await request(f);
      } finally {
        boundary.restore();
        await f.t.env.DB.exec('DROP TRIGGER settings_test_audit_failure;');
      }
      expect(response!.status).toBe(200);
      expect(await response!.json()).toEqual({ ok: true });
      expect(boundary.calls()).toBe(1);
      const current = await snapshot(f.t);
      expect(current.audits).toEqual([]);
      if (operation === 'insert' || operation === 'update')
        expect(current.settings).toMatchObject([
          {
            key: 'app.name',
            value: JSON.stringify('After'),
            updated_by_id: f.userId,
          },
        ]);
      else expect(current.settings).toEqual([]);
    }
  );
});
