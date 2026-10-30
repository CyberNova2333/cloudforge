import { reportAuthenticationPolicyChallenge } from './authenticationPolicy';

type PendingVerification = {
  sessionId: string;
  waiters: Set<(verified: boolean) => void>;
};

const listeners = new Set<() => void>();
let browserSession: string | null = null;
let pending: PendingVerification | null = null;

const changed = () => listeners.forEach((listener) => listener());

/** Only the mounted UI's current browser session may complete a waiting operation. */
export function setRecentAuthenticationSession(sessionId: string | null) {
  if (browserSession === sessionId) return;
  browserSession = sessionId;
  if (pending) finishRecentAuthentication(pending.sessionId, false);
}

export function subscribeRecentAuthentication(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && pending)
      finishRecentAuthentication(pending.sessionId, false);
  };
}

export const pendingRecentAuthentication = () => pending?.sessionId ?? null;

export function finishRecentAuthentication(
  sessionId: string,
  verified: boolean
) {
  if (pending?.sessionId !== sessionId) return;
  const waiting = pending;
  pending = null;
  for (const resolve of waiting.waiters)
    resolve(verified && browserSession === sessionId);
  changed();
}

/** Concurrent blocked requests share one prompt, while cancellation belongs to each request. */
export function requestRecentAuthentication(
  sessionId: string,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (
    !listeners.size ||
    browserSession !== sessionId ||
    signal?.aborted ||
    (pending && pending.sessionId !== sessionId)
  )
    return Promise.resolve(false);
  if (!pending) pending = { sessionId, waiters: new Set() };
  const waiting = pending;
  return new Promise((resolve) => {
    const done = (verified: boolean) => {
      signal?.removeEventListener('abort', abort);
      waiting.waiters.delete(done);
      resolve(verified);
    };
    const abort = () => {
      done(false);
      if (pending === waiting && !waiting.waiters.size) {
        pending = null;
        changed();
      }
    };
    waiting.waiters.add(done);
    signal?.addEventListener('abort', abort, { once: true });
    changed();
  });
}

function replayable(input: RequestInfo | URL, init?: RequestInit) {
  // A consumed Request or an upload stream cannot safely be replayed after a prompt.
  if (input instanceof Request && (input.bodyUsed || input.body !== null))
    return false;
  return init?.body == null || typeof init.body === 'string';
}

/** Retry once only after an explicit server challenge, never after an uncertain write result. */
export async function recentAuthenticationFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const canReplay = replayable(input, init);
  const response = await fetch(input, init);
  if (response.status !== 403 || typeof window === 'undefined') return response;
  let url: URL;
  try {
    url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin
    );
  } catch {
    return response;
  }
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith('/api/') ||
    !response.headers.get('content-type')?.includes('application/json')
  )
    return response;
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (reportAuthenticationPolicyChallenge(body)) return response;
  if (!canReplay || url.pathname === '/api/auth/reauthenticate')
    return response;
  if (
    body?.code !== 'RECENT_AUTHENTICATION_REQUIRED' ||
    typeof body.sessionId !== 'string' ||
    !body.sessionId ||
    body.sessionId.length > 256
  )
    return response;
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : null);
  if (!(await requestRecentAuthentication(body.sessionId, signal)))
    return response;
  // A cookie may have changed while the prompt was open. The server must enforce this header too.
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  headers.set('X-CloudForge-Session', body.sessionId);
  return fetch(input, { ...init, headers });
}
