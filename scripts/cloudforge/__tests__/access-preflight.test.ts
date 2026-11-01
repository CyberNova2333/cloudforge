// CloudForge fork (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Deps } from '../cli.ts';
import type { Io } from '../collect.ts';
import { installationIdOf, resourceNames } from '../names.ts';
import { checkoutSource, packageSource } from '../source.ts';
import { newState, writeState } from '../state.ts';
import { fakeCloudflare, fakePackage, fakeRunner } from './fakes.ts';

const ACCOUNT = 'a'.repeat(32);
const DATABASE = 'd1-access-preflight';
const PRIVATE = 'private-token-email@example.invalid-secret-ownership-material';
const MIGRATIONS = new URL('../../../migrations/', import.meta.url);
let root: string;
let databases: DatabaseSync[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-access-preflight-'));
  databases = [];
});
afterEach(() => {
  for (const database of databases) database.close();
  const absolute = resolve(root);
  if (
    !absolute.startsWith(
      resolve(tmpdir()) + '\\cloudforge-access-preflight-'
    ) &&
    !absolute.startsWith(resolve(tmpdir()) + '/cloudforge-access-preflight-')
  )
    throw new Error('Unexpected cleanup target');
  rmSync(absolute, { recursive: true, force: true });
});

function localFiles(directory = root): Record<string, string> {
  return Object.fromEntries(
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? Object.entries(localFiles(path))
        : [[path, readFileSync(path).toString('base64')]];
    })
  );
}

function harness(
  opts: {
    recorded?: boolean;
    latestSchema?: boolean;
    packageMode?: boolean;
    accounts?: { id: string; name: string }[];
    d1?: { uuid: string; name: string }[];
    response?: (rows: Record<string, unknown>[]) => unknown;
  } = {}
) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  for (const file of readdirSync(MIGRATIONS)
    // This command is deliberately legacy-only; the compatible schema is refused.
    .filter(
      (name) =>
        name.endsWith('.sql') &&
        (opts.latestSchema || Number(name.slice(0, 4)) <= 62)
    )
    .sort())
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    INSERT INTO users (id,name,email,username,role) VALUES
      ('owner','Owner','owner-private@example.invalid','owner','admin'),
      ('bob','Bob','bob-private@example.invalid','bob','user');
    INSERT INTO teams (id,slug,name,created_at) VALUES ('legacy','shared','Shared',0);
    INSERT INTO repositories (id,owner_id,team_id,name,visibility,artifacts_name,created_at,updated_at) VALUES
      ('personal','owner',NULL,'personal','private','r_personal',0,0),
      ('team-internal','owner','legacy','internal','internal','r_internal',0,0),
      ('team-public','owner','legacy','public','public','r_public',0,0);
    INSERT INTO repository_collaborators (repository_id,user_id,created_at) VALUES ('personal','bob',0);
  `);
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
      baseUrl: 'https://acme.example.invalid',
    }),
    status: 'installed' as const,
    resources: [
      {
        key: 'd1',
        kind: 'd1' as const,
        name: names.d1,
        id: DATABASE,
        ownership: 'created' as const,
        state: 'ready' as const,
      },
    ],
  };
  const home = opts.packageMode ? join(root, 'home') : null;
  const dir = home ? join(home, 'acme') : join(root, '.cloudforge');
  if (opts.recorded) {
    writeState(dir, state);
    db.prepare(
      'INSERT INTO install_state (installation_id,ownership_nonce,updated_at) VALUES (?,?,0)'
    ).run(state.installationId, state.ownershipNonce);
  }
  const cf = fakeCloudflare({
    accounts: opts.accounts ?? [{ id: ACCOUNT, name: 'Account' }],
    d1: opts.d1 ?? [{ uuid: DATABASE, name: 'actual-database-name' }],
    d1Query: (_id, sql, params) => {
      // Any accidental DML, schema change or trigger side effect fails, even if hidden in a CTE.
      db.exec('PRAGMA query_only = ON');
      try {
        const rows = db
          .prepare(sql)
          .all(...(params as (string | number | null)[]));
        return (opts.response ? opts.response(rows) : rows) as Record<
          string,
          unknown
        >[];
      } finally {
        db.exec('PRAGMA query_only = OFF');
      }
    },
  });
  const output: string[] = [];
  const io: Io = {
    tty: false,
    prompt: async () => {
      throw new Error('Unexpected prompt');
    },
    select: async () => {
      throw new Error('Unexpected selection');
    },
    confirm: async () => {
      throw new Error('Unexpected confirmation');
    },
    print: (value) => output.push(value),
  };
  const runner = fakeRunner({});
  let tokens = 0;
  const deps: Deps = {
    io,
    dir,
    home,
    configDir: root,
    runner,
    env: {},
    source: opts.packageMode
      ? packageSource(
          fakePackage(join(root, 'package'), {
            version: '1.0.0',
            commit: 'f'.repeat(40),
          })
        )
      : checkoutSource(root),
    token: async () => {
      tokens++;
      return PRIVATE;
    },
    cloudflare: () => cf,
    now: () => new Date('2026-10-31T00:00:00Z'),
    fetchImpl: async () => {
      throw new Error('Unexpected HTTP request');
    },
    sleep: async () => {},
  };
  const run = (...args: string[]) => main(['access-preflight', ...args], deps);
  const selected = () => run('--database', DATABASE, '--account', ACCOUNT);
  const text = () => output.join('\n');
  const report = () => JSON.parse(output.at(-1)!);
  return {
    db,
    cf,
    deps,
    runner,
    state,
    dir,
    run,
    selected,
    text,
    report,
    tokens: () => tokens,
  };
}

describe('access-preflight：只读兼容迁移预检', () => {
  it('已迁入兼容schema时拒绝当作旧模型回填，保持所有数据及代数不变', async () => {
    const h = harness({ latestSchema: true });
    const before = h.db.prepare('SELECT * FROM access_control_state').all();
    const grants = h.db.prepare('SELECT * FROM repository_collaborators').all();
    expect(await h.selected()).toBe(1);
    expect(h.text()).toContain(
      'could not read a valid, bounded compatibility snapshot'
    );
    expect(h.db.prepare('SELECT * FROM access_control_state').all()).toEqual(
      before
    );
    expect(
      h.db.prepare('SELECT * FROM repository_collaborators').all()
    ).toEqual(grants);
    expect(h.text()).not.toContain(PRIVATE);
  });

  it('仅执行一次只读快照，保留旧协作者/创建者/公开集合并不授权角色发布', async () => {
    const h = harness();
    const before = localFiles();
    expect(await h.selected()).toBe(0);
    const report = h.report();
    expect(report.target).toEqual({
      accountId: ACCOUNT,
      databaseId: DATABASE,
      installationId: null,
    });
    expect(report.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.legacySharedTeamId).toBe('legacy');
    expect(report.publicRepositoryIds).toEqual(['team-public']);
    expect(report.compatibility).toMatchObject({
      legacyCollaboratorsBackfillRole: 'write',
      legacyCollaboratorCount: 1,
      preserveOwnerCreatorAdmin: true,
      newRolesEnabled: false,
      rollbackSafe: false,
    });
    expect(report).toMatchObject({
      blocked: false,
      rolePublishingAllowed: false,
      migrationApplied: false,
    });
    expect(report.notice).toContain('not an apply authorization');
    expect(h.cf.calls.map((call) => call.method)).toEqual([
      'listAccounts',
      'listD1',
      'queryD1',
    ]);
    expect(h.runner.calls).toEqual([]);
    expect(localFiles()).toEqual(before);
    expect(h.text()).not.toMatch(/owner-private|bob-private|ownershipNonce/);
    expect(h.text()).not.toContain(PRIVATE);
    expect(report).not.toHaveProperty('snapshot');
    expect(
      h.db.prepare('SELECT COUNT(*) AS n FROM repository_collaborators').get()
        ?.n
    ).toBe(1);
  });

  it.each([
    [],
    ['--account', ACCOUNT],
    ['--database', DATABASE],
    ['--name', 'acme', '--account', ACCOUNT],
    ['--name', 'acme', '--database', DATABASE, '--account', ACCOUNT],
    ['--database', DATABASE, '--account', ''],
    ['--database', '', '--account', ACCOUNT],
    ['--name', '../acme'],
    ['--name', 'acme\n'],
    ['--name', 'acme', '--yes'],
    ['--name', 'acme', '--apply'],
    ['--name', 'acme', '--plan'],
    ['--name', 'acme', '--expect-plan', PRIVATE],
    ['--database', DATABASE, '--account', ACCOUNT, PRIVATE],
  ])('非法或非显式目标参数%j在读凭据前退出2', async (...args) => {
    const h = harness();
    const before = localFiles();
    expect(await h.run(...args)).toBe(2);
    expect(h.tokens()).toBe(0);
    expect(h.cf.calls).toEqual([]);
    expect(h.text()).not.toContain(PRIVATE);
    expect(localFiles()).toEqual(before);
  });

  it.each([false, true])(
    '记录安装目标核对实际库与marker；packageMode=%s',
    async (packageMode) => {
      const h = harness({ recorded: true, packageMode });
      const before = localFiles();
      expect(await h.run('--name', 'acme')).toBe(0);
      expect(h.report().target.installationId).toBe(h.state.installationId);
      const call = h.cf.calls.find((call) => call.method === 'queryD1')!;
      expect(call.args.slice(0, 2)).toEqual([ACCOUNT, DATABASE]);
      expect(JSON.stringify(call.args)).toContain(h.state.ownershipNonce);
      expect(h.text()).not.toContain(h.state.ownershipNonce);
      expect(localFiles()).toEqual(before);
    }
  );

  it('错ownership marker拒绝，不输出摘要或潜在错误目标的资料', async () => {
    const h = harness({ recorded: true });
    h.db.exec("UPDATE install_state SET ownership_nonce='wrong-ownership'");
    expect(await h.run('--name', 'acme')).toBe(1);
    expect(h.text()).toBe(
      'Access preflight could not read a valid, bounded compatibility snapshot. Nothing was changed.'
    );
    expect(h.text()).not.toContain(h.state.ownershipNonce);
    expect(h.text()).not.toContain('snapshotDigest');
  });

  it('记录库ID不存在时不回退到同名新库', async () => {
    const h = harness({
      recorded: true,
      d1: [{ uuid: 'replacement', name: resourceNames('acme').d1 }],
    });
    expect(await h.run('--name', 'acme')).toBe(1);
    expect(h.cf.calls.some((call) => call.method === 'queryD1')).toBe(false);
  });

  it.each(['missing', 'moved', 'multiple-databases'])(
    '记录安装%s拒绝且不读云端',
    async (problem) => {
      const h = harness({ recorded: problem !== 'missing' });
      if (problem === 'moved')
        writeState(h.dir, { ...h.state, movedTo: PRIVATE });
      if (problem === 'multiple-databases')
        writeState(h.dir, {
          ...h.state,
          resources: [
            h.state.resources[0],
            { ...h.state.resources[0], key: 'extra', id: 'other-db' },
          ],
        });
      const before = localFiles();
      expect(await h.run('--name', 'acme')).toBe(1);
      expect(h.cf.calls).toEqual([]);
      expect(h.text()).not.toContain(PRIVATE);
      expect(localFiles()).toEqual(before);
    }
  );

  it.each([
    { accounts: [] },
    { accounts: [{ id: 'other', name: 'Other' }] },
    {
      accounts: [
        { id: 'one', name: 'ambiguous' },
        { id: 'two', name: 'AMBIGUOUS' },
      ],
    },
    { d1: [] },
    {
      d1: [
        { uuid: DATABASE, name: 'one' },
        { uuid: 'two', name: DATABASE },
      ],
    },
  ])('不存在或歧义的真实account/db拒绝且不queryD1：%j', async (opts) => {
    const h = harness(opts);
    const args =
      opts.accounts?.[0]?.name === 'ambiguous' ? 'ambiguous' : ACCOUNT;
    expect(await h.run('--database', DATABASE, '--account', args)).toBe(1);
    expect(h.cf.calls.some((call) => call.method === 'queryD1')).toBe(false);
    expect(h.text()).not.toContain(PRIVATE);
  });

  it.each([
    null,
    [],
    [{}],
    [{ snapshot: '{invalid' }],
    [{ snapshot: null }],
    [{ snapshot: '{}' }, { snapshot: '{}' }],
  ])('不完整快照failclosed，不回显原响应%j', async (response) => {
    const h = harness({ response: () => response });
    expect(await h.selected()).toBe(1);
    expect(h.text()).toBe(
      'Access preflight could not read a valid, bounded compatibility snapshot. Nothing was changed.'
    );
    expect(h.text()).not.toContain('snapshotDigest');
  });

  it('传输/凭据错误不回显原错误或SQL参数', async () => {
    const h = harness();
    h.cf.failNext('queryD1', new Error(`SQL with ${PRIVATE}`));
    expect(await h.selected()).toBe(1);
    expect(h.text()).not.toContain(PRIVATE);
    h.deps.token = async () => {
      throw new Error(PRIVATE);
    };
    expect(await h.selected()).toBe(1);
    expect(h.text()).not.toContain(PRIVATE);
  });

  it('数据库存在多团队或旧team-private时阻断，但不自动修复数据', async () => {
    const h = harness();
    h.db.exec(
      "INSERT INTO teams(id,slug,name,created_at) VALUES('extra','extra','Extra',0)"
    );
    h.db.exec(
      "UPDATE repositories SET visibility='private' WHERE id='team-internal'"
    );
    const before = h.db
      .prepare('SELECT id,team_id,visibility FROM repositories ORDER BY id')
      .all();
    expect(await h.selected()).toBe(1);
    expect(h.report().blockers.length).toBeGreaterThan(0);
    expect(h.report().rolePublishingAllowed).toBe(false);
    expect(
      h.db
        .prepare('SELECT id,team_id,visibility FROM repositories ORDER BY id')
        .all()
    ).toEqual(before);
  });

  it('已加入未知角色列的库不能被旧兼容预检判为可发布', async () => {
    const h = harness();
    h.db.exec('ALTER TABLE repository_collaborators ADD COLUMN role TEXT');
    expect(await h.selected()).toBe(1);
    expect(h.text()).not.toContain('snapshotDigest');
  });

  it('同一数据库的行/键返回顺序不改变摘要；授权/公开集合/目标变化会改变', async () => {
    let reverse = false;
    const h = harness({
      response: (rows) =>
        rows.map((row) => {
          if (!reverse) return row;
          const snapshot = JSON.parse(row.snapshot as string);
          for (const key of [
            'users',
            'teams',
            'repositories',
            'collaborators',
            'agents',
          ])
            snapshot[key].reverse();
          return {
            snapshot: JSON.stringify(
              Object.fromEntries(Object.entries(snapshot).reverse())
            ),
          };
        }),
    });
    expect(await h.selected()).toBe(0);
    const initial = h.report().snapshotDigest;
    reverse = true;
    expect(await h.selected()).toBe(0);
    expect(h.report().snapshotDigest).toBe(initial);
    h.db.exec("DELETE FROM repository_collaborators WHERE user_id='bob'");
    expect(await h.selected()).toBe(0);
    const afterAccess = h.report().snapshotDigest;
    expect(afterAccess).not.toBe(initial);
    h.db.exec(
      "UPDATE repositories SET visibility='public' WHERE id='personal'"
    );
    expect(await h.selected()).toBe(0);
    expect(h.report().snapshotDigest).not.toBe(afterAccess);
    const other = harness({ d1: [{ uuid: 'other-db', name: DATABASE }] });
    expect(await other.selected()).toBe(0);
    expect(other.report().snapshotDigest).not.toBe(initial);
  });

  it('help在无凭据时可发现只读命令，不打印apply命令', async () => {
    const h = harness();
    expect(await main(['--help'], h.deps)).toBe(0);
    expect(h.text()).toContain('access-preflight options (always read-only)');
    expect(h.tokens()).toBe(0);
  });
});
