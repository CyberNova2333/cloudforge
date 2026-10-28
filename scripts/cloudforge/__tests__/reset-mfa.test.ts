import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Deps } from '../cli.ts';
import type { Io } from '../collect.ts';
import { installationIdOf, resourceNames } from '../names.ts';
import { checkoutSource } from '../source.ts';
import { newState, writeState } from '../state.ts';
import {
  fakeCloudflare,
  fakeRunner,
  type FakeCloudflareSeed,
} from './fakes.ts';

const ACCOUNT = 'a'.repeat(32);
const DB_ID = 'd1-prod';
const HASH = 'credential-hash-that-must-stay-private';
const SECRET = 'encrypted-authenticator-secret-private';
const REASON = 'Lost the authenticator and all recovery codes';
const MIGRATIONS = new URL('../../../migrations/', import.meta.url);
let root: string;
let databases: DatabaseSync[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-mfa-reset-'));
  databases = [];
});
afterEach(() => {
  for (const db of databases) db.close();
  if (
    !resolve(root).startsWith(resolve(tmpdir()) + '\\cloudforge-mfa-reset-') &&
    !resolve(root).startsWith(resolve(tmpdir()) + '/cloudforge-mfa-reset-')
  )
    throw new Error('Unexpected cleanup target');
  rmSync(root, { recursive: true, force: true });
});

function harness(
  opts: {
    tty?: boolean;
    recorded?: boolean;
    confirm?: boolean;
    onConfirm?: (db: DatabaseSync) => void;
    onWrite?: (db: DatabaseSync) => void;
    response?: 'lost' | 'malformed' | 'malformed-empty' | 'readback-fails';
    reverseRows?: boolean;
  } = {}
) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = Date.now();
  db.exec(`
    INSERT INTO users (id, name, email, username, two_factor_enabled) VALUES
      ('ada-id', 'Ada', 'Ada@Example.com', 'ada', 1),
      ('bob-id', 'Bob', 'bob@example.com', 'bob', 1),
      ('agent-id', 'Speed', 'speed@agents.invalid', 'speed', 0);
    INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES
      ('ada-credential', 'ada-id', 'credential', 'ada-id', '${HASH}', ${at}, ${at}),
      ('bob-credential', 'bob-id', 'credential', 'bob-id', 'bob-private-hash', ${at}, ${at});
    INSERT INTO two_factors (id, user_id, secret, backup_codes, verified) VALUES
      ('ada-factor', 'ada-id', '${SECRET}', 'encrypted-codes', 1),
      ('bob-factor', 'bob-id', 'bob-secret', 'bob-codes', 1);
    INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at, mfa_verified_at) VALUES
      ('ada-s1', 'ada-id', 'ada-token1', ${at + 3600000}, ${at}, ${at}, ${at}),
      ('ada-s2', 'ada-id', 'ada-token2', ${at + 3600000}, ${at}, ${at}, NULL),
      ('bob-s1', 'bob-id', 'bob-token', ${at + 3600000}, ${at}, ${at}, NULL);
    INSERT INTO verifications (id, identifier, value, expires_at) VALUES
      ('ada-challenge', '2fa-challenge-ada', 'ada-id', ${at + 3600000}),
      ('ada-generation', '2fa-generation-2fa-challenge-ada-digest', 'ada-id', ${at + 3600000}),
      ('ada-attempts', '2fa-attempts-2fa-challenge-ada', '3', ${at + 3600000}),
      ('ada-trust', 'trust-device-ada', 'ada-id', ${at + 3600000}),
      ('bob-challenge', '2fa-challenge-bob', 'bob-id', ${at + 3600000}),
      ('bob-attempts', '2fa-attempts-2fa-challenge-bob', '2', ${at + 3600000}),
      ('ada-email', 'verify-email', 'ada-id', ${at + 3600000});
    INSERT INTO agents (user_id, name, trigger_ask, trigger_above, created_at)
      VALUES ('agent-id', 'Speed', 'Slow?', 0.5, ${at});
    INSERT INTO repositories (id, owner_id, name, artifacts_name, created_at, updated_at)
      VALUES ('repo-id', 'ada-id', 'repo', 'r_repo-id', ${at}, ${at});
    INSERT INTO personal_access_tokens (id, user_id, name, token_hash, created_at)
      VALUES ('pat', 'ada-id', 'CI', 'pat-hash', ${at});
    INSERT INTO repository_deploy_tokens (id, repository_id, created_by_id, name, token_hash, expires_at, created_at)
      VALUES ('deploy', 'repo-id', 'ada-id', 'deploy', 'deploy-hash', ${at + 3600000}, ${at});
    INSERT INTO oauth_clients (id, client_id, redirect_uris) VALUES ('client-row', 'client', '["https://client.example/callback"]');
    INSERT INTO oauth_consents (id, client_id, user_id, scopes)
      VALUES ('consent', 'client', 'ada-id', '["openid"]');
    INSERT INTO oauth_refresh_tokens (id, token, client_id, user_id, session_id, scopes)
      VALUES ('refresh', 'refresh-secret', 'client', 'ada-id', 'ada-s1', '["openid"]');
  `);
  const dir = join(root, '.cloudforge');
  const names = resourceNames('acme');
  const state = {
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
    status: 'installed' as const,
    resources: [
      {
        key: 'd1',
        kind: 'd1' as const,
        name: names.d1,
        id: DB_ID,
        ownership: 'created' as const,
        state: 'ready' as const,
      },
    ],
  };
  if (opts.recorded) {
    writeState(dir, state);
    db.prepare(
      'INSERT INTO install_state (installation_id, ownership_nonce, updated_at) VALUES (?, ?, ?)'
    ).run(state.installationId, state.ownershipNonce, at);
  }
  const output: string[] = [];
  const confirms: boolean[] = [];
  let writes = 0;
  const d1Query: FakeCloudflareSeed['d1Query'] = (_id, sql, params) => {
    if (/^INSERT INTO mfa_recovery_events/.test(sql)) {
      writes++;
      opts.onWrite?.(db);
      const rows = db
        .prepare(sql)
        .all(...(params as (string | number | null)[]));
      if (opts.response === 'lost' || opts.response === 'readback-fails')
        throw new Error('Lost the response');
      return opts.response === 'malformed'
        ? [{ unexpected: true }]
        : opts.response === 'malformed-empty'
          ? []
          : rows;
    }
    if (
      opts.response === 'readback-fails' &&
      sql.includes('FROM mfa_recovery_events')
    )
      throw new Error('Readback unavailable');
    const rows = db.prepare(sql).all(...(params as (string | number | null)[]));
    return opts.reverseRows
      ? rows.map((row) => Object.fromEntries(Object.entries(row).reverse()))
      : rows;
  };
  const cf = fakeCloudflare({
    accounts: [{ id: ACCOUNT, name: 'Acme' }],
    d1: [{ uuid: DB_ID, name: 'real-database' }],
    d1Query,
  });
  const io: Io = {
    tty: opts.tty ?? true,
    async prompt() {
      throw new Error('No secret prompts belong to MFA recovery');
    },
    async select<T>(_msg: string, choices: { value: T }[]) {
      return choices[0].value;
    },
    async confirm(_msg, initial) {
      confirms.push(initial);
      opts.onConfirm?.(db);
      return opts.confirm ?? true;
    },
    print(value) {
      output.push(value);
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
      throw new Error('Unexpected HTTP request');
    }) as typeof fetch,
    sleep: async () => {},
    now: () => new Date('2026-10-28T08:00:00Z'),
    token: async () => 'test-token',
    cloudflare: () => cf,
  };
  const run = (...args: string[]) => main(['reset-mfa', ...args], deps);
  const selected = (extra: string[] = []) =>
    run(
      'ada',
      '--database',
      DB_ID,
      '--account',
      ACCOUNT,
      '--reason',
      REASON,
      ...extra
    );
  const text = () => output.join('\n');
  const digest = () => text().match(/Plan digest\s+([a-f0-9]{64})/)?.[1];
  const count = (table: string) =>
    Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
  return {
    db,
    run,
    selected,
    text,
    digest,
    count,
    confirms,
    cf,
    deps,
    state,
    writes: () => writes,
  };
}

describe('独立离线 MFA 恢复', () => {
  for (const name of [
    'cloudforge_factor_auth_version_v1',
    'cloudforge_password_auth_version_v1',
  ]) {
    it(`恢复触发器存在但认证代际触发器缺失时拒绝操作：${name}`, async () => {
      const h = harness();
      h.db.exec(`DROP TRIGGER ${name}`);
      expect(await h.selected()).toBe(1);
      expect(h.writes()).toBe(0);
    });
  }
  it('确认之后认证代际触发器消失时，最终 SQL 不执行恢复', async () => {
    const h = harness({
      onWrite: (db) =>
        db.exec('DROP TRIGGER cloudforge_factor_auth_version_v1'),
    });
    expect(await h.selected()).toBe(1);
    expect(h.count('mfa_recovery_events')).toBe(0);
    expect(h.count('two_factors')).toBe(2);
  });
  for (const sql of [
    "UPDATE users SET auth_version=auth_version+1 WHERE id='ada-id'",
    "UPDATE two_factors SET recovery_version=recovery_version+1 WHERE user_id='ada-id'",
  ]) {
    it(`预览后的认证或恢复码组版本变化拒绝旧恢复请求：${sql}`, async () => {
      const h = harness({ onWrite: (db) => db.exec(sql) });
      expect(await h.selected()).toBe(1);
      expect(h.count('mfa_recovery_events')).toBe(0);
      expect(h.count('two_factors')).toBe(2);
    });
  }
  it('相同查询值的 JSON 键顺序变化不使已确认的计划漂移', async () => {
    const options = { reverseRows: false };
    const h = harness(options);
    expect(await h.selected(['--plan'])).toBe(0);
    const digest = h.digest()!;
    options.reverseRows = true;
    expect(await h.selected(['--yes', '--expect-plan', digest])).toBe(0);
    expect(h.writes()).toBe(1);
  });
  it('单条 INSERT 撤销指定成员的因子/挑战/会话，保留密码、其他成员和机器凭据并审计', async () => {
    const h = harness();
    expect(await h.selected()).toBe(0);
    expect(h.writes()).toBe(1);
    expect(h.cf.calls.some((call) => call.method === 'batchD1')).toBe(false);
    expect(h.confirms).toEqual([false]);
    expect(
      h.db
        .prepare("SELECT two_factor_enabled FROM users WHERE id='ada-id'")
        .get()?.two_factor_enabled
    ).toBe(0);
    expect(
      h.db.prepare("SELECT password FROM accounts WHERE user_id='ada-id'").get()
        ?.password
    ).toBe(HASH);
    expect(h.db.prepare('SELECT user_id FROM two_factors').all()).toEqual([
      { user_id: 'bob-id' },
    ]);
    expect(h.db.prepare('SELECT user_id FROM sessions').all()).toEqual([
      { user_id: 'bob-id' },
    ]);
    expect(
      h.db
        .prepare('SELECT id FROM verifications ORDER BY id')
        .all()
        .map((r) => r.id)
    ).toEqual(['ada-email', 'bob-attempts', 'bob-challenge']);
    expect(h.count('personal_access_tokens')).toBe(1);
    expect(h.count('repository_deploy_tokens')).toBe(1);
    expect(h.count('oauth_consents')).toBe(1);
    expect(
      h.db.prepare('SELECT session_id FROM oauth_refresh_tokens').get()
        ?.session_id
    ).toBeNull();
    const audit = h.db
      .prepare('SELECT actor_kind, via, action, target, data FROM audit_events')
      .get()!;
    expect(audit).toMatchObject({
      actor_kind: 'system',
      via: 'cloudforge reset-mfa',
      action: 'user.mfa_reset',
      target: '@ada',
    });
    expect(JSON.parse(audit.data as string)).toMatchObject({
      userId: 'ada-id',
      reason: REASON,
    });
    expect(h.text()).toContain('unrecorded/manual');
    expect(h.text()).not.toContain(HASH);
    expect(h.text()).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain(HASH);
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });

  it('取消或默认拒绝确认不写入', async () => {
    const h = harness({ confirm: false });
    expect(await h.selected()).toBe(1);
    expect(h.writes()).toBe(0);
    expect(h.count('sessions')).toBe(3);
    expect(h.count('mfa_recovery_events')).toBe(0);
  });

  it('非交互计划只读，执行必须带相同计划摘要', async () => {
    const h = harness({ tty: false });
    expect(await h.selected(['--plan'])).toBe(0);
    expect(h.writes()).toBe(0);
    expect(h.digest()).toMatch(/^[a-f0-9]{64}$/);
    expect(await h.selected(['--yes', '--expect-plan', h.digest()!])).toBe(0);
    expect(h.confirms).toEqual([]);
    expect(h.writes()).toBe(1);
  });

  it('拒绝未明确实例/账户、缺原因、控制字符、单独 --yes 及非终端未审计划', async () => {
    for (const args of [
      ['ada', '--reason', REASON],
      ['ada', '--database', DB_ID, '--reason', REASON],
      [
        'ada',
        '--name',
        'acme',
        '--database',
        DB_ID,
        '--account',
        ACCOUNT,
        '--reason',
        REASON,
      ],
      ['ada', '--database', DB_ID, '--account', ACCOUNT],
      [
        'ada',
        '--database',
        DB_ID,
        '--account',
        ACCOUNT,
        '--reason',
        'bad\u001b[31m',
      ],
      [
        'ada',
        '--database',
        DB_ID,
        '--account',
        ACCOUNT,
        '--reason',
        REASON,
        '--yes',
      ],
    ]) {
      const h = harness();
      expect(await h.run(...args)).toBe(2);
      expect(h.cf.calls).toHaveLength(0);
    }
    const pipe = harness({ tty: false });
    expect(await pipe.selected()).toBe(2);
    expect(pipe.cf.calls).toHaveLength(0);
  });

  it('安装记录必须与实际数据库和 marker 匹配，仍查询远端账户/数据库列表', async () => {
    const h = harness({ recorded: true });
    expect(
      await h.run('ADA@example.com', '--name', 'acme', '--reason', REASON)
    ).toBe(0);
    expect(h.text()).toContain('"acme"');
    expect(h.cf.calls.some((call) => call.method === 'listAccounts')).toBe(
      true
    );
    expect(h.cf.calls.some((call) => call.method === 'listD1')).toBe(true);
    const changed = harness({ recorded: true });
    changed.db.exec("UPDATE install_state SET ownership_nonce='someone-else'");
    expect(await changed.run('ada', '--name', 'acme', '--reason', REASON)).toBe(
      1
    );
    expect(changed.writes()).toBe(0);
  });

  it('拒绝缺失、陈旧或同名被替换的触发器', async () => {
    for (const replacement of [
      '',
      `CREATE TRIGGER cloudforge_mfa_recovery_v1 AFTER INSERT ON mfa_recovery_events BEGIN SELECT 1; END;`,
    ]) {
      const h = harness();
      h.db.exec('DROP TRIGGER cloudforge_mfa_recovery_v1');
      if (replacement) h.db.exec(replacement);
      expect(await h.selected()).toBe(1);
      expect(h.writes()).toBe(0);
      expect(h.text()).toContain('migration/trigger');
    }
  });

  it('预览后身份、密码、秘密或实例变化由最终 INSERT CAS 拒绝', async () => {
    for (const change of [
      "UPDATE users SET username='renamed' WHERE id='ada-id'",
      "UPDATE users SET email='different@example.com' WHERE id='ada-id'",
      "UPDATE accounts SET password='new-password-hash' WHERE user_id='ada-id'",
      "UPDATE two_factors SET secret='new-secret' WHERE user_id='ada-id'",
      "INSERT INTO install_state (installation_id,ownership_nonce,updated_at) VALUES ('other','other',1)",
      'DROP TRIGGER cloudforge_mfa_recovery_v1',
    ]) {
      const h = harness({ onConfirm: (db) => db.exec(change) });
      expect(await h.selected()).toBe(1);
      expect(h.count('mfa_recovery_events')).toBe(0);
      expect(h.count('sessions')).toBe(3);
      expect(h.text()).toContain('changed after preview');
    }
  });

  it('旧摘要在重绑后不执行，新的只读计划可以重新核对', async () => {
    const h = harness();
    expect(await h.selected(['--plan'])).toBe(0);
    const digest = h.digest()!;
    h.db.exec(
      "UPDATE two_factors SET secret='rebound-secret' WHERE user_id='ada-id'"
    );
    expect(await h.selected(['--yes', '--expect-plan', digest])).toBe(1);
    expect(h.writes()).toBe(0);
    expect(h.text()).toContain('plan changed');
  });

  it('触发器末尾审计失败使整条 INSERT 完整回滚', async () => {
    const h = harness();
    h.db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events WHEN NEW.action='user.mfa_reset' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;"
    );
    expect(await h.selected()).toBe(1);
    expect(h.count('sessions')).toBe(3);
    expect(h.count('two_factors')).toBe(2);
    expect(h.count('verifications')).toBe(7);
    expect(h.count('mfa_recovery_events')).toBe(0);
    expect(
      h.db
        .prepare("SELECT two_factor_enabled FROM users WHERE id='ada-id'")
        .get()?.two_factor_enabled
    ).toBe(1);
  });

  it('丢失或损坏写入响应后只读核验恢复事件，不重复执行', async () => {
    for (const response of ['lost', 'malformed', 'malformed-empty'] as const) {
      const h = harness({ response });
      expect(await h.selected()).toBe(0);
      expect(h.writes()).toBe(1);
      expect(h.count('mfa_recovery_events')).toBe(1);
      expect(h.text()).toContain('response was interrupted');
    }
  });

  it('响应和只读核验均失败时说明未知状态，不谎称未修改或自动重试', async () => {
    const h = harness({ response: 'readback-fails' });
    expect(await h.selected()).toBe(1);
    expect(h.writes()).toBe(1);
    expect(h.count('mfa_recovery_events')).toBe(1);
    expect(h.text()).toContain('status is unknown');
    expect(h.text()).not.toContain('Nothing was changed');
  });

  it('拒绝 agent、封禁成员、无密码成员、不存在或歧义成员', async () => {
    const agent = harness();
    expect(
      await agent.run(
        'speed',
        '--database',
        DB_ID,
        '--account',
        ACCOUNT,
        '--reason',
        REASON
      )
    ).toBe(1);
    const banned = harness();
    banned.db.exec("UPDATE users SET banned=1 WHERE id='ada-id'");
    expect(await banned.selected()).toBe(1);
    const noPassword = harness();
    noPassword.db.exec("DELETE FROM accounts WHERE user_id='ada-id'");
    expect(await noPassword.selected()).toBe(1);
    const absent = harness();
    expect(
      await absent.run(
        'ghost',
        '--database',
        DB_ID,
        '--account',
        ACCOUNT,
        '--reason',
        REASON
      )
    ).toBe(1);
    const ambiguous = harness();
    ambiguous.db.exec(
      "UPDATE users SET email='ADA@example.com' WHERE id='bob-id'"
    );
    expect(
      await ambiguous.run(
        'ada@example.com',
        '--database',
        DB_ID,
        '--account',
        ACCOUNT,
        '--reason',
        REASON
      )
    ).toBe(1);
    for (const h of [agent, banned, noPassword, absent, ambiguous])
      expect(h.writes()).toBe(0);
  });

  it('待确认绑定也能独立撤销，无因子账号则不产生恢复事件', async () => {
    const pending = harness();
    pending.db.exec(
      "UPDATE users SET two_factor_enabled=0 WHERE id='ada-id'; UPDATE two_factors SET verified=0 WHERE user_id='ada-id'"
    );
    expect(await pending.selected()).toBe(0);
    const none = harness();
    none.db.exec(
      "UPDATE users SET two_factor_enabled=0 WHERE id='ada-id'; DELETE FROM two_factors WHERE user_id='ada-id'"
    );
    expect(await none.selected()).toBe(1);
    expect(none.writes()).toBe(0);
  });

  it('实际账户或数据库不可见时不会尝试恢复', async () => {
    const account = harness();
    expect(
      await account.run(
        'ada',
        '--database',
        DB_ID,
        '--account',
        'missing',
        '--reason',
        REASON
      )
    ).toBe(1);
    expect(account.writes()).toBe(0);
    const database = harness();
    expect(
      await database.run(
        'ada',
        '--database',
        'missing',
        '--account',
        ACCOUNT,
        '--reason',
        REASON
      )
    ).toBe(1);
    expect(database.writes()).toBe(0);
  });
});
