// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  AI_VIA,
  clockTime,
  decidedByText,
  delegatedText,
  findingEventText,
  possessive,
} from './claudeLog';
import type { AuditEvent, DelegatedEvent } from './uiApi';

const delegated = (
  decision: 'approve' | 'request_changes' | 'leave',
  over: Partial<DelegatedEvent['data']> = {}
): DelegatedEvent => ({
  id: 'e1',
  at: Date.UTC(2026, 9, 8, 12, 2),
  actor: { kind: 'ai', login: 'mahmoud', name: 'Mahmoud' },
  via: AI_VIA,
  action: 'finding.delegated',
  target: 'Removes CSV export',
  repo: 'cho/app',
  pull: 68,
  data: {
    finding: 'f1',
    kind: 'needs_person',
    agent: 'featureagent',
    decision,
    reason: 'The Downloads page replaces it.',
    undone: false,
    undoable: true,
    ...over,
  },
});

const event = (
  action: string,
  data: Record<string, unknown> = {},
  over: Partial<AuditEvent> = {}
): AuditEvent => ({
  id: 'e',
  at: 0,
  actor: { kind: 'person', login: 'cho', name: 'Cho' },
  via: null,
  action,
  target: 'Finding',
  data,
  repo: 'cho/app',
  pull: 3,
  ...over,
});

describe('名称', () => {
  it('按文案规则生成名称的所有格', () => {
    expect(possessive('Data')).toBe('Data’s');
    expect(possessive('Features')).toBe('Features’');
    expect(possessive('@speedagent')).toBe('@speedagent’s');
  });
});

describe('Claude 今日操作', () => {
  it('每个回答显示为一行', () => {
    expect(delegatedText(delegated('approve'), 'Features')).toBe(
      'Claude approved Features’ finding on #68'
    );
    expect(delegatedText(delegated('request_changes'), 'Data')).toBe(
      'Claude requested changes on #68 for Data’s finding'
    );
    expect(delegatedText(delegated('leave'), 'Speed')).toBe(
      'Claude left Speed’s finding on #68 for you'
    );
  });

  it('以小时和分钟显示时间', () => {
    const at = new Date(2026, 9, 8, 9, 5).getTime();
    expect(clockTime(at)).toBe('09:05');
    expect(clockTime(new Date(2026, 9, 8, 17, 42).getTime())).toBe('17:42');
  });
});

describe('决定者', () => {
  const me = 'mahmoud';
  const ref = (login: string, name: string | null = null) => ({
    login,
    name,
    isAgent: false,
    color: null,
  });

  it('显示“你”、姓名、应用或代表他人的 Claude', () => {
    expect(decidedByText(ref('mahmoud', 'Mahmoud'), null, me)).toBe('you');
    expect(decidedByText(ref('cho', 'Cho'), null, me)).toBe('Cho');
    expect(decidedByText(ref('cho'), null, me)).toBe('@cho');
    expect(decidedByText(ref('cho', 'Cho'), 'Claude Mod', me)).toBe(
      'Cho via Claude Mod'
    );
    expect(decidedByText(ref('mahmoud', 'Mahmoud'), AI_VIA, me)).toBe(
      'Claude for you'
    );
    expect(decidedByText(ref('cho', 'Cho'), AI_VIA, me)).toBe('Claude for Cho');
    expect(decidedByText(null, null, me)).toBe('someone');
  });
});

describe('问题历史', () => {
  const ctx = { me: 'mahmoud', agentName: 'Security' };

  it('显示批准和驳回及其理由', () => {
    expect(
      findingEventText(
        event('finding.approved', { reason: 'Accepted risk' }),
        ctx
      )
    ).toBe('Cho approved it. Reason: Accepted risk.');
    expect(
      findingEventText(
        event('finding.approved', { kind: 'change_requested' }),
        ctx
      )
    ).toBe('Cho dismissed it.');
    expect(
      findingEventText(
        event(
          'finding.approved',
          {},
          { actor: { kind: 'person', login: 'mahmoud', name: 'Mahmoud' } }
        ),
        ctx
      )
    ).toBe('You approved it.');
    expect(
      findingEventText(
        event('finding.approved', {}, { via: 'Claude Mod' }),
        ctx
      )
    ).toBe('Cho via Claude Mod approved it.');
  });

  it('显示修改要求及其备注', () => {
    expect(
      findingEventText(
        event('finding.changes_requested', { note: 'Check sign-in' }),
        ctx
      )
    ).toBe('Cho requested changes: “Check sign-in”');
    expect(
      findingEventText(event('finding.changes_requested', { note: null }), ctx)
    ).toBe('Cho requested changes.');
  });

  it('显示受邀作出决定的人', () => {
    expect(
      findingEventText(event('finding.assigned', { assignee: 'ada' }), ctx)
    ).toBe('Cho asked @ada to decide.');
    expect(
      findingEventText(event('finding.assigned', { assignee: 'mahmoud' }), ctx)
    ).toBe('Cho asked you to decide.');
    expect(
      findingEventText(event('finding.assigned', { assignee: null }), ctx)
    ).toBe('Cho took the question back.');
  });

  it('显示 Claude 的回答、代表的人和原因', () => {
    const ai = {
      actor: { kind: 'ai' as const, login: 'mahmoud', name: 'Mahmoud' },
      via: AI_VIA,
    };
    expect(
      findingEventText(
        event(
          'finding.delegated',
          { decision: 'approve', reason: 'Low risk.' },
          ai
        ),
        ctx
      )
    ).toBe('Claude approved it for you: Low risk.');
    expect(
      findingEventText(
        event(
          'finding.delegated',
          { decision: 'request_changes', reason: 'Add a check' },
          { ...ai, actor: { kind: 'ai', login: 'cho', name: 'Cho' } }
        ),
        ctx
      )
    ).toBe('Claude requested changes for Cho: Add a check.');
    expect(
      findingEventText(
        event(
          'finding.delegated',
          { decision: 'leave', reason: 'Not sure.' },
          ai
        ),
        ctx
      )
    ).toBe('Claude left it for you: Not sure.');
  });

  it('显示撤销的操作与教学内容', () => {
    expect(
      findingEventText(event('finding.undone', { undid: 'approved' }), ctx)
    ).toBe('Cho undid the approval.');
    expect(
      findingEventText(
        event('finding.undone', { undid: 'changes_requested', via: AI_VIA }),
        ctx
      )
    ).toBe('Cho undid Claude’s request for changes.');
    expect(
      findingEventText(event('finding.undone', { undid: 'dismissed' }), ctx)
    ).toBe('Cho undid the dismissal.');
    expect(
      findingEventText(
        event('finding.taught', { teach: 'Public links may skip sign-in.' }),
        ctx
      )
    ).toBe('Cho taught Security: “Public links may skip sign-in.”');
  });

  it('其他情况回退到操作名', () => {
    expect(
      findingEventText(
        event(
          'pull.merged',
          {},
          { actor: { kind: 'system', login: null, name: null } }
        ),
        ctx
      )
    ).toBe('CloudForge: pull.merged.');
  });
});
