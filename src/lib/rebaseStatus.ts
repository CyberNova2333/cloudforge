// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { t, tn } from './i18n';
import type { MergeRefusal, RebaseView } from './uiApi';

const sha7 = (s: unknown) => (typeof s === 'string' ? s.slice(0, 7) : '');

/** The merge box's line about the branch against its base. */
export function rebaseHeadline(
  r: RebaseView,
  headRef: string
): { title: string; detail: string } {
  switch (r.status) {
    case 'nothing_to_merge':
      return {
        title: t('This branch is up to date'),
        detail: t('There is nothing to merge.'),
      };
    case 'up_to_date':
      return {
        title: t('Up to date with {onto}', { onto: r.onto }),
        detail: t(
          'Merging moves the target branch to this branch’s head: its commits land as they are.'
        ),
      };
    case 'behind':
      return {
        title: t('Behind {onto}', { onto: r.onto }),
        detail: t(
          'CloudForge rebases it onto the latest commits; merging rebases it first if it still needs to.'
        ),
      };
    case 'resolving':
      return {
        title: r.commit
          ? t('Resolving commit {sha}’s conflict with AI', {
              sha: sha7(r.commit),
            })
          : t('Resolving a conflict with AI'),
        detail: t(
          'The rebase onto {onto} stopped there; an agent is resolving it and the rebase goes on.',
          { onto: r.onto }
        ),
      };
    case 'conflict':
      return {
        title: r.commit
          ? t('Commit {sha} conflicts with {onto}', {
              sha: sha7(r.commit),
              onto: r.onto,
            })
          : t('This branch can’t be rebased onto {onto}', { onto: r.onto }),
        detail:
          r.error ??
          t('Rebase {head} onto {onto} locally, then push.', {
            head: headRef,
            onto: r.onto,
          }),
      };
  }
}

/**
 * Whether a person may try the rebase again: it stopped (a conflict), and not on a branch CloudForge never rebases
 * ("Not rebased: …", which only bringing the branch up to date clears).
 */
export function canRetryRebase(r: RebaseView | null): boolean {
  return r?.status === 'conflict' && !r.error?.startsWith('Not rebased:');
}

/** The `rebased` timeline entry as text. */
export function rebasedText(d: Record<string, unknown>): string {
  const skipped = Number(d.skipped) || 0;
  const resolved = Number(d.resolved) || 0;
  const onto = d.onto != null ? String(d.onto) : t('its base');
  return (
    t('CloudForge rebased this branch onto {onto} ({from} → {to})', {
      onto,
      from: sha7(d.from),
      to: sha7(d.to),
    }) +
    (skipped
      ? tn(
          skipped,
          ', skipping {n} commit {onto} already has',
          ', skipping {n} commits {onto} already has',
          { onto }
        )
      : '') +
    (resolved
      ? tn(
          resolved,
          '; AI resolved the conflicts of {n} commit',
          '; AI resolved the conflicts of {n} commits'
        )
      : '')
  );
}

/**
 * A merge refusal that is a normal outcome, not an error: landing rebased the branch first and now waits for the
 * new head's checks or review (it lands once they pass). `status` and `body` are the ApiError's.
 */
export function rebasedFirst(status: number, body: unknown): boolean {
  if (status !== 409 || !body || typeof body !== 'object') return false;
  const b = body as MergeRefusal;
  return (
    typeof b.rebased === 'string' &&
    !!b.rebased &&
    (b.reason === 'checks' || b.reason === 'review')
  );
}
