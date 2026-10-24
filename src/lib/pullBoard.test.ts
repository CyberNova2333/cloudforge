// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  boardLanes,
  etaLine,
  etaText,
  laneChip,
  laneLabel,
  laneOf,
  LANE_ORDER,
  sortReviewers,
} from './pullBoard';
import type {
  Pull,
  PullReason,
  PullReviewer,
  PullState,
  QueueTarget,
} from './uiApi';

const state = (
  name: PullState['state'],
  ...reasons: PullReason[]
): PullState => ({ state: name, reasons });

describe('laneOf：看板泳道', () => {
  it('将每种状态放入对应泳道', () => {
    expect(laneOf(state('human_review'))).toBe('needs');
    expect(laneOf(state('agent_followup'))).toBe('fixing');
    expect(laneOf(state('waiting'))).toBe('checking');
    expect(laneOf(state('ready'))).toBe('queued');
  });

  it('合并暂停时，等待中的拉取请求进入队列泳道，无论还在等待什么', () => {
    expect(
      laneOf(
        state('waiting', { kind: 'merging_paused' }, { kind: 'checks_running' })
      )
    ).toBe('queued');
  });

  it('暂停期间人工或代理待行动的请求保留在各自泳道', () => {
    expect(laneOf(state('human_review', { kind: 'merging_paused' }))).toBe(
      'needs'
    );
    expect(laneOf(state('agent_followup', { kind: 'merging_paused' }))).toBe(
      'fixing'
    );
  });

  it('状态无法读取的拉取请求标记为检查中', () => {
    expect(laneOf(null)).toBe('checking');
    expect(laneOf(undefined)).toBe('checking');
  });
});

describe('laneLabel：泳道标签', () => {
  it('用文字显示泳道名称', () => {
    expect(laneLabel('needs', false)).toBe('Needs you');
    expect(laneLabel('fixing', false)).toBe('Being fixed');
    expect(laneLabel('checking', false)).toBe('Checking');
    expect(laneLabel('queued', false)).toBe('Queued');
  });

  it('合并暂停时将队列称为已暂停', () => {
    expect(laneLabel('queued', true)).toBe('Paused');
    expect(laneLabel('needs', true)).toBe('Needs you');
  });

  it('按顺序列出泳道', () => {
    expect(LANE_ORDER).toEqual(['needs', 'fixing', 'checking', 'queued']);
  });
});

describe('laneChip：泳道标签样式', () => {
  it('使用泳道的色调显示名称', () => {
    expect(laneChip(state('human_review'))).toEqual({
      lane: 'needs',
      label: 'Needs you',
      tone: 'warn',
    });
    expect(laneChip(state('agent_followup'))).toMatchObject({
      label: 'Being fixed',
      tone: 'serious',
    });
    expect(laneChip(state('waiting'))).toMatchObject({
      label: 'Checking',
      tone: 'info',
    });
    expect(laneChip(state('ready'))).toMatchObject({
      label: 'Queued',
      tone: 'good',
    });
  });

  it('对合并已暂停的拉取请求显示已暂停', () => {
    expect(
      laneChip(state('waiting', { kind: 'merging_paused' }))
    ).toMatchObject({ lane: 'queued', label: 'Paused', tone: 'off' });
    expect(
      laneChip(state('human_review', { kind: 'merging_paused' })).label
    ).toBe('Needs you');
  });

  it('没有状态的拉取请求显示检查中', () => {
    expect(laneChip(null).label).toBe('Checking');
  });
});

describe('sortReviewers：排序评审者', () => {
  const r = (handle: string, status: PullReviewer['status']): PullReviewer => ({
    handle,
    name: handle,
    color: '#123456',
    status,
  });

  it('需要关注的排最前，已完成的排最后', () => {
    expect(
      sortReviewers([
        r('a-approved', 'approved'),
        r('b-reviewing', 'reviewing'),
        r('c-asked', 'changes_requested'),
        r('d-flagged', 'flagged'),
        r('e-failed', 'failed'),
      ]).map((x) => x.status)
    ).toEqual([
      'failed',
      'flagged',
      'changes_requested',
      'reviewing',
      'approved',
    ]);
  });

  it('同一状态内保持账号名顺序，且不修改输入', () => {
    const input = [r('zed', 'approved'), r('amy', 'approved')];
    expect(sortReviewers(input).map((x) => x.handle)).toEqual(['amy', 'zed']);
    expect(input.map((x) => x.handle)).toEqual(['zed', 'amy']);
    expect(sortReviewers([])).toEqual([]);
  });
});

describe('etaText：预计耗时', () => {
  it('没有估算时不显示', () => {
    expect(etaText(null)).toBeNull();
    expect(etaText(Number.NaN)).toBeNull();
  });

  it('显示分钟和小时', () => {
    expect(etaText(0)).toBe('under a minute');
    expect(etaText(1)).toBe('about 1 min');
    expect(etaText(4)).toBe('about 4 min');
    expect(etaText(60)).toBe('about 1 h');
    expect(etaText(95)).toBe('about 1 h 35 min');
  });
});

describe('etaLine：预计完成说明', () => {
  it('说明排队或检查中的拉取请求何时合入', () => {
    expect(etaLine('queued', 4, false)).toBe('Lands in about 4 min');
    expect(etaLine('checking', 20, false)).toBe('Lands in about 20 min');
  });

  it('说明阻塞解除后才开始计算时间', () => {
    expect(etaLine('needs', 6, false)).toBe('About 6 min once it is unblocked');
    expect(etaLine('fixing', 15, false)).toBe(
      'About 15 min once it is unblocked'
    );
  });

  it('合并暂停或没有估算时不显示', () => {
    expect(etaLine('queued', 4, true)).toBeNull();
    expect(etaLine('queued', null, false)).toBeNull();
  });
});

const pull = (n: number, extra: Partial<Pull> = {}): Pull =>
  ({
    id: `p${n}`,
    number: n,
    title: `Pull ${n}`,
    state: 'open',
    author: { id: 'u', username: 'cho', name: 'Cho', image: null },
    headRef: `b${n}`,
    createdVia: null,
    sessionLabel: null,
    sessionId: 's-x',
    commentCount: 0,
    createdAt: '2026-10-08T10:00:00.000Z',
    mergedAt: null,
    pullState: state('ready'),
    ...extra,
  }) as Pull;

const target = (
  entries: Partial<QueueTarget['entries'][number]>[],
  paused: QueueTarget['paused'] = null
): QueueTarget => ({
  target: 'main',
  paused,
  entries: entries.map((e, i) => ({
    position: i + 1,
    number: 0,
    title: '',
    author: { login: 'cho', name: 'Cho', isAgent: false, color: null },
    createdVia: null,
    session: null,
    sessionId: 's-x',
    state: 'ready',
    blockers: [],
    etaMinutes: null,
    ...e,
  })),
});

describe('boardLanes：看板泳道集合', () => {
  it('按合入顺序将开放拉取请求分入泳道', () => {
    const open = [
      pull(11, {
        pullState: state('waiting', {
          kind: 'checks_running',
          check: null,
          started: true,
        }),
      }),
      pull(10, { pullState: state('ready') }),
      pull(12, { pullState: state('human_review') }),
      pull(13, { pullState: state('agent_followup') }),
      pull(14, { pullState: state('ready') }),
    ];
    const queue = [
      target([
        { number: 10, position: 1 },
        { number: 14, position: 2 },
        { number: 11, position: 3 },
        { number: 12, position: 4 },
        { number: 13, position: 5 },
      ]),
    ];
    const { lanes, paused } = boardLanes(open, queue);
    expect(paused).toBe(false);
    expect(lanes.needs.map((c) => c.pull.number)).toEqual([12]);
    expect(lanes.fixing.map((c) => c.pull.number)).toEqual([13]);
    expect(lanes.checking.map((c) => c.pull.number)).toEqual([11]);
    expect(lanes.queued.map((c) => c.pull.number)).toEqual([10, 14]);
  });

  it('队列未列出的请求排在已列出请求之后，并按从旧到新排序', () => {
    const open = [
      pull(20, { createdAt: '2026-10-08T12:00:00.000Z' }),
      pull(21, { createdAt: '2026-10-08T09:00:00.000Z' }),
      pull(22, { createdAt: '2026-10-08T11:00:00.000Z' }),
    ];
    const { lanes } = boardLanes(open, [target([{ number: 22, position: 1 }])]);
    expect(lanes.queued.map((c) => c.pull.number)).toEqual([22, 21, 20]);
  });

  it('使用队列给出的阻塞原因，并说明其他原因的数量', () => {
    const open = [pull(10, { pullState: state('human_review') })];
    const queue = [
      target([
        {
          number: 10,
          blockers: [
            'Data needs a person to decide 1 finding',
            'Lands after #9',
            'Tests are running',
          ],
        },
      ]),
    ];
    const card = boardLanes(open, queue).lanes.needs[0];
    expect(card.blocker.text).toBe('Data needs a person to decide 1 finding');
    expect(card.blocker.more).toEqual(['Lands after #9', 'Tests are running']);
  });

  it('已就绪的拉取请求无需等待', () => {
    const open = [pull(10), pull(11)];
    const queue = [target([{ number: 10 }, { number: 11 }])];
    const [first, second] = boardLanes(open, queue).lanes.queued;
    expect(first.blocker.text).toBe(
      'Nothing is holding it back. It lands next.'
    );
    expect(second.blocker.text).toBe('Nothing is holding it back.');
  });

  it('没有队列时回退到拉取请求自身的原因', () => {
    const open = [
      pull(10, {
        pullState: state('agent_followup', {
          kind: 'check_failed',
          run_number: 7,
          check: 'test (pulls)',
        }),
      }),
    ];
    const card = boardLanes(open, []).lanes.fixing[0];
    expect(card.blocker.text).toBe('The "test (pulls)" check failed (run #7)');
    expect(card.position).toBeNull();
  });

  it('显示评审者和预计耗时，最紧迫的评审者优先', () => {
    const reviewers: PullReviewer[] = [
      { handle: 'sec', name: 'Security', color: '#2a78d6', status: 'approved' },
      { handle: 'data', name: 'Data', color: '#199e70', status: 'flagged' },
    ];
    const open = [
      pull(10, { pullState: state('human_review'), reviewers }),
      pull(11, { pullState: state('ready') }),
    ];
    const { lanes } = boardLanes(open, [
      target([{ number: 10, etaMinutes: 6, blockers: ['x'] }]),
    ]);
    expect(lanes.needs[0].reviewers.map((x) => x.handle)).toEqual([
      'data',
      'sec',
    ]);
    expect(lanes.needs[0].eta).toBe('About 6 min once it is unblocked');
    // A list from a server that sends none has none.
    expect(lanes.queued[0].reviewers).toEqual([]);
  });

  it('阻塞原因未说明时补充堆叠或等待关系', () => {
    const open = [
      pull(11, {
        pullState: state('ready', { kind: 'stacked_on', pr: 10 }),
      }),
      pull(12, {
        pullState: state(
          'human_review',
          { kind: 'agent_flagged', agent: 'dataagent', flags: [] },
          { kind: 'waits_on', pr: 9 }
        ),
      }),
    ];
    const queue = [
      target([
        { number: 11, blockers: ['Lands after #10'] },
        {
          number: 12,
          blockers: ['Data needs a person to decide 1 finding', 'Waits on #9'],
        },
      ]),
    ];
    const { lanes } = boardLanes(open, queue);
    expect(lanes.queued[0].notes).toEqual([]);
    expect(lanes.needs[0].notes).toEqual(['Waits on #9']);
  });

  it('根据队列或拉取请求信息报告合并暂停', () => {
    const paused = {
      at: 1,
      by: { login: 'cho', name: 'Cho', isAgent: false, color: null },
    };
    const open = [
      pull(10, {
        pullState: state('waiting', { kind: 'merging_paused' }),
      }),
    ];
    const viaQueue = boardLanes(open, [target([{ number: 10 }], paused)]);
    expect(viaQueue.paused).toBe(true);
    expect(viaQueue.lanes.queued.map((c) => c.pull.number)).toEqual([10]);
    expect(boardLanes(open, []).paused).toBe(true);
    expect(boardLanes([pull(10)], []).paused).toBe(false);
  });

  it('暂停期间移除预计耗时', () => {
    const paused = {
      at: 1,
      by: { login: 'cho', name: 'Cho', isAgent: false, color: null },
    };
    const open = [
      pull(10, { pullState: state('waiting', { kind: 'merging_paused' }) }),
    ];
    const card = boardLanes(open, [
      target([{ number: 10, etaMinutes: 4 }], paused),
    ]).lanes.queued[0];
    expect(card.eta).toBeNull();
  });
});
