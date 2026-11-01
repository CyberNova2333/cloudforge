// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  areaKind,
  areaSpark,
  clientMark,
  contributorLine,
  decisionCopy,
  healthLede,
  noReviewersBody,
  notReviewing,
  pickDecision,
  reviewerRecord,
  reviewerState,
  TREND_LOOK,
  weekLabels,
} from './health';
import type {
  Agent,
  AgentStats,
  ApprovalItem,
  HealthArea,
  HealthReport,
  ReviewFlag,
} from '../api/uiApi';

const area = (over: Partial<HealthArea> = {}): HealthArea => ({
  id: 'agent:dataagent',
  label: 'Data',
  color: '#199e70',
  agent: 'dataagent',
  thisWeek: 3,
  lastWeek: 1,
  weeks: [0, 1, 0, 2, 1, 0, 1, 3],
  trend: 'worse',
  status: '2 open problems',
  detail: '3 raised this week, 2 more than last week',
  open: 2,
  ...over,
});

const report = (over: Partial<HealthReport> = {}): HealthReport => ({
  summary: 'Nothing got worse this week.',
  decisionsWaiting: 0,
  areas: [],
  contributors: [],
  ...over,
});

describe('areaKind：区域类型', () => {
  it('区分代理行与两种内置行', () => {
    expect(areaKind(area())).toBe('agent');
    expect(areaKind(area({ id: 'tests', agent: null }))).toBe('tests');
    expect(areaKind(area({ id: 'merging', agent: null }))).toBe('merging');
  });
});

describe('TREND_LOOK：趋势外观', () => {
  it('每种趋势都有文字和色调，避免仅靠颜色传达', () => {
    expect(TREND_LOOK.better).toEqual({ label: 'Better', tone: 'good' });
    expect(TREND_LOOK.same).toEqual({ label: 'Same', tone: 'off' });
    expect(TREND_LOOK.worse).toEqual({ label: 'Worse', tone: 'serious' });
  });
});

describe('weekLabels：周标签', () => {
  it('从最早的一周到本周命名八周', () => {
    expect(weekLabels(8)).toEqual([
      '7 weeks ago',
      '6 weeks ago',
      '5 weeks ago',
      '4 weeks ago',
      '3 weeks ago',
      '2 weeks ago',
      'Last week',
      'This week',
    ]);
  });
  it('处理不同的周数', () => {
    expect(weekLabels(2)).toEqual(['Last week', 'This week']);
    expect(weekLabels(1)).toEqual(['This week']);
    expect(weekLabels(0)).toEqual([]);
  });
});

describe('areaSpark：区域迷你图', () => {
  it('按提出的问题数绘制代理图表', () => {
    const s = areaSpark(area());
    expect(s.values).toEqual([0, 1, 0, 2, 1, 0, 1, 3]);
    expect(s.unit).toBe(' raised');
    expect(s.label).toBe('Data, findings raised, last 8 weeks');
    expect(s.labels).toHaveLength(8);
    expect(s.trend).toBe('worse');
  });

  it('测试行标题表示失败数而非通过率', () => {
    const s = areaSpark(
      area({
        id: 'tests',
        agent: null,
        label: 'Tests on main',
        weeks: [0, 0, 10, 0, 0, 0, 0, 20],
        trend: 'worse',
      })
    );
    expect(s.unit).toBe('% of runs failed');
    expect(s.label).toBe(
      'Tests on main, share of runs that failed, last 8 weeks'
    );
    expect(`${s.label} ${s.unit}`).not.toMatch(/pass/i);
  });

  it('按回退次数绘制合并图表', () => {
    const s = areaSpark(
      area({ id: 'merging', agent: null, label: 'Merging', weeks: [0, 1] })
    );
    expect(s.unit).toBe(' reverted');
    expect(s.label).toBe('Merging, reverts, last 2 weeks');
    expect(s.labels).toEqual(['Last week', 'This week']);
  });
});

describe('areaSpark：图表空缺', () => {
  const tests = (over: Partial<HealthArea> = {}) =>
    area({
      id: 'tests',
      agent: null,
      label: 'Tests on main',
      weeks: [0, 0, 0, 0, 25, 0, 0, 50],
      noRuns: [true, true, true, true, false, true, true, false],
      trend: 'worse',
      ...over,
    });

  it('没有测试运行的周绘制为空缺，并在提示中说明', () => {
    const s = areaSpark(tests());
    expect(s.missing).toEqual([
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(s.missingText).toBe('no test runs');
    // The numbers are unchanged: a gap week keeps its 0 in `values`, it is the flag that says it is not a measurement.
    expect(s.values).toEqual([0, 0, 0, 0, 25, 0, 0, 50]);
    expect(s.label).toContain('weeks with no test runs are gaps');
  });

  it('每周都有运行、API 未提供空缺或非测试行时不绘制空缺', () => {
    expect(
      areaSpark(tests({ noRuns: Array(8).fill(false) })).missing
    ).toBeUndefined();
    expect(areaSpark(tests({ noRuns: undefined })).missing).toBeUndefined();
    expect(areaSpark(tests({ noRuns: undefined })).label).not.toContain('gaps');
    // Only the tests row has gaps, whatever another row carries.
    expect(
      areaSpark(area({ noRuns: Array(8).fill(true) })).missing
    ).toBeUndefined();
  });

  it('忽略与周数不对应的 noRuns 列表', () => {
    expect(areaSpark(tests({ noRuns: [true, false] })).missing).toBeUndefined();
  });
});

describe('healthLede：健康摘要', () => {
  it('先显示摘要，再显示待决定和开放项', () => {
    expect(healthLede(report({ decisionsWaiting: 1 }), 6)).toBe(
      'Nothing got worse this week. 1 decision needs you. 6 pull requests open.'
    );
  });
  it('无待决定项时不提决定，并处理一个或零个开放项', () => {
    expect(healthLede(report(), 1)).toBe(
      'Nothing got worse this week. 1 pull request open.'
    );
    expect(healthLede(report({ summary: 'Data got worse.' }), 0)).toBe(
      'Data got worse. No pull requests open.'
    );
    expect(healthLede(report({ decisionsWaiting: 3 }), 2)).toContain(
      '3 decisions need you.'
    );
  });
});

const flag = (over: Partial<ReviewFlag> = {}): ReviewFlag => ({
  id: 'f1',
  kind: 'needs_person',
  title: 'Invoices change currency',
  paths: ['src/invoices.ts'],
  detail: null,
  detailModel: null,
  agentSha: null,
  approvedBy: null,
  approvedAt: null,
  approvedVia: null,
  changesRequestedBy: null,
  changesRequestedAt: null,
  changesRequestedNote: null,
  question: null,
  guarded: false,
  assignee: null,
  decidedVia: null,
  reason: null,
  teach: null,
  ...over,
});

const item = (
  fullName: string,
  number: number,
  flags: ReviewFlag[],
  agentName = 'Data'
): ApprovalItem => ({
  repo: { fullName, name: fullName.split('/')[1] },
  pull: {
    number,
    title: `Pull ${number}`,
    author: null,
    updatedAt: '2026-10-08T10:00:00.000Z',
    headSha: 'a'.repeat(40),
    createdVia: null,
    sessionLabel: null,
    sessionId: 'sess-1',
  },
  reviewFailed: null,
  resolutionFailed: null,
  needsApproval: false,
  agents: [
    {
      reviewerId: `rv-${number}`,
      agent: {
        id: 'u',
        username: `${agentName.toLowerCase()}agent`,
        name: agentName,
        image: null,
      },
      status: 'flagged',
      error: null,
      flags,
    },
  ],
  pullState: null,
  stackStale: [],
  stackUnchecked: [],
});

describe('pickDecision：选择待决定项', () => {
  it('其他仓库或没有条目时不返回结果', () => {
    expect(pickDecision([], 'o/r')).toBeNull();
    expect(pickDecision([item('o/other', 1, [flag()])], 'o/r')).toBeNull();
  });

  it('匹配仓库时忽略大小写', () => {
    const d = pickDecision([item('O/R', 4, [flag()])], 'o/r');
    expect(d?.flag.id).toBe('f1');
    expect(d?.pull.number).toBe(4);
  });

  it('所有者问题优先于普通问题', () => {
    const d = pickDecision(
      [
        item('o/r', 1, [flag({ id: 'plain' })]),
        item('o/r', 2, [flag({ id: 'ask', question: 'Is this right?' })]),
      ],
      'o/r'
    );
    expect(d?.flag.id).toBe('ask');
  });

  it('跳过已决定的问题和修改要求', () => {
    expect(
      pickDecision(
        [
          item('o/r', 1, [
            flag({ id: 'done', approvedAt: '2026-10-08T00:00:00.000Z' }),
            flag({
              id: 'asked',
              changesRequestedAt: '2026-10-08T00:00:00.000Z',
            }),
            flag({ id: 'cr', kind: 'change_requested' }),
          ]),
        ],
        'o/r'
      )
    ).toBeNull();
  });
});

describe('decisionCopy：决定文案', () => {
  const row = (f: ReviewFlag) => pickDecision([item('o/r', 7, [f])], 'o/r')!;

  it('用易懂的文字表达所有者问题', () => {
    const c = decisionCopy(
      row(
        flag({
          question: 'Were all your invoices in Canadian dollars?',
          detail: 'The change will mark 1,284 invoices as Canadian dollars.',
        })
      )
    );
    expect(c.from).toBe('Data is asking');
    expect(c.title).toBe('Were all your invoices in Canadian dollars?');
    expect(c.body).toBe(
      'The change will mark 1,284 invoices as Canadian dollars.'
    );
  });

  it('代理未提问时使用问题标题', () => {
    const c = decisionCopy(row(flag()));
    expect(c.from).toBe('Data wants a person to decide');
    expect(c.title).toBe('Invoices change currency');
    expect(c.body).toBeNull();
  });
});

describe('contributorLine：贡献者说明', () => {
  const c = (over: Partial<HealthReport['contributors'][number]> = {}) => ({
    who: {
      kind: 'person' as const,
      label: 'Cho',
      login: 'cho',
      client: null,
      sessionId: 's-0123456789',
    },
    merged: 4,
    findings: 0,
    note: null,
    trend: 'same' as const,
    ...over,
  });

  it('评审者未提出问题时说明没有恶化', () => {
    expect(contributorLine(c())).toEqual({
      text: 'Nothing got worse',
      detail: 'No findings from your reviewers',
      dir: 'same',
    });
  });

  it('问题减少时标记为改善', () => {
    expect(contributorLine(c({ trend: 'better' }))).toEqual({
      text: 'Nothing got worse',
      detail: 'No findings this week, fewer than last week',
      dir: 'better',
    });
  });

  it('提出问题时显示备注并与上周比较', () => {
    expect(
      contributorLine(
        c({ findings: 2, note: '2 findings, most on #74', trend: 'worse' })
      )
    ).toEqual({
      text: '2 findings, most on #74',
      detail: 'More than last week',
      dir: 'worse',
    });
    expect(contributorLine(c({ findings: 1, trend: 'same' }))).toEqual({
      text: '1 finding',
      detail: 'Same as last week',
      dir: 'same',
    });
    expect(contributorLine(c({ findings: 3, trend: 'better' })).detail).toBe(
      'Fewer than last week'
    );
  });
});

describe('clientMark：客户端标识', () => {
  it('取应用首字母，Codex 使用轮廓 X', () => {
    expect(clientMark('Claude Code')).toEqual({ mark: 'C', codex: false });
    expect(clientMark('Codex')).toEqual({ mark: 'X', codex: true });
    expect(clientMark('  cursor')).toEqual({ mark: 'C', codex: false });
  });
  it('缺少名称时显示占位符', () => {
    expect(clientMark(null)).toEqual({ mark: '?', codex: false });
    expect(clientMark('')).toEqual({ mark: '?', codex: false });
  });
});

describe('评审记录与状态', () => {
  const stats = (over: Partial<AgentStats> = {}): AgentStats => ({
    handle: 'dataagent',
    raised: 12,
    kept: 8,
    dismissed: 2,
    keptPct: 80,
    rules: 3,
    reviews: 30,
    byDay: [],
    bestCatch: null,
    repos: [
      { repo: 'O/R', status: 'flagged', number: 9 },
      { repo: 'o/other', status: 'approved', number: 2 },
    ],
    ...over,
  });

  it('根据本周和总体数据生成记录', () => {
    expect(reviewerRecord(area(), stats())).toBe(
      '3 raised this week · 80% kept overall · 3 rules learned overall'
    );
  });

  it('使用单数形式并省略未知项', () => {
    expect(
      reviewerRecord(area({ thisWeek: 1 }), stats({ keptPct: null, rules: 1 }))
    ).toBe('1 raised this week · 1 rule learned overall');
  });

  it('仅加载一个数据来源时仍显示信息', () => {
    expect(reviewerRecord(area({ thisWeek: 0 }), undefined)).toBe(
      'Nothing raised this week'
    );
    expect(reviewerRecord(undefined, stats())).toBe(
      '80% kept overall · 3 rules learned overall'
    );
    expect(reviewerRecord(undefined, undefined)).toBeNull();
  });

  it('根据代理在该仓库中的活动读取状态', () => {
    expect(reviewerState(stats(), 'o/r')).toBe('flagged');
    expect(reviewerState(stats(), 'o/other')).toBe('approved');
    expect(reviewerState(stats(), 'o/none')).toBe('idle');
    expect(reviewerState(undefined, 'o/r')).toBeNull();
  });
});

describe('notReviewing：未参与评审的代理', () => {
  const agent = (username: string, deletedAt: string | null = null) =>
    ({
      id: `id-${username}`,
      username,
      name: username,
      image: null,
      deletedAt,
    }) as unknown as Agent;

  it('列出存在但未加入该仓库的代理，并跳过已删除者', () => {
    const all = [
      agent('dataagent'),
      agent('securityagent'),
      agent('gone', '2026-01-01'),
    ];
    expect(
      notReviewing(all, [{ username: 'DataAgent' }]).map((a) => a.username)
    ).toEqual(['securityagent']);
  });
});

describe('noReviewersBody：没有评审者的说明', () => {
  it('提示管理员添加代理，并告知其他人谁可以添加', () => {
    expect(noReviewersBody({ admin: true, available: 3 })).toBe(
      'Reviewers look at each change before it merges. Add one below.'
    );
    const other = noReviewersBody({ admin: false, available: 3 });
    expect(other).toBe(
      'Reviewers look at each change before it merges. An admin of this repository can add one.'
    );
    expect(other).not.toMatch(/below/i);
  });

  it('没有可添加代理时对所有人指向代理页面', () => {
    for (const admin of [true, false])
      expect(noReviewersBody({ admin, available: 0 })).toBe(
        'Reviewers look at each change before it merges. A site admin can create them from Agents.'
      );
  });
});
