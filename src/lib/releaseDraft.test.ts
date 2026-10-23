// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { FIRST_NOTES, refreshDraft, suggestedDraft } from './releaseDraft';

const changes = (latest: string | null, next: string | null, notes: string) =>
  ({ latest, next, notesPreview: notes }) as Parameters<
    typeof suggestedDraft
  >[0];

describe('suggestedDraft：建议草稿', () => {
  it('建议下一版本及发行说明，首次发布则由用户输入', () => {
    expect(suggestedDraft(changes('v0.1.0', 'v0.2.0', '### Minor'))).toEqual({
      version: 'v0.2.0',
      notes: '### Minor',
    });
    expect(suggestedDraft(changes(null, null, FIRST_NOTES))).toEqual({
      version: '',
      notes: FIRST_NOTES,
    });
  });
});

describe('refreshDraft：刷新草稿', () => {
  const before = { version: 'v0.2.0', notes: 'old notes' };
  const after = { version: 'v1.0.0', notes: 'new notes' };

  it('将仍等于旧建议的字段更新为新建议', () => {
    expect(refreshDraft(before, before, after)).toEqual(after);
  });

  it('保留用户输入的内容', () => {
    expect(
      refreshDraft({ version: 'v0.3.0', notes: 'mine' }, before, after)
    ).toEqual({ version: 'v0.3.0', notes: 'mine' });
    expect(
      refreshDraft({ version: 'v0.2.0', notes: 'mine' }, before, after)
    ).toEqual({ version: 'v1.0.0', notes: 'mine' });
    expect(
      refreshDraft({ version: 'v0.5.0', notes: 'old notes' }, before, after)
    ).toEqual({ version: 'v0.5.0', notes: 'new notes' });
  });
});
