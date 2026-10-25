// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  brokenRepos,
  dateEyebrow,
  decisionsOf,
  healthState,
  homeHeadline,
  homeLede,
  isNotable,
  mergeActivity,
  repoVerdict,
  sinceLastWeek,
  topByActivity,
} from './home';
import { boardRows } from './board';
import type {
  ApprovalItem,
  AuditEvent,
  HealthArea,
  HealthReport,
  RepoStats,
  RepoWithStats,
  ReviewFlag,
} from './uiApi';

const flag = (id: string, over: Partial<ReviewFlag> = {}): ReviewFlag => ({
  id,
  kind: 'needs_person',
  title: `Finding ${id}`,
  paths: [],
  detail: null,
  detailModel: null,
  agentSha: null,
  approvedBy: null,
  approvedAt: null,
  approvedVia: null,
  changesRequestedBy: null,
  changesRequestedAt: null,
  changesRequestedNote: null,
  question: `Question ${id}?`,
  guarded: false,
  assignee: null,
  decidedVia: null,
  reason: null,
  teach: null,
  ...over,
});

const item = (n: number, flags: ReviewFlag[]): ApprovalItem => ({
  repo: { fullName: 'a/b', name: 'b' },
  pull: {
    number: n,
    title: `PR ${n}`,
    author: null,
    updatedAt: '2026-10-09T00:00:00Z',
    headSha: 'abc',
    createdVia: null,
    sessionLabel: null,
    sessionId: 'sess-1',
  },
  reviewFailed: null,
  resolutionFailed: null,
  needsApproval: false,
  agents: [
    {
      reviewerId: `r${n}`,
      agent: { id: 'x', username: 'dataagent', name: 'Data', image: null },
      status: 'flagged',
      error: null,
      flags,
    },
  ],
  pullState: null,
  stackStale: [],
  stackUnchecked: [],
});

describe('decisionsOf：待决定项', () => {
  it('列出包含面向所有者的明确问题且尚未关闭的记录', () => {
    const ds = decisionsOf(
      [
        item(1, [flag('a'), flag('b', { question: null })]),
        item(2, [flag('c', { question: '  ' }), flag('d')]),
      ],
      'me'
    );
    expect(ds.map((d) => d.flag.id)).toEqual(['a', 'd']);
    expect(ds[0].item.pull.number).toBe(1);
    expect(ds[0].agent.agent.username).toBe('dataagent');
  });

  it('跳过修改要求和已决定的问题', () => {
    const ds = decisionsOf(
      [
        item(1, [
          flag('a', { kind: 'change_requested' }),
          flag('b', { approvedAt: '2026-10-09T00:00:00Z' }),
          flag('c'),
        ]),
      ],
      'me'
    );
    expect(ds.map((d) => d.flag.id)).toEqual(['c']);
  });

  it('分配给当前用户的排最前，分配给其他人的排最后', () => {
    const person = (login: string) => ({
      login,
      name: null,
      isAgent: false,
      color: null,
    });
    const ds = decisionsOf(
      [
        item(1, [
          flag('other', { assignee: person('cho') }),
          flag('nobody'),
          flag('mine', { assignee: person('me') }),
        ]),
      ],
      'me'
    );
    expect(ds.map((d) => d.flag.id)).toEqual(['mine', 'nobody', 'other']);
  });
});

describe('homeHeadline：首页标题', () => {
  const fine = { kind: 'fine', checked: 3, total: 3 } as const;

  it('所有仓库都已检查且没有故障时说明一切正常', () => {
    const h = (decisions: number, others: number) =>
      homeHeadline({ decisions, others, health: fine });
    expect(h(1, 3)).toBe(
      'Nothing is broken. 1 decision and 3 other items need you.'
    );
    expect(h(1, 0)).toBe('Nothing is broken. 1 decision needs you.');
    expect(h(2, 0)).toBe('Nothing is broken. 2 decisions need you.');
    expect(h(0, 1)).toBe('Nothing is broken. 1 item needs you.');
    expect(h(0, 4)).toBe('Nothing is broken. 4 items need you.');
    expect(h(0, 0)).toBe('Nothing is broken. Nothing needs you.');
  });

  it('还有其他仓库时仅描述已检查的范围', () => {
    expect(
      homeHeadline({
        decisions: 1,
        others: 0,
        health: { kind: 'fine', checked: 3, total: 7 },
      })
    ).toBe(
      'Nothing is broken in your 3 busiest repositories. 1 decision needs you.'
    );
    expect(
      homeHeadline({
        decisions: 0,
        others: 0,
        health: { kind: 'fine', checked: 1, total: 2 },
      })
    ).toBe('Nothing is broken in your busiest repository. Nothing needs you.');
  });

  it('有失败时指出失败项', () => {
    expect(
      homeHeadline({
        decisions: 0,
        others: 0,
        health: { kind: 'failing', repos: ['a/one', 'a/two'] },
      })
    ).toBe('Tests are failing on a/one and a/two. Nothing needs you.');
  });

  it('无法读取健康状况时不作结论', () => {
    expect(
      homeHeadline({
        decisions: 1,
        others: 0,
        health: { kind: 'unavailable' },
      })
    ).toBe('1 decision needs you.');
    expect(
      homeHeadline({
        decisions: 0,
        others: 0,
        health: { kind: 'unavailable' },
      })
    ).toBe('Nothing needs you.');
  });

  it('加载期间不显示结论', () => {
    expect(
      homeHeadline({ decisions: 1, others: 0, health: { kind: 'loading' } })
    ).toBeNull();
  });
});

describe('healthState：健康状态', () => {
  const base = {
    loading: false,
    unavailable: false,
    total: 5,
    checked: 3,
    pending: 0,
    failed: 0,
    failing: [] as string[],
  };

  it('看板、代理和所有报告都完成处理前保持加载状态', () => {
    expect(healthState({ ...base, loading: true })).toEqual({
      kind: 'loading',
    });
    expect(healthState({ ...base, pending: 1 })).toEqual({ kind: 'loading' });
    // Even a repository already known to fail waits for the others, so the sentence does not grow.
    expect(healthState({ ...base, pending: 1, failing: ['a/b'] })).toEqual({
      kind: 'loading',
    });
  });

  it('仅对已检查的仓库判定正常', () => {
    expect(healthState(base)).toEqual({ kind: 'fine', checked: 3, total: 5 });
    expect(healthState({ ...base, total: 0, checked: 0 })).toEqual({
      kind: 'fine',
      checked: 0,
      total: 0,
    });
  });

  it('无论其他失败情况如何都报告测试失败', () => {
    expect(healthState({ ...base, failing: ['a/b'], failed: 1 })).toEqual({
      kind: 'failing',
      repos: ['a/b'],
    });
  });

  it('报告或列表无法读取时标记为不可用', () => {
    expect(healthState({ ...base, failed: 1 })).toEqual({
      kind: 'unavailable',
    });
    expect(healthState({ ...base, unavailable: true, loading: true })).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('homeLede：首页摘要', () => {
  it('说明已合并的内容及无需手动点击合并的数量', () => {
    expect(homeLede({ merged7d: 67, automatic: 56 })).toBe(
      'CloudForge merged 67 changes in the last 7 days; 56 needed no merge click.'
    );
    expect(homeLede({ merged7d: 1, automatic: 1 })).toBe(
      'CloudForge merged 1 change in the last 7 days, and it needed no merge click.'
    );
    expect(homeLede({ merged7d: 3, automatic: 3 })).toBe(
      'CloudForge merged 3 changes in the last 7 days, and none needed a merge click.'
    );
    expect(homeLede({ merged7d: 0, automatic: 0 })).toBe(
      'Nothing has merged in the last 7 days.'
    );
  });
});

describe('dateEyebrow：日期提示', () => {
  it('使用自然语言显示日期', () => {
    expect(dateEyebrow(new Date(2026, 9, 9, 15))).toBe('Friday 9 October');
    expect(dateEyebrow(new Date(2026, 0, 1, 0, 5))).toBe('Thursday 1 January');
  });
});

const stats = (
  over: Partial<RepoStats> & { open?: number } = {}
): RepoStats => {
  const { open = 0, ...rest } = over;
  return {
    pulls: {
      open,
      needsPerson: 0,
      changesRequested: 0,
      checking: 0,
      queued: 0,
    },
    merged7d: 0,
    mergedByDay: [0, 0, 0, 0, 0, 0, 0],
    mergedAutomaticallyPct: null,
    agents: [],
    branchCount: 1,
    language: null,
    updatedAt: 1000,
    ...rest,
  };
};
const repo = (
  owner: string,
  name: string,
  over: Partial<RepoStats> & { open?: number } = {}
): RepoWithStats => ({
  id: `${owner}-${name}`,
  owner: { id: owner, username: owner, name: owner, image: null },
  ownerType: 'user',
  visibility: 'internal',
  name,
  fullName: `${owner}/${name}`,
  description: null,
  defaultBranch: 'main',
  protectedBranches: [],
  deleteMergedBranches: true,
  hasIssues: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  stats: stats(over),
});

describe('topByActivity：按活跃度排名', () => {
  it('按开放拉取请求与本周合并数之和排列代码仓库，再按最近活动排序', () => {
    const rows = boardRows(
      [
        repo('a', 'quiet', { updatedAt: 50 }),
        repo('a', 'busy', { open: 3, merged7d: 4, updatedAt: 10 }),
        repo('a', 'newer', { open: 1, updatedAt: 99 }),
        repo('a', 'older', { open: 1, updatedAt: 20 }),
        repo('dataagent', 'dataagent', { open: 9, merged7d: 9 }),
      ],
      [
        {
          id: 'x',
          username: 'dataagent',
          name: 'Data',
          image: null,
          bio: '',
          reviewLanguage: 'en',
          trigger: { ask: '', above: 0 },
          engine: 'pass',
          color: '#199e70',
          facet: 'data',
          guarded: true,
          repository: 'dataagent/dataagent',
          configSha: null,
          configError: null,
          createdAt: '',
          deletedAt: null,
        },
      ]
    );
    expect(topByActivity(rows, 3).map((r) => r.repo.fullName)).toEqual([
      'a/busy',
      'a/newer',
      'a/older',
    ]);
  });
});

const area = (over: Partial<HealthArea> = {}): HealthArea => ({
  id: 'agent:securityagent',
  label: 'Security',
  color: '#2a78d6',
  agent: 'securityagent',
  thisWeek: 0,
  lastWeek: 0,
  weeks: [0, 0, 0, 0, 0, 0, 0, 0],
  trend: 'same',
  status: 'No open problems',
  detail: 'None raised this week or last',
  open: 0,
  ...over,
});
const report = (
  areas: HealthArea[],
  over: Partial<HealthReport> = {}
): HealthReport => ({
  summary: '',
  decisionsWaiting: 0,
  areas,
  contributors: [],
  ...over,
});

describe('sinceLastWeek：与上周比较', () => {
  it('依次说明恶化、改善和保持不变的部分', () => {
    const lines = sinceLastWeek([
      {
        repo: 'a/b',
        report: report([
          area({ id: 'agent:dataagent', label: 'Data' }),
          area({
            label: 'Security',
            trend: 'better',
            detail: '1 raised this week, 2 fewer than last week',
          }),
          area({
            id: 'merging',
            label: 'Merging',
            trend: 'worse',
            detail: '2 reverts this week, 1 more than last week',
          }),
        ]),
      },
    ]);
    expect(lines).toEqual([
      {
        trend: 'worse',
        text: 'Merging: 2 reverts this week, 1 more than last week',
      },
      {
        trend: 'better',
        text: 'Security: 1 raised this week, 2 fewer than last week',
      },
      { trend: 'same', text: 'No change in Data' },
    ]);
  });

  it('指出保持不变但仍有未解决问题的领域', () => {
    const lines = sinceLastWeek([
      {
        repo: 'a/b',
        report: report([
          area({ open: 2, status: '2 open problems' }),
          area({ id: 'tests', label: 'Tests on main' }),
        ]),
      },
    ]);
    expect(lines).toEqual([
      { trend: 'same', text: 'Security: 2 open problems' },
      { trend: 'same', text: 'No change in Tests on main' },
    ]);
  });

  it('多个仓库时包含仓库名', () => {
    const lines = sinceLastWeek([
      {
        repo: 'a/one',
        report: report([area({ trend: 'worse', detail: 'x' })]),
      },
      { repo: 'a/two', report: report([area()]) },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Security in a/one: x',
      '1 area in a/two unchanged',
    ]);
  });

  it('合并多个平静领域的说明', () => {
    const lines = sinceLastWeek([
      {
        repo: 'a/b',
        report: report([
          area({ label: 'Security' }),
          area({ id: 'agent:dataagent', label: 'Data' }),
          area({ id: 'merging', label: 'Merging' }),
        ]),
      },
    ]);
    expect(lines).toEqual([
      { trend: 'same', text: 'No change in Security, Data and Merging' },
    ]);
  });

  it('没有报告时不显示说明', () => {
    expect(sinceLastWeek([])).toEqual([]);
  });
});

describe('brokenRepos 和 repoVerdict：异常仓库与判定', () => {
  const failing = report([
    area({
      id: 'tests',
      label: 'Tests on main',
      open: 1,
      status: 'Failing now',
    }),
  ]);

  it('找出 main 分支测试失败的仓库', () => {
    expect(
      brokenRepos([
        { repo: 'a/one', report: failing },
        { repo: 'a/two', report: report([area()]) },
      ])
    ).toEqual(['a/one']);
  });

  it('判定优先级为测试失败、待决定、恶化，否则为健康', () => {
    expect(repoVerdict(failing)).toEqual({
      tone: 'critical',
      label: 'Tests are failing on main',
    });
    expect(repoVerdict(report([area()], { decisionsWaiting: 1 }))).toEqual({
      tone: 'warn',
      label: '1 decision for you',
    });
    expect(repoVerdict(report([area()], { decisionsWaiting: 3 }))).toEqual({
      tone: 'warn',
      label: '3 decisions for you',
    });
    expect(repoVerdict(report([area({ trend: 'worse' })]))).toEqual({
      tone: 'serious',
      label: 'Security got worse',
    });
    expect(
      repoVerdict(
        report([
          area({ trend: 'worse' }),
          area({ id: 'merging', label: 'Merging', trend: 'worse' }),
        ])
      )
    ).toEqual({ tone: 'serious', label: '2 areas got worse' });
    expect(repoVerdict(report([area()]))).toEqual({
      tone: 'good',
      label: 'Healthy',
    });
  });
});

const ev = (
  id: string,
  at: number,
  action: string,
  over: Partial<AuditEvent> = {}
): AuditEvent => ({
  id,
  at,
  actor: { kind: 'person', login: 'me', name: 'Me' },
  via: null,
  action,
  target: '#1',
  data: {},
  repo: 'a/b',
  pull: 1,
  ...over,
});

describe('isNotable 和 mergeActivity：重要活动与合并活动', () => {
  it('保留所有者关心的事件，移除时间线噪声', () => {
    expect(isNotable(ev('1', 1, 'pull.merged'))).toBe(true);
    expect(isNotable(ev('1', 1, 'finding.approved'))).toBe(true);
    expect(isNotable(ev('1', 1, 'merging.paused'))).toBe(true);
    expect(isNotable(ev('1', 1, 'pull.state_changed'))).toBe(false);
    expect(isNotable(ev('1', 1, 'pull.stacked'))).toBe(false);
    expect(isNotable(ev('1', 1, 'branch.deleted'))).toBe(false);
    expect(isNotable(ev('1', 1, 'pull.something_new'))).toBe(false);
  });

  it('合并多个仓库的活动，最新在前、去重并限制数量', () => {
    const merged = mergeActivity(
      [
        [ev('a', 10, 'pull.merged'), ev('b', 30, 'pull.state_changed')],
        [ev('c', 20, 'finding.approved'), ev('a', 10, 'pull.merged')],
        [ev('d', 5, 'pull.reverted')],
      ],
      3
    );
    expect(merged.map((e) => e.id)).toEqual(['c', 'a', 'd']);
    expect(mergeActivity([[ev('a', 10, 'pull.merged')]], 0)).toEqual([]);
  });
});
