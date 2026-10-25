import { useId, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  GearIcon,
  LinkIcon,
  LockIcon,
  XCircleIcon,
} from '@primer/octicons-react';
import type { RepoDetail } from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/format';
import { t, tServer } from '@/lib/i18n';
import {
  WEBHOOK_EVENTS,
  webhookInput,
  webhookKeys,
  webhooksApi,
  type Webhook,
  type WebhookDelivery,
  type WebhookDraft,
  type WebhookInput,
} from '@/lib/webhooksApi';
import { InlineConfirm } from '@/components/InlineConfirm';
import { PanelError } from '@/components/approvals/Panels';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { PendingButton } from '@/components/ui/PendingButton';
import { NotFound } from './NotFound';

const EVENT_LABELS = {
  push: t('Pushes to branches and tags'),
  pull_request: t('Pull requests opened, closed or updated'),
  issues: t('Issues opened, closed or assigned'),
  issue_comment: t('New issue and pull request comments'),
  release: t('Published releases'),
  status: t('Commit status updates'),
};

function WebhookForm({
  hook,
  onSave,
  onCancel,
}: {
  hook?: Webhook;
  onSave: (input: WebhookInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<WebhookDraft>({
    url: hook?.url ?? '',
    events: hook?.events ?? ['push'],
    active: hook?.active ?? true,
    secretAction: 'keep',
    secret: '',
  });
  const save = useMutation({ mutationFn: () => onSave(webhookInput(draft)) });
  const allEvents = draft.events.includes('*');
  const valid =
    !!draft.url.trim() &&
    draft.events.length > 0 &&
    (draft.secretAction !== 'replace' || draft.secret.length > 0);

  return (
    <form
      className="webhook-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !save.isPending) save.mutate();
      }}
    >
      <h3>{hook ? t('Edit webhook') : t('New webhook')}</h3>
      <fieldset className="webhook-form-fields" disabled={save.isPending}>
        <label className="fld" htmlFor={`${id}-url`}>
          <span id={`${id}-url-label`} className="lbl">
            {t('Payload URL')}
          </span>
          <input
            id={`${id}-url`}
            className="form-control mono"
            type="url"
            required
            autoFocus
            maxLength={2000}
            placeholder="https://example.com/webhooks"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            aria-labelledby={`${id}-url-label`}
            aria-describedby={`${id}-url-help`}
          />
          <span id={`${id}-url-help`} className="muted small">
            {t('A public HTTP or HTTPS endpoint that receives JSON requests.')}
          </span>
        </label>
        <div className="fld">
          <label className="lbl" htmlFor={`${id}-secret-action`}>
            {t('Signing secret')}
          </label>
          <select
            id={`${id}-secret-action`}
            className="form-select"
            value={draft.secretAction}
            onChange={(e) =>
              setDraft({
                ...draft,
                secretAction: e.target.value as WebhookDraft['secretAction'],
                secret: '',
              })
            }
            aria-describedby={`${id}-secret-help`}
          >
            <option value="keep">
              {hook?.hasSecret ? t('Keep the existing secret') : t('No secret')}
            </option>
            <option value="replace">
              {hook?.hasSecret ? t('Replace the secret') : t('Set a secret')}
            </option>
            {hook?.hasSecret && (
              <option value="remove">{t('Remove the secret')}</option>
            )}
          </select>
          {draft.secretAction === 'replace' && (
            <input
              className="form-control"
              type="password"
              autoComplete="new-password"
              aria-label={t('New signing secret')}
              required
              maxLength={256}
              value={draft.secret}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
            />
          )}
          <span id={`${id}-secret-help`} className="muted small">
            {t(
              'Used to sign requests with HMAC-SHA256. Saved secrets are never shown again.'
            )}
          </span>
        </div>
        <fieldset className="webhook-events">
          <legend className="lbl">{t('Which events should be sent?')}</legend>
          <label className="webhook-choice">
            <input
              type="checkbox"
              checked={allEvents}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  events: e.target.checked ? ['*'] : ['push'],
                })
              }
            />
            <span>{t('Send all events')}</span>
          </label>
          <div className="webhook-event-grid">
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="webhook-choice">
                <input
                  type="checkbox"
                  checked={allEvents || draft.events.includes(event)}
                  disabled={allEvents}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      events: e.target.checked
                        ? [...draft.events, event]
                        : draft.events.filter((value) => value !== event),
                    })
                  }
                />
                <span>
                  <code>{event}</code>
                  <span className="muted small">{EVENT_LABELS[event]}</span>
                </span>
              </label>
            ))}
          </div>
          {!draft.events.length && (
            <p className="webhook-error" role="alert">
              {t('Choose at least one event.')}
            </p>
          )}
        </fieldset>
        <label className="webhook-choice">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          <span>
            {t('Active webhook')}
            <span className="muted small">
              {t('Send a request when a subscribed event occurs.')}
            </span>
          </span>
        </label>
      </fieldset>
      {!hook && (
        <p className="muted small">
          {t('An active webhook receives a test ping when it is created.')}
        </p>
      )}
      <PanelError error={save.isError ? errorMessage(save.error) : null} />
      <div className="webhook-actions">
        <PendingButton
          type="submit"
          className="primary"
          pending={save.isPending}
          pendingLabel={t('Saving…')}
          disabled={!valid}
        >
          {hook ? t('Save webhook') : t('Create webhook')}
        </PendingButton>
        <button
          type="button"
          className="btn"
          disabled={save.isPending}
          onClick={onCancel}
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

function DeliveryStatus({ delivery }: { delivery: WebhookDelivery }) {
  return delivery.status === 'delivered' ? (
    <Chip tone="good" icon={<CheckIcon size={12} />}>
      {t('Delivered')}
    </Chip>
  ) : delivery.status === 'failed' ? (
    <Chip tone="critical" icon={<XCircleIcon size={12} />}>
      {t('Delivery failed')}
    </Chip>
  ) : (
    <Chip tone="warn" icon={<ClockIcon size={12} />}>
      {delivery.attempts ? t('Waiting to retry') : t('Queued')}
    </Chip>
  );
}

function readablePayload(payload: string) {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

function DeliveryRow({
  delivery,
  onRedeliver,
}: {
  delivery: WebhookDelivery;
  onRedeliver: () => Promise<unknown>;
}) {
  const resend = useMutation({ mutationFn: onRedeliver });
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <details
      className="webhook-delivery"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <DeliveryStatus delivery={delivery} />
        <code>
          {delivery.event}
          {delivery.action ? ` · ${delivery.action}` : ''}
        </code>
        <span className="muted small webhook-delivery-response">
          {delivery.responseStatus === null
            ? t('No HTTP response')
            : `HTTP ${delivery.responseStatus}`}
        </span>
        <time
          className="muted small"
          dateTime={delivery.createdAt}
          title={fullDate(delivery.createdAt)}
        >
          {timeAgo(delivery.createdAt)}
        </time>
      </summary>
      {open && (
        <div className="webhook-delivery-body">
          <dl className="webhook-delivery-meta">
            <div>
              <dt>{t('Delivery ID')}</dt>
              <dd className="mono">{delivery.id}</dd>
            </div>
            <div>
              <dt>{t('Attempts')}</dt>
              <dd>{delivery.attempts}</dd>
            </div>
            <div>
              <dt>{t('Response status')}</dt>
              <dd>
                {delivery.responseStatus === null
                  ? t('No HTTP response')
                  : `HTTP ${delivery.responseStatus}`}
              </dd>
            </div>
            <div>
              <dt>{t('Duration')}</dt>
              <dd>
                {delivery.durationMs === null
                  ? '—'
                  : t('{n} ms', { n: delivery.durationMs })}
              </dd>
            </div>
            <div>
              <dt>{t('Created at')}</dt>
              <dd>{fullDate(delivery.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('Delivered at')}</dt>
              <dd>
                {delivery.deliveredAt ? fullDate(delivery.deliveredAt) : '—'}
              </dd>
            </div>
          </dl>
          {delivery.error && (
            <p className="webhook-error">
              <b>{t('Delivery error')}:</b> {tServer(delivery.error)}
            </p>
          )}
          <div className="webhook-payloads">
            <section>
              <h4>{t('Request body')}</h4>
              <pre tabIndex={0}>{readablePayload(delivery.payload)}</pre>
            </section>
            <section>
              <h4>{t('Response body (first 2 KB)')}</h4>
              {delivery.responseBody ? (
                <pre tabIndex={0}>{delivery.responseBody}</pre>
              ) : (
                <p className="muted small">{t('No response body')}</p>
              )}
            </section>
          </div>
          <div className="webhook-actions">
            <PendingButton
              pending={resend.isPending}
              pendingLabel={t('Queueing…')}
              onClick={() => {
                setSent(false);
                resend.mutate(undefined, { onSuccess: () => setSent(true) });
              }}
            >
              {t('Redeliver')}
            </PendingButton>
            {sent && (
              <span className="muted small" role="status">
                {t('A new delivery has been queued.')}
              </span>
            )}
          </div>
          <PanelError
            error={resend.isError ? errorMessage(resend.error) : null}
          />
        </div>
      )}
    </details>
  );
}

function WebhookRow({
  hook,
  repo,
  expanded,
  onExpand,
  refresh,
}: {
  hook: Webhook;
  repo: RepoDetail;
  expanded: boolean;
  onExpand: () => void;
  refresh: () => Promise<unknown>;
}) {
  const o = repo.owner.username;
  const n = repo.name;
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: webhookKeys.detail(o, n, hook.id),
    queryFn: () => webhooksApi.get(o, n, hook.id),
    enabled: expanded,
    refetchInterval: (q) =>
      expanded && q.state.data?.deliveries.some((d) => d.status === 'pending')
        ? 5000
        : false,
  });
  const shown = expanded ? (query.data ?? hook) : hook;
  const ping = useMutation({
    mutationFn: async () => {
      setNotice(null);
      const result = await webhooksApi.ping(o, n, hook.id);
      if (!result.delivery)
        throw new Error(t('The delivery could not be queued. Try again.'));
    },
    onSuccess: async () => {
      setNotice(
        t('Test ping queued. Its result will appear in recent deliveries.')
      );
      if (!expanded) onExpand();
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => webhooksApi.remove(o, n, hook.id),
    onSuccess: refresh,
  });
  return (
    <li className="panel webhook-card">
      <div className="webhook-card-head">
        <button
          type="button"
          className="webhook-open"
          aria-expanded={expanded}
          aria-controls={`webhook-${hook.id}`}
          onClick={onExpand}
        >
          {expanded ? (
            <ChevronDownIcon size={16} />
          ) : (
            <ChevronRightIcon size={16} />
          )}
          <span className="mono webhook-url">{shown.url}</span>
        </button>
        <Chip tone={shown.active ? 'good' : 'off'}>
          {shown.active ? t('Active') : t('Inactive')}
        </Chip>
        {!editing && (
          <button
            type="button"
            className="btn small"
            disabled={remove.isPending || ping.isPending}
            onClick={() => {
              setEditing(true);
              setNotice(null);
            }}
          >
            {t('Edit')}
          </button>
        )}
        <InlineConfirm
          label={t('Delete')}
          confirmLabel={t('Delete webhook and deliveries')}
          pendingLabel={t('Deleting…')}
          accessibleName={t('Delete webhook {url}', { url: hook.url })}
          pending={remove.isPending}
          disabled={editing || ping.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate()}
        />
      </div>
      <div className="webhook-card-meta muted small">
        <span>
          {shown.events.includes('*')
            ? t('All events')
            : shown.events.join(', ')}
        </span>
        <span>
          <LockIcon size={12} />{' '}
          {shown.hasSecret ? t('Secret configured') : t('No secret')}
        </span>
        <span>
          {shown.lastDeliveredAt
            ? shown.lastStatus === null
              ? t('Last attempt: no HTTP response')
              : t('Last response: HTTP {status}', { status: shown.lastStatus })
            : t('No delivery attempts yet')}
        </span>
      </div>
      {editing && (
        <WebhookForm
          hook={shown}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await webhooksApi.update(o, n, hook.id, input);
            await refresh();
            setEditing(false);
            setNotice(t('Webhook saved.'));
          }}
        />
      )}
      {notice && (
        <p className="webhook-notice" role="status">
          {notice}
        </p>
      )}
      {expanded && (
        <section
          id={`webhook-${hook.id}`}
          className="webhook-history"
          aria-label={t('Recent deliveries')}
        >
          <div className="webhook-history-head">
            <div>
              <h3>{t('Recent deliveries')}</h3>
              <p className="muted small">
                {t(
                  'The latest 30 deliveries are shown. Records are kept for 14 days.'
                )}
              </p>
            </div>
            <div className="webhook-actions">
              <PendingButton
                className="small"
                pending={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t('Refresh')}
              </PendingButton>
              <PendingButton
                className="small"
                pending={ping.isPending}
                disabled={editing || remove.isPending}
                pendingLabel={t('Queueing…')}
                onClick={() => ping.mutate()}
              >
                {t('Send test ping')}
              </PendingButton>
            </div>
          </div>
          <PanelError error={ping.isError ? errorMessage(ping.error) : null} />
          {query.isError ? (
            <QueryError
              error={query.error}
              title={t('Deliveries did not load')}
              onRetry={() => void query.refetch()}
            />
          ) : !query.data ? (
            <RowsSkeleton rows={2} />
          ) : !query.data.deliveries.length ? (
            <EmptyState
              title={t('No deliveries yet')}
              body={t('Send a test ping to check the receiving endpoint.')}
            />
          ) : (
            <div className="webhook-deliveries">
              {query.data.deliveries.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  onRedeliver={async () => {
                    const result = await webhooksApi.redeliver(
                      o,
                      n,
                      hook.id,
                      delivery.id
                    );
                    if (!result.delivery)
                      throw new Error(
                        t('The delivery could not be queued. Try again.')
                      );
                    await refresh();
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </li>
  );
}

function WebhooksContent({ repo }: { repo: RepoDetail }) {
  const o = repo.owner.username;
  const n = repo.name;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: webhookKeys.list(o, n),
    queryFn: () => webhooksApi.list(o, n),
  });
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const refresh = () =>
    qc.invalidateQueries({ queryKey: webhookKeys.list(o, n) });
  const atLimit = (query.data?.length ?? 0) >= 20;
  return (
    <>
      <PageHead
        icon="plug"
        crumbs={[
          { label: t('Settings'), to: `/${repo.fullName}/settings` },
          { label: t('Webhooks') },
        ]}
        title={t('Webhooks')}
        tab="settings"
        lede={t(
          'Send repository events to external services and inspect their responses.'
        )}
        actions={
          !adding && (
            <button
              type="button"
              className="btn primary"
              disabled={!query.data || atLimit}
              onClick={() => setAdding(true)}
            >
              {t('New webhook')}
            </button>
          )
        }
      />
      <div className="webhooks-layout">
        <nav
          className="menu webhook-settings-nav"
          aria-label={t('Repository settings')}
        >
          <Link className="menu-item" to={`/${repo.fullName}/settings`}>
            <GearIcon size={16} /> {t('General')}
          </Link>
          <Link
            className="menu-item selected"
            to={`/${repo.fullName}/settings/webhooks`}
            aria-current="page"
          >
            <LinkIcon size={16} /> {t('Webhooks')}
          </Link>
        </nav>
        <div className="webhooks-main">
          {atLimit && (
            <p className="muted small">
              {t('This repository has reached the limit of 20 webhooks.')}
            </p>
          )}
          {adding && (
            <div className="panel">
              <WebhookForm
                onCancel={() => setAdding(false)}
                onSave={async (input) => {
                  const hook = await webhooksApi.create(o, n, input);
                  await refresh();
                  setExpanded(hook.id);
                  setAdding(false);
                }}
              />
            </div>
          )}
          {query.isError ? (
            <div className="panel">
              <QueryError
                error={query.error}
                title={t('Webhooks did not load')}
                onRetry={() => void query.refetch()}
              />
            </div>
          ) : !query.data ? (
            <RowsSkeleton rows={3} />
          ) : !query.data.length ? (
            <div className="panel">
              <EmptyState
                picture={<LinkIcon size={24} />}
                title={t('No webhooks yet')}
                body={t(
                  'Add a webhook to notify your CI, chat or other services when repository events occur.'
                )}
              />
            </div>
          ) : (
            <ul className="webhook-list">
              {query.data.map((hook) => (
                <WebhookRow
                  key={hook.id}
                  hook={hook}
                  repo={repo}
                  expanded={expanded === hook.id}
                  onExpand={() =>
                    setExpanded(expanded === hook.id ? null : hook.id)
                  }
                  refresh={refresh}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/** Repository administrators manage webhooks; other members never request the admin-only endpoint. */
export default function RepoWebhooks() {
  const repo = useOutletContext<RepoDetail>();
  return repo.permissions.admin ? (
    <WebhooksContent key={repo.id} repo={repo} />
  ) : (
    <NotFound />
  );
}
