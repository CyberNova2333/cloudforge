import { apiFetch } from './api';

export const WEBHOOK_EVENTS = [
  'push',
  'pull_request',
  'issues',
  'issue_comment',
  'release',
  'status',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  hasSecret: boolean;
  lastStatus: number | null;
  lastDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  action: string | null;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  payload: string;
  createdAt: string;
  deliveredAt: string | null;
}

export type WebhookDetail = Webhook & { deliveries: WebhookDelivery[] };

export interface WebhookInput {
  url: string;
  events: string[];
  active: boolean;
  /** Omitted keeps the saved secret; null removes it; a string replaces it. */
  secret?: string | null;
}

export interface WebhookDraft {
  url: string;
  events: string[];
  active: boolean;
  secretAction: 'keep' | 'replace' | 'remove';
  secret: string;
}

/** Keep an unchanged write-only secret out of the request, and preserve a replacement exactly as entered. */
export function webhookInput(draft: WebhookDraft): WebhookInput {
  return {
    url: draft.url.trim(),
    events: draft.events.includes('*') ? ['*'] : [...new Set(draft.events)],
    active: draft.active,
    ...(draft.secretAction === 'remove'
      ? { secret: null }
      : draft.secretAction === 'replace'
        ? { secret: draft.secret }
        : {}),
  };
}

const path = (owner: string, repo: string, id?: string) =>
  `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks${
    id === undefined ? '' : `/${encodeURIComponent(id)}`
  }`;

/** Under the repository key, so live repository changes refresh this page too. */
export const webhookKeys = {
  list: (o: string, n: string) => ['repo', o, n, 'webhooks'] as const,
  detail: (o: string, n: string, id: string) =>
    ['repo', o, n, 'webhooks', id] as const,
};

export const webhooksApi = {
  list: (o: string, n: string) => apiFetch<Webhook[]>(path(o, n)),
  get: (o: string, n: string, id: string) =>
    apiFetch<WebhookDetail>(path(o, n, id)),
  create: (o: string, n: string, json: WebhookInput) =>
    apiFetch<Webhook>(path(o, n), { method: 'POST', json }),
  update: (o: string, n: string, id: string, json: WebhookInput) =>
    apiFetch<Webhook>(path(o, n, id), { method: 'PATCH', json }),
  remove: (o: string, n: string, id: string) =>
    apiFetch<{ ok: true }>(path(o, n, id), { method: 'DELETE' }),
  ping: (o: string, n: string, id: string) =>
    apiFetch<{ delivery: string | null }>(`${path(o, n, id)}/pings`, {
      method: 'POST',
    }),
  redeliver: (o: string, n: string, id: string, deliveryId: string) =>
    apiFetch<{ delivery: string | null }>(
      `${path(o, n, id)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      { method: 'POST' }
    ),
};
