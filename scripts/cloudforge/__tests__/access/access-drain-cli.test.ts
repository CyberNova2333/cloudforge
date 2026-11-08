// CloudForge fork (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, type Deps } from '../../cli.ts';
import { checkoutSource, packageSource } from '../../distribution/source.ts';
import { newState, writeState } from '../../installation/state.ts';
import { installationIdOf, resourceNames } from '../../planning/names.ts';
import type { Cloudflare } from '../../platform/cloudflare.ts';
import { fakeCloudflare, fakePackage, fakeRunner } from '../helpers/fakes.ts';

const ACCOUNT = 'a'.repeat(32);
const DATABASE = 'd1-access-drain';
const PRIVATE = 'private-token-email@example.invalid-secret-ownership-material';
const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);
let root: string;
let databases: DatabaseSync[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-access-drain-'));
  databases = [];
});
afterEach(() => {
  for (const database of databases) database.close();
  const absolute = resolve(root);
  if (!absolute.startsWith(join(resolve(tmpdir()), 'cloudforge-access-drain-')))
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
    packageMode?: boolean;
    historical?: boolean;
    accounts?: { id: string; name: string }[];
    d1?: { uuid: string; name: string }[];
  } = {}
) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  for (const file of readdirSync(MIGRATIONS)
    .filter(
      (name) =>
        name.endsWith('.sql') &&
        (!opts.historical || Number(name.slice(0, 4)) <= 64)
    )
    .sort())
    db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
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
      db.exec('PRAGMA query_only = ON');
      try {
        return db.prepare(sql).all(...(params as (string | number | null)[]));
      } finally {
        db.exec('PRAGMA query_only = OFF');
      }
    },
  });
  const output: string[] = [];
  const runner = fakeRunner({});
  let tokens = 0;
  const deps: Deps = {
    io: {
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
    },
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
    now: () => new Date('2026-11-05T00:00:00Z'),
    fetchImpl: async () => {
      throw new Error('Unexpected HTTP request');
    },
    sleep: async () => {},
  };
  const run = (...args: string[]) =>
    main(['access-drain-status', ...args], deps);
  return {
    db,
    cf,
    deps,
    runner,
    state,
    dir,
    run,
    selected: () => run('--database', DATABASE, '--account', ACCOUNT),
    text: () => output.join('\n'),
    report: () => JSON.parse(output.at(-1)!),
    tokens: () => tokens,
  };
}

function expectObservation(report: Record<string, unknown>) {
  expect(report).toMatchObject({
    command: 'access-drain-status',
    drainComplete: false,
    rolePublishingAllowed: false,
    rollbackSafe: false,
    admissionPaused: false,
  });
}

describe('access-drain-status CLI：显式目标、只读观察与失败脱敏', () => {
  it('help无凭据可发现命令、边界和退出码含义', async () => {
    const h = harness();
    expect(await main(['--help'], h.deps)).toBe(0);
    expect(h.text()).toContain(
      'access-drain-status options (always read-only)'
    );
    expect(h.text()).toContain(
      'Exit 0 means a valid observation, even when work remains'
    );
    expect(h.text()).toContain(
      'never pauses admission or proves a complete drain'
    );
    expect(h.tokens()).toBe(0);
    expect(h.cf.calls).toEqual([]);
  });

  it.each([
    [],
    ['--account', ACCOUNT],
    ['--database', DATABASE],
    ['--name', 'acme', '--account', ACCOUNT],
    ['--name', 'acme', '--database', DATABASE, '--account', ACCOUNT],
    ['--database', DATABASE, '--account', ''],
    ['--database', ' ', '--account', ACCOUNT],
    ['--database', 'x'.repeat(257), '--account', ACCOUNT],
    ['--database', 'hidden\u200b', '--account', ACCOUNT],
    ['--name', '../acme'],
    ['--name', 'acme\n'],
    ...['--yes', '--apply', '--plan', '--force', '--resume'].map((flag) => [
      '--name',
      'acme',
      flag,
    ]),
    ['--name', 'acme', '--expect-plan', PRIVATE],
    ['--name', 'acme', '--sql', PRIVATE],
    ['--database', DATABASE, '--account', ACCOUNT, PRIVATE],
  ])('拒绝非法参数%j，退出2且不读取凭据或改动文件', async (...args) => {
    const h = harness();
    const before = localFiles();
    expect(await h.run(...args)).toBe(2);
    expect(h.tokens()).toBe(0);
    expect(h.cf.calls).toEqual([]);
    expect(h.runner.calls).toEqual([]);
    expect(h.text()).not.toContain(PRIVATE);
    expect(localFiles()).toEqual(before);
  });

  it.each([
    [DATABASE, ACCOUNT],
    ['actual-database-name', 'aCcOuNt'],
  ])(
    '手动显式选择实际数据库%s与账户%s，不落本地状态或改数据库',
    async (database, account) => {
      const h = harness();
      const files = localFiles();
      const state = h.db.prepare('SELECT * FROM access_control_state').all();
      expect(await h.run('--database', database, '--account', account)).toBe(0);
      expectObservation(h.report());
      expect(h.report().workObserved).toBe(false);
      expect(h.report().target).toEqual({
        accountId: ACCOUNT,
        databaseId: DATABASE,
        installationId: null,
      });
      expect(h.cf.calls.map((call) => call.method)).toEqual([
        'listAccounts',
        'listD1',
        'queryD1',
        'queryD1',
      ]);
      expect(
        h.cf.calls
          .filter((call) => call.method === 'queryD1')
          .every(
            (call) => call.args[0] === ACCOUNT && call.args[1] === DATABASE
          )
      ).toBe(true);
      expect(h.runner.calls).toEqual([]);
      expect(localFiles()).toEqual(files);
      expect(h.db.prepare('SELECT * FROM access_control_state').all()).toEqual(
        state
      );
      expect(h.text()).not.toContain(PRIVATE);
    }
  );

  it.each([false, true])(
    '安装记录只匹配ID并核验marker，packageMode=%s',
    async (packageMode) => {
      const h = harness({ recorded: true, packageMode });
      const files = localFiles();
      expect(await h.run('--name', 'acme')).toBe(0);
      expectObservation(h.report());
      expect(h.report().target.installationId).toBe(h.state.installationId);
      expect(JSON.stringify(h.cf.calls.at(-1)?.args)).toContain(
        h.state.ownershipNonce
      );
      expect(h.text()).not.toContain(h.state.ownershipNonce);
      expect(h.runner.calls).toEqual([]);
      expect(localFiles()).toEqual(files);
    }
  );

  it.each([
    'missing',
    'moved',
    'multiple-databases',
    'invalid-account',
    'invalid-nonce',
  ])('不合法安装记录%s不读凭据或云端', async (problem) => {
    const h = harness({ recorded: problem !== 'missing' });
    if (problem === 'moved')
      writeState(h.dir, { ...h.state, movedTo: PRIVATE });
    if (problem === 'multiple-databases')
      writeState(h.dir, {
        ...h.state,
        resources: [
          h.state.resources[0],
          { ...h.state.resources[0], key: 'extra', id: 'other' },
        ],
      });
    if (problem === 'invalid-account')
      writeState(h.dir, { ...h.state, accountId: '' });
    if (problem === 'invalid-nonce')
      writeState(h.dir, { ...h.state, ownershipNonce: '' });
    const files = localFiles();
    expect(await h.run('--name', 'acme')).toBe(1);
    expect(h.tokens()).toBe(0);
    expect(h.cf.calls).toEqual([]);
    expect(h.text()).not.toContain(PRIVATE);
    expect(localFiles()).toEqual(files);
  });

  it.each([
    { accounts: [] },
    { accounts: [{ id: 'replacement-account', name: ACCOUNT }] },
    { d1: [{ uuid: 'replacement-database', name: DATABASE }] },
  ])('记录ID缺失时不回退同名账户或数据库%j', async (options) => {
    const h = harness({ recorded: true, ...options });
    expect(await h.run('--name', 'acme')).toBe(1);
    expect(h.cf.calls.some((call) => call.method === 'queryD1')).toBe(false);
  });

  it.each([
    {
      accounts: [
        { id: ACCOUNT, name: 'one' },
        { id: 'two', name: ACCOUNT },
      ],
    },
    {
      d1: [
        { uuid: DATABASE, name: 'one' },
        { uuid: 'two', name: DATABASE },
      ],
    },
    { d1: [] },
  ])('手动目标不唯一或不存在时不查询数据库%j', async (options) => {
    const h = harness(options);
    expect(await h.selected()).toBe(1);
    expect(h.cf.calls.some((call) => call.method === 'queryD1')).toBe(false);
  });

  it.each(['token', 'listAccounts', 'listD1', 'queryD1'])(
    '读取%s失败只输出固定脱敏错误',
    async (operation) => {
      const h = harness();
      if (operation === 'token')
        h.deps.token = async () => {
          throw new Error(PRIVATE);
        };
      else h.cf.failNext(operation as keyof Cloudflare, new Error(PRIVATE));
      const files = localFiles();
      expect(await h.selected()).toBe(1);
      expect(h.text()).not.toContain(PRIVATE);
      expect(h.text()).not.toContain('snapshotDigest');
      expect(h.text()).toContain('Nothing was changed');
      expect(h.runner.calls).toEqual([]);
      expect(localFiles()).toEqual(files);
    }
  );

  it('历史schema不能输出空队列成功报告', async () => {
    const h = harness({ historical: true });
    expect(await h.selected()).toBe(1);
    expect(h.text()).not.toContain('snapshotDigest');
    expect(h.cf.calls.filter((call) => call.method === 'queryD1')).toHaveLength(
      1
    );
  });

  it('错误marker不输出目标记录或成功摘要', async () => {
    const h = harness({ recorded: true });
    h.db.exec("UPDATE install_state SET ownership_nonce='wrong-ownership'");
    expect(await h.run('--name', 'acme')).toBe(1);
    expect(h.text()).not.toContain(h.state.ownershipNonce);
    expect(h.text()).not.toContain('snapshotDigest');
  });

  it('非空待处理工作仍可成功观察，但不宣称排空或放行发布', async () => {
    const h = harness();
    h.db.exec(`
      INSERT INTO users(id,name,email,username,role) VALUES('owner','Owner','private-owner@example.invalid','owner','admin');
      INSERT INTO repositories(id,owner_id,name,artifacts_name,created_at,updated_at) VALUES('repo','owner','repo','r_repo',0,0);
      INSERT INTO push_events(id,repository_id,commands,created_at) VALUES('push-1','repo','private-command-material',1);
    `);
    const before = h.db.prepare('SELECT * FROM push_events').all();
    expect(await h.selected()).toBe(0);
    expectObservation(h.report());
    expect(h.report().workObserved).toBe(true);
    expect(h.report().categories.pushEvents.count).toBe(1);
    expect(h.db.prepare('SELECT * FROM push_events').all()).toEqual(before);
    expect(h.text()).not.toContain('private-owner');
    expect(h.text()).not.toContain('private-command-material');
  });
});
