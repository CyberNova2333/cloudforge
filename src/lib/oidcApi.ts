import { apiFetch } from './api';

export type OidcProvider = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  version: number;
  callbackUrl: string;
};
export type OidcIdentity = {
  issuer: string;
  subject: string;
  email: string | null;
  name: string | null;
};
export type OidcBinding = OidcIdentity & {
  id: string;
  providerId: string;
  revision: number;
};
export type OidcStatus = {
  sessionId: string;
  provider: OidcProvider | null;
  ready: boolean;
  bindings: OidcBinding[];
};
export type OidcActive = {
  id: string;
  issuer: string;
  version: number;
  generation: number;
  enabled: boolean;
};
export type OidcAdminStatus = {
  sessionId: string;
  configured: boolean;
  provider: OidcProvider | null;
  ready: boolean;
  active: OidcActive | null;
  configurationError?: boolean;
};
export type OidcPreview = {
  previewId: string;
  digest: string;
  expiresAt: string;
  provider: OidcProvider;
};
export type OidcAdminPreview = OidcPreview & { active: OidcActive | null };
export type OidcRetirementPreview = {
  previewId: string;
  digest: string;
  expiresAt: string;
  active: OidcActive;
};
export type OidcAction = {
  sessionId: string;
  actionId: string;
  status:
    'pending' | 'candidate' | 'confirmed' | 'failed' | 'expired' | 'cancelled';
  expiresAt: string | null;
  identity: OidcIdentity | null;
};

/** Callback query data identifies a receipt; it never supplies identity or permission. */
export function oidcActionId(search: string): string | null {
  const values = new URLSearchParams(search).getAll('oidc_action');
  return values.length === 1 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      values[0]!
    )
    ? values[0]!
    : null;
}

export function sameOidcProvider(
  a: OidcProvider | null,
  b: OidcProvider | null
) {
  return (
    !!a &&
    !!b &&
    a.id === b.id &&
    a.name === b.name &&
    a.issuer === b.issuer &&
    a.clientId === b.clientId &&
    a.version === b.version &&
    a.callbackUrl === b.callbackUrl
  );
}

export function liveOidcPreview(
  preview: OidcPreview | null,
  provider: OidcProvider | null,
  now = Date.now()
) {
  return (
    !!preview &&
    sameOidcProvider(preview.provider, provider) &&
    typeof preview.previewId === 'string' &&
    !!preview.previewId &&
    typeof preview.digest === 'string' &&
    !!preview.digest &&
    Number.isFinite(Date.parse(preview.expiresAt)) &&
    Date.parse(preview.expiresAt) > now
  );
}

export function candidateOidcAction(
  action: OidcAction | null,
  now = Date.now()
) {
  return (
    !!action &&
    action.status === 'candidate' &&
    !!action.identity &&
    typeof action.expiresAt === 'string' &&
    Number.isFinite(Date.parse(action.expiresAt)) &&
    Date.parse(action.expiresAt) > now
  );
}

/** Retirement is bound to D1's active configuration; it does not require a usable deployment provider. */
export function liveOidcRetirement(
  preview: OidcRetirementPreview | null,
  active: OidcActive | null,
  now = Date.now()
) {
  return (
    !!preview &&
    !!active &&
    active.enabled !== false &&
    preview.active.enabled !== false &&
    preview.active.id === active.id &&
    preview.active.issuer === active.issuer &&
    preview.active.version === active.version &&
    preview.active.generation === active.generation &&
    typeof preview.previewId === 'string' &&
    !!preview.previewId &&
    typeof preview.digest === 'string' &&
    !!preview.digest &&
    Number.isFinite(Date.parse(preview.expiresAt)) &&
    Date.parse(preview.expiresAt) > now
  );
}

/** The server validates the configured endpoint origins; the browser also rejects unsafe navigation schemes. */
export function oidcAuthorizationUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error(
      'The identity provider returned an invalid authorization address.'
    );
  return url.href;
}

function request<T>(
  path: string,
  sessionId: string,
  signal?: AbortSignal,
  json?: unknown
) {
  return apiFetch<T>(path, {
    cache: 'no-store',
    signal,
    headers: { 'X-CloudForge-Session': sessionId },
    ...(json === undefined ? {} : { method: 'POST', json }),
  });
}
function sessionBound<T extends { sessionId: string }>(
  value: T,
  sessionId: string
) {
  if (value.sessionId !== sessionId)
    throw new Error('The signed-in session changed. Reload and try again.');
  return value;
}

export const oidcApi = {
  status: async (sessionId: string, signal?: AbortSignal) =>
    sessionBound(
      await request<OidcStatus>('/api/me/oidc', sessionId, signal),
      sessionId
    ),
  preview: (sessionId: string, signal?: AbortSignal) =>
    request<OidcPreview>('/api/me/oidc/preview', sessionId, signal, {}),
  start: (sessionId: string, preview: OidcPreview, signal?: AbortSignal) =>
    request<{ authorizationUrl: string }>(
      '/api/me/oidc/start',
      sessionId,
      signal,
      { previewId: preview.previewId, digest: preview.digest }
    ),
  action: async (sessionId: string, actionId: string, signal?: AbortSignal) => {
    const value = sessionBound(
      await request<OidcAction>(
        `/api/me/oidc/actions/${encodeURIComponent(actionId)}`,
        sessionId,
        signal
      ),
      sessionId
    );
    if (value.actionId !== actionId)
      throw new Error('The identity action changed. Refresh its status.');
    return value;
  },
  confirm: (sessionId: string, actionId: string, signal?: AbortSignal) =>
    request<{ binding: OidcBinding }>(
      '/api/me/oidc/confirm',
      sessionId,
      signal,
      { actionId }
    ),
  cancel: (sessionId: string, actionId: string, signal?: AbortSignal) =>
    request<{ ok: true }>('/api/me/oidc/cancel', sessionId, signal, {
      actionId,
    }),
  revoke: (sessionId: string, binding: OidcBinding, signal?: AbortSignal) =>
    request<{ ok: true }>('/api/me/oidc/revoke', sessionId, signal, {
      bindingId: binding.id,
      revision: binding.revision,
    }),
  adminStatus: async (sessionId: string, signal?: AbortSignal) =>
    sessionBound(
      await request<OidcAdminStatus>(
        '/api/admin/oidc-provider',
        sessionId,
        signal
      ),
      sessionId
    ),
  adminPreview: (sessionId: string, signal?: AbortSignal) =>
    request<OidcAdminPreview>(
      '/api/admin/oidc-provider/preview',
      sessionId,
      signal,
      {}
    ),
  apply: (sessionId: string, preview: OidcAdminPreview, signal?: AbortSignal) =>
    request<{ ready: true; provider: OidcProvider }>(
      '/api/admin/oidc-provider/apply',
      sessionId,
      signal,
      { previewId: preview.previewId, digest: preview.digest }
    ),
  retirePreview: (sessionId: string, signal?: AbortSignal) =>
    request<OidcRetirementPreview>(
      '/api/admin/oidc-provider/retire-preview',
      sessionId,
      signal,
      {}
    ),
  retire: (
    sessionId: string,
    preview: OidcRetirementPreview,
    signal?: AbortSignal
  ) =>
    request<{ ready: false; active: OidcActive }>(
      '/api/admin/oidc-provider/retire',
      sessionId,
      signal,
      { previewId: preview.previewId, digest: preview.digest }
    ),
};
