import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersIcon } from '@primer/octicons-react';
import { api, qk, type InstanceSetting } from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { t, tn, tServer } from '@/lib/i18n';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';
import { LoadError, Notice } from '@/components/Notice';
import { RowsSkeleton } from '@/components/SetFrame';

const GROUPS: InstanceSetting['group'][] = [
  'General',
  'AI models',
  'Reviews',
  'Actions',
];

function SettingRow({
  s,
  onSaved,
}: {
  s: InstanceSetting;
  onSaved: () => void;
}) {
  const retention = s.key === 'actions.retention_days';
  // Other number settings (e.g. actions.max_concurrent_jobs) save numbers, not text.
  const numeric = !retention && typeof s.default === 'number';
  const [text, setText] = useState('');
  const [forever, setForever] = useState(false);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Follow the server's value whenever it changes (after a save, a reset, or a live update).
  useEffect(() => {
    if (retention) {
      setForever(s.value === null);
      setText(s.value === null ? '' : String(s.value));
    } else setText(String(s.value ?? ''));
  }, [s.value, retention]);

  const current = retention
    ? forever
      ? null
      : Number(text)
    : numeric
      ? Number(text)
      : text.trim();
  const dirty = current !== s.value;

  const run = async (kind: 'save' | 'reset', fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const defaultText =
    s.default === null
      ? t('keep forever')
      : retention
        ? t('{n} days', { n: String(s.default) })
        : String(s.default);

  return (
    <li className="setting">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run('save', () => api.saveSetting(s.key, current));
        }}
      >
        <label className="setting-label" htmlFor={`setting-${s.key}`}>
          {tServer(s.label)}
        </label>
        <p className="small muted">{tServer(s.description)}</p>
        <div className="setting-input">
          {retention ? (
            <>
              <input
                id={`setting-${s.key}`}
                className="form-control short"
                type="number"
                min={1}
                max={400}
                value={text}
                disabled={forever}
                onChange={(e) => setText(e.target.value)}
                required={!forever}
              />
              <span className="muted">{t('days')}</span>
              <label className="check-inline small">
                <input
                  type="checkbox"
                  checked={forever}
                  onChange={(e) => setForever(e.target.checked)}
                />
                {t('Keep forever')}
              </label>
            </>
          ) : numeric ? (
            <input
              id={`setting-${s.key}`}
              className="form-control short"
              type="number"
              min={s.min ?? 1}
              max={s.max}
              step={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
          ) : (
            <input
              id={`setting-${s.key}`}
              className="form-control wide"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
          )}
          <PendingButton
            type="submit"
            className="small"
            pending={busy === 'save'}
            pendingLabel={t('Saving…')}
            disabled={busy !== null || !dirty}
          >
            {t('Save')}
          </PendingButton>
          {s.overridden && (
            <PendingButton
              className="small quiet"
              pending={busy === 'reset'}
              pendingLabel={t('Resetting…')}
              disabled={busy !== null}
              onClick={() => void run('reset', () => api.resetSetting(s.key))}
            >
              {t('Reset to default')}
            </PendingButton>
          )}
        </div>
        <p className="small muted">
          {s.overridden
            ? s.updatedAt
              ? t('Set here {when}. Default: {value}.', {
                  when: timeAgo(s.updatedAt),
                  value: defaultText,
                })
              : t('Set here. Default: {value}.', { value: defaultText })
            : t('Using the default ({value}).', { value: defaultText })}
          {saved && !error && <span className="saved"> {t('Saved.')}</span>}
        </p>
        {error && <Notice tone="bad">{error}</Notice>}
      </form>
    </li>
  );
}

/**
 * Instance settings in Site admin: values a site admin changes without a deploy. Each shows its
 * default (from the deploy's config, or built in) and can be reset to it.
 */
export function AdminSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.adminSettings,
    queryFn: api.adminSettings,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.adminSettings });
    // The instance name shows in the rail and page titles.
    void qc.invalidateQueries({ queryKey: qk.setup });
  };
  return (
    <div id="settings">
      <Section
        title={
          <>
            <SlidersIcon size={16} /> {t('Instance settings')}
          </>
        }
      >
        <p className="small muted">
          {t(
            "Instance-wide settings. Defaults come from the deploy's configuration; anything set here takes effect right away, without a deploy."
          )}
        </p>
        {q.isPending ? (
          <RowsSkeleton rows={4} />
        ) : q.isError ? (
          <LoadError
            what={t('the instance settings')}
            error={q.error}
            onRetry={() => q.refetch()}
          />
        ) : (
          GROUPS.map((group) => (
            <div key={group} className="panel">
              <div className="pad">
                <h3 className="group-title">{tServer(group)}</h3>
              </div>
              <ul className="rowlist">
                {q.data.settings
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <SettingRow key={s.key} s={s} onSaved={refresh} />
                  ))}
                {group === 'Actions' && (
                  <li className="setting-foot small muted">
                    {q.data.actions.oldestFinishedAt
                      ? tn(
                          q.data.actions.runs,
                          '{n} workflow run stored; the oldest finished {when}.',
                          '{n} workflow runs stored; the oldest finished {when}.',
                          { when: timeAgo(q.data.actions.oldestFinishedAt) }
                        )
                      : tn(
                          q.data.actions.runs,
                          '{n} workflow run stored.',
                          '{n} workflow runs stored.'
                        )}{' '}
                    {!q.data.actions.retention
                      ? t('Cleanup runs once a day.')
                      : q.data.actions.retention.more
                        ? tn(
                            q.data.actions.retention.deletedRuns,
                            'Cleanup last ran {when} and deleted {n} run (more remain; it continues tomorrow).',
                            'Cleanup last ran {when} and deleted {n} runs (more remain; it continues tomorrow).',
                            { when: timeAgo(q.data.actions.retention.at) }
                          )
                        : tn(
                            q.data.actions.retention.deletedRuns,
                            'Cleanup last ran {when} and deleted {n} run.',
                            'Cleanup last ran {when} and deleted {n} runs.',
                            { when: timeAgo(q.data.actions.retention.at) }
                          )}
                  </li>
                )}
              </ul>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
