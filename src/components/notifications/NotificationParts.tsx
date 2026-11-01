import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellIcon, BellSlashIcon, EyeIcon } from '@primer/octicons-react';
import { api, qk, type RepoDetail, type WatchLevel } from '@/lib/api/uiApi';
import { useCurrentUser } from '@/lib/auth/auth';
import { errorMessage } from '@/lib/api/api';
import { t } from '@/lib/i18n/i18n';
import { PendingButton } from '@/components/ui/PendingButton';

/** The unread count for the bell; refreshed by the live ping, and every minute where live updates are off. */
export function useNotificationCount() {
  const signedIn = !!useCurrentUser();
  return useQuery({
    queryKey: qk.notificationCount,
    queryFn: api.notificationCount,
    select: (r) => r.unread,
    enabled: signedIn,
    refetchInterval: 60_000,
  });
}

/** The top band's bell: the inbox, with how many notifications are unread. */
export function NotificationsTool() {
  const count = useNotificationCount().data ?? 0;
  return (
    <Link
      to="/notifications"
      className="tool"
      aria-label={
        count
          ? t('Notifications, {count} unread', { count })
          : t('Notifications')
      }
      title={t('Notifications')}
    >
      <BellIcon />
      {count > 0 && (
        <span className="tool-dot" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

/** Subscribe to / unsubscribe from one issue or pull request, with why the viewer follows it. */
export function SubscribeButton({
  repo,
  kind,
  number,
}: {
  repo: RepoDetail;
  kind: 'issues' | 'pulls';
  number: number;
}) {
  const o = repo.owner.username;
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const key = qk.subscription(o, repo.name, kind, number);
  const sub = useQuery({
    queryKey: key,
    queryFn: () => api.subscription(o, repo.name, kind, number),
    enabled: !!me,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || !sub.data) return null;
  const on = sub.data.subscribed;
  const why =
    sub.data.reason === 'watching'
      ? t('You’re watching this repository.')
      : on
        ? t('You’re receiving notifications because you’re subscribed.')
        : t('You’re not receiving notifications.');
  return (
    <div className="notify-sub">
      <PendingButton
        className="small"
        pending={busy}
        error={error}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            queryClient.setQueryData(
              key,
              await api.setSubscription(o, repo.name, kind, number, !on)
            );
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {on ? <BellSlashIcon size={14} /> : <BellIcon size={14} />}
        {on ? t('Unsubscribe') : t('Subscribe')}
      </PendingButton>
      <p className="muted small">{why}</p>
    </div>
  );
}

const LEVELS: { value: WatchLevel; label: string }[] = [
  { value: 'participating', label: t('Participating and @mentions') },
  { value: 'watching', label: t('All activity') },
  { value: 'ignoring', label: t('Ignore') },
];

/** How the viewer follows the repository: participating (the default), every thread, or nothing. */
export function WatchSelect({ repo }: { repo: RepoDetail }) {
  const o = repo.owner.username;
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const key = qk.watch(o, repo.name);
  const watch = useQuery({
    queryKey: key,
    queryFn: () => api.watch(o, repo.name),
    enabled: !!me,
  });
  const [busy, setBusy] = useState(false);
  if (!me || !watch.data) return null;
  return (
    <label
      className="watch-select"
      title={t('Notifications for this repository')}
    >
      <EyeIcon size={14} />
      <span className="sr">{t('Notifications for this repository')}</span>
      <select
        value={watch.data.level}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            queryClient.setQueryData(
              key,
              await api.setWatch(o, repo.name, e.target.value as WatchLevel)
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {LEVELS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      {watch.data.watchers > 0 && (
        <span className="count" title={t('People watching')}>
          {watch.data.watchers}
        </span>
      )}
    </label>
  );
}
