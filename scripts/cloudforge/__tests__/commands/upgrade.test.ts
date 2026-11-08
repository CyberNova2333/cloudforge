// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx, Optional } from '../../commands/apply.ts';
import { renderConfig } from '../../commands/apply-steps.ts';
import { configVars } from '../../commands/adopt-worker.ts';
import type { Io } from '../../ui/collect.ts';
import { ConfigConflict } from '../../installation/config.ts';
import { resourceNames } from '../../planning/names.ts';
import { R2_MARKER_KEY } from '../../planning/observe.ts';
import { DOCKER_NOT_INSTALLED } from '../../platform/preflight.ts';
import type { RunResult } from '../../platform/runner.ts';
import { packageSource } from '../../distribution/source.ts';
import {
  newState,
  readState,
  writeState,
  type InstallState,
} from '../../installation/state.ts';
import {
  formatUpgradePlan,
  planUpgrade,
  upgrade,
} from '../../commands/upgrade.ts';
import {
  ACCESS_MIGRATION,
  ACCESS_MIGRATIONS,
  accessDatabase,
  closeAccessDatabases,
  copyAccessProtocol,
  migrateAccessDatabase,
} from '../helpers/access-upgrade-fixture.ts';
import {
  fakeCloudflare,
  fakePackage,
  fakeRunner,
  type FakeCloudflareSeed,
} from '../helpers/fakes.ts';

const ACCOUNT = 'a'.repeat(32);
const BASE = 'https://acme.me.workers.dev';
const ID = 'acme-1a2b3c4d5e6f';
const TO = '1.3.0';
const LAST =
  'Migrations cannot be undone. If the new release is broken, the way back is the next release.';
const TYPED = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'CF_ANALYTICS_TOKEN',
];
/** What a worker installed with every credential has, except the secrets the installer generates. */
const ALL_BUT_AUTH = [...TYPED, 'SETUP_CODE_HASH'];
/** The generated secrets (generatedSecrets), in the order it adds them. */
const GENERATED = ['BETTER_AUTH_SECRET', 'ACTIONS_SECRETS_KEY'];
const ALL_SECRETS = [...ALL_BUT_AUTH, ...GENERATED];
const DO_IDS = {
  JOB_RUNNER_NAMESPACE_ID: 'ns-job',
  MERGE_RESOLVER_NAMESPACE_ID: 'ns-merge',
  AGENT_REVIEWER_NAMESPACE_ID: 'ns-review',
  LIVE_NAMESPACE_ID: 'ns-live',
};
const DO_NAMESPACES = [
  { id: 'ns-job', script: 'acme', class: 'JobRunner' },
  { id: 'ns-merge', script: 'acme', class: 'MergeResolver' },
  { id: 'ns-review', script: 'acme', class: 'AgentReviewer' },
  { id: 'ns-live', script: 'acme', class: 'LiveHub' },
];

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-upgrade-'));
  home = join(root, 'home', 'acme');
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  closeAccessDatabases();
  rmSync(root, { recursive: true, force: true });
});

const res = (
  key: string,
  kind: 'd1' | 'r2' | 'worker' | 'workflow',
  name: string,
  id = name,
  ownership: 'created' | 'adopted' = 'created'
) => ({ key, kind, name, id, ownership, state: 'ready' as const });

const marker = (s: InstallState, key: string) =>
  JSON.stringify({
    installationId: s.installationId,
    ownershipNonce: s.ownershipNonce,
    key,
  });

/** Installed at 1.2.0, without the Actions cache bucket (a resource the new version needs). */
function installedAt120(): InstallState {
  const s = newState({
    installationId: ID,
    accountId: ACCOUNT,
    inputs: { name: 'acme', hostname: null, workersDev: true, fromEmail: null },
    names: resourceNames('acme'),
    baseUrl: BASE,
  });
  return {
    ...s,
    ownershipNonce: 'n'.repeat(64),
    status: 'installed',
    resources: [
      res('d1', 'd1', 'acme-db', 'd1-existing'),
      res('lfs', 'r2', 'acme-lfs'),
      res('actionsLogs', 'r2', 'acme-actions-logs'),
      res('worker', 'worker', 'acme'),
      res('actionsWorkflow', 'workflow', 'acme-actions-run'),
      res('mergeWorkflow', 'workflow', 'acme-merge-resolution'),
    ],
    steps: [{ key: 'deploy:1', at: '2026-10-16T00:00:00.000Z' }],
    deployedVersion: '1.2.0',
    deployedConfigHash: 'old',
    doNamespaceIds: { ...DO_IDS },
  };
}

function seedFor(s: InstallState): FakeCloudflareSeed {
  return {
    d1: [{ uuid: 'd1-existing', name: 'acme-db' }],
    d1Migrations: { 'd1-existing': [...ACCESS_MIGRATIONS] },
    ...accessDatabase(s, 'd1-existing').seed,
    r2: {
      'acme-lfs': { [R2_MARKER_KEY]: marker(s, 'lfs') },
      'acme-actions-logs': { [R2_MARKER_KEY]: marker(s, 'actionsLogs') },
    },
    workflows: [
      { name: 'acme-actions-run', scriptName: 'acme' },
      { name: 'acme-merge-resolution', scriptName: 'acme' },
    ],
    workerVars: {
      acme: {
        CLOUDFORGE_VERSION: s.deployedVersion ?? '1.2.0',
        CLOUDFORGE_INSTALLATION: JSON.stringify({
          installationId: s.installationId,
          ownershipNonce: s.ownershipNonce,
        }),
      },
    },
    doNamespaces: DO_NAMESPACES,
  };
}

type Deploy = { args: string[]; secrets: Record<string, string> | null };

function harness(
  opts: {
    state?: InstallState;
    seed?: FakeCloudflareSeed;
    /** The version /.well-known reports before the first deploy. */
    running?: string | null;
    /** The installation id it reports before the first deploy. */
    runningId?: string | null;
    secrets?: string[];
    confirm?: boolean;
    tty?: boolean;
    /** Setup open without a code: verify refuses. */
    setupOpen?: boolean;
    /** The HTTP status R2 answers a key check with (default 200). */
    r2Check?: number;
    docker?: () => RunResult | Promise<RunResult>;
  } = {}
) {
  const s = opts.state ?? installedAt120();
  writeState(home, s);
  const remote = opts.seed ?? seedFor(s);
  const cf = fakeCloudflare(remote);
  const pkgRoot = fakePackage(join(root, 'pkg'), {
    version: TO,
    commit: 'c'.repeat(40),
  });
  mkdirSync(join(pkgRoot, 'migrations'), { recursive: true });
  copyFileSync(
    new URL('../../../../wrangler.jsonc.example', import.meta.url),
    join(pkgRoot, 'wrangler.jsonc.example')
  );
  copyAccessProtocol(pkgRoot);
  const source = packageSource(pkgRoot);
  const deploys: Deploy[] = [];
  const migrations: string[][] = [];
  const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
  let deployResult: RunResult = ok();
  let published = false;
  const runner = fakeRunner({
    docker: opts.docker ?? (() => ok('27.0.0\n')),
    [process.execPath]: (args) => {
      const w = args.slice(1);
      if (w[0] === 'deploy') {
        const i = args.indexOf('--secrets-file');
        deploys.push({
          args,
          secrets:
            i >= 0
              ? (JSON.parse(readFileSync(args[i + 1]!, 'utf8')) as Record<
                  string,
                  string
                >)
              : null,
        });
        if (deployResult.code === 0) {
          published = true;
          remote.workerVars ??= {};
          remote.workerVars.acme = configVars(
            readFileSync(join(home, 'wrangler.jsonc'), 'utf8')
          );
        }
        return deployResult;
      }
      if (w[0] === 'secret') {
        const names = opts.secrets ?? ALL_BUT_AUTH;
        return ok(JSON.stringify(names.map((name) => ({ name }))));
      }
      if (w[0] === 'd1') {
        migrations.push(w);
        remote.d1Migrations = {
          'd1-existing': [...ACCESS_MIGRATIONS],
        };
        return ok();
      }
      throw new Error(`意外的 wrangler 调用：${args.join(' ')}`);
    },
  });
  const printed: string[] = [];
  const io: Io = {
    tty: opts.tty ?? false,
    async prompt() {
      return null;
    },
    async select() {
      throw new Error('不应触发选择提示');
    },
    async confirm() {
      return opts.confirm ?? true;
    },
    print(t) {
      printed.push(t);
    },
  };
  let down = false;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url === `${BASE}/.well-known/cloudforge`) {
      const deployed = published;
      if (down && !deployed) throw new TypeError('fetch failed');
      return Response.json({
        installationId: deployed
          ? ID
          : opts.runningId === undefined
            ? ID
            : opts.runningId,
        version: deployed
          ? TO
          : opts.running === undefined
            ? '1.2.0'
            : opts.running,
      });
    }
    if (url === `${BASE}/api/setup/status`) {
      return Response.json({
        setupRequired: opts.setupOpen === true,
        codeRequired: opts.setupOpen !== true,
      });
    }
    if (
      url.startsWith(`https://${ACCOUNT}.r2.cloudflarestorage.com/acme-lfs`)
    ) {
      return new Response('', { status: opts.r2Check ?? 200 });
    }
    throw new Error(`意外的网络请求：${url}`);
  }) as typeof fetch;
  const ctx: Ctx = {
    cf,
    runner,
    io,
    dir: home,
    source,
    configDir: home,
    fetchImpl,
    sleep: async () => {},
    now: () => new Date('2026-10-17T00:00:00Z'),
  };
  return {
    ctx,
    cf,
    runner,
    deploys,
    migrations,
    printed,
    state: s,
    /** /.well-known unreachable until a deploy succeeds. */
    siteDown() {
      down = true;
    },
    failDeploys() {
      deployResult = { code: 1, stdout: '', stderr: 'boom' };
    },
    okDeploys() {
      deployResult = ok();
    },
    saved: () => readState(home, ID)!,
    /** Runner calls other than the Docker check. */
    nonDocker: () => runner.calls.filter((c) => c.cmd !== 'docker'),
  };
}

const run = (
  h: ReturnType<typeof harness>,
  o: Partial<Parameters<typeof upgrade>[1]> = {}
) =>
  upgrade(h.ctx, {
    state: h.saved(),
    yes: true,
    replaceCustomCode: false,
    resume: false,
    ...o,
  });

describe('planUpgrade：规划升级', () => {
  it('计划列出迁移、新密钥和新资源', async () => {
    const h = harness();
    const p = await planUpgrade(h.ctx, h.state);
    expect(p.from).toBe('1.2.0');
    expect(p.to).toBe(TO);
    expect(p.comparison).toEqual({ kind: 'upgrade' });
    expect(p.migrations).toEqual([]);
    expect(p.create.map((a) => [a.kind, a.name])).toEqual([
      ['r2', 'acme-actions-cache'],
    ]);
    expect(p.secrets).toEqual(GENERATED);
    expect(p.missing).toEqual([]);
    expect(p.configChanged).toBe(true);
    expect(p.digest).toMatch(/^[0-9a-f]{12}$/);
    const lines = formatUpgradePlan(p).split('\n');
    expect(lines[0]).toBe('Upgrade acme: 1.2.0 → 1.3.0');
    expect(lines).toContain('Migrations: none');
    expect(lines).toContain('Create: r2 acme-actions-cache');
    expect(lines).toContain(
      'New secrets: BETTER_AUTH_SECRET, ACTIONS_SECRETS_KEY'
    );
    expect(lines).toContain('Config: changes');
    expect(lines.some((l) => l.startsWith('Missing'))).toBe(false);
    expect(lines.at(-1)).toBe(LAST);
  });

  it('不存在 d1_migrations 表时所有迁移均待执行', async () => {
    const s = installedAt120();
    const h = harness({
      seed: {
        ...seedFor(s),
        d1Migrations: {},
        d1Tables: {},
        d1Query: (_id, sql) =>
          sql.includes('AS access_empty') ? [{ access_empty: 1 }] : [],
      },
    });
    const p = await planUpgrade(h.ctx, h.state);
    expect(p.migrations).toEqual(ACCESS_MIGRATIONS);
  });

  it('不存在 d1_migrations 但存在其他表时停止规划', async () => {
    const s = installedAt120();
    const h = harness({
      seed: {
        ...seedFor(s),
        d1Migrations: {},
        d1Tables: { 'd1-existing': ['users', 'repositories'] },
      },
    });
    await expect(planUpgrade(h.ctx, h.state)).rejects.toThrow(
      'D1 acme-db has tables but no d1_migrations table; CloudForge cannot tell which migrations ran.'
    );
    await expect(run(h)).rejects.toThrow('no d1_migrations table');
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
    expect(h.saved().status).toBe('installed');
  });
});

describe('upgrade：升级', () => {
  it('依次执行资源、配置、迁移、部署、Durable Object、标记和验证', async () => {
    const h = harness();
    const s = await run(h);
    expect(s.status).toBe('installed');
    expect(s.deployedVersion).toBe(TO);
    expect(s.upgradedAt).toBe('2026-10-17T00:00:00.000Z');
    expect(s.upgradeTarget).toBeUndefined();
    expect(s.resources.find((r) => r.key === 'actionsCache')?.ownership).toBe(
      'created'
    );
    expect(h.cf.state.lifecycle['acme-actions-cache']).toBeDefined();
    expect(h.migrations).toHaveLength(1);
    expect(h.deploys).toHaveLength(1);
    expect(s.deployedConfigHash).toBe(renderConfig(h.ctx, s, TO).hash);
    expect(
      [
        'resources',
        'config',
        'migrations',
        'deploy',
        'durable-objects',
        'markers',
        'verify',
      ].map((k) => s.steps.some((x) => x.key === `upgrade:${TO}:${k}`))
    ).toEqual([true, true, true, true, true, true, true]);
    expect(
      h.cf.state.d1[0]!.queries.some((q) =>
        q.startsWith('INSERT INTO install_state')
      )
    ).toBe(true);
    // Every Durable Object namespace id is recorded: none are read again.
    expect(h.cf.calls.some((c) => c.method === 'durableObjectNamespaces')).toBe(
      false
    );
    expect(h.printed.at(-1)).toBe(`Upgraded acme to ${TO}: ${BASE}`);
    expect(readState(home, ID)!.status).toBe('installed');
  });

  it('重新生成的配置包含保留的可调变量', async () => {
    const base = installedAt120();
    const h = harness({
      state: {
        ...base,
        inputs: { ...base.inputs, vars: { AI_GATEWAY: 'mine' } },
      },
    });
    const s = await run(h);
    const config = readFileSync(join(home, 'wrangler.jsonc'), 'utf8');
    expect(config).toContain('"AI_GATEWAY": "mine"');
    expect(config).toContain('"APP_NAME": "CloudForge"');
    expect(s.inputs.vars).toEqual({ AI_GATEWAY: 'mine' });
  });

  it('读取缺少的 Durable Object 命名空间 ID 并部署', async () => {
    const h = harness({
      state: {
        ...installedAt120(),
        doNamespaceIds: { JOB_RUNNER_NAMESPACE_ID: 'ns-job' },
      },
    });
    const s = await run(h);
    expect(s.doNamespaceIds).toEqual(DO_IDS);
    expect(h.deploys).toHaveLength(2);
    expect(h.deploys[1]!.secrets).toBeNull();
    expect(s.deployedConfigHash).toBe(renderConfig(h.ctx, s, TO).hash);
    const config = readFileSync(join(home, 'wrangler.jsonc'), 'utf8');
    expect(config).toContain('"LIVE_NAMESPACE_ID": "ns-live"');
  });

  it('缺少 Docker 时在规划前停止', async () => {
    const h = harness({
      docker: () => Promise.reject(new Error('spawn docker ENOENT')),
    });
    const before = readFileSync(join(home, `${ID}.json`), 'utf8');
    await expect(run(h)).rejects.toThrow(DOCKER_NOT_INSTALLED);
    await expect(run(h, { plan: true })).rejects.toThrow(DOCKER_NOT_INSTALLED);
    expect(h.cf.calls).toEqual([]);
    expect(h.nonDocker()).toEqual([]);
    expect(h.printed).toEqual([]);
    expect(readFileSync(join(home, `${ID}.json`), 'utf8')).toBe(before);
    expect(existsSync(join(home, `${ID}.lock`))).toBe(false);
    expect(existsSync(join(home, 'wrangler.jsonc'))).toBe(false);
  });

  it('拒绝降级', async () => {
    const h = harness({ running: '1.4.0' });
    await expect(run(h)).rejects.toThrow(
      'Run that version instead: pnpm dlx @cybernova2333/cloudforge@1.4.0 upgrade --name acme'
    );
    expect(h.nonDocker()).toHaveLength(0);
    expect(h.saved().status).toBe('installed');
  });

  it('安装 ID 不匹配时停止', async () => {
    const h = harness({ runningId: 'someone-else' });
    await expect(run(h)).rejects.toThrow(
      'this is not the install the state describes'
    );
    expect(h.deploys).toHaveLength(0);
  });

  it('仅在接管后接受空 ID', async () => {
    const plain = harness({ runningId: null });
    await expect(run(plain)).rejects.toThrow(
      'this is not the install the state describes'
    );
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });

    const adopted = harness({
      runningId: null,
      state: { ...installedAt120(), adoptedAt: '2026-10-16T00:00:00.000Z' },
    });
    const s = await run(adopted);
    expect(s.status).toBe('installed');
    expect(adopted.deploys).toHaveLength(1);

    // After that first upgrade, a null id stops again.
    const later = harness({ runningId: null, running: TO, state: s });
    await expect(run(later)).rejects.toThrow(
      'this is not the install the state describes'
    );
  });

  it('接管后的首次升级写入已接管存储桶标记，并保留其生命周期配置', async () => {
    const base = installedAt120();
    const s0: InstallState = {
      ...base,
      adoptedAt: '2026-10-16T00:00:00.000Z',
      resources: [
        ...base.resources.map((r) =>
          r.key === 'lfs' ? { ...r, ownership: 'adopted' as const } : r
        ),
        res(
          'actionsCache',
          'r2',
          'acme-actions-cache',
          'acme-actions-cache',
          'adopted'
        ),
      ],
    };
    const seed = seedFor(s0);
    const h = harness({
      state: s0,
      seed: {
        ...seed,
        r2: { ...seed.r2, 'acme-lfs': {}, 'acme-actions-cache': {} },
      },
    });
    await run(h);
    expect(JSON.parse(h.cf.state.r2['acme-lfs']![R2_MARKER_KEY]!)).toEqual({
      installationId: ID,
      ownershipNonce: s0.ownershipNonce,
      key: 'lfs',
    });
    expect(h.cf.calls.some((c) => c.method === 'putR2Lifecycle')).toBe(false);
  });

  it('没有 --replace-custom-code 时遇到自定义代码则停止', async () => {
    const h = harness({ running: 'deadbeef1234-dirty' });
    const e = await run(h).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    const m = (e as Error).message;
    expect(m).toContain('not a release');
    expect(m).toContain('stock CloudForge');
    expect(m).toContain('own checkout');
    expect(m).toContain(
      'pnpm dlx @cybernova2333/cloudforge@1.3.0 upgrade --name acme --replace-custom-code'
    );
    expect(h.nonDocker()).toHaveLength(0);
  });

  it('指定 --replace-custom-code 时允许替换自定义代码', async () => {
    const h = harness({ running: 'deadbeef1234-dirty' });
    const s = await run(h, { replaceCustomCode: true });
    expect(s.status).toBe('installed');
    expect(h.printed.join('\n')).toContain(
      'Replacing custom code: deadbeef1234-dirty (uncommitted changes) → CloudForge 1.3.0'
    );
  });

  it('拒绝手工编辑的配置', async () => {
    const h = harness();
    writeFileSync(join(home, 'wrangler.jsonc'), '{}\n');
    const e = await run(h).catch((x: Error) => x);
    expect(e).toBeInstanceOf(ConfigConflict);
    expect((e as Error).message).toContain(join(home, 'wrangler.jsonc'));
    expect(h.deploys).toHaveLength(0);
    expect(readFileSync(join(home, 'wrangler.jsonc'), 'utf8')).toBe('{}\n');
  });

  it('仅发送缺少的密钥', async () => {
    const h = harness();
    await run(h);
    expect(h.deploys).toHaveLength(1);
    expect(Object.keys(h.deploys[0]!.secrets ?? {})).toEqual(GENERATED);
  });

  it('升级从不添加 SETUP_CODE_HASH', async () => {
    const h = harness({ secrets: [...TYPED, ...GENERATED] });
    const p = await planUpgrade(h.ctx, h.state);
    expect(p.secrets).toEqual([]);
    expect(formatUpgradePlan(p)).not.toContain('SETUP_CODE_HASH');
    await run(h);
    expect(h.deploys).toHaveLength(1);
    expect(h.deploys[0]!.args).not.toContain('--secrets-file');
  });

  it('不缺少密钥时部署不使用密钥文件', async () => {
    const h = harness({ secrets: ALL_SECRETS });
    await run(h);
    expect(h.deploys).toHaveLength(1);
    expect(h.deploys[0]!.args).not.toContain('--secrets-file');
  });

  it('缺少 R2 密钥不阻止 --yes', async () => {
    const h = harness({
      secrets: [...GENERATED, 'CF_ANALYTICS_TOKEN'],
    });
    const p = await planUpgrade(h.ctx, h.state);
    expect(formatUpgradePlan(p).split('\n')).toContain(
      'Missing (you add them): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
    );
    const s = await run(h);
    expect(h.deploys).toHaveLength(1);
    expect(h.deploys[0]!.args).not.toContain('--secrets-file');
    expect(s.status).toBe('installed');
    expect(s.skipped).toEqual(['r2-keys']);
    const text = h.printed.join('\n');
    expect(text).toContain(
      `Missing (you add them): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Add them with: ${h.ctx.source.command('install --resume --name acme')}`
    );
  });

  it('手动输入的凭据随部署发送，但不计入摘要', async () => {
    const h = harness({ secrets: GENERATED });
    const p = await planUpgrade(h.ctx, h.state);
    const asked: string[][] = [];
    const s = await run(h, {
      expectPlan: p.digest,
      async askOptional(missing): Promise<Optional> {
        asked.push(missing);
        return { r2: { id: 'kid', secret: 'ksecret' }, analytics: 'tok' };
      },
    });
    expect(asked).toEqual([['r2-keys', 'analytics-token']]);
    expect(h.deploys[0]!.secrets).toEqual({
      R2_ACCESS_KEY_ID: 'kid',
      R2_SECRET_ACCESS_KEY: 'ksecret',
      CF_ANALYTICS_TOKEN: 'tok',
    });
    expect(s.skipped).toEqual([]);
    expect(h.printed.join('\n')).not.toContain('Add them with');
    expect(JSON.stringify(s)).not.toContain('ksecret');
  });

  it('R2 密钥被拒绝时跳过而不停止', async () => {
    const h = harness({
      secrets: [...GENERATED, 'CF_ANALYTICS_TOKEN'],
      r2Check: 403,
    });
    const s = await run(h, {
      askOptional: async () => ({ r2: { id: 'kid', secret: 'bad' } }),
    });
    expect(s.status).toBe('installed');
    expect(h.deploys).toHaveLength(1);
    expect(h.deploys[0]!.args).not.toContain('--secrets-file');
    expect(s.skipped).toEqual(['r2-keys']);
    expect(h.printed.join('\n')).toContain(
      'R2 rejected these keys (HTTP 403).'
    );
  });

  it('Worker 已有所有凭据时不再要求手动输入', async () => {
    const h = harness();
    let asked = false;
    await run(h, {
      askOptional: async () => {
        asked = true;
        return {};
      },
    });
    expect(asked).toBe(false);
  });

  it('部署失败后恢复时跳过迁移', async () => {
    const h = harness();
    h.failDeploys();
    const e = await run(h).catch((x: Error) => x);
    expect((e as Error).message).toContain(
      'Run: pnpm dlx @cybernova2333/cloudforge@1.3.0 upgrade --resume --name acme'
    );
    const failed = h.saved();
    expect(failed.status).toBe('failed');
    expect(failed.upgradeTarget).toBe(TO);
    expect(failed.steps.map((x) => x.key)).toContain(
      `upgrade:${TO}:migrations`
    );
    expect(h.migrations).toHaveLength(1);

    h.okDeploys();
    const deploysBefore = h.deploys.length;
    const s = await run(h, { resume: true });
    expect(h.migrations).toHaveLength(1);
    expect(h.deploys.length - deploysBefore).toBe(1);
    expect(s.status).toBe('installed');
    expect(s.deployedVersion).toBe(TO);
    expect(s.upgradeTarget).toBeUndefined();
  });

  it('恢复时 /.well-known 无法访问仍继续', async () => {
    const h = harness();
    h.failDeploys();
    await run(h).catch(() => {});
    expect(h.saved().status).toBe('failed');
    h.okDeploys();
    h.siteDown();
    const s = await run(h, { resume: true });
    expect(s.status).toBe('installed');
    expect(s.deployedVersion).toBe(TO);
  });

  it('全新升级时 /.well-known 无法访问则停止', async () => {
    const h = harness();
    h.siteDown();
    await expect(run(h)).rejects.toThrow('Could not read');
    expect(h.nonDocker()).toHaveLength(0);
  });

  it('恢复被终止的运行，即 upgrading 状态', async () => {
    const base = installedAt120();
    const h = harness({
      state: {
        ...base,
        status: 'upgrading',
        upgradeTarget: TO,
        resources: [
          ...base.resources,
          res('actionsCache', 'r2', 'acme-actions-cache'),
        ],
        steps: [
          ...base.steps,
          {
            key: 'provision-intent:actionsCache',
            at: '2026-10-17T00:00:00.000Z',
          },
          { key: 'lifecycle:v1', at: '2026-10-17T00:00:00.000Z' },
          { key: `upgrade:${TO}:resources`, at: '2026-10-17T00:00:00.000Z' },
          { key: `upgrade:${TO}:migrations`, at: '2026-10-17T00:00:00.000Z' },
        ],
      },
      seed: {
        ...seedFor(base),
        r2: {
          ...seedFor(base).r2,
          'acme-actions-cache': {
            [R2_MARKER_KEY]: marker(base, 'actionsCache'),
          },
        },
      },
    });
    const s = await run(h, { resume: true });
    expect(h.migrations).toHaveLength(0);
    expect(h.deploys).toHaveLength(1);
    expect(s.status).toBe('installed');
    expect(s.deployedVersion).toBe(TO);
  });

  it('验证失败时仅提示升级恢复命令', async () => {
    const h = harness({ setupOpen: true });
    const e = await run(h).catch((x: Error) => x);
    const m = (e as Error).message;
    expect(m).toContain('anyone could claim this instance');
    expect(m).toContain(
      'pnpm dlx @cybernova2333/cloudforge@1.3.0 upgrade --resume --name acme'
    );
    expect(m).not.toContain('install --resume');
  });

  it('存在升级到另一版本的未完成操作时停止', async () => {
    const h = harness({
      state: { ...installedAt120(), status: 'failed', upgradeTarget: '1.2.5' },
    });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'An upgrade to 1.2.5 is unfinished; run pnpm dlx @cybernova2333/cloudforge@1.2.5 upgrade --resume'
    );
    expect(h.deploys).toHaveLength(0);
  });

  it('expect-plan 不匹配时停止', async () => {
    const h = harness();
    await expect(run(h, { expectPlan: '000000000000' })).rejects.toThrow(
      'The plan changed since it was reviewed'
    );
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
    expect(h.saved().status).toBe('installed');
  });

  it('expect-plan 匹配时应用', async () => {
    const h = harness();
    const p = await planUpgrade(h.ctx, h.state);
    const s = await run(h, { expectPlan: p.digest });
    expect(s.status).toBe('installed');
  });

  it('拒绝确认后不作变更', async () => {
    const h = harness({ tty: true, confirm: false });
    await expect(run(h, { yes: false })).rejects.toThrow('Nothing was changed');
    expect(h.deploys).toHaveLength(0);
    expect(h.saved().status).toBe('installed');
  });

  it('相同版本重新部署', async () => {
    const first = harness();
    const s = await run(first);
    const again = harness({
      running: TO,
      state: s,
      secrets: ALL_SECRETS,
      seed: {
        ...seedFor(s),
        d1Migrations: {
          'd1-existing': [...ACCESS_MIGRATIONS],
        },
        r2: {
          ...seedFor(s).r2,
          'acme-actions-cache': { [R2_MARKER_KEY]: marker(s, 'actionsCache') },
        },
      },
    });
    const s2 = await run(again);
    expect(again.deploys).toHaveLength(1);
    expect(again.deploys[0]!.args).not.toContain('--secrets-file');
    expect(again.printed.join('\n')).toContain('Migrations: none');
    expect(again.printed.join('\n')).toContain('Create: none');
    expect(s2.status).toBe('installed');
    expect(s2.deployedVersion).toBe(TO);
  });

  it('再次升级到同一版本时重新生成配置并收集缺失项', async () => {
    const first = harness();
    const s = await run(first);
    expect(s.steps.some((x) => x.key === `upgrade:${TO}:deploy`)).toBe(true);
    // Since then: the config file differs and the worker lost its auth secret and analytics token.
    writeFileSync(
      join(home, 'wrangler.jsonc'),
      readFileSync(join(home, 'wrangler.jsonc'), 'utf8').replace(
        '"LIVE_NAMESPACE_ID": "ns-live"',
        '"LIVE_NAMESPACE_ID": "stale"'
      )
    );
    const again = harness({
      running: TO,
      state: { ...s, deployedConfigHash: 'stale' },
      secrets: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'SETUP_CODE_HASH'],
      seed: {
        ...seedFor(s),
        d1Migrations: {
          'd1-existing': [...ACCESS_MIGRATIONS],
        },
        r2: {
          ...seedFor(s).r2,
          'acme-actions-cache': { [R2_MARKER_KEY]: marker(s, 'actionsCache') },
        },
      },
    });
    const asked: string[][] = [];
    const s2 = await run(again, {
      askOptional: async (missing) => {
        asked.push(missing);
        return { analytics: 'tok' };
      },
    });
    expect(again.printed.join('\n')).toContain('Config: changes');
    expect(asked).toEqual([['analytics-token']]);
    expect(again.deploys).toHaveLength(1);
    expect(Object.keys(again.deploys[0]!.secrets ?? {}).sort()).toEqual([
      'ACTIONS_SECRETS_KEY',
      'BETTER_AUTH_SECRET',
      'CF_ANALYTICS_TOKEN',
    ]);
    expect(readFileSync(join(home, 'wrangler.jsonc'), 'utf8')).toContain(
      '"LIVE_NAMESPACE_ID": "ns-live"'
    );
    expect(s2.deployedConfigHash).toBe(renderConfig(again.ctx, s2, TO).hash);
  });

  it.each([
    ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    ['R2_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID'],
  ])(
    '单独的 %s 会被报告，且不会与手动输入的另一半配对',
    async (present, absent) => {
      const h = harness({
        secrets: [...GENERATED, 'CF_ANALYTICS_TOKEN', present],
      });
      const p = await planUpgrade(h.ctx, h.state);
      const fix = `Delete it (${h.ctx.source.wranglerCommand(`secret delete ${present} --name acme`)}), then run the upgrade again to add a matching pair.`;
      const lines = formatUpgradePlan(p).split('\n');
      expect(lines).toContain(
        `Problem: the worker has ${present} without ${absent}, so the R2 upload keys are left as they are. ${fix}`
      );
      expect(lines.some((l) => l.startsWith('Missing'))).toBe(false);
      let asked = false;
      const s = await run(h, {
        askOptional: async () => {
          asked = true;
          return { r2: { id: 'kid', secret: 'ksecret' } };
        },
      });
      expect(asked).toBe(false);
      expect(h.deploys).toHaveLength(1);
      expect(h.deploys[0]!.args).not.toContain('--secrets-file');
      expect(s.status).toBe('installed');
      expect(h.printed.at(-1)).toContain(`Problem: the worker has ${present}`);
    }
  );

  it('状态文件损坏时失败，且不遗留锁', async () => {
    const h = harness();
    const state = h.saved();
    writeFileSync(join(home, `${ID}.json`), '{ not json');
    await expect(
      upgrade(h.ctx, {
        state,
        yes: true,
        replaceCustomCode: false,
        resume: false,
      })
    ).rejects.toThrow();
    expect(existsSync(join(home, `${ID}.lock`))).toBe(false);
  });

  it('--plan 不写入任何内容并打印应用命令', async () => {
    const h = harness();
    const before = readFileSync(join(home, `${ID}.json`), 'utf8');
    await run(h, { plan: true });
    expect(readFileSync(join(home, `${ID}.json`), 'utf8')).toBe(before);
    expect(existsSync(join(home, `${ID}.lock`))).toBe(false);
    expect(existsSync(join(home, 'wrangler.jsonc'))).toBe(false);
    expect(h.deploys).toHaveLength(0);
    const p = await planUpgrade(h.ctx, h.state);
    expect(h.printed.join('\n')).toContain(
      `pnpm dlx @cybernova2333/cloudforge@${TO} upgrade --name acme --expect-plan ${p.digest} --yes`
    );
  });
});

describe('数据库版本领先于软件包', () => {
  const ahead = (extra: string[]) => {
    const s = installedAt120();
    const seed = seedFor(s);
    return harness({
      running: 'deadbeef1234-dirty',
      seed: {
        ...seed,
        d1Migrations: {
          'd1-existing': [...ACCESS_MIGRATIONS, ...extra],
        },
      },
    });
  };

  it('即使指定 --replace-custom-code 也在规划前停止', async () => {
    const h = ahead(['0002_future.sql', '0003_later.sql']);
    const before = readFileSync(join(home, `${ID}.json`), 'utf8');
    const msg =
      'The database has migrations this release does not ship (0002_future.sql, 0003_later.sql): it is ahead of 1.3.0. Upgrade to a newer release instead. Nothing was changed.';
    await expect(planUpgrade(h.ctx, h.state)).rejects.toThrow(msg);
    await expect(run(h, { replaceCustomCode: true })).rejects.toThrow(msg);
    await expect(
      run(h, { replaceCustomCode: true, plan: true })
    ).rejects.toThrow(msg);
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
    expect(readFileSync(join(home, `${ID}.json`), 'utf8')).toBe(before);
    expect(existsSync(join(home, 'wrangler.jsonc'))).toBe(false);
    expect(existsSync(join(home, `${ID}.lock`))).toBe(false);
  });

  it('数据库与软件包完全一致时没有待执行迁移', async () => {
    const h = ahead([]);
    const p = await planUpgrade(h.ctx, h.state);
    expect(p.migrations).toEqual([]);
    const s = await run(h, { replaceCustomCode: true });
    expect(s.status).toBe('installed');
  });
});

describe('接管或上次升级后的变量漂移', () => {
  const adopted = (): InstallState => ({
    ...installedAt120(),
    adoptedAt: '2026-10-16T00:00:00.000Z',
  });
  const withVars = (
    s: InstallState,
    vars: Record<string, string>
  ): FakeCloudflareSeed => {
    const seed = seedFor(s);
    return {
      ...seed,
      workerVars: { acme: { ...seed.workerVars!.acme!, ...vars } },
    };
  };

  it('接管后在控制台修改变量会阻止首次升级', async () => {
    const s = adopted();
    const h = harness({
      state: s,
      seed: withVars(s, { REVIEW_MODEL: '@cf/edited/model' }),
    });
    const before = readFileSync(join(home, `${ID}.json`), 'utf8');
    const e = await run(h).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe(
      [
        'Worker acme has vars the upgrade would drop or change:',
        '  REVIEW_MODEL  "@cf/edited/model" -> "@cf/zai-org/glm-5.3"',
        'Change or remove them on the worker, then run the upgrade again. Nothing was changed.',
      ].join('\n')
    );
    await expect(planUpgrade(h.ctx, h.state)).rejects.toThrow(
      'REVIEW_MODEL  "@cf/edited/model"'
    );
    expect(h.deploys).toHaveLength(0);
    expect(readFileSync(join(home, `${ID}.json`), 'utf8')).toBe(before);
  });

  it('保留变量本身不阻止升级，但后续编辑会阻止', async () => {
    const base = adopted();
    const s = {
      ...base,
      inputs: { ...base.inputs, vars: { AI_GATEWAY: 'mine' } },
    };
    const h = harness({ state: s, seed: withVars(s, { AI_GATEWAY: 'mine' }) });
    const done = await run(h);
    expect(done.status).toBe('installed');
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });

    // A later upgrade: the kept value edited on the dashboard stops it.
    const s2 = { ...s, upgradedAt: '2026-10-17T00:00:00.000Z' };
    const later = harness({
      state: s2,
      seed: withVars(s2, { AI_GATEWAY: 'other' }),
    });
    await expect(run(later)).rejects.toThrow('  AI_GATEWAY  "other" -> "mine"');
  });

  it('后续升级对从未保留的变量采用新的模板默认值', async () => {
    const s = installedAt120();
    const h = harness({
      state: s,
      seed: withVars(s, { REVIEW_MODEL: '@cf/old/default' }),
    });
    expect((await run(h)).status).toBe('installed');
  });

  it('仅含 localhost 的 TRUSTED_ORIGINS 被列为删除项并计入摘要', async () => {
    const s = adopted();
    const plain = harness({ state: s });
    const without = await planUpgrade(plain.ctx, plain.state);
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });

    const h = harness({
      state: s,
      seed: withVars(s, { TRUSTED_ORIGINS: 'http://localhost:8080' }),
    });
    const p = await planUpgrade(h.ctx, h.state);
    const lines = formatUpgradePlan(p).split('\n');
    expect(lines).toContain(
      'Drops these vars (the worker does not need them):'
    );
    expect(lines).toContain(
      '  TRUSTED_ORIGINS  "http://localhost:8080" -> removed (drops local development origins)'
    );
    expect(p.digest).not.toBe(without.digest);
    expect((await run(h)).status).toBe('installed');
  });
});

describe('API 无法列出的已接管 Artifacts 命名空间', () => {
  it('以已绑定但未验证的命名空间生成计划', async () => {
    const s = { ...installedAt120(), adoptedAt: '2026-10-16T00:00:00.000Z' };
    const h = harness({ state: s });
    h.cf.failNext('listArtifactsNamespaces', new Error('403 Forbidden'));
    const p = await planUpgrade(h.ctx, h.state);
    expect(formatUpgradePlan(p).split('\n')).toContain(
      'artifacts acme: bound, not verified'
    );
  });

  it('从未接管过的安装仍会停止', async () => {
    const h = harness();
    h.cf.failNext('listArtifactsNamespaces', new Error('403 Forbidden'));
    await expect(planUpgrade(h.ctx, h.state)).rejects.toThrow('403 Forbidden');
  });
});

describe('恢复升级先核对当前远端证据', () => {
  const paused = (): InstallState => ({
    ...installedAt120(),
    status: 'failed',
    upgradeTarget: TO,
  });
  const remote = (
    s: InstallState,
    version: string | null,
    vars: Record<string, string> = {}
  ): FakeCloudflareSeed => {
    const seed = seedFor(s);
    if (version === null) delete seed.workerVars!.acme!.CLOUDFORGE_VERSION;
    else seed.workerVars!.acme!.CLOUDFORGE_VERSION = version;
    Object.assign(seed.workerVars!.acme!, vars);
    return seed;
  };
  it.each([false, true])('拒绝较新控制面版本，站点不可达=%s', async (down) => {
    const state = paused();
    const h = harness({
      state,
      running: '1.4.0',
      seed: remote(state, '1.4.0'),
    });
    if (down) h.siteDown();
    await expect(run(h, { resume: true })).rejects.toThrow(
      'newer than this package'
    );
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
  });
  it('HTTP看到较新版本也拒绝，不能只信旧settings', async () => {
    const state = paused();
    const h = harness({
      state,
      running: '1.4.0',
      seed: remote(state, '1.2.0'),
    });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'newer than this package'
    );
    expect(h.deploys).toHaveLength(0);
  });
  it('HTTP和控制面版本不同也停止恢复', async () => {
    const state = paused();
    const h = harness({
      state,
      running: '1.2.1',
      seed: remote(state, '1.2.0'),
    });
    await expect(run(h, { resume: true })).rejects.toThrow('disagree');
    expect(h.deploys).toHaveLength(0);
  });
  it('同一目标以下的其他远端发行也不能被旧恢复计划覆盖', async () => {
    const state = paused();
    const h = harness({
      state,
      running: '1.2.1',
      seed: remote(state, '1.2.1'),
    });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'changed since this upgrade'
    );
    expect(h.deploys).toHaveLength(0);
  });
  it.each([
    ['missing', ''],
    ['malformed', '{'],
    [
      'different id',
      JSON.stringify({
        installationId: 'other',
        ownershipNonce: 'n'.repeat(64),
      }),
    ],
    [
      'different nonce',
      JSON.stringify({ installationId: ID, ownershipNonce: 'other-nonce' }),
    ],
  ])('站点不可达时拒绝%s安装归属', async (_, marker) => {
    const state = paused();
    const h = harness({
      state,
      seed: remote(state, '1.2.0', { CLOUDFORGE_INSTALLATION: marker }),
    });
    h.siteDown();
    await expect(run(h, { resume: true })).rejects.toThrow(
      'do not confirm this installation'
    );
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
  });
  it('HTTP安装id不匹配不能被settings正确id覆盖', async () => {
    const state = paused();
    const h = harness({
      state,
      runningId: 'other',
      seed: remote(state, '1.2.0'),
    });
    await expect(run(h, { resume: true })).rejects.toThrow('not the install');
    expect(h.deploys).toHaveLength(0);
  });
  it('缺版本或控制面不可读不能退回本地deployedVersion', async () => {
    const state = paused();
    const h = harness({ state, seed: remote(state, null) });
    h.siteDown();
    await expect(
      run(h, { resume: true, replaceCustomCode: true })
    ).rejects.toThrow('do not report a known version');
    expect(h.deploys).toHaveLength(0);
    h.cf.failNext('workerVars', new Error('settings unavailable'));
    await expect(run(h, { resume: true })).rejects.toThrow(
      'settings unavailable'
    );
    expect(h.deploys).toHaveLength(0);
  });
  it.each([false, true])(
    '自定义代码替换必须本次明确授权=%s',
    async (authorized) => {
      const state = { ...paused(), deployedVersion: 'abcdef012345-dirty' };
      const h = harness({
        state,
        running: 'abcdef012345-dirty',
        seed: remote(state, 'abcdef012345-dirty'),
      });
      if (authorized) {
        expect(
          (await run(h, { resume: true, replaceCustomCode: true })).status
        ).toBe('installed');
        expect(h.deploys).toHaveLength(1);
      } else {
        await expect(run(h, { resume: true })).rejects.toThrow(
          '--replace-custom-code'
        );
        expect(h.deploys).toHaveLength(0);
      }
    }
  );
  it('恢复仍保护保留变量且不被新custom授权绕过', async () => {
    const state = {
      ...paused(),
      inputs: { ...paused().inputs, vars: { AI_GATEWAY: 'approved' } },
    };
    const h = harness({
      state,
      seed: remote(state, '1.2.0', { AI_GATEWAY: 'changed' }),
    });
    await expect(
      run(h, { resume: true, replaceCustomCode: true })
    ).rejects.toThrow('AI_GATEWAY');
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
  });
  it('恢复首次adopt仍保护实际观察过的模板变量', async () => {
    const state = { ...paused(), adoptedAt: '2026-10-16T00:00:00Z' };
    const h = harness({
      state,
      seed: remote(state, '1.2.0', { REVIEW_MODEL: 'custom-changed' }),
    });
    await expect(run(h, { resume: true })).rejects.toThrow('REVIEW_MODEL');
    expect(h.deploys).toHaveLength(0);
  });
  it('本次目标已部署但本地收据丢失，故障站点仍能继续', async () => {
    const state = paused();
    const h = harness({ state, running: TO, seed: remote(state, TO) });
    h.siteDown();
    const result = await run(h, { resume: true });
    expect(result.status).toBe('installed');
    expect(result.deployedVersion).toBe(TO);
    expect(h.deploys).toHaveLength(1);
  });

  it('已完成主部署后换成custom，即使本次授权替换也不能跳过deploy收据继续', async () => {
    const state = {
      ...paused(),
      deployedVersion: TO,
      steps: [
        ...paused().steps,
        { key: `upgrade:${TO}:deploy`, at: '2026-10-17T00:00:00Z' },
      ],
    };
    const h = harness({
      state,
      running: 'deadbeef-dirty',
      seed: remote(state, 'deadbeef-dirty'),
    });
    await expect(
      run(h, { resume: true, replaceCustomCode: true })
    ).rejects.toThrow('completed deployment no longer matches');
    expect(h.deploys).toHaveLength(0);
    expect(
      h.cf.state.d1
        .flatMap((db) => db.queries)
        .some((query) => /^INSERT/i.test(query))
    ).toBe(false);
  });

  it.each([false, true])(
    'DO第二次部署丢收据，只接受真实namespace映射，远端ID篡改=%s',
    async (changed) => {
      const state = {
        ...paused(),
        deployedVersion: TO,
        doNamespaceIds: { JOB_RUNNER_NAMESPACE_ID: 'ns-job' },
        steps: [
          ...paused().steps,
          { key: `upgrade:${TO}:deploy`, at: '2026-10-17T00:00:00Z' },
        ],
      };
      const h = harness({
        state,
        running: TO,
        seed: remote(state, TO, {
          ...DO_IDS,
          ...(changed ? { LIVE_NAMESPACE_ID: 'unrelated-namespace' } : {}),
        }),
      });
      if (changed) {
        await expect(run(h, { resume: true })).rejects.toThrow(
          'LIVE_NAMESPACE_ID'
        );
        expect(h.deploys).toHaveLength(0);
      } else {
        const resumed = await run(h, { resume: true });
        expect(resumed.status).toBe('installed');
        expect(resumed.doNamespaceIds).toEqual(DO_IDS);
        expect(h.deploys).toHaveLength(1);
      }
    }
  );

  it('DO缺收据恢复不得覆盖已记录的namespace身份', async () => {
    const state = {
      ...paused(),
      deployedVersion: TO,
      doNamespaceIds: { JOB_RUNNER_NAMESPACE_ID: 'old-recorded-job' },
      steps: [
        ...paused().steps,
        { key: `upgrade:${TO}:deploy`, at: '2026-10-17T00:00:00Z' },
      ],
    };
    const h = harness({ state, running: TO, seed: remote(state, TO, DO_IDS) });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'Recorded Durable Object namespaces changed'
    );
    expect(h.deploys).toHaveLength(0);
  });

  const unmarkedAdopted = () => {
    const state = {
      ...paused(),
      adoptedAt: '2026-10-16T00:00:00Z',
      resources: paused().resources.map((r) => ({
        ...r,
        ownership: 'adopted' as const,
      })),
    };
    const seed = remote(state, '1.2.0');
    delete seed.workerVars!.acme!.CLOUDFORGE_INSTALLATION;
    seed.subdomain = 'me';
    seed.workers = {
      acme: [
        { type: 'plain_text', name: 'CLOUDFORGE_VERSION', text: '1.2.0' },
        { type: 'd1', name: 'DB', id: 'd1-existing' },
        { type: 'r2_bucket', name: 'LFS', bucket_name: 'acme-lfs' },
        {
          type: 'r2_bucket',
          name: 'ACTIONS_LOGS',
          bucket_name: 'acme-actions-logs',
        },
        {
          type: 'workflow',
          name: 'ACTIONS_RUN',
          workflow_name: 'acme-actions-run',
        },
        {
          type: 'workflow',
          name: 'MERGE_RESOLUTION',
          workflow_name: 'acme-merge-resolution',
        },
      ],
    };
    return { state, seed };
  };

  it('首次adopt在deploy前失败，无marker时重验在线源版本和实际绑定后可恢复', async () => {
    const { state, seed } = unmarkedAdopted();
    const h = harness({ state, seed, runningId: null });
    const resumed = await run(h, { resume: true });
    expect(resumed.status).toBe('installed');
    expect(h.deploys).toHaveLength(1);
    expect(h.cf.calls.some((c) => c.method === 'workerSettings')).toBe(true);
  });

  it('首次adopt无marker且站点不可达时拒绝并指明恢复站点后重试', async () => {
    const { state, seed } = unmarkedAdopted();
    const h = harness({ state, seed, runningId: null });
    h.siteDown();
    await expect(run(h, { resume: true })).rejects.toThrow(
      'Restore site access and retry --resume'
    );
    expect(h.deploys).toHaveLength(0);
  });

  it('重新核验adopt不能把新改的模板变量收为新配置', async () => {
    const { state, seed } = unmarkedAdopted();
    seed.workerVars!.acme!.REVIEW_MODEL = 'changed-on-dashboard';
    seed.workers!.acme!.push({
      type: 'plain_text',
      name: 'REVIEW_MODEL',
      text: 'changed-on-dashboard',
    });
    const h = harness({ state, seed, runningId: null });
    await expect(run(h, { resume: true })).rejects.toThrow('REVIEW_MODEL');
    expect(h.deploys).toHaveLength(0);
  });

  it.each([
    '{',
    'null',
    JSON.stringify({ installationId: ID, ownershipNonce: 'wrong' }),
  ])('首次adopt损坏或冲突marker不能冒充缺marker：%s', async (marker) => {
    const { state, seed } = unmarkedAdopted();
    seed.workerVars!.acme!.CLOUDFORGE_INSTALLATION = marker;
    const h = harness({ state, seed, runningId: null });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'do not confirm this installation'
    );
    expect(h.deploys).toHaveLength(0);
  });

  it('首次adopt无marker不能在绑定被改到另一实际D1后继续', async () => {
    const { state, seed } = unmarkedAdopted();
    seed.d1!.push({ uuid: 'another-db', name: 'different-db' });
    seed.workers!.acme!.find((b) => b.name === 'DB')!.id = 'another-db';
    const h = harness({ state, seed, runningId: null });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'adopted Worker bindings, URL or source version changed'
    );
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
  });

  it('曾有主deploy成功收据的adopt不能再走缺marker例外', async () => {
    const { state, seed } = unmarkedAdopted();
    state.steps.push({
      key: `upgrade:${TO}:deploy`,
      at: '2026-10-17T00:00:00Z',
    });
    const h = harness({ state, seed, runningId: null });
    await expect(run(h, { resume: true })).rejects.toThrow(
      'do not confirm this installation'
    );
    expect(h.deploys).toHaveLength(0);
  });
});

describe('权限兼容升级门禁', () => {
  const withDatabase = (legacy: boolean | 'compat' = false) => {
    const state = installedAt120();
    const access = accessDatabase(state, 'd1-existing', legacy);
    const seed = { ...seedFor(state), ...access.seed };
    if (legacy)
      seed.d1Migrations = {
        'd1-existing': ACCESS_MIGRATIONS.filter(
          (name) => Number(name.slice(0, 4)) <= (legacy === 'compat' ? 64 : 62)
        ),
      };
    return { ...harness({ state, seed }), db: access.db, seed };
  };
  const noCloudWrites = (h: ReturnType<typeof harness>) => {
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
    expect(
      h.cf.calls.filter((call) =>
        [
          'createD1',
          'createR2',
          'putR2Object',
          'putR2Lifecycle',
          'batchD1',
        ].includes(call.method)
      )
    ).toEqual([]);
    expect(h.saved().status).toBe('installed');
  };
  it('旧库与兼容库都能生成明确的版本计划', async () => {
    const old = withDatabase(true);
    const planned = await planUpgrade(old.ctx, old.state);
    expect(planned.access.schema).toBe('legacy');
    expect(planned.migrations).toContain(ACCESS_MIGRATION);
    const current = withDatabase();
    expect((await planUpgrade(current.ctx, current.state)).access.schema).toBe(
      'runtime-bridge-v1'
    );
  });
  it('compat-v1 计划补齐桥接与后续业务迁移，部署前要求实际桥接结构', async () => {
    const h = withDatabase('compat');
    const planned = await planUpgrade(h.ctx, h.state);
    expect(planned.access.schema).toBe('compat-v1');
    expect(planned.migrations).toEqual([
      '0065_silent_albert_cleary.sql',
      '0066_minor_ultragirl.sql',
    ]);
    const original = h.runner.run.bind(h.runner);
    h.runner.run = async (...args) => {
      const result = await original(...args);
      if (args[1].includes('migrations'))
        for (const migration of planned.migrations)
          h.db.exec(
            readFileSync(join(h.ctx.source.migrationsDir, migration), 'utf8')
          );
      return result;
    };
    expect((await run(h)).status).toBe('installed');
    expect(h.deploys.length).toBeGreaterThan(0);
    expect(
      h.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='release_tag_receipts'"
        )
        .get()
    ).toBeTruthy();
  });
  for (const mode of ['plan', 'apply', 'replace'] as const) {
    it(`${mode} 拒绝额外权限表且不发生云写入`, async () => {
      const h = withDatabase();
      h.db.exec('CREATE TABLE team_members (team_id TEXT, user_id TEXT)');
      await expect(
        run(h, { plan: mode === 'plan', replaceCustomCode: mode === 'replace' })
      ).rejects.toThrow('Access preflight');
      noCloudWrites(h);
    });
  }
  it('拒绝缺失的托管触发器', async () => {
    const h = withDatabase();
    h.db.exec('DROP TRIGGER cloudforge_access_claim_delete_v1');
    await expect(run(h)).rejects.toThrow(/Access/);
    noCloudWrites(h);
  });
  it('数据库最低协议高于源码时拒绝计划和替换，不能靠版本环境变量绕过', async () => {
    const h = withDatabase();
    h.db.exec(
      'UPDATE access_runtime_state SET minimum_protocol=2,revision=revision+1'
    );
    await expect(run(h, { replaceCustomCode: true })).rejects.toThrow(
      'blocking findings'
    );
    noCloudWrites(h);
  });
  it('确认后运行时底线提升时重新检查并在云写入前停止', async () => {
    const h = withDatabase();
    h.ctx.io.confirm = async () => {
      h.db.exec(
        'UPDATE access_runtime_state SET minimum_protocol=2,revision=revision+1'
      );
      return true;
    };
    await expect(run(h, { yes: false })).rejects.toThrow('blocking findings');
    noCloudWrites(h);
  });
  it('迁移完成收据但仍缺桥接状态时不能部署', async () => {
    const h = withDatabase();
    const original = h.runner.run.bind(h.runner);
    h.runner.run = async (...args) => {
      const out = await original(...args);
      if (args[1].includes('migrations')) {
        h.db.exec(
          'DROP TRIGGER cloudforge_runtime_state_delete_v1; DELETE FROM access_runtime_state'
        );
      }
      return out;
    };
    await expect(run(h)).rejects.toThrow(/Access/);
    expect(h.deploys).toHaveLength(0);
  });
  it('诊断ready为false但目标源码符合D1底线时允许修复升级', async () => {
    const h = withDatabase();
    const original = h.ctx.fetchImpl;
    h.ctx.fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      if (String(args[0]).endsWith('/.well-known/cloudforge') && response.ok) {
        return Response.json({
          ...((await response.json()) as object),
          ready: false,
          accessRuntime: { ready: false, protocol: 0 },
        });
      }
      return response;
    }) as typeof fetch;
    expect(
      (await planUpgrade(h.ctx, h.state)).access.protocol.runtimeProtocol
    ).toBe(1);
  });
  it('拒绝未知 read 授予，即使显式允许替换自定义代码', async () => {
    const h = withDatabase();
    h.db.exec(`
      INSERT INTO users (id,name,email,username,role) VALUES ('a','A','a@example.invalid','owner','admin'), ('b','B','b@example.invalid','member','user');
      INSERT INTO repositories (id,owner_id,name,visibility,artifacts_name,created_at,updated_at) VALUES ('r','a','repo','private','r_repo',0,0);
      INSERT INTO repository_collaborators (repository_id,user_id,created_at) VALUES ('r','b',0);
      DROP TRIGGER cloudforge_access_collaborator_update_v1;
      UPDATE repository_collaborators SET role='read' WHERE repository_id='r';
    `);
    await expect(run(h, { replaceCustomCode: true })).rejects.toThrow(/Access/);
    noCloudWrites(h);
  });
  it('拒绝另一安装的标记', async () => {
    const h = withDatabase();
    h.db.exec("UPDATE install_state SET ownership_nonce = 'changed'");
    await expect(run(h)).rejects.toThrow(/Access/);
    noCloudWrites(h);
  });
  it('拒绝兼容结构与迁移收据不一致', async () => {
    const h = withDatabase();
    h.seed.d1Migrations = {
      'd1-existing': ACCESS_MIGRATIONS.filter(
        (name) => Number(name.slice(0, 4)) <= 62
      ),
    };
    await expect(run(h)).rejects.toThrow(
      'schema and migration receipts disagree'
    );
    noCloudWrites(h);
  });
  it('软件包缺少协议或迁移内容被修改时拒绝计划', async () => {
    const h = withDatabase();
    writeFileSync(
      join(h.ctx.source.migrationsDir, ACCESS_MIGRATION),
      'SELECT 1;'
    );
    await expect(run(h, { replaceCustomCode: true })).rejects.toThrow(
      'access protocol'
    );
    noCloudWrites(h);
  });
  for (const when of ['before-plan', 'during-confirmation'] as const) {
    it(`${when} 出现额外迁移必须在云写入前停止`, async () => {
      const h = withDatabase();
      const alter = () =>
        writeFileSync(
          join(h.ctx.source.migrationsDir, '0065_unknown_acl.sql'),
          'CREATE TABLE team_members (id TEXT);'
        );
      if (when === 'before-plan') alter();
      else
        h.ctx.io.confirm = async () => {
          alter();
          return true;
        };
      await expect(
        run(h, { yes: when === 'before-plan', replaceCustomCode: true })
      ).rejects.toThrow('access protocol');
      noCloudWrites(h);
    });
  }
  it('确认期间数据库结构改变时在首个云写入前停止', async () => {
    const h = withDatabase();
    h.ctx.io.confirm = async () => {
      h.db.exec('CREATE TABLE team_members (id TEXT)');
      return true;
    };
    await expect(run(h, { yes: false })).rejects.toThrow(/Access/);
    noCloudWrites(h);
  });
  it('等待可选凭据期间结构改变时在首个云写入前停止', async () => {
    const state = installedAt120();
    const access = accessDatabase(state, 'd1-existing');
    const h = harness({
      state,
      seed: { ...seedFor(state), ...access.seed },
      secrets: GENERATED,
    });
    await expect(
      run(h, {
        askOptional: async () => {
          access.db.exec('CREATE TABLE team_members (id TEXT)');
          return {};
        },
      })
    ).rejects.toThrow(/Access/);
    noCloudWrites(h);
  });
  it('确认期间普通成员变化不使计划失效', async () => {
    const h = withDatabase();
    h.ctx.io.confirm = async () => {
      h.db.exec(
        "INSERT INTO users (id,name,email,username,role) VALUES ('u','U','u@example.invalid','member','user')"
      );
      return true;
    };
    expect((await run(h, { yes: false })).status).toBe('installed');
  });
  it('确认期间目标迁移被替换时在首个云写入前停止', async () => {
    const h = withDatabase();
    h.ctx.io.confirm = async () => {
      writeFileSync(
        join(h.ctx.source.migrationsDir, ACCESS_MIGRATION),
        'SELECT 1;'
      );
      return true;
    };
    await expect(run(h, { yes: false })).rejects.toThrow('access protocol');
    noCloudWrites(h);
  });
  it('资源准备后变更结构时停止迁移及部署', async () => {
    const h = withDatabase();
    const original = h.cf.putR2Lifecycle.bind(h.cf);
    h.cf.putR2Lifecycle = async (...args) => {
      await original(...args);
      h.db.exec('CREATE TABLE team_members (id TEXT)');
    };
    await expect(run(h)).rejects.toThrow(/Access/);
    expect(h.migrations).toHaveLength(0);
    expect(h.deploys).toHaveLength(0);
    expect(h.saved().status).toBe('failed');
  });
  it('迁移命令之后结构异常时停止部署', async () => {
    const h = withDatabase();
    const original = h.runner.run.bind(h.runner);
    h.runner.run = async (...args) => {
      const out = await original(...args);
      if (args[1].includes('migrations'))
        h.db.exec('CREATE TABLE team_members (id TEXT)');
      return out;
    };
    await expect(run(h)).rejects.toThrow(/Access/);
    expect(h.migrations).toHaveLength(1);
    expect(h.deploys).toHaveLength(0);
  });
  it('恢复升级重新检查当前结构，旧完成收据不绕过', async () => {
    const h = withDatabase();
    h.failDeploys();
    await expect(run(h)).rejects.toThrow('boom');
    h.okDeploys();
    h.db.exec('CREATE TABLE team_members (id TEXT)');
    const count = h.deploys.length;
    await expect(
      run(h, { resume: true, replaceCustomCode: true })
    ).rejects.toThrow(/Access/);
    expect(h.deploys).toHaveLength(count);
  });
  it('本地迁移步骤已完成但数据库缺少其他已知迁移收据，恢复时不得部署或写成功标记', async () => {
    const h = withDatabase();
    h.failDeploys();
    await expect(run(h)).rejects.toThrow('boom');
    expect(
      h.saved().steps.some((step) => step.key === `upgrade:${TO}:migrations`)
    ).toBe(true);
    h.okDeploys();
    h.seed.d1Migrations = {
      'd1-existing': ACCESS_MIGRATIONS.filter(
        (name) => name !== '0064_third_azazel.sql'
      ),
    };
    const deployments = h.deploys.length;
    const markers = h.cf.calls.filter(
      (call) => call.method === 'batchD1'
    ).length;
    await expect(run(h, { resume: true })).rejects.toThrow(
      'Pending database migrations remain'
    );
    expect(h.deploys).toHaveLength(deployments);
    expect(h.cf.calls.filter((call) => call.method === 'batchD1')).toHaveLength(
      markers
    );
    expect(h.saved().status).toBe('failed');
    expect(
      h.saved().steps.some((step) => step.key === `upgrade:${TO}:markers`)
    ).toBe(false);
  });
});

describe('空数据库升级恢复', () => {
  const emptyHarness = () => {
    const state = installedAt120();
    const access = accessDatabase(state, 'd1-existing', false, true);
    const seed = { ...seedFor(state), ...access.seed, d1Migrations: {} };
    const h = harness({ state, seed });
    const original = h.runner.run.bind(h.runner);
    let migrated = false;
    h.runner.run = async (...args) => {
      const result = await original(...args);
      if (args[1].includes('migrations') && !migrated) {
        migrateAccessDatabase(access.db);
        migrated = true;
      }
      return result;
    };
    return { ...h, db: access.db, seed };
  };
  it('空库计划迁移后允许零标记并最终写入本安装标记', async () => {
    const h = emptyHarness();
    const done = await run(h);
    expect(done.status).toBe('installed');
    expect(done.upgradeAccessOrigin).toBeUndefined();
    expect(
      h.db.prepare('SELECT ownership_nonce FROM install_state').get()
        ?.ownership_nonce
    ).toBe(h.state.ownershipNonce);
  });
  it('空库迁移后部署失败仍可凭绑定数据库的本地来源恢复', async () => {
    const h = emptyHarness();
    h.failDeploys();
    await expect(run(h)).rejects.toThrow('boom');
    expect(h.saved().upgradeAccessOrigin).toEqual({
      target: TO,
      databaseId: 'd1-existing',
      schema: 'empty',
    });
    h.okDeploys();
    expect((await run(h, { resume: true })).status).toBe('installed');
  });
  it('迁移成功但迁移命令回执丢失仍可恢复', async () => {
    const h = emptyHarness();
    const original = h.runner.run.bind(h.runner);
    let fail = true;
    h.runner.run = async (...args) => {
      const result = await original(...args);
      if (args[1].includes('migrations') && fail) {
        fail = false;
        return { code: 1, stdout: '', stderr: 'lost-migration-receipt' };
      }
      return result;
    };
    await expect(run(h)).rejects.toThrow('lost-migration-receipt');
    expect(
      h.saved().steps.some((step) => step.key === `upgrade:${TO}:migrations`)
    ).toBe(false);
    expect((await run(h, { resume: true })).status).toBe('installed');
  });
  it('迁移前复查失败不能保存可用于零标记恢复的来源', async () => {
    const h = emptyHarness();
    const original = h.cf.putR2Lifecycle.bind(h.cf);
    h.cf.putR2Lifecycle = async (...args) => {
      await original(...args);
      migrateAccessDatabase(h.db);
    };
    await expect(run(h)).rejects.toThrow(/Access/);
    expect(h.saved().upgradeAccessOrigin).toBeUndefined();
    expect(h.migrations).toHaveLength(0);
    expect(h.deploys).toHaveLength(0);
  });
  for (const origin of ['empty', 'adopted'] as const) {
    it(`${origin} 标记步骤完成后丢失标记不得恢复为成功`, async () => {
      const h = (() => {
        if (origin === 'empty') return emptyHarness();
        const state = {
          ...installedAt120(),
          adoptedAt: '2026-10-16T00:00:00.000Z',
        };
        const access = accessDatabase(state, 'd1-existing');
        const seed = { ...seedFor(state), ...access.seed };
        return { ...harness({ state, seed }), db: access.db, seed };
      })();
      const original = h.ctx.fetchImpl;
      let unavailable = true;
      h.ctx.fetchImpl = async (...args) => {
        if (String(args[0]).includes('/api/setup/status') && unavailable)
          return new Response('', { status: 503 });
        return original(...args);
      };
      await expect(run(h)).rejects.toThrow();
      expect(
        h.saved().steps.some((step) => step.key === `upgrade:${TO}:markers`)
      ).toBe(true);
      h.db.exec('DELETE FROM install_state');
      unavailable = false;
      const count = h.deploys.length;
      await expect(run(h, { resume: true })).rejects.toThrow(/Access/);
      expect(h.deploys).toHaveLength(count);
      expect(h.saved().status).toBe('failed');
    });
  }
  it('空库来源不容许恢复时忽略已存在的另一安装标记', async () => {
    const h = emptyHarness();
    h.failDeploys();
    await expect(run(h)).rejects.toThrow('boom');
    h.db.exec(
      "INSERT INTO install_state (installation_id,ownership_nonce,updated_at) VALUES ('other','other',0)"
    );
    const count = h.deploys.length;
    h.okDeploys();
    await expect(run(h, { resume: true })).rejects.toThrow(/Access/);
    expect(h.deploys).toHaveLength(count);
  });
  it('已有兼容库没有标记不能伪装为空库恢复', async () => {
    const state = installedAt120();
    const access = accessDatabase(state, 'd1-existing');
    access.db.exec('DELETE FROM install_state');
    const h = harness({ state, seed: { ...seedFor(state), ...access.seed } });
    await expect(run(h)).rejects.toThrow(/Access/);
    expect(h.deploys).toHaveLength(0);
    expect(h.migrations).toHaveLength(0);
  });
});
