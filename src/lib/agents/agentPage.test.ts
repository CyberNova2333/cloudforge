// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  avatarStatusOf,
  cardStats,
  crewResultText,
  engineText,
  groupAgents,
  handleProblem,
  inviteChoices,
  latestNote,
  lessonTone,
  listNames,
  overallStatus,
  parseProfileTab,
  presetState,
  thresholdText,
  wakeText,
  whereText,
} from './agentPage';
import type {
  Agent,
  AgentPreset,
  AgentStats,
  CrewResult,
  Repo,
} from '../api/uiApi';

const agent = (handle: string, extra: Partial<Agent> = {}): Agent => ({
  id: `id-${handle}`,
  username: handle,
  reviewLanguage: 'en',
  name: handle,
  image: null,
  bio: '',
  trigger: { ask: 'Anything?', above: 0.4 },
  engine: 'pass',
  color: '#2a78d6',
  facet: null,
  guarded: false,
  repository: `${handle}/${handle}`,
  configSha: null,
  configError: null,
  createdAt: '2026-10-01T00:00:00Z',
  deletedAt: null,
  ...extra,
});

const stats = (
  handle: string,
  repos: AgentStats['repos'],
  extra: Partial<AgentStats> = {}
): AgentStats => ({
  handle,
  raised: 0,
  kept: 0,
  dismissed: 0,
  keptPct: null,
  rules: 0,
  reviews: 0,
  byDay: [],
  bestCatch: null,
  repos,
  ...extra,
});

describe('overallStatus：总体状态', () => {
  it('没有仓库或拉取请求时为空闲', () => {
    expect(overallStatus([])).toBe('idle');
    expect(overallStatus([{ status: 'idle' }, { status: 'idle' }])).toBe(
      'idle'
    );
  });
  it('取所有仓库中最紧迫的状态', () => {
    expect(
      overallStatus([{ status: 'approved' }, { status: 'reviewing' }])
    ).toBe('reviewing');
    expect(
      overallStatus([{ status: 'reviewing' }, { status: 'flagged' }])
    ).toBe('flagged');
    expect(
      overallStatus([{ status: 'flagged' }, { status: 'changes_requested' }])
    ).toBe('changes_requested');
    expect(
      overallStatus([{ status: 'changes_requested' }, { status: 'failed' }])
    ).toBe('failed');
    expect(overallStatus([{ status: 'idle' }, { status: 'approved' }])).toBe(
      'approved'
    );
  });
  it('忽略表示未参与拉取请求的状态', () => {
    expect(overallStatus([{ status: 'not_needed' }])).toBe('idle');
  });
});

describe('avatarStatusOf：头像状态', () => {
  it('已删除或未加入任何仓库时休眠，否则展示当前活动', () => {
    expect(avatarStatusOf({ deleted: true, repos: 2, status: 'flagged' })).toBe(
      'off'
    );
    expect(avatarStatusOf({ repos: 0, status: 'idle' })).toBe('off');
    expect(avatarStatusOf({ repos: 1, status: 'idle' })).toBe('idle');
    expect(avatarStatusOf({ repos: 1, status: 'flagged' })).toBe('flagged');
  });
});

describe('groupAgents：代理分组', () => {
  const a = agent('aagent');
  const b = agent('bagent');
  const c = agent('cagent');
  it('将加入可见仓库的代理归为评审中，其余归为可用', () => {
    const groups = groupAgents(
      [a, b, c],
      new Map([
        [
          'aagent',
          stats('aagent', [{ repo: 'o/r', status: 'idle', number: null }]),
        ],
        ['bagent', stats('bagent', [])],
        [
          'cagent',
          stats('cagent', [{ repo: 'o/s', status: 'approved', number: 3 }]),
        ],
      ])
    );
    expect(groups.reviewing.map((x) => x.username)).toEqual([
      'aagent',
      'cagent',
    ]);
    expect(groups.available.map((x) => x.username)).toEqual(['bagent']);
  });
  it('无法读取记录的代理仍保留在评审者中，避免隐藏其工作位置', () => {
    const groups = groupAgents([a], new Map());
    expect(groups.reviewing).toHaveLength(1);
    expect(groups.available).toHaveLength(0);
  });
});

describe('cardStats：卡片统计', () => {
  it('显示提出的问题数、保留比例和学到的规则数', () => {
    expect(
      cardStats(stats('x', [], { raised: 12, keptPct: 75, rules: 2 }))
    ).toEqual([
      { value: '12', label: 'raised' },
      { value: '75%', label: 'kept' },
      { value: '2', label: 'rules' },
    ]);
  });
  it('无人作出决定的比例显示短横线，一条规则使用单数', () => {
    expect(cardStats(stats('x', [], { raised: 3, rules: 1 }))).toEqual([
      { value: '3', label: 'raised' },
      { value: '—', label: 'kept' },
      { value: '1', label: 'rule' },
    ]);
  });
  it('记录未知时显示短横线', () => {
    expect(cardStats(undefined)).toEqual([
      { value: '—', label: 'raised' },
      { value: '—', label: 'kept' },
      { value: '—', label: 'rules' },
    ]);
  });
});

describe('whereText：工作位置说明', () => {
  it('显示单个仓库名、多个仓库数或未加入仓库', () => {
    expect(whereText(undefined)).toBe('Record unavailable');
    expect(whereText(stats('x', []))).toBe(
      'Add it to a repository from its profile'
    );
    expect(
      whereText(stats('x', [{ repo: 'o/r', status: 'idle', number: null }]))
    ).toBe('Reviews o/r');
    expect(
      whereText(
        stats('x', [
          { repo: 'o/r', status: 'idle', number: null },
          { repo: 'o/s', status: 'idle', number: null },
        ])
      )
    ).toBe('Reviews 2 repositories');
  });
});

describe('parseProfileTab：解析资料页标签', () => {
  it('从地址读取标签，失败时回退到概览', () => {
    expect(parseProfileTab('reviews')).toBe('reviews');
    expect(parseProfileTab('rules')).toBe('rules');
    expect(parseProfileTab('config')).toBe('config');
    expect(parseProfileTab('overview')).toBe('overview');
    expect(parseProfileTab('nope')).toBe('overview');
    expect(parseProfileTab(null)).toBe('overview');
  });
});

const repo = (
  fullName: string,
  extra: Partial<Repo> & { ownerId?: string } = {}
): Repo => {
  const [o, n] = fullName.split('/');
  const { ownerId, ...rest } = extra;
  return {
    id: `r-${fullName}`,
    owner: { id: ownerId ?? `u-${o}`, username: o, name: o, image: null },
    ownerType: 'user',
    visibility: 'internal',
    name: n,
    fullName,
    description: null,
    defaultBranch: 'main',
    protectedBranches: [],
    deleteMergedBranches: false,
    hasIssues: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...rest,
  };
};

describe('inviteChoices：邀请选项', () => {
  const repos = [
    repo('zoe/site'),
    repo('mia/app'),
    repo('mia/tools'),
    repo('team/shared', { ownerType: 'team', ownerId: 't-1' }),
    repo('securityagent/securityagent'),
  ];
  const opts = {
    invited: [] as string[],
    agentRepos: ['securityagent/securityagent'],
  };
  it('为站点管理员列出排序后的未加入仓库，排除代理自己的仓库', () => {
    expect(
      inviteChoices(repos, {
        ...opts,
        invited: ['mia/app'],
        me: { id: 'x', role: 'admin' },
      }).map((r) => r.fullName)
    ).toEqual(['mia/tools', 'team/shared', 'zoe/site']);
  });
  it('为其他人列出其拥有的仓库', () => {
    expect(
      inviteChoices(repos, { ...opts, me: { id: 'u-mia', role: 'user' } }).map(
        (r) => r.fullName
      )
    ).toEqual(['mia/app', 'mia/tools']);
  });
  it('匹配已邀请的仓库时忽略大小写', () => {
    expect(
      inviteChoices(repos, {
        ...opts,
        invited: ['MIA/App'],
        me: { id: 'u-mia', role: 'user' },
      }).map((r) => r.fullName)
    ).toEqual(['mia/tools']);
  });
  it('无人登录时不提供选项', () => {
    expect(inviteChoices(repos, { ...opts, me: null })).toEqual([]);
  });
});

describe('wakeText 和 engineText：触发条件与引擎说明', () => {
  it('以整数百分比说明 Clef 所需的置信度', () => {
    expect(wakeText({ ask: 'x', above: 0.4 })).toBe(
      'Wakes when Clef is 40% sure'
    );
    expect(wakeText({ ask: 'x', above: 0.35 })).toBe(
      'Wakes when Clef is 35% sure'
    );
  });
  it('说明设置中的阈值', () => {
    expect(thresholdText({ above: 0.4 })).toBe(
      'At least 40% sure that the answer is yes'
    );
  });
  it('描述两种引擎', () => {
    expect(engineText('pass')).toBe('One reasoning-model pass per review');
    expect(engineText('pi')).toBe(
      'A Pi agent that reads the repository with read-only tools'
    );
  });
});

describe('listNames：名称列表', () => {
  it('按自然句式连接名称', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Security'])).toBe('Security');
    expect(listNames(['Security', 'Data'])).toBe('Security and Data');
    expect(listNames(['Security', 'Data', 'Speed'])).toBe(
      'Security, Data and Speed'
    );
  });
});

describe('crewResultText：团队创建结果', () => {
  const created = (n: string) => agent(n.toLowerCase() + 'agent', { name: n });
  it('列出新增和跳过的代理及原因', () => {
    const r: CrewResult = {
      created: [created('Security'), created('Data')],
      skipped: [{ handle: 'speedagent', reason: 'Already exists' }],
    };
    expect(crewResultText(r)).toEqual({
      added: 'Added Security and Data.',
      skipped: ['@speedagent: Already exists'],
    });
  });
  it('所有代理都已存在时说明情况', () => {
    expect(
      crewResultText({
        created: [],
        skipped: [{ handle: 'speedagent', reason: 'Already exists' }],
      }).added
    ).toBeNull();
  });
});

describe('handleProblem：账号名问题', () => {
  it('接受符合用户名规则的账号名', () => {
    expect(handleProblem('accessibility')).toBeNull();
    expect(handleProblem('my-agent2')).toBeNull();
  });
  it('用易懂的文字说明问题', () => {
    expect(handleProblem('')).toBe('Give the agent a handle.');
    expect(handleProblem('has space')).toBe(
      'Use letters, numbers and single hyphens only.'
    );
    expect(handleProblem('-lead')).toBe(
      'Use letters, numbers and single hyphens only.'
    );
    expect(handleProblem('trail-')).toBe(
      'Use letters, numbers and single hyphens only.'
    );
    expect(handleProblem('dou--ble')).toBe(
      'Use letters, numbers and single hyphens only.'
    );
    expect(handleProblem('a'.repeat(40))).toBe(
      'A handle can be at most 39 characters.'
    );
  });
});

describe('presetState：预设状态', () => {
  const preset = (handle: string, exists: boolean): AgentPreset => ({
    facet: 'security',
    name: 'Security',
    handle,
    bio: '',
    color: '#2a78d6',
    guarded: true,
    triggerAsk: '?',
    triggerAbove: 0.4,
    engine: 'pi',
    recommended: true,
    exists,
  });
  it('账号名空闲时可以创建', () => {
    expect(presetState(preset('securityagent', false), new Set())).toBe(
      'create'
    );
  });
  it('账号名由代理持有时视为已创建，由其他对象持有时视为已占用', () => {
    expect(
      presetState(preset('securityagent', true), new Set(['securityagent']))
    ).toBe('created');
    expect(presetState(preset('securityagent', true), new Set())).toBe('taken');
  });
});

describe('latestNote：最新记录说明', () => {
  it('说明受数量限制的列表展示了总量中的多少项', () => {
    expect(latestNote(10, 143, 'review')).toBe('Latest 10 of 143 reviews');
    expect(latestNote(4, 4, 'review')).toBe('All 4 reviews');
    expect(latestNote(1, 1, 'review')).toBe('1 review');
  });
  it('总数未知时不声称已展示全部', () => {
    expect(latestNote(10, undefined, 'review')).toBe('Latest 10 reviews');
    expect(latestNote(1, undefined, 'lesson')).toBe('Latest 1 lesson');
  });
});

describe('lessonTone：学习状态色调', () => {
  it('已学习为成功、处理中为提示、失败为严重，其余为低调色调', () => {
    expect(lessonTone('committed')).toBe('good');
    expect(lessonTone('learning')).toBe('info');
    expect(lessonTone('failed')).toBe('critical');
    expect(lessonTone('pending')).toBe('off');
    expect(lessonTone('nothing')).toBe('off');
  });
});
