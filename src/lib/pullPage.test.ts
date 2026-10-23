// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  canDeleteMergedBranch,
  etaText,
  fixerAttempts,
  nextStep,
  openQuestion,
  ordinal,
  participants,
  pullBlockers,
  pullChip,
  pullTab,
  queueLine,
  queueSpot,
  type NextStepInput,
} from './pullPage';
import type {
  AgentRun,
  PullState,
  QueueTarget,
  RebaseView,
  ReviewFlag,
  User,
} from './uiApi';

const person = (id: string): User => ({
  id,
  username: id,
  name: id.toUpperCase(),
  image: null,
});

const flag = (over: Partial<ReviewFlag> = {}): ReviewFlag => ({
  id: 'f1',
  kind: 'needs_person',
  title: 'Existing invoices become Canadian dollars',
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
  question: null,
  guarded: false,
  assignee: null,
  decidedVia: null,
  reason: null,
  teach: null,
  ...over,
});

const state = (
  s: PullState['state'],
  ...kinds: (string | Record<string, unknown>)[]
): PullState => ({
  state: s,
  reasons: kinds.map((k) => (typeof k === 'string' ? { kind: k } : k)) as {
    kind: string;
  }[],
});

const rebase = (over: Partial<RebaseView> = {}): RebaseView => ({
  status: 'up_to_date',
  onto: 'main',
  commit: null,
  files: [],
  error: null,
  ...over,
});

const input = (over: Partial<NextStepInput> = {}): NextStepInput => ({
  state: 'open',
  headRef: 'claude/s4-usd-invoices',
  baseRef: 'main',
  headBranchExists: true,
  pullState: state('ready'),
  rebase: rebase(),
  autoMerge: 'waiting',
  ...over,
});

const ctx = (over: Partial<Parameters<typeof nextStep>[1]> = {}) => ({
  blockers: [],
  question: null,
  coder: 'Claude Code',
  ...over,
});

describe('pullTab：拉取请求标签页', () => {
  it('未指定标签时显示讨论，其他标签按名称读取', () => {
    expect(pullTab(undefined)).toBe('conversation');
    expect(pullTab('')).toBe('conversation');
    expect(pullTab('commits')).toBe('commits');
    expect(pullTab('files')).toBe('files');
    expect(pullTab('checks')).toBe('checks');
  });
  it('拒绝其他值', () => {
    expect(pullTab('conversation')).toBeNull();
    expect(pullTab('Files')).toBeNull();
    expect(pullTab('settings')).toBeNull();
  });
});

describe('ordinal：序数', () => {
  it('正确显示 1st、2nd、3rd、th 及十几的序数', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(
      [
        '1st',
        '2nd',
        '3rd',
        '4th',
        '11th',
        '12th',
        '13th',
        '21st',
        '22nd',
        '23rd',
        '101st',
        '111th',
      ]
    );
  });
});

describe('etaText：预计耗时', () => {
  it('没有历史数据时不提供估算', () => {
    expect(etaText(null)).toBeNull();
  });
  it('用自然语言显示分钟和小时', () => {
    expect(etaText(0)).toBe('any minute now');
    expect(etaText(1)).toBe('about 1 min');
    expect(etaText(14)).toBe('about 14 min');
    expect(etaText(60)).toBe('about 1 h');
    expect(etaText(95)).toBe('about 1 h 35 min');
  });
});

describe('queueSpot 和 queueLine：队列位置与说明', () => {
  const entry = (n: number, position: number) => ({
    position,
    number: n,
    title: `#${n}`,
    author: { login: 'a', name: null, isAgent: false, color: null },
    createdVia: null,
    session: null,
    sessionId: 's-1',
    state: 'waiting',
    blockers: [],
    etaMinutes: position * 3,
  });
  const queue: QueueTarget[] = [
    { target: 'main', paused: null, entries: [entry(9, 1), entry(10, 2)] },
    { target: 'release', paused: null, entries: [entry(12, 1)] },
  ];
  it('在目标队列中找到拉取请求', () => {
    expect(queueSpot(queue, 10)).toMatchObject({
      target: 'main',
      total: 2,
      entry: { number: 10, position: 2 },
    });
    expect(queueSpot(queue, 12)?.target).toBe('release');
    expect(queueSpot(queue, 99)).toBeNull();
    expect(queueSpot(undefined, 10)).toBeNull();
  });
  it('说明其排队位置', () => {
    expect(queueLine(queueSpot(queue, 9)!)).toBe(
      'First in line to land on main.'
    );
    expect(queueLine(queueSpot(queue, 10)!)).toBe(
      '2nd of 2 in line to land on main.'
    );
  });
});

describe('openQuestion：开放问题', () => {
  const data = person('dataagent');
  it('找到首个仍待人工回答的问题', () => {
    const q = flag({ id: 'q', question: 'Were all your invoices in CAD?' });
    const found = openQuestion([
      { agent: person('securityagent'), flags: [flag({ id: 'x' })] },
      { agent: data, flags: [q] },
    ]);
    expect(found).toEqual({ agent: data, flag: q });
  });
  it('跳过已回答、已拒绝和要求修改的问题', () => {
    expect(
      openQuestion([
        {
          agent: data,
          flags: [
            flag({ question: 'A?', approvedAt: '2026-10-08T00:00:00Z' }),
            flag({ question: 'B?', changesRequestedAt: '2026-10-08' }),
            flag({ question: 'C?', kind: 'change_requested' }),
          ],
        },
      ])
    ).toBeNull();
    expect(openQuestion(undefined)).toBeNull();
  });
});

describe('pullBlockers：拉取请求阻塞原因', () => {
  it('优先使用队列提供的易懂说明', () => {
    expect(
      pullBlockers(state('waiting', 'checks_running'), [
        'The test check is running',
      ])
    ).toEqual(['The test check is running']);
  });
  it('回退到状态阻塞原因，并将首字母大写', () => {
    expect(
      pullBlockers(
        state(
          'human_review',
          { kind: 'agent_flagged', agent: 'dataagent', flags: [1] },
          { kind: 'stacked_on', pr: 9 }
        ),
        undefined
      )
    ).toEqual(['@dataagent flagged 1 finding for a person']);
    expect(pullBlockers(null, undefined)).toEqual([]);
  });
});

describe('nextStep：下一步', () => {
  it('已合并或已关闭的拉取请求显示完成', () => {
    expect(nextStep(input({ state: 'merged' }), ctx())).toEqual({
      tone: 'good',
      headline: 'Merged into main.',
      detail: null,
      listed: [],
    });
    expect(nextStep(input({ state: 'closed' }), ctx()).headline).toBe(
      'Closed without merging.'
    );
  });

  it('优先显示分支缺失', () => {
    const s = nextStep(input({ headBranchExists: false, rebase: null }), ctx());
    expect(s.tone).toBe('critical');
    expect(s.headline).toBe(
      'The claude/s4-usd-invoices branch is gone, so this can’t merge.'
    );
  });

  it('说明 Fixer 无法解决的冲突和 CloudForge 不会变基的分支', () => {
    const clash = nextStep(
      input({
        rebase: rebase({ status: 'conflict', commit: 'abc1234def' }),
        pullState: state('agent_followup', 'rebase_conflict'),
      }),
      ctx({
        blockers: [
          'Clashes with newer changes in a.ts',
          'The test check failed',
        ],
      })
    );
    expect(clash.tone).toBe('serious');
    expect(clash.headline).toBe(
      'It clashes with newer changes on main, and Fixer couldn’t combine them.'
    );
    // The headline is the clash; only the rest is listed.
    expect(clash.listed).toEqual(['The test check failed']);
    const blocked = nextStep(
      input({
        rebase: rebase({
          status: 'conflict',
          error: 'Not rebased: release/* is protected',
        }),
      }),
      ctx()
    );
    expect(blocked.headline).toBe(
      'CloudForge doesn’t rebase this branch, and it is behind main.'
    );
    expect(blocked.detail).toBe('Not rebased: release/* is protected');
  });

  it('Fixer 解决冲突期间显示正在处理', () => {
    const s = nextStep(
      input({ rebase: rebase({ status: 'resolving' }) }),
      ctx({ blockers: ['CloudForge is fixing a clash', 'Lands after #9'] })
    );
    expect(s).toMatchObject({
      tone: 'info',
      headline: 'Fixer is combining it with newer changes on main.',
      listed: ['Lands after #9'],
    });
    // The state's own words (when the queue didn't load) are left out the same way.
    expect(
      nextStep(
        input({ rebase: rebase({ status: 'resolving' }) }),
        ctx({ blockers: ['AI is resolving conflicts'] })
      ).listed
    ).toEqual([]);
  });

  it('根据自动合并设置描述已就绪的拉取请求', () => {
    expect(nextStep(input({ autoMerge: 'ready' }), ctx()).headline).toBe(
      'Ready. CloudForge is merging it now.'
    );
    expect(nextStep(input({ autoMerge: 'disabled' }), ctx()).headline).toBe(
      'Ready to merge. Auto-merge is off, so it waits for someone to merge it.'
    );
    expect(nextStep(input({ autoMerge: null }), ctx())).toMatchObject({
      tone: 'good',
      headline: 'Ready to merge.',
    });
  });

  it('仅暂停阻止合入时说明情况', () => {
    const s = nextStep(
      input({ pullState: state('waiting', 'merging_paused', 'stacked_on') }),
      ctx({ blockers: ['Merging is paused', 'Lands after #9'] })
    );
    expect(s.tone).toBe('warn');
    expect(s.headline).toBe(
      'Ready, but merging is paused. Someone needs to resume merging before this can land.'
    );
    const more = nextStep(
      input({
        pullState: state('waiting', 'merging_paused', 'checks_running'),
      }),
      ctx({ blockers: ['Merging is paused', 'Tests are running'] })
    );
    expect(more.headline).toBe(
      'Merging is paused, and it is still waiting on other things.'
    );
    // The pause is the headline; only what else it waits on is listed.
    expect(more.listed).toEqual(['Tests are running']);
  });

  it.each(['disabled', 'off'] as const)(
    '自动合并为 %s 时不承诺恢复后自动合并',
    (autoMerge) => {
      const s = nextStep(
        input({ autoMerge, pullState: state('waiting', 'merging_paused') }),
        ctx({ blockers: ['Merging is paused'] })
      );
      expect(s.headline).toBe(
        'Ready, but merging is paused. Someone needs to resume merging before this can land.'
      );
      expect(s.listed).toEqual([]);
    }
  );

  it('等待说明优先显示首个阻塞原因', () => {
    const s = nextStep(
      input({ pullState: state('waiting', 'checks_running') }),
      ctx({ blockers: ['The test check is running', 'Lands after #9'] })
    );
    expect(s).toEqual({
      tone: 'info',
      headline: 'Waiting. The test check is running.',
      detail: null,
      listed: ['Lands after #9'],
    });
    expect(
      nextStep(input({ pullState: state('waiting') }), ctx()).headline
    ).toBe('Waiting.');
  });

  it('原样表达所有者的问题', () => {
    const s = nextStep(
      input({ pullState: state('human_review', 'agent_flagged') }),
      ctx({
        blockers: ['Data needs a person to decide 1 finding', 'Lands after #9'],
        question: {
          agent: 'Data',
          text: 'Were all your invoices so far in Canadian dollars?',
          assignee: null,
        },
      })
    );
    expect(s).toEqual({
      tone: 'warn',
      headline: 'Data asks: Were all your invoices so far in Canadian dollars?',
      detail: null,
      // The question says what Data waits on; only the other blockers are listed.
      listed: ['Lands after #9'],
    });
    expect(
      nextStep(
        input({ pullState: state('human_review') }),
        ctx({
          question: { agent: 'Data', text: 'Is it CAD?', assignee: 'Cho' },
        })
      ).headline
    ).toBe('Data asks Cho: Is it CAD?');
  });

  it('其他情况下说明用户需要决定的事项', () => {
    const s = nextStep(
      input({ pullState: state('human_review', 'needs_approval') }),
      ctx({ blockers: ['Needs a person to approve it'] })
    );
    expect(s).toMatchObject({
      tone: 'warn',
      headline: 'Needs a person to approve it.',
      listed: [],
    });
    expect(
      nextStep(input({ pullState: state('human_review') }), ctx()).headline
    ).toBe('Needs a person before it can merge.');
  });

  it('指出需要作出修改的人', () => {
    const s = nextStep(
      input({ pullState: state('agent_followup', 'agent_changes_requested') }),
      ctx({ blockers: ['Security asked for 1 change'], coder: 'Codex' })
    );
    expect(s).toEqual({
      tone: 'serious',
      headline: 'Waiting for Codex to make changes.',
      detail: 'Security asked for 1 change.',
      listed: [],
    });
  });

  it('状态未知前显示检查中', () => {
    expect(nextStep(input({ pullState: null }), ctx()).headline).toBe(
      'Checking where it stands.'
    );
  });
});

describe('fixerAttempts：冲突修复尝试', () => {
  const run = (id: string, at: string): AgentRun => ({
    id,
    kind: 'rebase',
    status: 'succeeded',
    title: `Rebase ${id}`,
    pullRequest: null,
    startedAt: at,
    finishedAt: null,
    error: null,
  });
  it('合并各类型，最新在前、每项一次、最多五项', () => {
    const a = [run('a', '2026-10-08T10:00:00Z'), run('b', '2026-10-08T08:00Z')];
    const b = [
      run('c', '2026-10-08T09:00:00Z'),
      run('a', '2026-10-08T10:00:00Z'),
    ];
    expect(fixerAttempts([a, b, undefined]).map((r) => r.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
    const many = Array.from({ length: 8 }, (_, i) =>
      run(`r${i}`, `2026-10-0${i + 1}T00:00:00Z`)
    );
    expect(fixerAttempts([many]).map((r) => r.id)).toEqual([
      'r7',
      'r6',
      'r5',
      'r4',
      'r3',
    ]);
  });
});

describe('participants：参与者', () => {
  it('列出作者、评论者和合并者，每人一次', () => {
    const a = person('a');
    const b = person('b');
    const c = person('c');
    expect(
      participants({ author: a, mergedBy: c }, [
        { author: b },
        { author: a },
        { author: b },
      ]).map((u) => u.id)
    ).toEqual(['a', 'b', 'c']);
    expect(participants({ author: a, mergedBy: null }, []).length).toBe(1);
  });
});

describe('pullChip：拉取请求标签', () => {
  it('按当前应行动的角色描述开放请求', () => {
    expect(pullChip('open', state('human_review'))).toEqual({
      tone: 'warn',
      label: 'Requires human review',
    });
    expect(pullChip('open', state('waiting', 'merging_paused'))).toEqual({
      tone: 'info',
      label: 'Paused',
    });
    expect(pullChip('open', null)).toEqual({ tone: 'info', label: 'Open' });
  });
  it('如实显示已合并和已关闭状态', () => {
    expect(pullChip('merged', null)).toEqual({
      tone: 'merged',
      label: 'Merged',
    });
    expect(pullChip('closed', state('ready'))).toEqual({
      tone: 'off',
      label: 'Closed',
    });
  });
});

describe('canDeleteMergedBranch：合并分支删除权限', () => {
  const branch = {
    name: 'feature',
    isProtected: false,
    mergedNotDeleted: true,
  };
  it('等待服务端确认已合并分支可安全删除', () => {
    expect(canDeleteMergedBranch('feature', undefined)).toBe(false);
    expect(canDeleteMergedBranch('feature', branch)).toBe(true);
  });
  it('保留受保护、复用和已有新提交的分支，并防止使用其他分支的过期数据', () => {
    expect(
      canDeleteMergedBranch('feature', { ...branch, isProtected: true })
    ).toBe(false);
    expect(
      canDeleteMergedBranch('feature', { ...branch, mergedNotDeleted: false })
    ).toBe(false);
    expect(canDeleteMergedBranch('other', branch)).toBe(false);
  });
});
