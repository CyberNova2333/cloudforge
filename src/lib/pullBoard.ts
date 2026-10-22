/**
 * The Pull requests board: open pull requests in lanes by whose move it is, each card with who is reviewing it,
 * what holds it back and when it should land. Built from the pull request list (`pullState`) and the merge queue
 * (blockers, order, estimate), with no request per pull request.
 */
import type { Tone } from './agentLook';
import { t, tServer } from './i18n';
import { blocking, isPaused, reasonText, stateLabel } from './pullState';
import type { Pull, PullReviewer, PullState, QueueTarget } from './uiApi';

export type LaneId = 'needs' | 'fixing' | 'checking' | 'queued';

export const LANE_ORDER: readonly LaneId[] = [
  'needs',
  'fixing',
  'checking',
  'queued',
];

const LANE_LABEL: Record<LaneId, string> = {
  needs: t('Needs you'),
  fixing: t('Being fixed'),
  checking: t('Checking'),
  queued: t('Queued'),
};

/** Merging is paused, as this pull request's reasons say (whatever its state: a person's move carries it too). */
const mentionsPause = (s: PullState | null | undefined) =>
  !!s?.reasons.some((r) => r.kind === 'merging_paused');

/**
 * Where an open pull request goes. A person's or an agent's move keeps its own lane even while merging is paused;
 * anything else that is paused waits in the queue lane, which then reads "Paused". A state that could not be
 * worked out counts as checking.
 */
export function laneOf(state: PullState | null | undefined): LaneId {
  if (!state) return 'checking';
  switch (state.state) {
    case 'human_review':
      return 'needs';
    case 'agent_followup':
      return 'fixing';
    case 'ready':
      return 'queued';
    case 'waiting':
      return isPaused(state) ? 'queued' : 'checking';
  }
}

export function laneLabel(lane: LaneId, mergingPaused: boolean): string {
  return lane === 'queued' && mergingPaused ? t('Paused') : LANE_LABEL[lane];
}

const LANE_TONE: Record<LaneId, Tone> = {
  needs: 'warn',
  fixing: 'serious',
  checking: 'info',
  queued: 'good',
};

/** What a list row's status pill says for an open pull request: the lane's word and tone ("Paused" when paused). */
export function laneChip(state: PullState | null | undefined): {
  lane: LaneId;
  label: string;
  tone: Tone;
} {
  const lane = laneOf(state);
  // "Paused" is the pull-state label's word for it, so the two never disagree.
  if (state && isPaused(state))
    return { lane, label: stateLabel(state), tone: 'off' };
  return { lane, label: LANE_LABEL[lane], tone: LANE_TONE[lane] };
}

/** Most urgent first: a failed review, a person's decision, a change request, one still running, then the done. */
const REVIEW_RANK: Record<string, number> = {
  failed: 0,
  flagged: 1,
  changes_requested: 2,
  reviewing: 3,
  approved: 4,
};

/** A pull request's reviewer agents with what needs a look first, then by handle. */
export function sortReviewers(reviewers: PullReviewer[]): PullReviewer[] {
  const rank = (r: PullReviewer) => REVIEW_RANK[r.status] ?? 5;
  return [...reviewers].sort(
    (a, b) => rank(a) - rank(b) || a.handle.localeCompare(b.handle)
  );
}

/** An estimate in minutes as words ("about 4 min"); null without one. */
export function etaText(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return t('under a minute');
  if (m < 60) return t('about {m} min', { m });
  const h = Math.floor(m / 60);
  return m % 60
    ? t('about {h} h {m} min', { h, m: m % 60 })
    : t('about {h} h', { h });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The card's estimate line. The queue's estimate assumes nothing stops the pull request, so one that is waiting on
 * a person or on its author says so. While merging is paused nothing lands and there is no estimate.
 */
export function etaLine(
  lane: LaneId,
  minutes: number | null | undefined,
  mergingPaused: boolean
): string | null {
  if (mergingPaused) return null;
  const text = etaText(minutes);
  if (!text) return null;
  return lane === 'needs' || lane === 'fixing'
    ? t('{eta} once it is unblocked', { eta: capital(text) })
    : t('Lands in {eta}', { eta: text });
}

export interface BoardCard {
  pull: Pull;
  lane: LaneId;
  /** Landing order (1 is next); null when the queue does not list it. */
  position: number | null;
  /** What holds it back, in a sentence, and any further blockers. */
  blocker: { text: string; more: string[] };
  reviewers: PullReviewer[];
  /** What it is stacked on or waits on, unless the blocker already says. */
  notes: string[];
  eta: string | null;
}

const mentions = (text: string, n: number) =>
  new RegExp(`#${n}(?!\\d)`).test(text);

type Entry = QueueTarget['entries'][number];

function blockerOf(
  entry: Entry | undefined,
  state: PullState | null | undefined,
  lane: LaneId
): { text: string; more: string[] } {
  // The queue's blockers are the server's sentences.
  if (entry?.blockers.length)
    return {
      text: tServer(entry.blockers[0]),
      more: entry.blockers.slice(1).map(tServer),
    };
  if (entry)
    return {
      text:
        lane === 'queued' && entry.position === 1
          ? t('Nothing is holding it back. It lands next.')
          : t('Nothing is holding it back.'),
      more: [],
    };
  // No queue entry (the queue did not load): say what the pull request's own reasons say.
  const reasons = (state?.reasons ?? []).filter(blocking);
  if (reasons.length)
    return {
      text: capital(reasonText(reasons[0])),
      more: reasons.slice(1).map((r) => capital(reasonText(r))),
    };
  return {
    text:
      lane === 'queued'
        ? t('Nothing is holding it back.')
        : t('Its state can’t be read right now.'),
    more: [],
  };
}

/** What a pull request is stacked on or waits on, as short notes. */
function notesOf(state: PullState | null | undefined, shown: string): string[] {
  const notes: string[] = [];
  for (const r of state?.reasons ?? []) {
    const n = Number(r.pr);
    if (!Number.isFinite(n) || mentions(shown, n)) continue;
    // The translation must end in #{n}: `covered` below reads the number after the #.
    if (r.kind === 'stacked_on') notes.push(t('Stacked on #{n}', { n }));
    else if (r.kind === 'waits_on') notes.push(t('Waits on #{n}', { n }));
  }
  return notes;
}

/**
 * Sorts open pull requests into lanes. Within a lane they keep landing order (the queue's), with any the queue does
 * not list after them, oldest first. `paused` is true when the queue or any pull request says merging is paused.
 */
export function boardLanes(
  open: Pull[],
  queue: QueueTarget[]
): { lanes: Record<LaneId, BoardCard[]>; paused: boolean } {
  const entries = new Map<number, Entry>();
  for (const target of queue)
    for (const e of target.entries)
      if (!entries.has(e.number)) entries.set(e.number, e);
  const mergingPaused =
    queue.some((target) => !!target.paused) ||
    open.some((p) => mentionsPause(p.pullState));
  const lanes: Record<LaneId, BoardCard[]> = {
    needs: [],
    fixing: [],
    checking: [],
    queued: [],
  };
  const sorted = [...open].sort((a, b) => {
    const pa = entries.get(a.number)?.position ?? Infinity;
    const pb = entries.get(b.number)?.position ?? Infinity;
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number
    );
  });
  for (const pull of sorted) {
    const lane = laneOf(pull.pullState);
    const entry = entries.get(pull.number);
    const blocker = blockerOf(entry, pull.pullState, lane);
    const notes = notesOf(pull.pullState, blocker.text);
    const covered = (text: string) =>
      notes.some((note) => mentions(text, Number(note.split('#')[1])));
    lanes[lane].push({
      pull,
      lane,
      position: entry?.position ?? null,
      blocker: {
        text: blocker.text,
        more: blocker.more.filter((text) => !covered(text)),
      },
      reviewers: sortReviewers(pull.reviewers ?? []),
      notes,
      eta: etaLine(lane, entry?.etaMinutes, mergingPaused),
    });
  }
  return { lanes, paused: mergingPaused };
}
