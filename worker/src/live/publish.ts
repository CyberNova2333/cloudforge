// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Channels (pings carry no data): `repo:<id>` for any change in a repository; `approvals` for
 * anything that may change an approvals inbox; `user:<id>` for a change in that person's notifications.
 */
export const repoChannel = (repositoryId: string) => `repo:${repositoryId}`;
/** One person's own channel: their notifications changed. */
export const userChannel = (userId: string) => `user:${userId}`;
export const APPROVALS_CHANNEL = 'approvals';

export function liveConfigured(env: CloudflareBindings): boolean {
  return Boolean((env as Partial<CloudflareBindings>).LIVE);
}

const hub = (env: CloudflareBindings) => env.LIVE.getByName('hub');

/** Pings `repo:<id>` (and `approvals`). Never throws: a missed ping only delays an update. */
export async function publishChange(
  env: CloudflareBindings,
  repositoryId: string,
  opts: { approvals?: boolean } = {}
): Promise<void> {
  if (!liveConfigured(env)) return;
  try {
    const h = hub(env);
    await h.publish(
      repoChannel(repositoryId),
      JSON.stringify({ type: 'repo' })
    );
    if (opts.approvals)
      await h.publish(APPROVALS_CHANNEL, JSON.stringify({ type: 'approvals' }));
  } catch (e) {
    console.warn('[live] publish failed', e);
  }
}

/** Pings each person's own channel (their notifications changed), in one call. Never throws. */
export async function publishToUsers(
  env: CloudflareBindings,
  userIds: string[]
): Promise<void> {
  if (!liveConfigured(env) || !userIds.length) return;
  try {
    await hub(env).publishMany(
      userIds.map(userChannel),
      JSON.stringify({ type: 'notifications' })
    );
  } catch (e) {
    console.warn('[live] publish failed', e);
  }
}

/** Opens a WebSocket on the hub, subscribed to already-authorized channels. */
export function connectLive(
  env: CloudflareBindings,
  request: Request,
  channels: string[]
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('X-Live-Channels', channels.join(','));
  return hub(env).fetch(new Request(request.url, { headers }));
}

/** The parts of a Workflow step runner the executors use. */
interface Steps {
  do<T>(name: string, ...args: unknown[]): Promise<T>;
  sleep?(name: string, duration: number): Promise<void>;
  waitForEvent?(name: string, options: unknown): Promise<unknown>;
}

/**
 * Wraps a Workflow step runner so each completed step pings the repository, except one `quiet` says changed nothing
 * anyone sees (a poll that found the work still running).
 */
export function pingingSteps<S>(
  env: CloudflareBindings,
  step: S,
  repositoryId: string,
  opts: {
    approvals?: boolean;
    quiet?: (name: string, result: unknown) => boolean;
  } = {}
): S {
  const inner = step as unknown as Steps;
  const wrapped: Steps = {
    async do<T>(name: string, ...args: unknown[]): Promise<T> {
      const result = await inner.do<T>(name, ...args);
      if (opts.quiet?.(name, result)) return result;
      await publishChange(env, repositoryId, opts);
      return result;
    },
    // Sleeping changes nothing anyone sees: no ping.
    sleep: (name, duration) => inner.sleep!(name, duration),
  };
  // Waiting changes nothing on screen; the step after it pings.
  if (inner.waitForEvent)
    wrapped.waitForEvent = (name, options) =>
      inner.waitForEvent!(name, options);
  return wrapped as unknown as S;
}
