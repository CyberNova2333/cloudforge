/**
 * The Issues pages' pure parts: the list's address (`?state=`, `?q=`, `?label=`, `?assignee=`, `?page=`), label
 * colours, and an issue's timeline (comments and events in the order they happened).
 */
import type { Comment, IssueEvent, IssueListState } from './uiApi';

export const ISSUES_PAGE_SIZE = 25;

export interface IssuesParams {
  state: IssueListState;
  q: string;
  /** A label's name. */
  label: string;
  /** A username, or `none`. */
  assignee: string;
  page: number;
}

const STATES: readonly IssueListState[] = ['open', 'closed', 'all'];

/** The list's filters from its address; anything missing or malformed is its default. */
export function parseIssuesView(search: URLSearchParams): IssuesParams {
  const state = search.get('state') ?? '';
  const page = Number(search.get('page'));
  return {
    state: (STATES as readonly string[]).includes(state)
      ? (state as IssueListState)
      : 'open',
    q: (search.get('q') ?? '').trim(),
    label: (search.get('label') ?? '').trim(),
    assignee: (search.get('assignee') ?? '').trim(),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The list's address for `params`, leaving defaults out. */
export function issuesHref(
  base: string,
  params: Partial<IssuesParams> = {}
): string {
  const s = new URLSearchParams();
  if (params.state && params.state !== 'open') s.set('state', params.state);
  if (params.q?.trim()) s.set('q', params.q.trim());
  if (params.label) s.set('label', params.label);
  if (params.assignee) s.set('assignee', params.assignee);
  if (params.page && params.page > 1) s.set('page', String(params.page));
  const query = s.toString();
  return `${base}/issues${query ? `?${query}` : ''}`;
}

/** A label colour as six lower-case hex digits, or null: `#D73A4A` and `d73a4a` are the same. */
export function normalizeColor(input: string): string | null {
  const hex = input.trim().replace(/^#/, '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/** Relative luminance (WCAG 2) of a six-digit hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The text colour that reads on a label of colour `hex`: dark on light labels, white on dark ones. */
export function labelInk(hex: string): '#1f2328' | '#ffffff' {
  const l = luminance(normalizeColor(hex) ?? '000000');
  // Whichever of the two has the higher contrast ratio against the label.
  const onDark = 1.05 / (l + 0.05);
  const onLight = (l + 0.05) / (luminance('1f2328') + 0.05);
  return onLight >= onDark ? '#1f2328' : '#ffffff';
}

/** A few colours to start a new label from. */
export const LABEL_SWATCHES = [
  'd73a4a',
  'e99695',
  'fbca04',
  'fef2c0',
  '0e8a16',
  'c2e0c6',
  '1d76db',
  'bfdadc',
  '5319e7',
  'd4c5f9',
  'ededed',
  '24292f',
] as const;

export type TimelineEntry =
  | { kind: 'comment'; at: string; comment: Comment }
  | { kind: 'event'; at: string; event: IssueEvent };

/** Comments and events, oldest first; an event and a comment at the same moment keep the event first. */
export function issueTimeline(
  comments: Comment[],
  events: IssueEvent[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...events.map((event) => ({
      kind: 'event' as const,
      at: event.createdAt,
      event,
    })),
    ...comments.map((comment) => ({
      kind: 'comment' as const,
      at: comment.createdAt,
      comment,
    })),
  ];
  // A stable sort keeps the order above (events first) for equal times.
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
