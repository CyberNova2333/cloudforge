import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { BellIcon, CheckIcon, DotFillIcon } from '@primer/octicons-react';
import {
  api,
  qk,
  type NotificationItem,
  type NotificationReason,
} from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/format';
import { t, tx } from '@/lib/i18n';
import {
  NOTIFICATION_REASONS,
  NOTIFICATIONS_PAGE_SIZE,
  notificationsHref,
  parseNotificationsView,
  type NotificationsParams,
} from '@/lib/notificationsView';
import { PageHead } from '@/components/ui/PageHead';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/Notice';
import { Pager } from '@/components/actions/parts';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { IssueStateIcon } from '@/components/issue/IssueParts';
import { PrStateIcon } from '@/pages/PrIcons';

const REASON_LABEL: Record<NotificationReason, string> = {
  mention: t('Mentioned'),
  assign: t('Assigned'),
  author: t('Author'),
  participating: t('Participating'),
  watching: t('Watching'),
};

/** What happened, in words: "bob commented", "CloudForge merged it". */
function what(n: NotificationItem): ReactNode {
  const who = <b>{n.actor?.username ?? 'CloudForge'}</b>;
  switch (n.event) {
    case 'opened':
      return tx('{who} opened it', { who });
    case 'commented':
      return tx('{who} commented', { who });
    case 'closed':
      return tx('{who} closed it', { who });
    case 'reopened':
      return tx('{who} reopened it', { who });
    case 'merged':
      return tx('{who} merged it', { who });
    case 'assigned':
      return n.reason === 'assign'
        ? tx('{who} assigned you', { who })
        : tx('{who} changed the assignees', { who });
  }
}

function Row({
  n,
  onRead,
  onDone,
}: {
  n: NotificationItem;
  onRead: (unread: boolean) => void;
  onDone: () => void;
}) {
  return (
    <li className={`notif-row${n.unread ? ' unread' : ''}`}>
      <span className="notif-dot" aria-hidden="true">
        {n.unread && <DotFillIcon size={12} />}
      </span>
      <span className="notif-icon">
        {n.subject.kind === 'issue' ? (
          <IssueStateIcon
            issue={{
              state: n.subject.state === 'open' ? 'open' : 'closed',
              stateReason: n.subject.stateReason,
            }}
          />
        ) : (
          <PrStateIcon state={n.subject.state} />
        )}
      </span>
      <div className="notif-main">
        <div className="notif-where muted small">
          <Link to={`/${n.repository}`}>{n.repository}</Link>{' '}
          <span className="mono">#{n.subject.number}</span>
        </div>
        <Link
          to={n.url}
          className="notif-title"
          onClick={() => n.unread && onRead(false)}
        >
          {n.subject.title}
        </Link>
        <div className="notif-what small">
          {what(n)}
          {n.excerpt && (
            <span className="notif-excerpt muted">: {n.excerpt}</span>
          )}
        </div>
      </div>
      <div className="notif-side">
        <span className="chip off">{REASON_LABEL[n.reason]}</span>
        <time
          className="muted small"
          dateTime={n.updatedAt}
          title={fullDate(n.updatedAt)}
        >
          {timeAgo(n.updatedAt)}
        </time>
        <span className="notif-tools">
          <button
            type="button"
            className="btn-link small"
            onClick={() => onRead(!n.unread)}
          >
            {n.unread ? t('Mark as read') : t('Mark as unread')}
          </button>
          <button
            type="button"
            className="btn-link small"
            onClick={onDone}
            aria-label={t('Done: remove from the inbox')}
            title={t('Done: remove from the inbox')}
          >
            <CheckIcon size={14} />
            {t('Done')}
          </button>
        </span>
      </div>
    </li>
  );
}

/**
 * The inbox: every issue and pull request with news for the signed-in person, newest first; unread only by default
 * (`?filter=all` for the rest), by reason (`?reason=`) or repository (`?repo=`).
 */
export default function Notifications() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = parseNotificationsView(search);
  const { filter, reason, repo, page } = params;
  const query = useQuery({
    queryKey: qk.notifications({ filter, reason, repo, page }),
    queryFn: () =>
      api.notifications({
        filter,
        reason: reason || undefined,
        repo: repo || undefined,
        page,
        limit: NOTIFICATIONS_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  const [error, setError] = useState<string | null>(null);
  const go = (next: Partial<NotificationsParams>) =>
    navigate(notificationsHref({ ...params, ...next }));
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const act = (work: Promise<unknown>) => {
    setError(null);
    void work.then(refresh).catch((e) => setError(errorMessage(e)));
  };

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const tab = (to: 'unread' | 'all', label: string, n?: number) => (
    <Link
      to={notificationsHref({ ...params, filter: to, page: 1 })}
      className="pl-tab"
      aria-current={filter === to ? 'page' : undefined}
    >
      {label}
      {n !== undefined && n > 0 && <span className="count">{n}</span>}
    </Link>
  );

  let body;
  if (query.isError && !query.data)
    body = (
      <div className="panel">
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          title={t('Notifications did not load')}
        />
      </div>
    );
  else if (!query.data) body = <RowsSkeleton />;
  else if (!query.data.notifications.length)
    body = (
      <div className="panel">
        <EmptyState
          picture={<BellIcon size={24} />}
          title={
            filter === 'unread' && !reason && !repo
              ? t('You’re all caught up')
              : t('No notifications here')
          }
          body={t(
            'Issues and pull requests you open, take part in, are mentioned in or assigned to show up here, and every one in repositories you watch.'
          )}
        />
      </div>
    );
  else
    body = (
      <>
        <ul className="notif-rows panel">
          {query.data.notifications.map((n) => (
            <Row
              key={n.id}
              n={n}
              onRead={(unread) =>
                act(
                  unread
                    ? api.setNotificationUnread(n.id, true)
                    : api.markNotificationsRead({ ids: [n.id] })
                )
              }
              onDone={() => act(api.doneNotification(n.id))}
            />
          ))}
        </ul>
        {pages > 1 && (
          <Pager
            prevLabel={t('Previous')}
            nextLabel={t('Next')}
            onPrev={page > 1 ? () => go({ page: page - 1 }) : undefined}
            onNext={page < pages ? () => go({ page: page + 1 }) : undefined}
            note={t('Page {page} of {pages} · {total} notifications', {
              page,
              pages,
              total,
            })}
          />
        )}
      </>
    );

  return (
    <>
      <PageHead
        icon="bell"
        crumbs={[{ label: t('Notifications') }]}
        title={t('Notifications')}
        lede={t(
          'News on issues and pull requests you follow. Settings → Notifications chooses which also arrive by email.'
        )}
        actions={
          query.data?.unread ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                act(
                  api.markNotificationsRead({
                    all: true,
                    repo: repo || undefined,
                  })
                )
              }
            >
              <CheckIcon size={14} />
              {t('Mark all as read')}
            </button>
          ) : undefined
        }
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="plist">
        <div className="pl-bar">
          <nav className="pl-tabs" aria-label={t('Notifications')}>
            {tab('unread', t('Unread'), query.data?.unread)}
            {tab('all', t('All'))}
          </nav>
          <div className="pl-tools">
            <select
              className="pl-select"
              aria-label={t('Filter by reason')}
              value={reason}
              onChange={(e) =>
                go({ reason: e.target.value as NotificationReason, page: 1 })
              }
            >
              <option value="">{t('Any reason')}</option>
              {NOTIFICATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
            {repo && (
              <Link
                to={notificationsHref({ ...params, repo: '', page: 1 })}
                className="btn small"
              >
                {t('{repo} only · show all', { repo })}
              </Link>
            )}
          </div>
        </div>
        {body}
      </div>
    </>
  );
}
