/** The inbox's address (`/notifications?filter=&reason=&repo=&page=`): parsed and built. Pure. */
import type { NotificationReason } from '../api/uiApi';

export const NOTIFICATIONS_PAGE_SIZE = 25;

export const NOTIFICATION_REASONS: readonly NotificationReason[] = [
  'mention',
  'assign',
  'author',
  'participating',
  'watching',
];

export interface NotificationsParams {
  filter: 'unread' | 'all';
  reason: NotificationReason | '';
  /** `owner/name`, or '' for every repository. */
  repo: string;
  page: number;
}

export function parseNotificationsView(
  search: URLSearchParams
): NotificationsParams {
  const reason = search.get('reason') ?? '';
  const page = Number(search.get('page'));
  const repo = (search.get('repo') ?? '').trim();
  return {
    filter: search.get('filter') === 'all' ? 'all' : 'unread',
    reason: (NOTIFICATION_REASONS as readonly string[]).includes(reason)
      ? (reason as NotificationReason)
      : '',
    repo: /^[^/\s]+\/[^/\s]+$/.test(repo) ? repo : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function notificationsHref(p: Partial<NotificationsParams> = {}) {
  const s = new URLSearchParams();
  if (p.filter === 'all') s.set('filter', 'all');
  if (p.reason) s.set('reason', p.reason);
  if (p.repo) s.set('repo', p.repo);
  if (p.page && p.page > 1) s.set('page', String(p.page));
  const q = s.toString();
  return `/notifications${q ? `?${q}` : ''}`;
}
