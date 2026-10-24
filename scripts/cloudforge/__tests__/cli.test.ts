// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../apply.ts';
import { renderConfig } from '../apply-steps.ts';
import {
  applyCommand,
  isEntry,
  main,
  resolveToken,
  type Deps,
} from '../cli.ts';
import type { Io } from '../collect.ts';
import { installationIdOf, resourceNames } from '../names.ts';
import { R2_MARKER_KEY } from '../observe.ts';
import type { RunResult } from '../runner.ts';
import { checkoutSource, packageSource } from '../source.ts';
import {
  listStates,
  newState,
  readState,
  writeState,
  type InstallState,
} from '../state.ts';
import {
  fakeCloudflare,
  fakePackage,
  fakeRunner,
  type FakeCloudflare,
  type FakeCloudflareSeed,
} from './fakes.ts';

const ACCOUNT = 'a'.repeat(32);
const VERSION = 'abcdef123456';
const ID = installationIdOf(ACCOUNT, 'acme', 'workers.dev');
const BASE = 'https://acme.me.workers.dev';
const FLAGS = [
  '--name',
  'acme',
  '--account',
  ACCOUNT,
  '--workers-dev',
  '--no-email',
];
const DO_NAMESPACES = [
  { id: 'ns-job', script: 'acme', class: 'JobRunner' },
  { id: 'ns-merge', script: 'acme', class: 'MergeResolver' },
  { id: 'ns-review', script: 'acme', class: 'AgentReviewer' },
  { id: 'ns-live', script: 'acme', class: 'LiveHub' },
];

let root: string;
let cwd: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-cli-'));
  cwd = join(root, 'repo');
  dir = join(cwd, '.cloudforge');
  mkdirSync(join(cwd, 'migrations'), { recursive: true });
  copyFileSync(
    new URL('../../../wrangler.jsonc.example', import.meta.url),
    join(cwd, 'wrangler.jsonc.example')
  );
  writeFileSync(join(cwd, 'migrations', '0000_init.sql'), 'CREATE TABLE a;');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function harness(
  opts: {
    tty?: boolean;
    env?: Record<string, string>;
    seed?: FakeCloudflareSeed;
    prompts?: (string | null)[];
    wellKnown?: () => Response;
    /** The npm registry's dist-tags.latest; null = the registry answers 500. */
    latest?: string | null;
    analyticsOk?: boolean;
    confirm?: boolean;
    setupStatus?: { setupRequired: boolean; codeRequired: boolean };
    onCloudflare?: (cf: FakeCloudflare) => void;
    docker?: Record<string, () => RunResult | Promise<RunResult>>;
    /** What `wrangler secret list` answers (default: exit 1, no such worker). */
    secretList?: RunResult;
    /** What a deploy answers (default: success). */
    deployResult?: RunResult;
    /** Package mode: state and config go under this home. */
    pkg?: { home: string; source: ReturnType<typeof packageSource> };
  } = {}
) {
  let cf: FakeCloudflare | null = null;
  let tokenCalls = 0;
  const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
  const notFound: RunResult = { code: 1, stdout: '', stderr: 'not found' };
  /** Each deploy's secrets file (null: none). */
  const deploys: (Record<string, string> | null)[] = [];
  const deployed = (args: string[]): RunResult => {
    const i = args.indexOf('--secrets-file');
    deploys.push(
      i >= 0
        ? (JSON.parse(readFileSync(args[i + 1]!, 'utf8')) as Record<
            string,
            string
          >)
        : null
    );
    return opts.deployResult ?? ok();
  };
  const runner = fakeRunner({
    ...(opts.docker ?? { docker: () => ok('27.0.0\n') }),
    'git rev-parse': () => ok(`${VERSION}\n`),
    'git status': () => ok(''),
    [process.execPath]: (args) => {
      if (args[1] === 'deploy') return deployed(args);
      if (args[1] === 'd1') return ok();
      if (args[1] === 'secret') return opts.secretList ?? notFound;
      throw new Error(`意外的 wrangler 调用：${args.join(' ')}`);
    },
    yarn: (args) => {
      if (args[1] === 'deploy') return deployed(args);
      if (args[1] === 'wrangler' && args[2] === 'secret')
        return opts.secretList ?? notFound;
      if (args[1] === 'wrangler' && args[2] === 'd1') return ok();
      throw new Error(`意外的 Yarn 调用：${args.join(' ')}`);
    },
  });
  const out: string[] = [];
  const prompts = [...(opts.prompts ?? [])];
  const asked: string[] = [];
  const confirms: string[] = [];
  const io: Io = {
    tty: opts.tty ?? false,
    async prompt(msg) {
      asked.push(msg);
      return prompts.shift() ?? null;
    },
    async select<T>(_m: string, options: { value: T }[]) {
      return options[0]!.value;
    },
    async confirm(_m: string, initial: boolean) {
      confirms.push(_m);
      return opts.confirm ?? initial;
    },
    print(t) {
      out.push(t);
    },
  };
  const fetched: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    fetched.push(url);
    if (url === 'https://api.cloudflare.com/client/v4/graphql') {
      return Response.json(
        opts.analyticsOk === false
          ? { errors: [{ message: 'denied' }], data: null }
          : { data: { viewer: { accounts: [{ accountTag: ACCOUNT }] } } }
      );
    }
    if (url === `${BASE}/.well-known/cloudforge`) {
      if (opts.wellKnown) return opts.wellKnown();
      return Response.json({ installationId: ID, version: VERSION });
    }
    if (url === 'https://registry.npmjs.org/@cybernova2333%2fcloudforge') {
      if (opts.latest === undefined || opts.latest === null)
        return new Response('down', { status: 500 });
      return Response.json({ 'dist-tags': { latest: opts.latest } });
    }
    if (url === `${BASE}/api/setup/status`) {
      return Response.json(
        opts.setupStatus ?? { setupRequired: true, codeRequired: true }
      );
    }
    if (url.startsWith(`https://${ACCOUNT}.r2.cloudflarestorage.com/`)) {
      return new Response('', { status: 200 });
    }
    throw new Error(`意外的网络请求：${url}`);
  }) as typeof fetch;
  const deps: Deps = {
    io,
    env: opts.env ?? {},
    runner,
    dir: opts.pkg?.home ?? dir,
    source: opts.pkg?.source ?? checkoutSource(cwd),
    home: opts.pkg?.home ?? null,
    configDir: opts.pkg?.home ?? cwd,
    fetchImpl,
    sleep: async () => {},
    now: () => new Date('2026-10-17T00:00:00Z'),
    async token() {
      tokenCalls++;
      return 'tok';
    },
    cloudflare() {
      cf = fakeCloudflare({
        accounts: [{ id: ACCOUNT, name: 'Acme' }],
        subdomain: 'me',
        doNamespaces: DO_NAMESPACES,
        ...opts.seed,
      });
      opts.onCloudflare?.(cf);
      return cf;
    },
  };
  return {
    deps,
    deploys,
    out,
    asked,
    confirms,
    fetched,
    runner,
    text: () => out.join('\n'),
    cf: () => cf,
    tokenCalls: () => tokenCalls,
  };
}

function installedState(): InstallState {
  const s = newState({
    installationId: ID,
    accountId: ACCOUNT,
    inputs: { name: 'acme', hostname: null, workersDev: true, fromEmail: null },
    names: resourceNames('acme'),
    baseUrl: BASE,
  });
  return {
    ...s,
    status: 'installed',
    resources: [
      {
        key: 'd1',
        kind: 'd1',
        name: 'acme-db',
        id: 'd1-x',
        ownership: 'created',
        state: 'ready',
      },
    ],
    steps: [{ key: 'deploy:1', at: '2026-10-16T00:00:00.000Z' }],
    deployedVersion: VERSION,
  };
}

const MUTATING = [
  'createD1',
  'createR2',
  'putR2Lifecycle',
  'putR2Object',
  'queryD1',
];

describe('用法说明', () => {
  it('--help 列出 install 和 status，并以 0 退出', async () => {
    const h = harness();
    expect(await main(['--help'], h.deps)).toBe(0);
    expect(h.text()).toContain('install');
    expect(h.text()).toContain('status');
    expect(h.text()).toContain('--expect-plan');
    expect(h.text()).toContain('--new-setup-code');
  });

  it('未知命令以 2 退出', async () => {
    const h = harness();
    expect(await main(['nope'], h.deps)).toBe(2);
  });
});

describe('install：安装', () => {
  it('非终端环境且未指定 --yes 时在读取前以 2 退出', async () => {
    const h = harness();
    expect(await main(['install', ...FLAGS], h.deps)).toBe(2);
    expect(h.text()).toContain(
      'Not running in a terminal: pass --yes to apply (or --plan to only review).'
    );
    expect(h.cf()).toBeNull();
    expect(h.tokenCalls()).toBe(0);
  });

  it('同时指定 --hostname 与 --workers-dev 属于用法错误', async () => {
    const h = harness();
    const code = await main(
      ['install', '--plan', '--hostname', 'git.example.com', '--workers-dev'],
      h.deps
    );
    expect(code).toBe(2);
    expect(h.cf()).toBeNull();
  });

  it('--plan 打印计划和应用命令且不写入任何内容', async () => {
    const h = harness();
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(0);
    const text = h.text();
    expect(text).toContain('create  d1');
    const digest = /Plan ([0-9a-f]{12})/.exec(text)?.[1];
    expect(digest).toBeDefined();
    expect(h.out.at(-1)).toBe(
      `yarn cloudforge install --name acme --account ${ACCOUNT} --workers-dev --no-email --expect-plan ${digest} --yes`
    );
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(cwd, 'wrangler.jsonc'))).toBe(false);
    expect(h.cf()!.calls.filter((c) => MUTATING.includes(c.method))).toEqual(
      []
    );
  });

  it('--plan 警告手写 wrangler.jsonc 会阻止应用计划', async () => {
    writeFileSync(join(cwd, 'wrangler.jsonc'), '{ "name": "mine" }\n');
    const h = harness();
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(0);
    expect(h.text()).toContain(
      'wrangler.jsonc was written by hand: apply will refuse until you move it aside'
    );
    const clean = harness();
    rmSync(join(cwd, 'wrangler.jsonc'));
    await main(['install', '--plan', ...FLAGS], clean.deps);
    expect(clean.text()).not.toContain('written by hand');
  });

  it('R2 令牌说明与链接一致：所有存储桶或仅这三个', async () => {
    const h = harness({ tty: true, prompts: ['', ''] });
    await main(['install', '--yes', ...FLAGS], h.deps);
    expect(h.text()).toContain(
      'Create an R2 API token (Object Read & Write); it may cover all buckets or just acme-lfs, acme-actions-logs and acme-actions-cache:'
    );
  });

  it('未传参数时使用唯一账户和默认名称', async () => {
    const h = harness();
    expect(
      await main(['install', '--plan', '--workers-dev', '--no-email'], h.deps)
    ).toBe(0);
    expect(h.out.at(-1)).toContain(
      `--name cloudforge --account ${ACCOUNT} --workers-dev --no-email`
    );
  });

  it('预检失败时以 1 退出并显示修复说明', async () => {
    const h = harness({ seed: { subdomain: null } });
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain('The account has no workers.dev subdomain yet.');
    expect(h.text()).toContain('Open Workers & Pages');
  });

  it('PlanStop 以 1 退出并显示其消息', async () => {
    const h = harness({ seed: { d1: [{ uuid: 'x', name: 'acme-db' }] } });
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain('already exists');
  });

  it('--resume 搭配不同的 --hostname 时以 1 退出并指出主机名', async () => {
    const h = harness();
    const s = { ...installedState(), status: 'failed' as const };
    writeState(dir, s);
    const code = await main(
      [
        'install',
        '--resume',
        '--yes',
        '--name',
        'acme',
        '--hostname',
        'git.example.com',
      ],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.text()).toContain(
      'These options differ from the recorded installation: hostname'
    );
  });

  it('已有未完成状态但未指定 --resume 时以 1 退出并提示 --resume', async () => {
    const h = harness();
    writeState(dir, { ...installedState(), status: 'failed' });
    expect(await main(['install', '--yes', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain('--resume');
  });

  it('已安装但未指定 --resume 时说明情况且不作变更', async () => {
    const h = harness();
    writeState(dir, installedState());
    expect(await main(['install', '--yes', ...FLAGS], h.deps)).toBe(0);
    expect(h.text()).toContain('already installed');
    expect(h.cf()!.calls.filter((c) => MUTATING.includes(c.method))).toEqual(
      []
    );
  });

  it('非终端环境下 --yes 执行安装并记录跳过的凭据', async () => {
    const h = harness();
    expect(await main(['install', '--yes', ...FLAGS], h.deps)).toBe(0);
    const s = readState(dir, ID)!;
    expect(s.status).toBe('installed');
    expect(s.skipped).toEqual(['r2-keys', 'analytics-token']);
    expect(h.text()).toContain(`CloudForge is installed at ${BASE}`);
  });

  it('--expect-plan 的摘要过期时失败且不创建资源', async () => {
    const h = harness();
    const code = await main(
      ['install', '--yes', '--expect-plan', '000000000000', ...FLAGS],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.text()).toContain('The plan changed');
    expect(h.cf()!.calls.filter((c) => c.method === 'createD1')).toEqual([]);
  });

  it('--yes --expect-plan <stale> 在询问凭据或创建资源前停止', async () => {
    const h = harness({ tty: true, prompts: ['x', 'y', 'z'] });
    const code = await main(
      ['install', '--yes', '--expect-plan', '000000000000', ...FLAGS],
      h.deps
    );
    expect(code).toBe(1);
    expect(h.asked).toEqual([]);
    expect(h.out.at(-1)).toMatch(/Plan [0-9a-f]{12}$/);
    expect(h.cf()!.calls.filter((c) => MUTATING.includes(c.method))).toEqual(
      []
    );
    expect(existsSync(dir)).toBe(false);
  });

  it('展示后的计划发生变化时停止应用', async () => {
    const h = harness({
      onCloudflare(cf) {
        // The second observe (install's recomputation) sees our workflow appear: reuse, not create.
        const orig = cf.listWorkflows.bind(cf);
        let n = 0;
        cf.listWorkflows = async (a) => {
          const r = await orig(a);
          return ++n >= 2
            ? [...r, { name: 'acme-actions-run', scriptName: 'acme' }]
            : r;
        };
      },
    });
    expect(await main(['install', '--yes', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain('The plan changed since it was reviewed');
    expect(h.cf()!.calls.filter((c) => c.method === 'createD1')).toEqual([]);
  });

  it('拒绝应用计划后以 1 退出且不写入任何内容', async () => {
    const h = harness({ tty: true, confirm: false });
    expect(await main(['install', ...FLAGS], h.deps)).toBe(1);
    expect(h.confirms).toEqual(['Apply this plan?']);
    expect(h.text()).toContain('Nothing was changed.');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(cwd, 'wrangler.jsonc'))).toBe(false);
    expect(h.cf()!.calls.filter((c) => MUTATING.includes(c.method))).toEqual(
      []
    );
  });

  it('同时指定 --from-email 与 --no-email 属于用法错误', async () => {
    const h = harness();
    const code = await main(
      ['install', '--plan', '--from-email', 'a@example.com', '--no-email'],
      h.deps
    );
    expect(code).toBe(2);
    expect(h.cf()).toBeNull();
  });

  it('非终端环境中多个账户需要 --account，否则以 2 退出', async () => {
    const h = harness({
      seed: {
        accounts: [
          { id: ACCOUNT, name: 'Acme' },
          { id: 'b'.repeat(32), name: 'Other' },
        ],
      },
    });
    const code = await main(
      ['install', '--plan', '--name', 'acme', '--workers-dev', '--no-email'],
      h.deps
    );
    expect(code).toBe(2);
    expect(h.text()).toContain('--account is required');
  });

  it('--plan --resume 打印包含 --resume 和摘要的命令', async () => {
    const h = harness({ seed: { d1: [{ uuid: 'd1-x', name: 'acme-db' }] } });
    writeState(dir, { ...installedState(), status: 'failed' });
    expect(
      await main(['install', '--plan', '--resume', '--name', 'acme'], h.deps)
    ).toBe(0);
    expect(h.out.at(-1)).toMatch(
      new RegExp(
        `^yarn cloudforge install --resume --name acme --account ${ACCOUNT} --workers-dev --no-email --expect-plan [0-9a-f]{12} --yes$`
      )
    );
  });

  it('已安装状态下 --plan --resume 不打印 --expect-plan', async () => {
    const h = harness({ seed: { d1: [{ uuid: 'd1-x', name: 'acme-db' }] } });
    writeState(dir, installedState());
    expect(
      await main(['install', '--plan', '--resume', '--name', 'acme'], h.deps)
    ).toBe(0);
    expect(h.out.at(-1)).toBe(
      `yarn cloudforge install --resume --name acme --account ${ACCOUNT} --workers-dev --no-email --yes`
    );
  });

  it('已安装状态下 --resume 执行 resumeInstalled，仅验证', async () => {
    const h = harness({
      seed: { d1: [{ uuid: 'd1-x', name: 'acme-db' }] },
      setupStatus: { setupRequired: false, codeRequired: false },
    });
    const s = installedState();
    writeState(dir, s);
    expect(
      await main(['install', '--resume', '--yes', '--name', 'acme'], h.deps)
    ).toBe(0);
    expect(h.out.at(-1)).toBe('Nothing to do.');
    expect(h.confirms).toEqual([]);
    expect(
      h
        .cf()!
        .calls.filter((c) =>
          ['createD1', 'createR2', 'putR2Object', 'putR2Lifecycle'].includes(
            c.method
          )
        )
    ).toEqual([]);
    expect(h.runner.calls.some((c) => c.args[1] === 'deploy')).toBe(false);
    expect(h.fetched).toContain(`${BASE}/.well-known/cloudforge`);
    expect(readState(dir, ID)!.status).toBe('installed');
  });

  it('已安装状态下 --resume --new-setup-code 替换初始化码', async () => {
    const deployed = (h: ReturnType<typeof harness>) =>
      h.runner.calls.filter((c) => c.args[1] === 'deploy').length;
    const without = harness({
      seed: { d1: [{ uuid: 'd1-x', name: 'acme-db' }] },
    });
    const s = installedState();
    // Deployed from this checkout, so the code can be replaced without an upgrade.
    writeState(dir, {
      ...s,
      deployedConfigHash: renderConfig(
        { source: checkoutSource(cwd), configDir: cwd } as Ctx,
        s,
        VERSION
      ).hash,
    });
    expect(
      await main(
        ['install', '--resume', '--yes', '--name', 'acme'],
        without.deps
      )
    ).toBe(0);
    expect(deployed(without)).toBe(0);
    expect(without.text()).toContain('--new-setup-code');

    const withFlag = harness({
      seed: { d1: [{ uuid: 'd1-x', name: 'acme-db' }] },
    });
    expect(
      await main(
        ['install', '--resume', '--yes', '--name', 'acme', '--new-setup-code'],
        withFlag.deps
      )
    ).toBe(0);
    expect(deployed(withFlag)).toBe(1);
    expect(withFlag.text()).toMatch(/Setup code: \S+/);
    expect(withFlag.confirms).toEqual([]);
  });

  it('--plan --resume --new-setup-code 将该参数带入应用命令', async () => {
    const h = harness({ seed: { d1: [{ uuid: 'd1-x', name: 'acme-db' }] } });
    writeState(dir, installedState());
    expect(
      await main(
        ['install', '--plan', '--resume', '--name', 'acme', '--new-setup-code'],
        h.deps
      )
    ).toBe(0);
    expect(h.out.at(-1)).toBe(
      `yarn cloudforge install --resume --name acme --account ${ACCOUNT} --workers-dev --no-email --new-setup-code --yes`
    );
  });

  it('非终端环境中环境变量的分析令牌被拒绝时以 1 退出', async () => {
    const h = harness({
      env: { CLOUDFORGE_CF_ANALYTICS_TOKEN: 'bad' },
      analyticsOk: false,
    });
    expect(await main(['install', '--yes', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain("can't read Account Analytics");
    expect(h.cf()!.calls.filter((c) => c.method === 'createD1')).toEqual([]);
    expect(h.text()).not.toContain('bad');
  });

  it('终端中提供可选凭据输入，并跳过空回答', async () => {
    const h = harness({ tty: true, prompts: ['', ''] });
    expect(await main(['install', ...FLAGS], h.deps)).toBe(0);
    expect(h.text()).toContain('acme-lfs');
    expect(h.text()).toContain('dash.cloudflare.com');
    expect(readState(dir, ID)!.skipped).toEqual(['r2-keys', 'analytics-token']);
  });
});

describe('status：状态', () => {
  it('打印记录状态和 well-known 检查，不作变更', async () => {
    const h = harness();
    const s = installedState();
    writeState(dir, s);
    expect(await main(['status'], h.deps)).toBe(0);
    const text = h.text();
    expect(text).toContain('installed');
    expect(text).toContain(BASE);
    expect(text).toContain('acme-db');
    expect(h.fetched).toEqual([
      'https://registry.npmjs.org/@cybernova2333%2fcloudforge',
      `${BASE}/.well-known/cloudforge`,
    ]);
    expect(h.cf()).toBeNull();
    expect(h.runner.calls).toEqual([]);
    expect(listStates(dir)).toEqual([s]);
  });

  it('已是最新版本时不打印升级提示', async () => {
    const h = harness({ latest: VERSION });
    writeState(dir, installedState());
    expect(await main(['status'], h.deps)).toBe(0);
    expect(h.text()).toMatch(new RegExp(`Latest\\s+${VERSION}\\n`));
    expect(h.text()).not.toContain('upgrade --name');
  });

  it('离线时显示最新版本未知并以 0 退出', async () => {
    const h = harness({ latest: null });
    writeState(dir, installedState());
    expect(await main(['status'], h.deps)).toBe(0);
    expect(h.text()).toMatch(/Latest\s+unknown/);
  });

  it('源码检出目录中 status --from 属于用法错误', async () => {
    const h = harness();
    expect(await main(['status', '--from', '/x'], h.deps)).toBe(2);
  });

  it('显示已迁移安装的新位置', async () => {
    const h = harness();
    writeState(dir, {
      ...installedState(),
      movedTo: '/home/me/.cloudforge/acme',
    });
    await main(['status'], h.deps);
    expect(h.text()).toMatch(/Moved\s+\/home\/me\/\.cloudforge\/acme/);
  });

  it('实时状态行比较运行状态与记录状态', async () => {
    const h = harness({
      wellKnown: () => Response.json({ installationId: ID, version: 'zzz' }),
    });
    writeState(dir, installedState());
    expect(await main(['status'], h.deps)).toBe(1);
    expect(h.text()).toContain('version zzz');
    expect(h.text()).toContain(`version ${VERSION}`);
  });

  it('well-known 响应与记录不一致时以 1 退出', async () => {
    const h = harness({
      wellKnown: () => Response.json({ installationId: ID, version: 'other' }),
    });
    writeState(dir, installedState());
    expect(await main(['status'], h.deps)).toBe(1);
    expect(h.text()).toContain('other');
  });

  it.each([
    ['null', 'null'],
    ['非 JSON', '<html>hi</html>'],
  ])('2xx 响应正文为 %s 时以 1 退出', async (_label, body) => {
    const h = harness({ wellKnown: () => new Response(body, { status: 200 }) });
    writeState(dir, installedState());
    expect(await main(['status'], h.deps)).toBe(1);
    expect(h.text()).toContain(
      `Unexpected answer from ${BASE}/.well-known/cloudforge`
    );
  });

  it('无法访问时以 1 退出', async () => {
    const h = harness({
      wellKnown: () => {
        throw new Error('ECONNREFUSED');
      },
    });
    writeState(dir, installedState());
    expect(await main(['status'], h.deps)).toBe(1);
    expect(h.text()).toContain('ECONNREFUSED');
  });

  it('没有安装时说明情况并以 1 退出', async () => {
    const h = harness();
    expect(await main(['status'], h.deps)).toBe(1);
    expect(h.text()).toContain('No installation found');
  });
});

const source = checkoutSource('/repo');

describe('resolveToken：解析令牌', () => {
  it('优先使用 CLOUDFLARE_API_TOKEN，且不运行 wrangler', async () => {
    const r = fakeRunner({});
    expect(
      await resolveToken({ CLOUDFLARE_API_TOKEN: 'env-tok' }, r, source)
    ).toBe('env-tok');
    expect(r.calls).toEqual([]);
  });
  it('使用 wrangler 输出中最后一行符合令牌格式的内容，并去除颜色代码', async () => {
    const tok = 'AbC_def-123.456789012345';
    const r = fakeRunner({
      yarn: () => ({
        code: 0,
        stdout: `\u001b[33m▲ [WARNING] a newer wrangler is out\u001b[0m\n\u001b[1m${tok}\u001b[22m\n\n`,
        stderr: '',
      }),
    });
    expect(await resolveToken({}, r, source)).toBe(tok);
    expect(r.calls[0]!.args).toEqual(['-s', 'wrangler', 'auth', 'token']);
  });
  it('软件包模式运行自带 wrangler 的 auth token，且不传 --config', async () => {
    const pkgSource = packageSource(
      fakePackage(mkdtempSync(join(tmpdir(), 'tok-')), {
        version: '1.2.0',
        commit: 'abc123def456',
      })
    );
    const tok = 'AbC_def-123.456789012345';
    const r = fakeRunner({
      [process.execPath]: () => ({ code: 0, stdout: `${tok}\n`, stderr: '' }),
    });
    expect(await resolveToken({}, r, pkgSource)).toBe(tok);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.cmd).toBe(process.execPath);
    expect(r.calls[0]!.args.slice(1)).toEqual(['auth', 'token']);
    expect(r.calls[0]!.args).not.toContain('--config');
  });
  it('软件包模式未登录时打印固定版本的登录命令', async () => {
    const pkgSource = packageSource(
      fakePackage(mkdtempSync(join(tmpdir(), 'tok-')), {
        version: '1.2.0',
        commit: 'abc123def456',
      })
    );
    const r = fakeRunner({
      [process.execPath]: () => ({ code: 1, stdout: '', stderr: 'x' }),
    });
    await expect(resolveToken({}, r, pkgSource)).rejects.toThrow(
      'Run npx wrangler@4.127.0 login first.'
    );
  });
  it('没有符合令牌格式的行时提示运行 wrangler login', async () => {
    const r = fakeRunner({
      yarn: () => ({
        code: 0,
        stdout: 'You are not logged in.\nshort\n',
        stderr: '',
      }),
    });
    await expect(resolveToken({}, r, source)).rejects.toThrow(
      'Run yarn wrangler login first.'
    );
  });

  it('未登录时提示运行 wrangler login', async () => {
    const r = fakeRunner({
      yarn: () => ({ code: 1, stdout: '', stderr: 'Not logged in' }),
    });
    await expect(resolveToken({}, r, source)).rejects.toThrow(
      'Run yarn wrangler login first.'
    );
  });
});

describe('applyCommand：生成应用命令', () => {
  it('对安全字符集合之外的值加单引号', () => {
    const s = {
      ...installedState(),
      inputs: {
        name: 'acme',
        hostname: null,
        workersDev: true,
        fromEmail: "o'brien+git@example.com",
      },
    };
    expect(applyCommand(s, false, 'abc', false, source)).toBe(
      `yarn cloudforge install --name acme --account ${ACCOUNT} --workers-dev --from-email 'o'\\''brien+git@example.com' --expect-plan abc --yes`
    );
  });
});

describe('isEntry：判断入口', () => {
  const url = 'file:///repo/scripts/cloudforge/cli.ts';
  it('运行时支持 import.meta.main 时使用它', () => {
    expect(isEntry(true, undefined, url)).toBe(true);
    expect(isEntry(false, '/repo/scripts/cloudforge/cli.ts', url)).toBe(false);
  });
  it('Node 不支持 import.meta.main 时回退为比较 argv[1]', () => {
    expect(isEntry(undefined, '/repo/scripts/cloudforge/cli.ts', url)).toBe(
      true
    );
    expect(isEntry(undefined, '/repo/other.ts', url)).toBe(false);
    expect(isEntry(undefined, undefined, url)).toBe(false);
  });
});

describe('软件包模式', () => {
  const pkg = () => {
    const home = join(root, 'home');
    const pkgRoot = fakePackage(mkdtempSync(join(tmpdir(), 'pkg-')), {
      version: '1.2.0',
      commit: 'abc123def456',
    });
    copyFileSync(
      join(cwd, 'wrangler.jsonc.example'),
      join(pkgRoot, 'wrangler.jsonc.example')
    );
    mkdirSync(join(pkgRoot, 'migrations'), { recursive: true });
    writeFileSync(
      join(pkgRoot, 'migrations', '0000_init.sql'),
      'CREATE TABLE a;'
    );
    const source = packageSource(pkgRoot);
    return { home, source };
  };
  const names = (p: string) =>
    existsSync(p) ? readdirSync(p).sort() : ([] as string[]);

  it('安装以私有权限写入 home/<slug>，不写入当前工作目录', async () => {
    const pkgOpts = pkg();
    const h = harness({
      pkg: pkgOpts,
      wellKnown: () => Response.json({ installationId: ID, version: '1.2.0' }),
    });
    const code = await main(['install', '--yes', ...FLAGS], h.deps);
    expect(code).toBe(0);
    const idir = join(pkgOpts.home, 'acme');
    expect(names(idir).some((f) => f.endsWith('.json'))).toBe(true);
    expect(names(idir)).toContain('wrangler.jsonc');
    expect(statSync(idir).mode & 0o777).toBe(0o700);
    expect(statSync(join(idir, 'wrangler.jsonc')).mode & 0o777).toBe(0o600);
    for (const f of names(idir).filter((f) => f.endsWith('.json')))
      expect(statSync(join(idir, f)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(cwd, 'wrangler.jsonc'))).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  it('手写配置提示包含完整路径', async () => {
    const pkgOpts = pkg();
    mkdirSync(join(pkgOpts.home, 'acme'), { recursive: true });
    writeFileSync(join(pkgOpts.home, 'acme', 'wrangler.jsonc'), '{}\n');
    const h = harness({ pkg: pkgOpts });
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(0);
    const c = join(pkgOpts.home, 'acme', 'wrangler.jsonc');
    expect(h.text()).toContain(`\`mv ${c} ${c}.hand\``);
  });

  it('status 打印最新版本，运行版本较旧时显示 npx 升级命令', async () => {
    const pkgOpts = pkg();
    writeState(join(pkgOpts.home, 'acme'), {
      ...installedState(),
      deployedVersion: '1.0.0',
    });
    const h = harness({
      pkg: pkgOpts,
      latest: '9.9.9',
      wellKnown: () => Response.json({ installationId: ID, version: '1.0.0' }),
    });
    expect(await main(['status'], h.deps)).toBe(0);
    expect(h.text()).toMatch(/Latest\s+9\.9\.9/);
    expect(h.text()).toContain(
      '(npx @cybernova2333/cloudforge@9.9.9 upgrade --name acme)'
    );
  });

  it('status --from 只读检出目录，并提示先接管再升级', async () => {
    const checkout = join(root, 'checkout');
    const cdir = join(checkout, '.cloudforge');
    writeState(cdir, { ...installedState(), deployedVersion: '1.0.0' });
    const pkgOpts = pkg();
    const h = harness({
      pkg: pkgOpts,
      latest: '9.9.9',
      wellKnown: () => Response.json({ installationId: ID, version: '1.0.0' }),
    });
    expect(await main(['status', '--from', checkout], h.deps)).toBe(0);
    expect(h.text()).toContain('acme-db');
    expect(h.text()).toContain(
      `(npx @cybernova2333/cloudforge@9.9.9 adopt --from ${checkout} --name acme, then npx @cybernova2333/cloudforge@9.9.9 upgrade --name acme)`
    );
    expect(listStates(cdir)).toHaveLength(1);
    expect(existsSync(join(pkgOpts.home, 'acme'))).toBe(false);
  });

  it('status 读取主目录下唯一的安装', async () => {
    const pkgOpts = pkg();
    writeState(join(pkgOpts.home, 'acme'), installedState());
    const h = harness({ pkg: pkgOpts });
    expect(await main(['status'], h.deps)).toBe(0);
    expect(h.text()).toContain('acme');
  });

  it('status 遇到多个安装时要求 --name', async () => {
    const pkgOpts = pkg();
    writeState(join(pkgOpts.home, 'acme'), installedState());
    writeState(join(pkgOpts.home, 'beta'), installedState());
    const h = harness({ pkg: pkgOpts });
    expect(await main(['status'], h.deps)).toBe(2);
    expect(h.text()).toContain('Several installs: acme, beta. Pass --name.');
  });
});

describe('Docker 检查', () => {
  const NOT_INSTALLED =
    'Docker is not installed. CloudForge runs Actions jobs in containers, and deploying builds the runner image with Docker. Install Docker Desktop (https://docs.docker.com/get-docker/), start it, then run the same command again.';
  const NOT_RUNNING =
    'Docker is installed but not running. Start Docker Desktop (or the Docker daemon), then run the same command again.';
  const ok = { code: 0, stdout: '27.0.0\n', stderr: '' };

  it('未安装时显示准确消息、不写入内容，--plan 不打印摘要', async () => {
    const h = harness({
      docker: {
        docker: () => Promise.reject(new Error('spawn docker ENOENT')),
      },
    });
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain(NOT_INSTALLED);
    expect(h.text()).not.toContain('Plan ');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(cwd, 'wrangler.jsonc'))).toBe(false);
    const apply = harness({
      docker: { docker: () => ({ code: 127, stdout: '', stderr: '' }) },
    });
    expect(await main(['install', '--yes', ...FLAGS], apply.deps)).toBe(1);
    expect(apply.text()).toContain(NOT_INSTALLED);
    expect(existsSync(dir)).toBe(false);
  });

  it('未运行时显示准确消息、不写入内容，--plan 不打印摘要', async () => {
    const h = harness({
      docker: {
        'docker --version': () => ok,
        'docker info': () => ({ code: 1, stdout: '', stderr: 'no daemon' }),
      },
    });
    expect(await main(['install', '--plan', ...FLAGS], h.deps)).toBe(1);
    expect(h.text()).toContain(NOT_RUNNING);
    expect(h.text()).not.toContain('Plan ');
    expect(h.text()).not.toContain('not installed');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(cwd, 'wrangler.jsonc'))).toBe(false);
  });

  it('status 从不运行 Docker', async () => {
    writeState(dir, installedState());
    const h = harness();
    expect(await main(['status'], h.deps)).toBe(0);
    expect(h.runner.calls.filter((c) => c.cmd === 'docker')).toEqual([]);
  });
});

describe('upgrade：升级', () => {
  const home = () => join(root, 'home');
  const idir = () => join(home(), 'acme');
  const seedInstall = (over: Partial<InstallState> = {}) => {
    const s = {
      ...installedState(),
      deployedVersion: '1.2.0',
      doNamespaceIds: {
        JOB_RUNNER_NAMESPACE_ID: 'ns-job',
        MERGE_RESOLVER_NAMESPACE_ID: 'ns-merge',
        AGENT_REVIEWER_NAMESPACE_ID: 'ns-review',
        LIVE_NAMESPACE_ID: 'ns-live',
      },
      ...over,
    };
    writeState(idir(), s);
    return s;
  };
  const seedFor = (s: InstallState): FakeCloudflareSeed => {
    const marker = (key: string) => ({
      [R2_MARKER_KEY]: JSON.stringify({
        installationId: s.installationId,
        ownershipNonce: s.ownershipNonce,
        key,
      }),
    });
    return {
      d1: [{ uuid: 'd1-x', name: 'acme-db' }],
      d1Migrations: { 'd1-x': ['0000_init.sql'] },
      r2: {
        'acme-lfs': marker('lfs'),
        'acme-actions-logs': marker('actionsLogs'),
        'acme-actions-cache': marker('actionsCache'),
      },
      workflows: [
        { name: 'acme-actions-run', scriptName: 'acme' },
        { name: 'acme-merge-resolution', scriptName: 'acme' },
      ],
      workerVars: {
        acme: {
          CLOUDFORGE_INSTALLATION: JSON.stringify({
            installationId: s.installationId,
            ownershipNonce: s.ownershipNonce,
          }),
        },
      },
    };
  };
  const secretList = (names: string[]): RunResult => ({
    code: 0,
    stdout: JSON.stringify(names.map((name) => ({ name }))),
    stderr: '',
  });
  const ALL = [
    'BETTER_AUTH_SECRET',
    'SETUP_CODE_HASH',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'CF_ANALYTICS_TOKEN',
  ];
  const pkg130 = () => {
    const pkgRoot = fakePackage(mkdtempSync(join(tmpdir(), 'pkg-')), {
      version: '1.3.0',
      commit: 'c'.repeat(40),
    });
    copyFileSync(
      join(cwd, 'wrangler.jsonc.example'),
      join(pkgRoot, 'wrangler.jsonc.example')
    );
    mkdirSync(join(pkgRoot, 'migrations'), { recursive: true });
    writeFileSync(
      join(pkgRoot, 'migrations', '0000_init.sql'),
      'CREATE TABLE a;'
    );
    writeFileSync(
      join(pkgRoot, 'migrations', '0001_more.sql'),
      'CREATE TABLE b;'
    );
    return { home: home(), source: packageSource(pkgRoot) };
  };
  /** An installed acme at 1.2.0 under home; the site reports 1.3.0 once a deploy succeeded. */
  const upgradeHarness = (
    o: {
      tty?: boolean;
      secrets?: string[];
      prompts?: (string | null)[];
      running?: () => string;
      deployResult?: RunResult;
      state?: Partial<InstallState>;
      /** Keep the state already under home (a second run). */
      keep?: boolean;
    } = {}
  ) => {
    const s = o.keep ? readState(idir(), ID)! : seedInstall(o.state);
    let deployedOk = false;
    const h = harness({
      pkg: pkg130(),
      tty: o.tty,
      prompts: o.prompts,
      secretList: secretList(o.secrets ?? ALL),
      deployResult: o.deployResult,
      seed: seedFor(s),
      setupStatus: { setupRequired: false, codeRequired: false },
      wellKnown: () => {
        deployedOk = h.deploys.length > 0 && o.deployResult?.code !== 1;
        return Response.json({
          installationId: ID,
          version: deployedOk ? '1.3.0' : (o.running?.() ?? '1.2.0'),
        });
      },
    });
    return h;
  };

  it('--help 列出 upgrade 及其选项', async () => {
    const h = harness();
    expect(await main(['--help'], h.deps)).toBe(0);
    expect(h.text()).toContain('upgrade');
    expect(h.text()).toContain('--replace-custom-code');
  });

  it('upgrade --plan 打印应用命令且不写入任何内容', async () => {
    const h = upgradeHarness();
    const before = readFileSync(join(idir(), `${ID}.json`), 'utf8');
    expect(await main(['upgrade', '--plan'], h.deps)).toBe(0);
    const text = h.text();
    expect(text).toContain('Upgrade acme: 1.2.0 → 1.3.0');
    const digest = /Plan ([0-9a-f]{12})/.exec(text)?.[1];
    expect(digest).toBeDefined();
    expect(text).toContain(
      `npx @cybernova2333/cloudforge@1.3.0 upgrade --name acme --expect-plan ${digest} --yes`
    );
    expect(h.deploys).toHaveLength(0);
    expect(readFileSync(join(idir(), `${ID}.json`), 'utf8')).toBe(before);
    expect(readdirSync(idir())).toEqual([`${ID}.json`]);
  });

  it('打印的应用命令可以执行且摘要匹配', async () => {
    const p = upgradeHarness();
    expect(await main(['upgrade', '--plan'], p.deps)).toBe(0);
    const cmd = p.out.at(-1)!;
    const h = upgradeHarness();
    expect(await main(cmd.split(' ').slice(2), h.deps)).toBe(0);
    expect(h.text()).not.toContain('The plan changed');
    expect(h.text()).toContain('Upgraded acme to 1.3.0');
    const s = readState(idir(), ID)!;
    expect(s.status).toBe('installed');
    expect(s.deployedVersion).toBe('1.3.0');
  });

  it('无终端时 upgrade 需要 --yes 或 --plan', async () => {
    const h = upgradeHarness();
    expect(await main(['upgrade'], h.deps)).toBe(2);
    expect(h.text()).toContain(
      'Not running in a terminal: pass --yes to apply (or --plan to only review).'
    );
    expect(h.tokenCalls()).toBe(0);
  });

  it('部署失败后打印升级恢复命令，该命令可完成升级', async () => {
    const first = upgradeHarness({
      deployResult: { code: 1, stdout: '', stderr: 'boom' },
    });
    expect(await main(['upgrade', '--yes', '--name', 'acme'], first.deps)).toBe(
      1
    );
    const printed = /Run: (npx @cybernova2333\/cloudforge@1\.3\.0 (.+))$/m.exec(
      first.text()
    );
    expect(printed?.[1]).toBe(
      'npx @cybernova2333/cloudforge@1.3.0 upgrade --resume --name acme'
    );
    const failed = readState(idir(), ID)!;
    expect(failed.status).toBe('failed');
    expect(failed.upgradeTarget).toBe('1.3.0');

    const again = upgradeHarness({ keep: true, tty: true });
    expect(await main(printed![2]!.split(' '), again.deps)).toBe(0);
    expect(again.confirms).toEqual(['Apply this upgrade?']);
    const s = readState(idir(), ID)!;
    expect(s.status).toBe('installed');
    expect(s.deployedVersion).toBe('1.3.0');
    expect(again.deploys).toHaveLength(1);
  });

  it('缺少 R2 密钥不阻止 --yes，并说明添加方法', async () => {
    const h = upgradeHarness({
      secrets: [
        'BETTER_AUTH_SECRET',
        'ACTIONS_SECRETS_KEY',
        'SETUP_CODE_HASH',
        'CF_ANALYTICS_TOKEN',
      ],
    });
    expect(await main(['upgrade', '--yes'], h.deps)).toBe(0);
    expect(h.asked).toEqual([]);
    expect(h.deploys).toEqual([null]);
    const text = h.text();
    expect(text).toContain(
      'Missing (you add them): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\n'
    );
    expect(text).toContain(
      'Missing (you add them): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Add them with: npx @cybernova2333/cloudforge@1.3.0 install --resume --name acme'
    );
    expect(readState(idir(), ID)!.skipped).toEqual(['r2-keys']);
  });

  it('终端中询问缺少的手动凭据，隐藏输入后部署', async () => {
    const h = upgradeHarness({
      tty: true,
      secrets: ['BETTER_AUTH_SECRET', 'ACTIONS_SECRETS_KEY', 'SETUP_CODE_HASH'],
      prompts: ['kid', 'ksecret', 'tok'],
    });
    expect(await main(['upgrade'], h.deps)).toBe(0);
    expect(h.confirms).toEqual(['Apply this upgrade?']);
    expect(h.asked).toEqual([
      'R2 access key ID',
      'R2 secret access key',
      'Analytics API token',
    ]);
    expect(h.deploys).toEqual([
      {
        R2_ACCESS_KEY_ID: 'kid',
        R2_SECRET_ACCESS_KEY: 'ksecret',
        CF_ANALYTICS_TOKEN: 'tok',
      },
    ]);
    expect(h.text()).not.toContain('ksecret');
    expect(h.text()).not.toContain('Add them with');
    expect(readState(idir(), ID)!.skipped).toEqual([]);
  });

  it('终端中使用 --yes 时不询问', async () => {
    const h = upgradeHarness({
      tty: true,
      secrets: ['BETTER_AUTH_SECRET', 'ACTIONS_SECRETS_KEY', 'SETUP_CODE_HASH'],
      prompts: ['kid', 'ksecret', 'tok'],
    });
    expect(await main(['upgrade', '--yes'], h.deps)).toBe(0);
    expect(h.asked).toEqual([]);
    expect(h.deploys).toEqual([null]);
    expect(readState(idir(), ID)!.skipped).toEqual([
      'r2-keys',
      'analytics-token',
    ]);
  });

  it('缺少 Docker 时在规划前停止', async () => {
    seedInstall();
    const h = harness({
      pkg: pkg130(),
      docker: {
        docker: () => Promise.reject(new Error('spawn docker ENOENT')),
      },
    });
    const before = readFileSync(join(idir(), `${ID}.json`), 'utf8');
    expect(await main(['upgrade', '--yes'], h.deps)).toBe(1);
    expect(h.text()).toContain('Docker is not installed.');
    expect(h.text()).not.toContain('Upgrade acme');
    expect(h.cf()!.calls).toEqual([]);
    expect(readFileSync(join(idir(), `${ID}.json`), 'utf8')).toBe(before);
    expect(readdirSync(idir())).toEqual([`${ID}.json`]);
  });

  it('源码模式提示使用 npx', async () => {
    const h = harness();
    expect(await main(['upgrade', '--yes'], h.deps)).toBe(2);
    expect(h.text()).toContain(
      `Upgrades run from npm: npx @cybernova2333/cloudforge adopt --from ${cwd}, then npx @cybernova2333/cloudforge upgrade.`
    );
    expect(h.tokenCalls()).toBe(0);
  });

  it.each([
    ['upgrading', {}],
    ['failed', { upgradeTarget: '1.3.0' }],
  ] as const)(
    'install --resume 拒绝未完成的升级（%s）',
    async (status, extra) => {
      seedInstall({ status, upgradeTarget: '1.3.0', ...extra });
      const h = harness({ pkg: pkg130() });
      expect(
        await main(['install', '--resume', '--yes', '--name', 'acme'], h.deps)
      ).toBe(1);
      expect(h.text()).toContain(
        'An upgrade to 1.3.0 is unfinished; run npx @cybernova2333/cloudforge@1.3.0 upgrade --resume --name acme.'
      );
      expect(h.deploys).toHaveLength(0);
    }
  );
});

describe('adopt：接管', () => {
  const home = () => join(root, 'home');
  const MOVED = () => join(home(), resourceNames('acme').worker);
  const seedCheckout = (over: Partial<InstallState> = {}) => {
    const s = { ...installedState(), ...over };
    writeState(dir, s);
    writeFileSync(join(cwd, 'wrangler.jsonc'), '// generated\n{}\n');
    return s;
  };
  const MOVED_LINE = () =>
    `This install moved to ${MOVED()}. Run npx @cybernova2333/cloudforge upgrade --name ${resourceNames('acme').worker}.`;
  const pkgHarness = (o: { tty?: boolean; confirm?: boolean } = {}) =>
    harness({
      ...o,
      pkg: {
        home: home(),
        source: packageSource(
          fakePackage(mkdtempSync(join(tmpdir(), 'pkg-')), {
            version: '1.2.0',
            commit: 'abc123def456',
          })
        ),
      },
    });

  it('迁移安装后，检出目录拒绝 install 和 --resume', async () => {
    seedCheckout();
    const h = pkgHarness();
    expect(await main(['adopt', '--from', cwd, '--yes'], h.deps)).toBe(0);
    expect(h.text()).toContain(`Moved acme to ${MOVED()}`);
    expect(readState(MOVED(), ID)!.adoptedAt).toBe('2026-10-17T00:00:00.000Z');
    expect(readState(dir, ID)!.movedTo).toBe(MOVED());
    expect(h.tokenCalls()).toBe(0);

    const fresh = harness({});
    expect(await main(['install', ...FLAGS, '--yes'], fresh.deps)).toBe(1);
    expect(fresh.text()).toContain(MOVED_LINE());
    expect(fresh.deploys).toHaveLength(0);

    const resume = harness({});
    expect(
      await main(
        ['install', '--resume', '--name', 'acme', '--yes'],
        resume.deps
      )
    ).toBe(1);
    expect(resume.text()).toContain(MOVED_LINE());
    expect(resume.deploys).toHaveLength(0);
  });

  it('迁移前询问，拒绝后不作变更', async () => {
    seedCheckout();
    const h = pkgHarness({ tty: true, confirm: false });
    expect(await main(['adopt', '--from', cwd], h.deps)).toBe(1);
    expect(h.confirms).toEqual(['Move this install?']);
    expect(existsSync(MOVED())).toBe(false);
    expect(readState(dir, ID)!.movedTo).toBeUndefined();
  });

  it('非终端环境且未指定 --yes 时以 2 退出', async () => {
    seedCheckout();
    const h = pkgHarness();
    expect(await main(['adopt', '--from', cwd], h.deps)).toBe(2);
    expect(h.text()).toContain('Not running in a terminal');
    expect(existsSync(MOVED())).toBe(false);
  });

  it('需要 --from', async () => {
    const h = pkgHarness();
    expect(await main(['adopt', '--yes'], h.deps)).toBe(2);
    expect(h.text()).toContain('adopt needs --from');
  });

  it('--from 搭配仅适用于 Worker 的参数属于用法错误', async () => {
    const h = pkgHarness();
    expect(
      await main(['adopt', '--from', cwd, '--plan', '--yes'], h.deps)
    ).toBe(2);
    expect(h.text()).toContain('--plan is only for adopt --worker.');
  });

  it('源码模式提示使用 npx', async () => {
    seedCheckout();
    const h = harness({});
    expect(await main(['adopt', '--from', cwd, '--yes'], h.deps)).toBe(2);
    expect(h.text()).toContain(
      `npx @cybernova2333/cloudforge adopt --from ${cwd}`
    );
    expect(readState(dir, ID)!.movedTo).toBeUndefined();
  });

  it('目标位置已占用时以 1 退出且保留检出目录', async () => {
    const s = seedCheckout();
    writeState(MOVED(), s);
    const h = pkgHarness();
    expect(await main(['adopt', '--from', cwd, '--yes'], h.deps)).toBe(1);
    expect(h.text()).toContain(`${MOVED()} already has an install`);
    expect(readState(dir, ID)!.movedTo).toBeUndefined();
  });
});

describe('adopt --worker：接管 Worker', () => {
  const home = () => join(root, 'home');
  const seed: FakeCloudflareSeed = {
    workers: {
      acme: [
        { type: 'd1', name: 'DB', id: 'd1-acme' },
        { type: 'plain_text', name: 'BASE_URL', text: BASE },
        { type: 'secret_text', name: 'BETTER_AUTH_SECRET' },
      ],
    },
    d1: [{ uuid: 'd1-acme', name: 'acme-db' }],
    doNamespaces: [],
  };
  const pkgHarness = (o: Parameters<typeof harness>[0] = {}) => {
    const pkgRoot = fakePackage(mkdtempSync(join(tmpdir(), 'pkg-')), {
      version: '1.2.0',
      commit: 'abc123def456',
    });
    copyFileSync(
      new URL('../../../wrangler.jsonc.example', import.meta.url),
      join(pkgRoot, 'wrangler.jsonc.example')
    );
    return harness({
      seed,
      wellKnown: () => new Response('', { status: 404 }),
      ...o,
      pkg: { home: home(), source: packageSource(pkgRoot) },
    });
  };

  it('--plan 打印报告和可执行的应用命令，且不触发部署', async () => {
    const h = pkgHarness();
    expect(await main(['adopt', '--worker', 'acme', '--plan'], h.deps)).toBe(0);
    const text = h.text();
    expect(text).toContain('Adopt worker acme');
    const digest = /Plan ([0-9a-f]{12})/.exec(text)![1]!;
    const command = `npx @cybernova2333/cloudforge@1.2.0 adopt --worker acme --account ${ACCOUNT} --expect-plan ${digest} --yes`;
    expect(text).toContain(command);
    expect(existsSync(home())).toBe(false);

    const apply = pkgHarness();
    expect(await main(command.split(' ').slice(2), apply.deps)).toBe(0);
    const s = listStates(join(home(), 'acme'))[0]!;
    expect(s.resources.every((r) => r.ownership === 'adopted')).toBe(true);
    expect(s.adoptedAt).toBe('2026-10-17T00:00:00.000Z');
    expect(apply.runner.calls).toHaveLength(0);
    expect(apply.deploys).toHaveLength(0);
  });

  it('同时指定 --from 与 --worker 时以 2 退出', async () => {
    const h = pkgHarness();
    expect(
      await main(['adopt', '--from', cwd, '--worker', 'acme', '--yes'], h.deps)
    ).toBe(2);
    expect(h.text()).toContain('Pass either --from or --worker, not both.');
  });

  it('非终端环境且未指定 --yes 时以 2 退出；源码模式提示使用 npx', async () => {
    const h = pkgHarness();
    expect(await main(['adopt', '--worker', 'acme'], h.deps)).toBe(2);
    expect(h.text()).toContain('Not running in a terminal');
    const c = harness({ seed });
    expect(await main(['adopt', '--worker', 'acme', '--yes'], c.deps)).toBe(2);
    expect(c.text()).toContain(
      'npx @cybernova2333/cloudforge adopt --worker acme'
    );
    expect(c.tokenCalls()).toBe(0);
  });

  it('Worker 名称错误时以 1 退出且不写入任何内容', async () => {
    const h = pkgHarness();
    expect(await main(['adopt', '--worker', 'nope', '--yes'], h.deps)).toBe(1);
    expect(h.text()).toContain(`No worker named nope on account ${ACCOUNT}`);
    expect(existsSync(home())).toBe(false);
  });

  it('--worker 搭配 --name 或无效 Worker 名称属于用法错误', async () => {
    const h = pkgHarness();
    expect(
      await main(['adopt', '--worker', 'acme', '--name', 'x', '--yes'], h.deps)
    ).toBe(2);
    expect(h.text()).toContain(
      '--name is only for adopt --from; with --worker the install is named after the worker.'
    );
    const bad = pkgHarness();
    expect(await main(['adopt', '--worker', 'A_B', '--yes'], bad.deps)).toBe(2);
    expect(bad.text()).toContain('--worker A_B:');
  });
});
