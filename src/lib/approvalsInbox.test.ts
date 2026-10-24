// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  askCandidates,
  dedupeItems,
  displayOrder,
  findingSentence,
  guardMessage,
  inboxRows,
  isOwnerQuestion,
  keyAction,
  moveCurrent,
  onlyAssignedTo,
  selectable,
  splitFindingDetail,
  type FindingRow,
} from './approvalsInbox';
import type { ApprovalItem, Member, ReviewFlag, User } from './uiApi';

const user = (username: string, name = username): User => ({
  id: `u-${username}`,
  username,
  name,
  image: null,
});

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
  question: null,
  guarded: false,
  assignee: null,
  decidedVia: null,
  reason: null,
  teach: null,
  ...over,
});

const item = (n: number, over: Partial<ApprovalItem> = {}): ApprovalItem => ({
  repo: { fullName: 'cho/app', name: 'app' },
  pull: {
    number: n,
    title: `Pull ${n}`,
    author: user('cho'),
    updatedAt: '2026-10-08T10:00:00.000Z',
    headSha: 'abc1234',
    createdVia: null,
    sessionLabel: null,
    sessionId: 'sess-1',
  },
  reviewFailed: null,
  resolutionFailed: null,
  needsApproval: false,
  agents: [],
  pullState: null,
  stackStale: [],
  stackUnchecked: [],
  ...over,
});

const findingRow = (f: ReviewFlag, agent = user('securityagent', 'Security')) =>
  inboxRows([
    item(1, {
      agents: [
        { reviewerId: 'r1', agent, status: 'flagged', error: null, flags: [f] },
      ],
    }),
  ])[0] as FindingRow;

describe('审批收件箱行', () => {
  it('将所有类型的条目按原页面顺序转换为行', () => {
    const rows = inboxRows([
      item(7, {
        reviewFailed: 'The model timed out',
        resolutionFailed: "AI couldn't resolve its conflicts: boom",
        stackStale: [{ pr: 3, since: '2026-10-01T00:00:00.000Z' }],
        stackUnchecked: [4, 5],
        needsApproval: true,
        agents: [
          {
            reviewerId: 'r1',
            agent: user('dataagent', 'Data'),
            status: 'failed',
            error: 'no model',
            flags: [],
          },
          {
            reviewerId: 'r2',
            agent: user('securityagent', 'Security'),
            status: 'flagged',
            error: null,
            flags: [flag('f1'), flag('f2')],
          },
        ],
      }),
    ]);
    expect(rows.map((r) => [r.type, r.key])).toEqual([
      ['review-failed', 'rf:cho/app#7'],
      ['resolution-failed', 'rs:cho/app#7'],
      ['stack-stale', 'st:cho/app#7:3'],
      ['stack-unchecked', 'su:cho/app#7'],
      ['needs-approval', 'na:cho/app#7'],
      ['reviewer-failed', 'rv:r1'],
      ['finding', 'f:f1'],
      ['finding', 'f:f2'],
    ]);
    expect(rows[0]).toMatchObject({
      owner: 'cho',
      name: 'app',
      repo: 'cho/app',
      prUrl: '/cho/app/pull/7',
    });
  });

  it('仅在不适用其他条目时显示因其他原因需要人工处理的拉取请求，且只显示一次', () => {
    const state = {
      state: 'human_review' as const,
      reasons: [{ kind: 'stack_cycle' }],
    };
    expect(
      inboxRows([item(2, { pullState: state })]).map((r) => r.type)
    ).toEqual(['human-review']);
    expect(
      inboxRows([item(2, { pullState: state, needsApproval: true })]).map(
        (r) => r.type
      )
    ).toEqual(['needs-approval']);
  });

  it('拉取请求需要批准且代理的修改要求仍有效时给出警告', () => {
    const plain = inboxRows([item(1, { needsApproval: true })])[0];
    expect(plain).toMatchObject({ changeRequested: false });
    const asked = inboxRows([
      item(1, {
        needsApproval: true,
        pullState: {
          state: 'human_review',
          reasons: [{ kind: 'agent_changes_requested' }],
        },
      }),
    ])[0];
    expect(asked).toMatchObject({ changeRequested: true });
  });

  it('每个拉取请求仅显示一次，并保留其首次出现的页码', () => {
    const a = item(1);
    const again = item(1, { needsApproval: true });
    const b = item(2);
    expect(
      dedupeItems([{ items: [a, b] }, { items: [again] }]).map((i) => [
        i.pull.number,
        i.needsApproval,
      ])
    ).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it('仅保留被指派给当前用户决定的问题', () => {
    const mine = flag('f1', {
      assignee: { login: 'mahmoud', name: null, isAgent: false, color: null },
    });
    const rows = inboxRows([
      item(1, {
        needsApproval: true,
        agents: [
          {
            reviewerId: 'r',
            agent: user('dataagent'),
            status: 'flagged',
            error: null,
            flags: [mine, flag('f2')],
          },
        ],
      }),
    ]);
    expect(onlyAssignedTo(rows, 'mahmoud').map((r) => r.key)).toEqual(['f:f1']);
    expect(onlyAssignedTo(rows, 'MAHMOUD').map((r) => r.key)).toEqual(['f:f1']);
  });
});

describe('可选择项与键盘操作', () => {
  it('受保护问题、所有者问题和已决定问题都不能批量批准', () => {
    expect(selectable(findingRow(flag('a')))).toBe(true);
    expect(selectable(findingRow(flag('a', { guarded: true })))).toBe(false);
    expect(selectable(findingRow(flag('a', { question: 'Was it?' })))).toBe(
      false
    );
    expect(
      selectable(
        findingRow(
          flag('a', { changesRequestedAt: '2026-10-08T10:00:00.000Z' })
        )
      )
    ).toBe(false);
    expect(selectable(inboxRows([item(1, { needsApproval: true })])[0])).toBe(
      false
    );
  });

  it('区分所有者问题与开发者问题', () => {
    expect(isOwnerQuestion(findingRow(flag('a', { question: 'Q?' })))).toBe(
      true
    );
    expect(isOwnerQuestion(findingRow(flag('a')))).toBe(false);
    expect(
      isOwnerQuestion(
        findingRow(flag('a', { question: 'Q?', kind: 'change_requested' }))
      )
    ).toBe(false);
  });

  it('使用 j 和 k 在行间移动，使用 A 批准所选项', () => {
    expect(keyAction('j', null)).toEqual({ kind: 'move', dir: 1 });
    expect(keyAction('k', null)).toEqual({ kind: 'move', dir: -1 });
    expect(keyAction('A', null)).toEqual({ kind: 'bulk' });
    expect(keyAction('a', null)).toBeNull();
  });

  it('使用单键批准、要求修改、驳回或选择普通问题', () => {
    const row = findingRow(flag('a'), user('speedagent', 'Speed'));
    expect(keyAction('o', row)).toEqual({ kind: 'open' });
    expect(keyAction('Enter', row)).toEqual({ kind: 'open' });
    expect(keyAction('a', row)).toEqual({ kind: 'approve' });
    expect(keyAction('r', row)).toEqual({ kind: 'panel', panel: 'changes' });
    expect(keyAction('d', row)).toEqual({ kind: 'panel', panel: 'dismiss' });
    expect(keyAction('x', row)).toEqual({ kind: 'select' });
    expect(keyAction('q', row)).toBeNull();
  });

  it('受保护问题不能单键批准或选择，而是打开详情并说明原因', () => {
    const row = findingRow(flag('a', { guarded: true }));
    expect(keyAction('a', row)).toEqual({
      kind: 'open',
      toast: 'Security findings need a reason. Open it to decide.',
    });
    expect(keyAction('d', row)).toEqual({
      kind: 'open',
      toast: 'Security findings need a reason. Open it to decide.',
    });
    expect(keyAction('x', row)).toEqual({
      kind: 'toast',
      message: "Security findings can't be approved in bulk.",
    });
    expect(keyAction('r', row)).toEqual({ kind: 'panel', panel: 'changes' });
  });

  it('对所有者问题按 a、r、d 均打开详情页', () => {
    const row = findingRow(flag('a', { question: 'Were they all CAD?' }));
    for (const k of ['a', 'r', 'd', 'o'])
      expect(keyAction(k, row)).toEqual({ kind: 'open' });
    expect(keyAction('x', row)).toBeNull();
  });

  it('按 a 或 d 打开受保护代理的所有者问题时提示需要理由', () => {
    const row = findingRow(
      flag('a', { question: 'Were they all CAD?', guarded: true }),
      user('dataagent', 'Data')
    );
    const toast = 'Data findings need a reason. Open it to decide.';
    expect(keyAction('a', row)).toEqual({ kind: 'open', toast });
    expect(keyAction('d', row)).toEqual({ kind: 'open', toast });
    expect(keyAction('r', row)).toEqual({ kind: 'open' });
    expect(keyAction('x', row)).toBeNull();
  });

  it('对其他行打开详情并忽略决定快捷键', () => {
    const row = inboxRows([item(1, { needsApproval: true })])[0];
    expect(keyAction('o', row)).toEqual({ kind: 'open' });
    for (const k of ['a', 'r', 'd', 'x']) expect(keyAction(k, row)).toBeNull();
  });

  it('对已要求修改的问题不再选择或重复要求修改', () => {
    const asked = { changesRequestedAt: '2026-10-08T10:00:00.000Z' };
    const row = findingRow(flag('a', asked));
    expect(keyAction('x', row)).toBeNull();
    expect(keyAction('r', row)).toBeNull();
    expect(keyAction('a', row)).toEqual({ kind: 'approve' });
    expect(keyAction('d', row)).toEqual({ kind: 'panel', panel: 'dismiss' });
    const guarded = findingRow(flag('b', { ...asked, guarded: true }));
    expect(keyAction('r', guarded)).toBeNull();
    expect(keyAction('a', guarded)).toMatchObject({ kind: 'open' });
  });

  it('说明受保护代理为何需要理由，并包含代理名称', () => {
    expect(guardMessage('Data')).toBe(
      'Data findings need a reason. Open it to decide.'
    );
  });

  it('移动当前行并在两端停止', () => {
    const keys = ['a', 'b', 'c'];
    expect(moveCurrent(keys, null, 1)).toBe('a');
    expect(moveCurrent(keys, 'gone', -1)).toBe('a');
    expect(moveCurrent(keys, 'a', 1)).toBe('b');
    expect(moveCurrent(keys, 'c', 1)).toBe('c');
    expect(moveCurrent(keys, 'a', -1)).toBe('a');
    expect(moveCurrent([], 'a', 1)).toBeNull();
  });
});

describe('原位显示处理回执', () => {
  it('列表刷新后即使不再返回已决定条目，仍保留其原位置', () => {
    expect(
      displayOrder(
        ['a', 'c'],
        [
          { key: 'b', index: 1 },
          { key: 'a', index: 0 },
        ]
      )
    ).toEqual(['a', 'b', 'c']);
    expect(displayOrder(['a'], [{ key: 'z', index: 9 }])).toEqual(['a', 'z']);
    expect(
      displayOrder(
        [],
        [
          { key: 'y', index: 1 },
          { key: 'x', index: 0 },
        ]
      )
    ).toEqual(['x', 'y']);
  });
});

describe('问题的原始记录', () => {
  const detail = [
    'Opening a link downloads the file without checking who is signed in.',
    '| | Before | After |\n|---|---|---|\n| **Sign-in** | Required | Not checked |',
    '```mermaid\nflowchart LR\n  A --> B\n```',
    '<details><summary><code>worker/src/share.ts</code> lines 3–5</summary>\n\n```diff\n-  const user = await requireUser(c);\n+  const link = await find(c);\n```\n\n</details>',
    '<details><summary><code>src/a.ts</code> lines 1–2</summary>\n\n```diff\n+x\n```\n\n</details>',
  ].join('\n\n');

  it('将内容拆分为句子、表格、图表和摘录', () => {
    const parts = splitFindingDetail(detail);
    expect(parts.sentence).toBe(
      'Opening a link downloads the file without checking who is signed in.'
    );
    expect(parts.table).toBe(
      '| | Before | After |\n|---|---|---|\n| **Sign-in** | Required | Not checked |'
    );
    expect(parts.diagram).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(parts.excerpts).toHaveLength(2);
    expect(parts.excerpts[0]).toContain('worker/src/share.ts');
    expect(parts.excerpts[0]).toContain('</details>');
    expect(parts.rest).toBeNull();
  });

  it('保留无法识别的内容，并处理缺少详情的情况', () => {
    expect(splitFindingDetail(null)).toEqual({
      sentence: null,
      table: null,
      diagram: null,
      excerpts: [],
      rest: null,
    });
    const parts = splitFindingDetail('One sentence.\n\nA second paragraph.');
    expect(parts.sentence).toBe('One sentence.');
    expect(parts.rest).toBe('A second paragraph.');
    expect(splitFindingDetail('| a |\n|---|\n| b |').sentence).toBeNull();
  });

  it('仅在补充信息时将该句显示在标题下方', () => {
    expect(
      findingSentence(flag('a', { title: 'Removes CSV export', detail }))
    ).toBe(
      'Opening a link downloads the file without checking who is signed in.'
    );
    expect(
      findingSentence(
        flag('a', {
          title: 'Removes CSV export',
          detail: 'Removes CSV export.',
        })
      )
    ).toBeNull();
    expect(findingSentence(flag('a'))).toBeNull();
  });
});

describe('可请求协助的人', () => {
  const member = (
    username: string,
    role = 'user',
    name = username
  ): Member => ({
    ...user(username, name),
    email: null,
    role,
    createdAt: '2026-01-01',
  });

  it('列出具有推送权限的站点管理员、协作者和所有者，并排除自己', () => {
    expect(
      askCandidates({
        members: [
          member('mahmoud', 'admin', 'Mahmoud'),
          member('ada', 'admin', 'Ada'),
          member('cho', 'user', 'Cho'),
          member('reader', 'user', 'Reader'),
          member('zed', 'user', 'Zed'),
        ],
        collaborators: [user('zed', 'Zed'), user('ada', 'Ada')],
        owner: 'cho',
        me: 'mahmoud',
      })
    ).toEqual([
      { login: 'ada', name: 'Ada' },
      { login: 'cho', name: 'Cho' },
      { login: 'zed', name: 'Zed' },
    ]);
  });

  it('排除不是自然人的团队所有者', () => {
    expect(
      askCandidates({
        members: [member('cho')],
        collaborators: [],
        owner: 'acme',
        me: 'mahmoud',
      })
    ).toEqual([]);
  });
});
