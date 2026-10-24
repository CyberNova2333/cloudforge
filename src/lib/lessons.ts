// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { t, tn } from './i18n';
import type { Lesson, LessonStatus } from './uiApi';

export const LESSON_STATUS: Record<
  LessonStatus,
  { label: string; className: string }
> = {
  pending: { label: t('Queued'), className: 'color-fg-muted' },
  learning: { label: t('Learning'), className: 'color-fg-attention' },
  committed: { label: t('Learned'), className: 'color-fg-success' },
  nothing: { label: t('Nothing to learn'), className: 'color-fg-muted' },
  failed: { label: t('Failed'), className: 'color-fg-danger' },
};

/** "learned from 2 dismissed findings" */
export const learnedPhrase = (findings: number) =>
  tn(
    findings,
    'learned from {n} dismissed finding',
    'learned from {n} dismissed findings'
  );

/** The timeline entry as text: "@secagent learned from 2 dismissed findings · abc1234". */
export const learnedText = (handle: string, findings: number, sha: string) =>
  `@${handle} ${learnedPhrase(findings)} · ${sha.slice(0, 7)}`;

/** A lesson's dismissed findings: `Dismissed "Token logged", "No expiry"`. */
export const dismissedText = (titles: string[]) =>
  titles.length
    ? t('Dismissed {titles}', {
        titles: titles.map((title) => t('"{title}"', { title })).join(t(', ')),
      })
    : t('Dismissed findings');

/** What follows a lesson's status: its commit, why there was nothing to learn (first line), or its error. */
export function lessonNote(
  l: Pick<Lesson, 'status' | 'commitSha' | 'summary' | 'error'>
): { kind: 'commit'; sha: string } | { kind: 'text'; text: string } | null {
  if (l.status === 'committed' && l.commitSha)
    return { kind: 'commit', sha: l.commitSha };
  if (l.status === 'nothing')
    return {
      kind: 'text',
      text: l.summary?.trim().split('\n')[0] || t('Nothing general to learn.'),
    };
  if (l.status === 'failed')
    return { kind: 'text', text: l.error ?? t('Failed.') };
  return null;
}
