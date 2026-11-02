// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { resourceNames } from '../../planning/names.ts';
import { observe, type Observed } from '../../planning/observe.ts';
import {
  computePlan,
  formatPlan,
  planDigest,
  PlanStop,
  type Plan,
} from '../../planning/plan.ts';
import {
  newState,
  recordStep,
  type InstallState,
  type Resource,
} from '../../installation/state.ts';
import { fakeCloudflare } from '../helpers/fakes.ts';

const names = resourceNames('cloudforge');
const installationId = 'cloudforge-1a2b3c4d5e6f';
const ownershipNonce = 'n'.repeat(64);
const desired = { installationId, ownershipNonce, names };

const MARKER_KEY = '.cloudforge/ownership.json';

function empty(): Observed {
  return {
    worker: { exists: false, vars: null },
    d1: [],
    d1Tables: {},
    d1InstallRow: {},
    r2: [],
    r2Markers: {},
    r2Empty: {},
    workflows: [],
    artifactsNamespaces: [],
  };
}

function state(): InstallState {
  return {
    ...newState({
      installationId,
      accountId: 'acc',
      inputs: {
        name: 'cloudforge',
        hostname: 'git.example.com',
        workersDev: false,
        fromEmail: 'noreply@example.com',
      },
      names,
      baseUrl: 'https://git.example.com',
    }),
    ownershipNonce,
  };
}

function marker(key: string, nonce = ownershipNonce): string {
  return JSON.stringify({ installationId, ownershipNonce: nonce, key });
}

function rec(
  key: string,
  kind: Resource['kind'],
  name: string,
  id: string
): Resource {
  return { key, kind, name, id, ownership: 'created', state: 'ready' };
}

function tuples(plan: Plan) {
  return plan.actions.map((a) => [a.action, a.kind, a.name]);
}

function stopMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PlanStop);
    return (e as Error).message;
  }
  throw new Error('预期抛出 PlanStop');
}

const notOurs = (n: string) =>
  `\`${n}\` already exists and was not created by this installation. Nothing was changed.`;

describe('computePlan：计算计划', () => {
  it('全新账户按固定顺序创建所有资源', () => {
    const plan = computePlan(desired, empty(), null);
    expect(plan.installationId).toBe(installationId);
    expect(tuples(plan)).toEqual([
      ['create', 'd1', 'cloudforge-db'],
      ['create', 'r2', 'cloudforge-lfs'],
      ['create', 'r2', 'cloudforge-actions-logs'],
      ['create', 'r2', 'cloudforge-actions-cache'],
      ['create', 'workflow', 'cloudforge-actions-run'],
      ['create', 'workflow', 'cloudforge-merge-resolution'],
      ['create', 'worker', 'cloudforge'],
    ]);
    expect(plan.actions.map((a) => a.key)).toEqual([
      'd1',
      'lfs',
      'actionsLogs',
      'actionsCache',
      'actionsWorkflow',
      'mergeWorkflow',
      'worker',
    ]);
    expect(plan.info).toEqual([]);
    expect(plan.digest).toMatch(/^[0-9a-f]{12}$/);
  });

  it('相同输入生成相同摘要', () => {
    const a = computePlan(desired, empty(), null);
    const b = computePlan(desired, empty(), null);
    expect(a.digest).toBe(b.digest);
    expect(planDigest(installationId, a.actions)).toBe(a.digest);
  });

  it('操作变化时摘要变化', () => {
    const a = computePlan(desired, empty(), null);
    const changed = a.actions.map((x, i) =>
      i === 0 ? { ...x, action: 'reuse' as const } : x
    );
    expect(planDigest(installationId, changed)).not.toBe(a.digest);
    expect(planDigest('other-1a2b3c4d5e6f', a.actions)).not.toBe(a.digest);
  });

  it('存储桶已存在但没有本安装标记时停止', () => {
    const o = {
      ...empty(),
      r2: ['cloudforge-lfs'],
      r2Markers: { 'cloudforge-lfs': null },
    };
    expect(stopMessage(() => computePlan(desired, o, null))).toBe(
      notOurs('cloudforge-lfs')
    );
  });

  it('已记录预配意图时复用无标记的空存储桶，应用阶段写入标记', () => {
    const o = {
      ...empty(),
      r2: ['cloudforge-lfs'],
      r2Markers: { 'cloudforge-lfs': null },
      r2Empty: { 'cloudforge-lfs': true },
    };
    const s = recordStep(state(), 'provision-intent:lfs');
    expect(
      computePlan(desired, o, s).actions.find((a) => a.key === 'lfs')?.action
    ).toBe('reuse');
  });

  it('无预配意图时遇到无标记的空存储桶则停止', () => {
    const o = {
      ...empty(),
      r2: ['cloudforge-lfs'],
      r2Markers: { 'cloudforge-lfs': null },
      r2Empty: { 'cloudforge-lfs': true },
    };
    expect(stopMessage(() => computePlan(desired, o, state()))).toBe(
      notOurs('cloudforge-lfs')
    );
  });

  it('已记录预配意图但无标记的存储桶非空时停止并提示', () => {
    const o = {
      ...empty(),
      r2: ['cloudforge-lfs'],
      r2Markers: { 'cloudforge-lfs': null },
      r2Empty: { 'cloudforge-lfs': false },
    };
    const s = recordStep(state(), 'provision-intent:lfs');
    expect(stopMessage(() => computePlan(desired, o, s))).toBe(
      `${notOurs('cloudforge-lfs')} It may be the bucket this install created before it was interrupted; if it is empty, delete it and run --resume.`
    );
  });

  it('复用标记匹配的存储桶', () => {
    const o = {
      ...empty(),
      r2: ['cloudforge-lfs'],
      r2Markers: { 'cloudforge-lfs': marker('lfs') },
    };
    const plan = computePlan(desired, o, null);
    expect(plan.actions[1]).toEqual({
      action: 'reuse',
      kind: 'r2',
      key: 'lfs',
      name: 'cloudforge-lfs',
    });
  });

  it('比较标记的值而非原始文本', () => {
    const reordered = JSON.stringify({
      key: 'lfs',
      ownershipNonce,
      installationId,
    });
    const o = {
      ...empty(),
      r2: ['cloudforge-lfs'],
      r2Markers: { 'cloudforge-lfs': ` ${reordered}\n` },
    };
    expect(computePlan(desired, o, null).actions[1].action).toBe('reuse');
  });

  it('存储桶标记的随机数或键不同，或标记不是 JSON 时停止', () => {
    for (const body of [
      marker('lfs', 'x'.repeat(64)),
      marker('actionsLogs'),
      'not json',
      'null',
    ]) {
      const o = {
        ...empty(),
        r2: ['cloudforge-lfs'],
        r2Markers: { 'cloudforge-lfs': body },
      };
      expect(stopMessage(() => computePlan(desired, o, null))).toBe(
        notOurs('cloudforge-lfs')
      );
    }
  });

  it('已记录的存储桶缺少本安装标记时停止，因为标记证明归属', () => {
    const s = state();
    s.resources.push(
      rec(
        'actionsCache',
        'r2',
        'cloudforge-actions-cache',
        'cloudforge-actions-cache'
      )
    );
    const o = {
      ...empty(),
      r2: ['cloudforge-actions-cache'],
      r2Markers: { 'cloudforge-actions-cache': null },
    };
    expect(stopMessage(() => computePlan(desired, o, s))).toBe(
      notOurs('cloudforge-actions-cache')
    );
  });

  it('复用已记录且标记匹配的存储桶', () => {
    const s = state();
    s.resources.push(
      rec(
        'actionsCache',
        'r2',
        'cloudforge-actions-cache',
        'cloudforge-actions-cache'
      )
    );
    const o = {
      ...empty(),
      r2: ['cloudforge-actions-cache'],
      r2Markers: { 'cloudforge-actions-cache': marker('actionsCache') },
    };
    expect(computePlan(desired, o, s).actions[3].action).toBe('reuse');
  });

  it('已记录的 Worker 或工作流缺失时停止', () => {
    for (const r of [
      rec('worker', 'worker', 'cloudforge', 'cloudforge'),
      rec(
        'mergeWorkflow',
        'workflow',
        'cloudforge-merge-resolution',
        'cloudforge-merge-resolution'
      ),
    ]) {
      const s = state();
      s.resources.push(r);
      const msg = stopMessage(() => computePlan(desired, empty(), s));
      expect(msg).toContain('recorded but missing');
      expect(msg).toContain(r.name);
    }
  });

  it('两个工作流使用本安装名称时停止', () => {
    const o = {
      ...empty(),
      workflows: [
        { name: 'cloudforge-actions-run', scriptName: 'cloudforge' },
        { name: 'cloudforge-actions-run', scriptName: 'cloudforge' },
      ],
    };
    const msg = stopMessage(() => computePlan(desired, o, null));
    expect(msg).toContain('cloudforge-actions-run');
    expect(msg).toContain('Nothing was changed.');
  });

  it('状态属于其他安装时抛出普通错误，而非 PlanStop', () => {
    for (const s of [
      { ...state(), installationId: 'other-1a2b3c4d5e6f' },
      { ...state(), ownershipNonce: 'x'.repeat(64) },
    ]) {
      let err: unknown;
      try {
        computePlan(desired, empty(), s);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PlanStop);
    }
  });

  it('工作流绑定到其他脚本时停止', () => {
    const o = {
      ...empty(),
      workflows: [
        { name: 'cloudforge-actions-run', scriptName: 'someone-else' },
      ],
    };
    expect(stopMessage(() => computePlan(desired, o, null))).toBe(
      notOurs('cloudforge-actions-run')
    );
  });

  it('复用绑定到本安装 Worker 的工作流', () => {
    const o = {
      ...empty(),
      workflows: [
        { name: 'cloudforge-merge-resolution', scriptName: 'cloudforge' },
        { name: 'unrelated', scriptName: 'other' },
      ],
    };
    const plan = computePlan(desired, o, null);
    expect(plan.actions[5]).toEqual({
      action: 'reuse',
      kind: 'workflow',
      key: 'mergeWorkflow',
      name: 'cloudforge-merge-resolution',
    });
    expect(plan.actions[4].action).toBe('create');
  });

  it('已记录的资源缺失时停止', () => {
    const s = state();
    s.resources.push({
      key: 'lfs',
      kind: 'r2',
      name: 'cloudforge-lfs',
      id: 'cloudforge-lfs',
      ownership: 'created',
      state: 'ready',
    });
    const msg = stopMessage(() => computePlan(desired, empty(), s));
    expect(msg).toContain('recorded but missing');
    expect(msg).toContain('cloudforge-lfs');
  });

  it('已记录的 D1 数据库被其他同名数据库替换时停止', () => {
    const s = state();
    s.resources.push({
      key: 'd1',
      kind: 'd1',
      name: 'cloudforge-db',
      id: 'uuid-old',
      ownership: 'created',
      state: 'ready',
    });
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-new', name: 'cloudforge-db' }],
      d1Tables: { 'uuid-new': [] },
      d1InstallRow: { 'uuid-new': null },
    };
    expect(stopMessage(() => computePlan(desired, o, s))).toContain(
      'recorded but missing'
    );
  });

  it('复用记录中 UUID 相同的 D1 数据库', () => {
    const s = state();
    s.resources.push({
      key: 'd1',
      kind: 'd1',
      name: 'cloudforge-db',
      id: 'uuid-1',
      ownership: 'created',
      state: 'ready',
    });
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
      d1Tables: { 'uuid-1': ['users'] },
      d1InstallRow: { 'uuid-1': null },
    };
    expect(computePlan(desired, o, s).actions[0].action).toBe('reuse');
  });

  it('两个 D1 数据库使用本安装名称时停止', () => {
    const o = {
      ...empty(),
      d1: [
        { uuid: 'uuid-1', name: 'cloudforge-db' },
        { uuid: 'uuid-2', name: 'cloudforge-db' },
      ],
      d1Tables: { 'uuid-1': [], 'uuid-2': [] },
      d1InstallRow: { 'uuid-1': null, 'uuid-2': null },
    };
    const s = recordStep(state(), 'provision-intent:d1');
    const msg = stopMessage(() => computePlan(desired, o, s));
    expect(msg).toContain('cloudforge-db');
    expect(msg).toContain('Nothing was changed.');
  });

  it('已记录预配意图时接受同名空 D1 数据库', () => {
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
      d1Tables: { 'uuid-1': [] },
      d1InstallRow: { 'uuid-1': null },
    };
    const s = recordStep(state(), 'provision-intent:d1');
    expect(computePlan(desired, o, s).actions[0]).toEqual({
      action: 'reuse',
      kind: 'd1',
      key: 'd1',
      name: 'cloudforge-db',
    });
  });

  it('未记录预配意图时遇到同名空 D1 数据库则停止', () => {
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
      d1Tables: { 'uuid-1': [] },
      d1InstallRow: { 'uuid-1': null },
    };
    expect(stopMessage(() => computePlan(desired, o, state()))).toBe(
      notOurs('cloudforge-db')
    );
    expect(stopMessage(() => computePlan(desired, o, null))).toBe(
      notOurs('cloudforge-db')
    );
  });

  it('同名 D1 有表但没有匹配的 install_state 行时停止', () => {
    const s = recordStep(state(), 'provision-intent:d1');
    for (const row of [
      null,
      { installation_id: installationId, ownership_nonce: 'x'.repeat(64) },
      {
        installation_id: 'other-1a2b3c4d5e6f',
        ownership_nonce: ownershipNonce,
      },
    ]) {
      const o = {
        ...empty(),
        d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
        d1Tables: { 'uuid-1': ['users', 'install_state'] },
        d1InstallRow: { 'uuid-1': row },
      };
      expect(stopMessage(() => computePlan(desired, o, s))).toBe(
        notOurs('cloudforge-db')
      );
    }
  });

  it('复用 install_state 行匹配的同名 D1', () => {
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
      d1Tables: { 'uuid-1': ['users', 'install_state'] },
      d1InstallRow: {
        'uuid-1': {
          installation_id: installationId,
          ownership_nonce: ownershipNonce,
        },
      },
    };
    expect(computePlan(desired, o, null).actions[0].action).toBe('reuse');
  });

  it('现有 Worker 携带本安装标记时部署', () => {
    const o = {
      ...empty(),
      worker: {
        exists: true,
        vars: {
          CLOUDFORGE_INSTALLATION: JSON.stringify({
            ownershipNonce,
            installationId,
          }),
        },
      },
    };
    expect(computePlan(desired, o, null).actions[6]).toEqual({
      action: 'deploy',
      kind: 'worker',
      key: 'worker',
      name: 'cloudforge',
    });
  });

  it('现有 Worker 未携带本安装标记时停止', () => {
    for (const vars of [
      {} as Record<string, string>,
      { CLOUDFORGE_INSTALLATION: '' },
      { CLOUDFORGE_INSTALLATION: 'not json' },
      {
        CLOUDFORGE_INSTALLATION: JSON.stringify({
          installationId,
          ownershipNonce: 'x'.repeat(64),
        }),
      },
    ]) {
      const o = { ...empty(), worker: { exists: true, vars } };
      expect(stopMessage(() => computePlan(desired, o, null))).toBe(
        notOurs('cloudforge')
      );
    }
  });

  it('提示已有 Artifacts 命名空间', () => {
    const o = { ...empty(), artifactsNamespaces: ['other', 'cloudforge'] };
    expect(computePlan(desired, o, null).info).toEqual([
      'existing Artifacts namespace cloudforge reused',
    ]);
  });
});

describe('formatPlan：格式化计划', () => {
  it('formatPlan 以未作变更的提示结束', () => {
    const s = state();
    const plan = computePlan(
      desired,
      { ...empty(), artifactsNamespaces: ['cloudforge'] },
      null
    );
    const out = formatPlan(plan, s.inputs, s.baseUrl);
    const lines = out.split('\n');
    expect(lines.at(-1)).toBe(
      'No Cloudflare resource or local file was changed.'
    );
    expect(lines).toContain('create  d1        cloudforge-db');
    expect(lines).toContain('create  worker    cloudforge');
    expect(out).toContain('git.example.com');
    expect(out).toContain('https://git.example.com');
    expect(out).toContain('noreply@example.com');
    expect(out).toContain('existing Artifacts namespace cloudforge reused');
  });

  it('格式化没有发件人的 workers.dev 安装计划', () => {
    const plan = computePlan(desired, empty(), null);
    const out = formatPlan(
      plan,
      { name: 'cloudforge', hostname: null, workersDev: true, fromEmail: null },
      'https://cloudforge.acme.workers.dev'
    );
    expect(out).toContain('workers.dev');
    expect(out).toContain('https://cloudforge.acme.workers.dev');
    expect(out.split('\n').at(-1)).toBe(
      'No Cloudflare resource or local file was changed.'
    );
  });
});

describe('observe：观察资源状态', () => {
  it('仅读取本安装的资源和标记', async () => {
    const cf = fakeCloudflare({
      d1: [
        { uuid: 'uuid-1', name: 'cloudforge-db' },
        { uuid: 'uuid-2', name: 'other-db' },
      ],
      r2: {
        'cloudforge-lfs': { [MARKER_KEY]: marker('lfs') },
        'other-bucket': { [MARKER_KEY]: 'x' },
        'cloudforge-actions-logs': {},
        'cloudforge-actions-cache': { 'some/object': 'x' },
      },
      workflows: [{ name: 'cloudforge-actions-run', scriptName: 'cloudforge' }],
      workerVars: { cloudforge: { CLOUDFORGE_INSTALLATION: 'v' } },
      artifactsNamespaces: ['cloudforge'],
    });
    const o = await observe(cf, 'acc', names);
    expect(o.worker).toEqual({
      exists: true,
      vars: { CLOUDFORGE_INSTALLATION: 'v' },
    });
    expect(o.d1).toHaveLength(2);
    expect(o.d1Tables).toEqual({ 'uuid-1': [] });
    expect(o.d1InstallRow).toEqual({ 'uuid-1': null });
    expect(o.r2Markers).toEqual({
      'cloudforge-lfs': marker('lfs'),
      'cloudforge-actions-logs': null,
      'cloudforge-actions-cache': null,
    });
    // Emptiness is read only for our unmarked buckets.
    expect(o.r2Empty).toEqual({
      'cloudforge-actions-logs': true,
      'cloudforge-actions-cache': false,
    });
    expect(o.workflows).toEqual([
      { name: 'cloudforge-actions-run', scriptName: 'cloudforge' },
    ]);
    expect(o.artifactsNamespaces).toEqual(['cloudforge']);
    const queried = cf.calls.filter((c) => c.method === 'queryD1');
    expect(queried.map((c) => c.args[1])).toEqual(['uuid-1']);
    // No install_state table, so no row query.
    expect(queried[0].args[2]).toBe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' " +
        "AND name NOT IN ('sqlite_sequence','d1_migrations')"
    );
    const markers = cf.calls.filter((c) => c.method === 'getR2Object');
    expect(markers.map((c) => c.args.slice(1))).toEqual([
      ['cloudforge-lfs', MARKER_KEY],
      ['cloudforge-actions-logs', MARKER_KEY],
      ['cloudforge-actions-cache', MARKER_KEY],
    ]);
  });

  it('install_state 表存在时读取其中的记录', async () => {
    const cf = fakeCloudflare({
      d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
    });
    const row = {
      installation_id: installationId,
      ownership_nonce: ownershipNonce,
    };
    cf.queryD1 = async (_a, _id, sql) =>
      sql.includes('sqlite_master')
        ? [{ name: 'users' }, { name: 'install_state' }]
        : [row];
    const o = await observe(cf, 'acc', names);
    expect(o.d1Tables).toEqual({ 'uuid-1': ['users', 'install_state'] });
    expect(o.d1InstallRow).toEqual({ 'uuid-1': row });
  });

  it('报告缺失的 Worker', async () => {
    const o = await observe(fakeCloudflare(), 'acc', names);
    expect(o.worker).toEqual({ exists: false, vars: null });
  });
});

describe('computePlan：已接管资源', () => {
  const adopted = (
    key: string,
    kind: Resource['kind'],
    name: string,
    id: string
  ): Resource => ({ ...rec(key, kind, name, id), ownership: 'adopted' });
  const withRes = (...r: Resource[]) => {
    const s = state();
    s.resources.push(...r);
    return s;
  };

  it('复用没有安装记录的已接管 D1', () => {
    const s = withRes(adopted('d1', 'd1', 'cloudforge-db', 'uuid-1'));
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-1', name: 'cloudforge-db' }],
      d1Tables: { 'uuid-1': ['repositories'] },
      d1InstallRow: { 'uuid-1': null },
    };
    expect(computePlan(desired, o, s).actions[0].action).toBe('reuse');
  });

  const buckets: [string, string, number][] = [
    ['lfs', 'cloudforge-lfs', 1],
    ['actionsLogs', 'cloudforge-actions-logs', 2],
    ['actionsCache', 'cloudforge-actions-cache', 3],
  ];
  for (const [key, name, i] of buckets) {
    it(`复用没有标记的已接管 R2（${key}）`, () => {
      const s = withRes(adopted(key, 'r2', name, name));
      const o = {
        ...empty(),
        r2: [name],
        r2Markers: { [name]: null },
        r2Empty: { [name]: false },
      };
      expect(computePlan(desired, o, s).actions[i].action).toBe('reuse');
    });
  }

  it('复用绑定在其他位置的已接管工作流', () => {
    const s = withRes(
      adopted(
        'actionsWorkflow',
        'workflow',
        'cloudforge-actions-run',
        'cloudforge-actions-run'
      ),
      adopted(
        'mergeWorkflow',
        'workflow',
        'cloudforge-merge-resolution',
        'cloudforge-merge-resolution'
      )
    );
    const o = {
      ...empty(),
      workflows: [
        { name: 'cloudforge-actions-run', scriptName: 'other' },
        { name: 'cloudforge-merge-resolution', scriptName: 'other' },
      ],
    };
    const a = computePlan(desired, o, s).actions;
    expect(a[4].action).toBe('reuse');
    expect(a[5].action).toBe('reuse');
  });

  it('部署不带 CLOUDFORGE_INSTALLATION 的已接管 Worker', () => {
    const s = withRes(adopted('worker', 'worker', 'cloudforge', 'cloudforge'));
    const o = { ...empty(), worker: { exists: true, vars: {} } };
    expect(computePlan(desired, o, s).actions[6].action).toBe('deploy');
  });

  it('已接管资源 ID 不匹配时停止', () => {
    const s = withRes(adopted('d1', 'd1', 'cloudforge-db', 'uuid-old'));
    const o = {
      ...empty(),
      d1: [{ uuid: 'uuid-new', name: 'cloudforge-db' }],
    };
    expect(stopMessage(() => computePlan(desired, o, s))).toContain(
      '`cloudforge-db` is recorded as adopted'
    );
  });

  it('已接管 R2、工作流和 Worker 的记录 ID 不同时停止', () => {
    const cases: [Resource, Partial<Observed>][] = [
      [
        adopted('lfs', 'r2', 'cloudforge-lfs', 'old-bucket'),
        { r2: ['cloudforge-lfs'] },
      ],
      [
        adopted('actionsWorkflow', 'workflow', 'cloudforge-actions-run', 'old'),
        {
          workflows: [{ name: 'cloudforge-actions-run', scriptName: 'x' }],
        },
      ],
      [
        adopted('worker', 'worker', 'cloudforge', 'old-script'),
        { worker: { exists: true, vars: {} } },
      ],
    ];
    for (const [r, o] of cases) {
      expect(
        stopMessage(() =>
          computePlan(desired, { ...empty(), ...o }, withRes(r))
        )
      ).toContain(`\`${r.name}\` is recorded as adopted`);
    }
  });

  it('Cloudflare 中缺少已接管资源时按资源缺失停止', () => {
    const s = withRes(adopted('worker', 'worker', 'cloudforge', 'cloudforge'));
    expect(stopMessage(() => computePlan(desired, empty(), s))).toContain(
      'recorded but missing'
    );
  });
});
