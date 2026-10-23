// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  blocking,
  isPaused,
  reasonText,
  STATE_LABEL,
  stateLabel,
  stateText,
} from './pullState';
import type { PullState } from './uiApi';

describe('拉取请求状态文字', () => {
  it('按规范命名每个状态', () => {
    expect(STATE_LABEL).toEqual({
      agent_followup: 'Ready for agent followup',
      human_review: 'Requires human review',
      waiting: 'Waiting for checks',
      ready: 'Ready',
    });
  });

  it('简要说明每种原因', () => {
    expect(
      reasonText({ kind: 'check_failed', run_number: 7, check: 'test' })
    ).toBe('the "test" check failed (run #7)');
    expect(
      reasonText({
        kind: 'agent_flagged',
        agent: 'secagent',
        flags: [
          { id: 'f', title: 'Token' },
          { id: 'g', title: 'Logging' },
        ],
      })
    ).toBe('@secagent flagged 2 findings for a person');
    expect(reasonText({ kind: 'needs_approval' })).toBe(
      'no agent reviewed it: a person approves it'
    );
    expect(
      reasonText({
        kind: 'agent_changes_requested',
        agent: 'secagent',
        changes: [{ id: 'c', title: 'Rotate it', detail: null }],
      })
    ).toBe('@secagent requested 1 change');
    expect(reasonText({ kind: 'agent_reviewing', agent: null })).toBe(
      'agents are reviewing'
    );
    expect(
      reasonText({
        kind: 'agent_review_failed',
        agent: 'dataagent',
        error: 'x',
      })
    ).toBe("@dataagent's review failed");
    expect(
      reasonText({ kind: 'must_account_for', pr: 28, landed: false })
    ).toBe('must account for #28');
    expect(reasonText({ kind: 'stacked_on', pr: 28 })).toBe('stacked on #28');
    expect(reasonText({ kind: 'something_new' })).toBe('something new');
  });

  it('用易懂英文说明合并暂停，并将其视为拉取请求的阻塞原因', () => {
    // Lowercase: callers join reason fragments into sentences ("… ; merging is paused").
    expect(reasonText({ kind: 'merging_paused' })).toBe('merging is paused');
    expect(blocking({ kind: 'merging_paused' })).toBe(true);
  });

  it('仅在等待状态且原因包含暂停时显示已暂停', () => {
    const pause = { kind: 'merging_paused' };
    expect(isPaused({ state: 'waiting', reasons: [pause] })).toBe(true);
    expect(isPaused({ state: 'waiting', reasons: [] })).toBe(false);
    expect(isPaused({ state: 'human_review', reasons: [pause] })).toBe(false);
    expect(isPaused({ state: 'ready', reasons: [] })).toBe(false);
    expect(isPaused(null)).toBe(false);
    expect(isPaused(undefined)).toBe(false);
  });

  it('合并暂停导致等待的拉取请求显示已暂停，而非等待检查', () => {
    const paused: PullState = {
      state: 'waiting',
      reasons: [{ kind: 'merging_paused' }],
    };
    expect(stateLabel(paused)).toBe('Paused');
    expect(stateText(paused).label).toBe('Paused');
    // Whatever else holds it, the pause is why it isn't landing.
    expect(
      stateLabel({
        state: 'waiting',
        reasons: [
          { kind: 'checks_running', check: 'test', started: true },
          { kind: 'merging_paused' },
        ],
      })
    ).toBe('Paused');
    // Without the pause the label is the state's own.
    expect(
      stateLabel({
        state: 'waiting',
        reasons: [{ kind: 'checks_running', check: 'test', started: true }],
      })
    ).toBe('Waiting for checks');
    expect(stateLabel({ state: 'waiting', reasons: [] })).toBe(
      'Waiting for checks'
    );
    // A person's or an agent's move stays that move, pause or not.
    expect(
      stateLabel({
        state: 'human_review',
        reasons: [{ kind: 'needs_approval' }, { kind: 'merging_paused' }],
      })
    ).toBe('Requires human review');
    expect(
      stateLabel({
        state: 'agent_followup',
        reasons: [{ kind: 'merging_paused' }],
      })
    ).toBe('Ready for agent followup');
    expect(
      stateText({
        state: 'ready',
        reasons: [{ kind: 'stacked_on', pr: 3 }],
      }).label
    ).toBe('Ready, stacked on #3');
  });

  it('将暂停作为已暂停请求的等待原因', () => {
    expect(
      stateText({ state: 'waiting', reasons: [{ kind: 'merging_paused' }] })
        .reason
    ).toBe('merging is paused');
    // Stacking only informs: the pause is still the first thing that holds it.
    expect(
      stateText({
        state: 'waiting',
        reasons: [{ kind: 'stacked_on', pr: 3 }, { kind: 'merging_paused' }],
      }).reason
    ).toBe('merging is paused');
  });

  it('省略缺失数字而非显示 NaN', () => {
    expect(reasonText({ kind: 'check_failed', check: null })).toBe(
      'a check failed'
    );
    expect(reasonText({ kind: 'changes_requested' })).toBe(
      'changes requested on review flags'
    );
  });

  it('区分仅提供信息的原因', () => {
    expect(blocking({ kind: 'stacked_on', pr: 1 })).toBe(false);
    expect(blocking({ kind: 'must_account_for', pr: 1, landed: false })).toBe(
      true
    );
    expect(blocking({ kind: 'check_failed', run_number: 1, check: null })).toBe(
      true
    );
  });

  it('说明变基目标和变基冲突', () => {
    expect(
      reasonText({
        kind: 'rebase_onto',
        pr: 28,
        branch: 'setup-checks',
        why: 'x',
      })
    ).toBe('CloudForge is rebasing it onto #28 (setup-checks)');
    expect(
      reasonText({
        kind: 'rebase_conflict',
        commit: 'abc1234def',
        files: ['x.ts', 'y.ts'],
        error: null,
      })
    ).toBe('commit abc1234 conflicts in x.ts, y.ts');
    expect(
      reasonText({
        kind: 'rebase_conflict',
        commit: null,
        files: [],
        error: 'Too many commits.',
      })
    ).toBe('Too many commits.');
  });
});
