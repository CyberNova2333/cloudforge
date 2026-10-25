// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { t, tn } from './i18n';
import type { PullReason, PullState, PullStateName } from './uiApi';

export const STATE_LABEL: Record<PullStateName, string> = {
  agent_followup: t('Ready for agent followup'),
  human_review: t('Requires human review'),
  waiting: t('Waiting for checks'),
  ready: t('Ready'),
};

/** Primer Label modifiers per state. */
export const STATE_CLASS: Record<PullStateName, string> = {
  agent_followup: 'Label--attention',
  human_review: 'Label--severe',
  waiting: 'Label--secondary',
  ready: 'Label--success',
};

const INFO = new Set(['stacked_on', 'waits_on']);
/** Whether a reason holds the PR in its state (others only inform). */
export const blocking = (r: PullReason) => !INFO.has(r.kind);

const n = (v: unknown) => Number(v);
const has = (v: unknown) => v != null && Number.isFinite(Number(v));
const prs = (v: unknown) =>
  ((v as number[]) ?? []).map((x) => `#${x}`).join(', ');

/** A reason in a few words, for labels, banners and the timeline. */
export function reasonText(r: PullReason): string {
  switch (r.kind) {
    case 'check_failed': {
      const check = r.check ? String(r.check) : null;
      // Run 0: a status a CI server reported, not an Actions run.
      const run =
        has(r.run_number) && n(r.run_number) > 0 ? n(r.run_number) : null;
      if (check && run !== null)
        return t('the "{check}" check failed (run #{run})', { check, run });
      if (check) return t('the "{check}" check failed', { check });
      if (run !== null) return t('a check failed (run #{run})', { run });
      return t('a check failed');
    }
    case 'changes_requested':
      return has(r.flags)
        ? tn(
            n(r.flags),
            'changes requested on {n} flag',
            'changes requested on {n} flags'
          )
        : t('changes requested on review flags');
    case 'rebase_conflict':
      return r.commit
        ? t('commit {sha} conflicts in {files}', {
            sha: String(r.commit).slice(0, 7),
            files: ((r.files as string[]) ?? []).join(', '),
          })
        : r.error != null
          ? String(r.error)
          : t('the rebase stopped');
    case 'must_account_for':
      return r.branch
        ? t('must account for #{pr}, after rebasing onto {branch}', {
            pr: n(r.pr),
            branch: String(r.branch),
          })
        : t('must account for #{pr}', { pr: n(r.pr) });
    case 'rebase_onto':
      return t('CloudForge is rebasing it onto #{pr} ({branch})', {
        pr: n(r.pr),
        branch: String(r.branch),
      });
    case 'cycle':
      return t('depends in a circle on {prs}', { prs: prs(r.prs) });
    case 'checks_running':
      return r.check
        ? r.started
          ? t('the "{check}" check is running', { check: String(r.check) })
          : t('waiting for the "{check}" check', { check: String(r.check) })
        : r.started
          ? t('checks are running')
          : t('no checks have run yet');
    case 'resolution_running':
      return t('AI is resolving conflicts');
    case 'stack_checking':
      return (r.prs as number[] | undefined)?.length
        ? t('checking against {prs}', { prs: prs(r.prs) })
        : t('checking how it relates to other open pull requests');
    case 'stacked_on':
      return t('stacked on #{pr}', { pr: n(r.pr) });
    case 'waits_on':
      return t('waits on #{pr}', { pr: n(r.pr) });
    case 'agent_reviewing':
      return r.agent
        ? t('@{agent} is reviewing', { agent: String(r.agent) })
        : t('agents are reviewing');
    case 'agent_flagged':
      return tn(
        ((r.flags as unknown[]) ?? []).length,
        '@{agent} flagged {n} finding for a person',
        '@{agent} flagged {n} findings for a person',
        { agent: String(r.agent) }
      );
    case 'agent_changes_requested':
      return tn(
        ((r.changes as unknown[]) ?? []).length,
        '@{agent} requested {n} change',
        '@{agent} requested {n} changes',
        { agent: String(r.agent) }
      );
    case 'agent_review_failed':
      return r.agent
        ? t("@{agent}'s review failed", { agent: String(r.agent) })
        : t('the review failed');
    case 'needs_approval':
      return t('no agent reviewed it: a person approves it');
    case 'merging_paused':
      return t('merging is paused');
    default:
      return r.kind.replace(/_/g, ' ');
  }
}

/**
 * The state's label: `STATE_LABEL`, except that a waiting pull request merging is paused on reads "Paused" (the pause
 * is why it is not landing, whatever else it waits for). A person's or an agent's move keeps its own label.
 */
export function stateLabel(state: PullState): string {
  return isPaused(state) ? t('Paused') : STATE_LABEL[state.state];
}

/** A waiting pull request merging is paused on: the pause is why it is not landing, whatever else it waits for. */
export function isPaused(state: PullState | null | undefined): boolean {
  return (
    state?.state === 'waiting' &&
    state.reasons.some((r) => r.kind === 'merging_paused')
  );
}

/** The state as the list's label reads it ("Ready, stacked on #3"), and the first reason it shows beside it. */
export function stateText(state: PullState): {
  label: string;
  reason: string | null;
} {
  const stacked = state.reasons.find((r) => r.kind === 'stacked_on');
  const first = state.reasons.find(blocking) ?? state.reasons[0];
  return {
    label:
      state.state === 'ready' && stacked
        ? t('{label}, stacked on #{pr}', {
            label: stateLabel(state),
            pr: Number(stacked.pr),
          })
        : stateLabel(state),
    // A ready PR's label already says what it's stacked on.
    reason:
      first && !(state.state === 'ready' && first === stacked)
        ? reasonText(first)
        : null,
  };
}
