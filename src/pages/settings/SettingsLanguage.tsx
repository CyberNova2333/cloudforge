import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qk, type Preferences } from '@/lib/api/uiApi';
import { errorMessage } from '@/lib/api/api';
import { lang, setLang, t } from '@/lib/i18n/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { LoadError, Notice } from '@/components/ui/Notice';
import { RowsSkeleton, SettingsFrame } from '@/components/shell/SetFrame';

type Choice = 'default' | 'zh' | 'en';

/**
 * Settings → Language: the interface language kept with the account, so it follows the person to every browser.
 * "Instance default" leaves it to Site admin's default language (which may follow the browser).
 */
export default function SettingsLanguage() {
  const prefs = useQuery({
    queryKey: qk.preferences,
    queryFn: api.preferences,
  });
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const [choice, setChoice] = useState<Choice>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefs.data) setChoice(prefs.data.language ?? 'default');
  }, [prefs.data]);

  const instanceDefault = status.data?.defaultLanguage ?? 'auto';
  const defaultLabel =
    instanceDefault === 'zh'
      ? '中文'
      : instanceDefault === 'en'
        ? 'English'
        : t('follows your browser');

  const save = async () => {
    setBusy(true);
    setError(null);
    const language: Preferences['language'] =
      choice === 'default' ? null : choice;
    try {
      await api.savePreferences({ language });
      // Reloads in the chosen language; "instance default" also forgets the choice made in this browser.
      setLang(language);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const options: { value: Choice; label: string; hint?: string }[] = [
    {
      value: 'default',
      label: t('Instance default'),
      hint: t('Currently {language}, set by a site admin.', {
        language: defaultLabel,
      }),
    },
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
  ];

  return (
    <>
      <PageHead
        icon="sliders"
        crumbs={[
          { label: t('Settings'), to: '/settings/tokens' },
          { label: t('Language') },
        ]}
        title={t('Language')}
        lede={t(
          'The language of the interface. It is kept with your account, so it follows you to every browser you sign in on.'
        )}
      />
      <SettingsFrame>
        {error && <Notice tone="bad">{error}</Notice>}
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
              <legend>{t('Interface language')}</legend>
              {options.map((o) => (
                <label key={o.value}>
                  <input
                    type="radio"
                    name="language"
                    checked={choice === o.value}
                    onChange={() => setChoice(o.value)}
                  />
                  <span>
                    <b
                      lang={
                        o.value === 'zh'
                          ? 'zh-CN'
                          : o.value === 'en'
                            ? 'en'
                            : undefined
                      }
                    >
                      {o.label}
                    </b>
                    {o.hint && (
                      <>
                        <br />
                        <span className="muted small">{o.hint}</span>
                      </>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="small muted">
              {t('This page is shown in {language} now.', {
                language: lang === 'zh' ? '中文' : 'English',
              })}
            </p>
            <PendingButton
              type="submit"
              className="primary"
              pending={busy}
              pendingLabel={t('Saving…')}
              disabled={busy || choice === (prefs.data?.language ?? 'default')}
            >
              {t('Save')}
            </PendingButton>
          </form>
        )}
      </SettingsFrame>
    </>
  );
}
