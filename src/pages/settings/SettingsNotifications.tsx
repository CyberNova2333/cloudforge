import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, type NotificationEmail } from '@/lib/api/uiApi';
import { errorMessage } from '@/lib/api/api';
import { t } from '@/lib/i18n/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { LoadError, Notice } from '@/components/ui/Notice';
import { RowsSkeleton, SettingsFrame } from '@/components/shell/SetFrame';

/** Settings → Notifications: which notifications also arrive by email. */
export default function SettingsNotifications() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: qk.preferences,
    queryFn: api.preferences,
  });
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const [choice, setChoice] = useState<NotificationEmail>('participating');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (prefs.data) setChoice(prefs.data.notificationEmail);
  }, [prefs.data]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      queryClient.setQueryData(
        qk.preferences,
        await api.savePreferences({ notificationEmail: choice })
      );
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const options: { value: NotificationEmail; label: string; hint: string }[] = [
    {
      value: 'participating',
      label: t('Participating'),
      hint: t(
        'When you are mentioned or assigned, and on issues and pull requests you opened or took part in.'
      ),
    },
    {
      value: 'all',
      label: t('All'),
      hint: t('Also every issue and pull request in repositories you watch.'),
    },
    {
      value: 'off',
      label: t('No email'),
      hint: t('Notifications stay in your inbox only.'),
    },
  ];

  return (
    <>
      <PageHead
        icon="sliders"
        crumbs={[
          { label: t('Settings'), to: '/settings/tokens' },
          { label: t('Notifications') },
        ]}
        title={t('Notifications')}
        lede={t(
          'Every notification goes to your inbox (the bell). Choose which ones also arrive at your account email.'
        )}
      />
      <SettingsFrame>
        {error && <Notice tone="bad">{error}</Notice>}
        {status.data && !status.data.passwordReset && (
          <Notice tone="warn">
            {t(
              'This instance does not send email yet, so notifications reach your inbox only.'
            )}
          </Notice>
        )}
        {prefs.isPending ? (
          <RowsSkeleton rows={3} />
        ) : prefs.isError ? (
          <LoadError
            what={t('your preferences')}
            error={prefs.error}
            onRetry={() => prefs.refetch()}
          />
        ) : (
          <form
            className="panel formpad"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset className="newrepo-visibility">
              <legend>{t('Email notifications')}</legend>
              {options.map((o) => (
                <label key={o.value}>
                  <input
                    type="radio"
                    name="notification-email"
                    checked={choice === o.value}
                    onChange={() => {
                      setChoice(o.value);
                      setSaved(false);
                    }}
                  />
                  <span>
                    <b>{o.label}</b>
                    <br />
                    <span className="muted small">{o.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="small muted">
              {t(
                'Emails go to your verified account email. Repositories you watch, and issues or pull requests you subscribe to, are chosen on their pages.'
              )}
            </p>
            <PendingButton
              type="submit"
              className="primary"
              pending={busy}
              pendingLabel={t('Saving…')}
              disabled={busy || choice === prefs.data?.notificationEmail}
            >
              {t('Save')}
            </PendingButton>
            {saved && (
              <span className="small muted" role="status">
                {' '}
                {t('Saved.')}
              </span>
            )}
          </form>
        )}
      </SettingsFrame>
    </>
  );
}
