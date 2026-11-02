// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyPassword } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Deps } from '../../cli.ts';
import type { Io } from '../../ui/collect.ts';
import { installationIdOf, resourceNames } from '../../planning/names.ts';
import { checkoutSource } from '../../distribution/source.ts';
import { newState, writeState } from '../../installation/state.ts';
import {
  fakeCloudflare,
  fakeRunner,
  type FakeCloudflare,
  type FakeCloudflareSeed,
} from '../helpers/fakes.ts';

const ACCOUNT = 'a'.repeat(32);
const DB_ID = 'd1-prod';
const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);
const OLD_HASH = 'deadbeef'.repeat(4) + ':' + '00'.repeat(64); // any stored hash; replaced on reset

/** The real schema (every migration) in an in-memory SQLite, answering the fake's D1 queries. */
function database() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  const now = Date.now();
  db.exec(`
    INSERT INTO users (id, name, email, username) VALUES
      ('u-admin', 'Ada', 'ada@example.com', 'ada'),
      ('u-bob', 'Bob', 'Bob@Example.com', 'bob'),
      ('u-agent', 'Speed', 'speed@agents.invalid', 'speed');
    INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES
      ('acc-admin', 'u-admin', 'credential', 'u-admin', '${OLD_HASH}', ${now}, ${now});
    INSERT INTO sessions (id, expires_at, token, created_at, updated_at, user_id) VALUES
      ('s1', ${now + 3600_000}, 't1', ${now}, ${now}, 'u-admin'),
      ('s2', ${now + 3600_000}, 't2', ${now}, ${now}, 'u-admin'),
      ('s3', ${now + 3600_000}, 't3', ${now}, ${now}, 'u-bob');
    INSERT INTO agents (user_id, name, trigger_ask, trigger_above, created_at) VALUES
      ('u-agent', 'Speed', 'Is it slow?', 0.5, ${now});
  `);
  const d1Query: FakeCloudflareSeed['d1Query'] = (_id, sql, params) => {
    const st = db.prepare(sql);
    const args = params as (string | number | null)[];
    if (/^\s*SELECT/i.test(sql)) return st.all(...args);
    st.run(...args);
    return [];
  };
  // As D1 runs a batch: one transaction, rolled back when a statement fails.
  const d1Batch: FakeCloudflareSeed['d1Batch'] = (id, statements) => {
    db.exec('BEGIN');
    try {
      const out = statements.map((s) => d1Query(id, s.sql, s.params ?? [])!);
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return { db, d1Query, d1Batch };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-reset-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function harness(
  opts: {
    tty?: boolean;
    prompts?: (string | null)[];
    confirm?: boolean;
    recorded?: boolean;
  } = {}
) {
  const { db, d1Query, d1Batch } = database();
  const dir = join(root, '.cloudforge');
  if (opts.recorded) {
    const names = resourceNames('acme');
    writeState(dir, {
      ...newState({
        installationId: installationIdOf(ACCOUNT, 'acme', 'workers.dev'),
        accountId: ACCOUNT,
        inputs: {
          name: 'acme',
          hostname: null,
          workersDev: true,
          fromEmail: null,
        },
        names,
        baseUrl: 'https://acme.me.workers.dev',
      }),
      status: 'installed',
      resources: [
        {
          key: 'd1',
          kind: 'd1',
          name: names.d1,
          id: DB_ID,
          ownership: 'created',
          state: 'ready',
        },
      ],
    });
  }
  let cf: FakeCloudflare | null = null;
  const out: string[] = [];
  const asked: string[] = [];
  const prompts = [...(opts.prompts ?? [])];
  const io: Io = {
    tty: opts.tty ?? true,
    async prompt(msg) {
      asked.push(msg);
      return prompts.shift() ?? null;
    },
    async select<T>(_m: string, options: { value: T }[]) {
      return options[0]!.value;
    },
    async confirm(_m: string, initial: boolean) {
      return opts.confirm ?? initial;
    },
    print(t) {
      out.push(t);
    },
  };
  const deps: Deps = {
    io,
    env: {},
    runner: fakeRunner({}),
    dir,
    source: checkoutSource(root),
    home: null,
    configDir: root,
    fetchImpl: (async () => {
      throw new Error('意外的网络请求');
    }) as typeof fetch,
    sleep: async () => {},
    now: () => new Date('2026-10-24T08:00:00Z'),
    token: async () => 'tok',
    cloudflare: () =>
      (cf = fakeCloudflare({
        accounts: [{ id: ACCOUNT, name: 'Acme' }],
        d1: [
          { uuid: DB_ID, name: 'gitorange-db' },
          { uuid: 'd1-other', name: 'other-db' },
        ],
        d1Query,
        d1Batch,
      })),
  };
  const run = (...argv: string[]) => main(['reset-password', ...argv], deps);
  const text = () => out.join('\n');
  const hash = (user: string) =>
    (
      db
        .prepare(
          "SELECT password FROM accounts WHERE user_id = ? AND provider_id = 'credential'"
        )
        .get(user) as { password: string } | undefined
    )?.password;
  const sessions = (user: string) =>
    (
      db
        .prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?')
        .get(user) as { n: number }
    ).n;
  const audit = () =>
    db
      .prepare(
        'SELECT actor_id, actor_kind, via, action, target, data, created_at FROM audit_events'
      )
      .all()
      .map((r) => ({ ...r }));
  return { run, text, asked, hash, sessions, audit, cf: () => cf, db };
}

describe('cloudforge reset-password', () => {
  it('撤销旧密码的未完成双因素挑战，保留因子、恢复码和其他成员挑战', async () => {
    const h = harness({ prompts: ['brand-new-pass', 'brand-new-pass'] });
    h.db.exec(`
      UPDATE users SET two_factor_enabled = 1 WHERE id = 'u-admin';
      INSERT INTO two_factors (id, user_id, secret, backup_codes, verified)
        VALUES ('factor', 'u-admin', 'encrypted-secret', 'encrypted-recovery', 1);
      INSERT INTO verifications (id, identifier, value, expires_at) VALUES
        ('pending-admin', '2fa-admin', 'u-admin', 9999999999999),
        ('pending-bob', '2fa-bob', 'u-bob', 9999999999999),
        ('unrelated', 'email-verification', 'u-admin', 9999999999999);
    `);
    expect(await h.run('ada', '--database', 'gitorange-db')).toBe(0);
    expect(
      h.db
        .prepare("SELECT id FROM verifications WHERE id = 'pending-admin'")
        .get()
    ).toBeUndefined();
    expect(
      h.db
        .prepare('SELECT id FROM verifications ORDER BY id')
        .all()
        .map((r) => r.id)
    ).toEqual(['pending-bob', 'unrelated']);
    expect(
      h.db
        .prepare("SELECT two_factor_enabled FROM users WHERE id = 'u-admin'")
        .get()?.two_factor_enabled
    ).toBe(1);
    const factor = h.db
      .prepare(
        "SELECT secret, backup_codes FROM two_factors WHERE id = 'factor'"
      )
      .get();
    expect(factor?.secret).toBe('encrypted-secret');
    expect(factor?.backup_codes).toBe('encrypted-recovery');
    expect(h.text()).toContain(
      'Two-factor authentication, if enabled, is still required.'
    );
  });

  it('用 --database 改手工部署实例的密码：better-auth 能验证新哈希，会话全部登出，写入审计', async () => {
    const h = harness({ prompts: ['brand-new-pass', 'brand-new-pass'] });
    expect(await h.run('ada', '--database', 'gitorange-db')).toBe(0);
    expect(h.asked).toEqual(['New password', 'Type it again']);
    const hash = h.hash('u-admin')!;
    expect(hash).not.toBe(OLD_HASH);
    expect(await verifyPassword({ hash, password: 'brand-new-pass' })).toBe(
      true
    );
    expect(h.sessions('u-admin')).toBe(0);
    expect(h.sessions('u-bob')).toBe(1);
    expect(h.audit()).toEqual([
      {
        actor_id: null,
        actor_kind: 'system',
        via: 'cloudforge reset-password',
        action: 'user.password_set',
        target: '@ada',
        data: '{}',
        created_at: Date.parse('2026-10-24T08:00:00Z'),
      },
    ]);
    expect(h.text()).toContain('Done: @ada can sign in with the new password.');
    // Only the chosen database was touched, and never by name lookups alone.
    const queried = h
      .cf()!
      .calls.filter((c) => c.method === 'queryD1')
      .map((c) => c.args[1]);
    expect(new Set(queried)).toEqual(new Set([DB_ID]));
  });

  it('密码、会话和审计在一次批量请求中写入，任一条失败则都不生效', async () => {
    const h = harness({ prompts: ['brand-new-pass', 'brand-new-pass'] });
    // The audit insert fails: the batch rolls back, the old password and sessions stay.
    h.db.exec('DROP TABLE audit_events');
    expect(await h.run('ada', '--database', DB_ID)).toBe(1);
    expect(h.text()).not.toContain('Done:');
    expect(h.hash('u-admin')).toBe(OLD_HASH);
    expect(h.sessions('u-admin')).toBe(2);
    const batches = h.cf()!.calls.filter((c) => c.method === 'batchD1');
    expect(batches).toHaveLength(1);
    expect((batches[0]!.args[2] as unknown[]).length).toBe(4);
  });

  it('按邮箱找人（不分大小写）；没有密码账户的成员会新建一个', async () => {
    const h = harness({ prompts: ['bobs-new-pass', 'bobs-new-pass'] });
    expect(await h.run('BOB@example.com', '--database', DB_ID)).toBe(0);
    const hash = h.hash('u-bob')!;
    expect(await verifyPassword({ hash, password: 'bobs-new-pass' })).toBe(
      true
    );
    expect(h.sessions('u-bob')).toBe(0);
    expect(h.audit()[0]).toMatchObject({ target: '@bob' });
  });

  it('有安装记录时按记录找到数据库，并给出登录地址', async () => {
    const h = harness({
      recorded: true,
      prompts: ['brand-new-pass', 'brand-new-pass'],
    });
    expect(await h.run('@ada')).toBe(0);
    expect(h.text()).toContain(
      'Done: @ada can sign in with the new password at https://acme.me.workers.dev.'
    );
    // The recorded D1 id is used as is: no listing.
    expect(h.cf()!.calls.some((c) => c.method === 'listD1')).toBe(false);
  });

  it('两次输入不一致、太短、取消或不确认时什么都不改', async () => {
    for (const [prompts, confirm, said] of [
      [['brand-new-pass', 'brand-new-pasS'], true, 'do not match'],
      [['short'], true, 'Use at least 8 characters.'],
      [[null], true, 'Nothing was changed.'],
      [[], false, 'Nothing was changed.'],
    ] as const) {
      const h = harness({ prompts: [...prompts], confirm });
      expect(await h.run('ada', '--database', 'gitorange-db')).toBe(1);
      expect(h.text()).toContain(said);
      expect(h.hash('u-admin')).toBe(OLD_HASH);
      expect(h.sessions('u-admin')).toBe(2);
      expect(h.audit()).toEqual([]);
    }
  });

  it('拒绝 Agent 与不存在的成员', async () => {
    const agent = harness();
    expect(await agent.run('speed', '--database', 'gitorange-db')).toBe(1);
    expect(agent.text()).toContain('@speed is a reviewer agent');
    expect(agent.hash('u-agent')).toBeUndefined();
    expect(agent.asked).toEqual([]);

    const ghost = harness();
    expect(await ghost.run('ghost', '--database', 'gitorange-db')).toBe(1);
    expect(ghost.text()).toContain('No member ghost in D1 gitorange-db.');
  });

  it('参数错误与非终端', async () => {
    expect(await harness().run('--database', 'gitorange-db')).toBe(2);
    expect(await harness().run('ada', 'bob', '--database', 'x')).toBe(2);
    expect(
      await harness().run('ada', '--name', 'acme', '--database', 'x')
    ).toBe(2);
    expect(await harness().run('ada', '--account', ACCOUNT)).toBe(2);

    const pipe = harness({ tty: false });
    expect(await pipe.run('ada', '--database', 'gitorange-db')).toBe(2);
    expect(pipe.text()).toContain('run it in a terminal');
    expect(pipe.cf()).toBeNull();

    const none = harness();
    expect(await none.run('ada')).toBe(1);
    expect(none.text()).toContain('pass --database');
    expect(none.cf()).toBeNull();

    const missing = harness();
    expect(await missing.run('ada', '--database', 'nope-db')).toBe(1);
    expect(missing.text()).toContain('No D1 database nope-db');
  });
});
