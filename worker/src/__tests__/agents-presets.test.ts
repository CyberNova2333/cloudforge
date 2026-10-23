// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { AGENT_PATH, parseAgentConfig } from '../agents/config';
import {
  AGENT_PALETTE,
  agentColor,
  guardedOf,
  isGuarded,
  PRESET_FACETS,
  PRESETS,
  presetAgentMd,
} from '../agents/presets';
import { decoder } from '../git/bytes';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';
import {
  agentRepo,
  agentRow,
  newAgent,
  type AgentJson,
} from './helpers/agents';

type PresetJson = {
  facet: string;
  name: string;
  handle: string;
  bio: string;
  color: string;
  guarded: boolean;
  triggerAsk: string;
  triggerAbove: number;
  engine: 'pass' | 'pi';
  recommended: boolean;
  exists: boolean;
};

type CrewJson = {
  created: AgentJson[];
  skipped: { handle: string; reason: string }[];
};

const HANDLES = [
  'securityagent',
  'dataagent',
  'speedagent',
  'featuresagent',
  'reliabilityagent',
  'privacyagent',
  'shippingagent',
];

const COLORS = {
  security: '#2a78d6',
  data: '#199e70',
  speed: '#c98500',
  features: '#d55181',
  reliability: '#008300',
  privacy: '#6b5cc9',
  shipping: '#55606e',
};

async function presets(t: ReturnType<typeof makeEnv>, cookie: string) {
  const res = await call(t, '/api/agents/presets', { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as PresetJson[];
}

/** AGENT.md on the agent repository's main. */
async function agentMdOf(t: ReturnType<typeof makeEnv>, handle: string) {
  const repo = await agentRepo(t, handle);
  const head = repo.refs.get('refs/heads/main')!;
  const tree = repo.parseTree(repo.parseCommit(head)!.treeHash)!;
  const entry = tree.find((e) => e.name === AGENT_PATH)!;
  return decoder.decode(repo.objects.get(entry.hash)!.data);
}

describe('七种预设', () => {
  it('包含七个领域及其标识名、颜色、保护状态和引擎', () => {
    expect(PRESET_FACETS).toEqual([
      'security',
      'data',
      'speed',
      'features',
      'reliability',
      'privacy',
      'shipping',
    ]);
    expect(PRESET_FACETS.map((f) => PRESETS[f].handle)).toEqual(HANDLES);
    for (const facet of PRESET_FACETS) {
      const p = PRESETS[facet];
      expect(p.facet).toBe(facet);
      expect(p.color).toBe(COLORS[facet]);
      expect(p.guarded).toBe(facet === 'security' || facet === 'data');
      expect(p.engine).toBe(facet === 'security' ? 'pi' : 'pass');
      expect(p.triggerAbove).toBe(0.4);
      expect(p.recommended).toBe(true);
    }
    expect(PRESETS.security).toMatchObject({
      name: 'Security',
      bio: 'Makes sure nobody gets in who shouldn’t, and nothing leaks.',
    });
    expect(PRESETS.shipping.name).toBe('Shipping');
  });

  it('每种预设生成的 AGENT.md 均可解析回原预设', () => {
    for (const facet of PRESET_FACETS) {
      const p = PRESETS[facet];
      const config = parseAgentConfig(presetAgentMd(p, p.handle, p.name));
      expect(config).toMatchObject({
        name: p.name,
        bio: p.bio,
        trigger: { ask: p.triggerAsk, above: 0.4 },
        engine: p.engine,
        color: p.color,
        facet,
        guarded: p.guarded,
      });
      expect(config.instructions).toContain(`## How ${p.name} reviews`);
      expect(config.instructions).toContain('## When to raise something');
      expect(config.instructions).toContain('## Rules learned from dismissals');
    }
  });
});

describe('isGuarded 保护状态判断', () => {
  it('保护标记为 guarded 的智能体以及所有安全或数据领域智能体', () => {
    expect(isGuarded({ guarded: true, facet: 'speed' })).toBe(true);
    expect(isGuarded({ guarded: false, facet: 'security' })).toBe(true);
    expect(isGuarded({ guarded: false, facet: 'data' })).toBe(true);
    expect(isGuarded({ guarded: false, facet: 'privacy' })).toBe(false);
    expect(isGuarded({ guarded: false, facet: null })).toBe(false);
  });
});

describe('guardedOf 有效保护状态', () => {
  it('返回 AGENT.md 对应的 agents.guarded 存储值，与 isGuarded 结果一致', () => {
    expect(guardedOf({ facet: 'security' })).toBe(true);
    expect(guardedOf({ facet: 'data', guarded: false })).toBe(true);
    expect(guardedOf({ facet: 'speed', guarded: true })).toBe(true);
    expect(guardedOf({ facet: 'speed' })).toBe(false);
    expect(guardedOf({})).toBe(false);
  });
});

describe('agentColor 智能体颜色', () => {
  it('使用 AGENT.md 中的颜色，否则从调色板选择稳定颜色', () => {
    expect(agentColor({ color: '#123456' }, 'docsagent')).toBe('#123456');
    const fallback = agentColor({ color: null }, 'docsagent');
    expect(AGENT_PALETTE).toContain(fallback);
    expect(agentColor({ color: null }, 'docsagent')).toBe(fallback);
  });

  it('标识名匹配预设时回退到预设颜色，不区分大小写', () => {
    for (const facet of PRESET_FACETS) {
      const p = PRESETS[facet];
      expect(agentColor({ color: null }, p.handle)).toBe(p.color);
      expect(agentColor({ color: null }, p.handle.toUpperCase())).toBe(p.color);
    }
    // AGENT.md's own colour still wins.
    expect(agentColor({ color: '#123456' }, 'securityagent')).toBe('#123456');
  });
});

describe('GET /api/agents/presets 智能体预设', () => {
  it('向所有成员列出七种预设，并标记已存在项', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    const before = await presets(t, bob);
    expect(before.map((p) => p.handle)).toEqual(HANDLES);
    expect(before.every((p) => !p.exists)).toBe(true);
    expect(before[0]).toEqual({
      facet: 'security',
      name: 'Security',
      handle: 'securityagent',
      bio: PRESETS.security.bio,
      color: '#2a78d6',
      guarded: true,
      triggerAsk: PRESETS.security.triggerAsk,
      triggerAbove: 0.4,
      engine: 'pi',
      recommended: true,
      exists: false,
    });
    await newAgent(t, admin, 'securityagent', 'Security');
    const after = await presets(t, bob);
    expect(after.filter((p) => p.exists).map((p) => p.handle)).toEqual([
      'securityagent',
    ]);
  });
});

describe('POST /api/admin/agents 使用预设创建智能体', () => {
  it('写入预设 AGENT.md，并缓存颜色、领域和保护状态', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const res = await call(t, '/api/admin/agents', {
      cookie: admin,
      json: { preset: 'data' },
    });
    expect(res.status).toBe(201);
    const { agent } = (await res.json()) as { agent: AgentJson };
    expect(agent).toMatchObject({
      username: 'dataagent',
      name: 'Data',
      bio: PRESETS.data.bio,
      trigger: { ask: PRESETS.data.triggerAsk, above: 0.4 },
      engine: 'pass',
      color: '#199e70',
      facet: 'data',
      guarded: true,
      repository: 'dataagent/dataagent',
    });
    expect(await agentMdOf(t, 'dataagent')).toBe(
      presetAgentMd(PRESETS.data, 'dataagent', 'Data')
    );
    expect(await agentRow(t, 'dataagent')).toMatchObject({
      color: '#199e70',
      facet: 'data',
      guarded: 1,
    });
  });

  it('允许为预设指定其他标识名和名称', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const res = await call(t, '/api/admin/agents', {
      cookie: admin,
      json: { preset: 'security', handle: 'appsec', name: 'App Security' },
    });
    expect(res.status).toBe(201);
    const { agent } = (await res.json()) as { agent: AgentJson };
    expect(agent).toMatchObject({
      username: 'appsec',
      name: 'App Security',
      engine: 'pi',
      color: '#2a78d6',
      facet: 'security',
      guarded: true,
    });
    expect(await agentMdOf(t, 'appsec')).toContain(
      '## How App Security reviews'
    );
  });

  it('拒绝未知预设，以及缺少标识名和名称的空白智能体', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    for (const json of [
      { preset: 'ops' },
      { preset: 'other' },
      { handle: 'docsagent' },
      { name: 'Docs' },
      {},
    ]) {
      const res = await call(t, '/api/admin/agents', { cookie: admin, json });
      expect(res.status, JSON.stringify(json)).toBe(400);
    }
    expect(t.fake.repos.size).toBe(0);
  });

  it('为空白智能体设置 other 领域、无保护状态和调色板颜色', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin, 'docsagent', 'Docs');
    expect(agent).toMatchObject({ facet: 'other', guarded: false });
    expect(AGENT_PALETTE).toContain(agent.color);
  });
});

describe('POST /api/admin/agents/crew 创建推荐团队', () => {
  it('为每个尚不存在的推荐预设创建一次智能体', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/admin/agents', {
      cookie: admin,
      json: { preset: 'data' },
    });
    const first = await call(t, '/api/admin/agents/crew', {
      cookie: admin,
      method: 'POST',
    });
    expect(first.status).toBe(200);
    const crew = (await first.json()) as CrewJson;
    expect(crew.created.map((a) => a.username)).toEqual(
      HANDLES.filter((h) => h !== 'dataagent')
    );
    expect(crew.skipped).toEqual([
      { handle: 'dataagent', reason: expect.any(String) },
    ]);
    expect(
      crew.created.find((a) => a.username === 'securityagent')
    ).toMatchObject({ engine: 'pi', guarded: true, color: '#2a78d6' });
    // Seven agent repositories now; a second run creates nothing.
    expect(t.fake.repos.size).toBe(7);
    const again = (await (
      await call(t, '/api/admin/agents/crew', { cookie: admin, method: 'POST' })
    ).json()) as CrewJson;
    expect(again.created).toEqual([]);
    expect(again.skipped.map((s) => s.handle)).toEqual(HANDLES);
    expect(t.fake.repos.size).toBe(7);
    expect((await presets(t, admin)).every((p) => p.exists)).toBe(true);
    // The stored guard is the effective one: SQL filters on agents.guarded agree with isGuarded.
    const { results } = await t.env.DB.prepare(
      'SELECT a.facet, a.guarded FROM agents a ORDER BY a.facet'
    ).all<{ facet: string; guarded: number }>();
    expect(
      results.map((r) => [r.facet, r.guarded]).filter(([, g]) => g === 1)
    ).toEqual([
      ['data', 1],
      ['security', 1],
    ]);
  });

  it('跳过他人已占用的标识名', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'speedagent');
    const crew = (await (
      await call(t, '/api/admin/agents/crew', { cookie: admin, method: 'POST' })
    ).json()) as CrewJson;
    expect(crew.created).toHaveLength(6);
    expect(crew.skipped.map((s) => s.handle)).toEqual(['speedagent']);
  });

  it('仅允许站点管理员访问', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    const res = await call(t, '/api/admin/agents/crew', {
      cookie: bob,
      method: 'POST',
    });
    expect(res.status).toBe(403);
    expect(t.fake.repos.size).toBe(0);
  });
});
