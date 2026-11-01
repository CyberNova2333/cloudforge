// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  dismissedText,
  learnedPhrase,
  learnedText,
  LESSON_STATUS,
  lessonNote,
} from './lessons';

describe('学习记录', () => {
  it('与时间线事件的描述一致', () => {
    expect(learnedText('secagent', 2, 'abcdef1234')).toBe(
      '@secagent learned from 2 dismissed findings · abcdef1'
    );
    expect(learnedPhrase(1)).toBe('learned from 1 dismissed finding');
  });

  it('列出被驳回的问题', () => {
    expect(dismissedText(['Token logged', 'No expiry'])).toBe(
      'Dismissed "Token logged", "No expiry"'
    );
    expect(dismissedText([])).toBe('Dismissed findings');
  });

  it('在状态之后显示提交、说明或错误', () => {
    const base = { commitSha: null, summary: null, error: null };
    expect(
      lessonNote({ ...base, status: 'committed', commitSha: 'a'.repeat(40) })
    ).toEqual({ kind: 'commit', sha: 'a'.repeat(40) });
    expect(
      lessonNote({
        ...base,
        status: 'nothing',
        summary: 'One-offs.\nNothing general.',
      })
    ).toEqual({ kind: 'text', text: 'One-offs.' });
    expect(lessonNote({ ...base, status: 'nothing' })).toEqual({
      kind: 'text',
      text: 'Nothing general to learn.',
    });
    expect(
      lessonNote({ ...base, status: 'failed', error: 'Too big.' })
    ).toEqual({
      kind: 'text',
      text: 'Too big.',
    });
    expect(lessonNote({ ...base, status: 'learning' })).toBeNull();
    expect(LESSON_STATUS.committed.label).toBe('Learned');
  });
});
