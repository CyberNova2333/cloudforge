// Webhooks (docs/webhooks.md): where a repository's events are POSTed, and their deliveries. A delivery is written with
// its event, sent after the response, and retried by the frequent cron (1 min, 5 min, 30 min, 2 h; five tries).
import { and, asc, desc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  webhookDeliveries,
  webhooks,
  type Webhook,
  type WebhookDelivery,
} from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import type { NotifyCtx } from './notifications';

export const MAX_WEBHOOKS_PER_REPO = 20;
export const MAX_ATTEMPTS = 5;
/** Minutes to wait after the nth failed attempt. */
const BACKOFF_MIN = [1, 5, 30, 120];
const TIMEOUT_MS = 10_000;
const RESPONSE_BODY_MAX = 2048;
/** A sender holds a delivery this long. */
const LEASE_MS = 60_000;
const KEEP_MS = 14 * 86_400_000;
/** Request bodies larger than this are cut down (push commits first) before they are stored. */
export const PAYLOAD_MAX = 256 * 1024;

// ── addresses ────────────────────────────────────────────────────────────────

/** Why `url` can't be a webhook's address; null when it can. */
export function webhookUrlError(url: string, baseUrl?: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Enter a full http or https URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return 'Only http and https URLs are allowed';
  if (u.username || u.password)
    return 'Put credentials in the secret, not in the URL';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (!host.includes('.') && !host.includes(':'))
  )
    return 'Local and internal hosts are not allowed';
  if (privateAddress(host))
    return 'Private and reserved addresses are not allowed';
  try {
    if (baseUrl && new URL(baseUrl).hostname.toLowerCase() === host)
      return 'A webhook cannot call this instance itself';
  } catch {
    // A malformed BASE_URL forbids nothing more.
  }
  return null;
}

/** Whether `host` is an IP literal in a private, loopback, link-local or reserved range. */
function privateAddress(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (!host.includes(':')) return false;
  const h = host.toLowerCase();
  return (
    h === '::' ||
    h === '::1' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe8') ||
    h.startsWith('fe9') ||
    h.startsWith('fea') ||
    h.startsWith('feb') ||
    h.startsWith('::ffff:')
  );
}

// ── secrets ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

/** The AES key for webhook secrets: from ACTIONS_SECRETS_KEY, else BETTER_AUTH_SECRET. */
function secretKey(env: CloudflareBindings): Promise<CryptoKey> {
  const secret =
    (env as Partial<CloudflareBindings>).ACTIONS_SECRETS_KEY ||
    env.BETTER_AUTH_SECRET;
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = (async () =>
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode('cloudforge-webhook-secrets'),
        info: enc.encode('aes-256-gcm v1'),
      },
      await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, [
        'deriveKey',
      ]),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    ))();
  cachedKey = { secret, key };
  return key;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** `secret` encrypted for webhook `hookId` (the ciphertext opens only on that row). */
export async function sealSecret(
  env: CloudflareBindings,
  hookId: string,
  secret: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`webhook:${hookId}`) },
    await secretKey(env),
    enc.encode(secret)
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

async function openSecret(
  env: CloudflareBindings,
  hookId: string,
  sealed: string
): Promise<string | null> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: unb64(iv),
        additionalData: enc.encode(`webhook:${hookId}`),
      },
      await secretKey(env),
      unb64(ct)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** `sha256=<hex>`: GitHub's X-Hub-Signature-256 of `body` under `secret`. */
export async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(body))
  );
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ── enqueue and send ─────────────────────────────────────────────────────────

/** The repository's active webhooks that take `event` (`*` takes every event; `ping` is sent to one hook only). */
export async function hooksFor(
  db: DrizzleDB,
  repositoryId: string,
  event: string
): Promise<Webhook[]> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(
      and(eq(webhooks.repositoryId, repositoryId), eq(webhooks.active, true))
    )
    .all();
  return rows.filter((h) => h.events.includes('*') || h.events.includes(event));
}

/**
 * Writes one delivery of `payload` per hook, then sends them (after the response when `ctx.after` is set). Never
 * throws: a delivery that cannot be written is logged.
 */
export async function enqueueDeliveries(
  ctx: NotifyCtx,
  hooks: Webhook[],
  event: string,
  action: string | null,
  payload: unknown,
  /** Makes the deliveries' ids stable (`<key>:<hook id>`): an event recorded twice is delivered once. */
  key?: string
): Promise<string[]> {
  if (!hooks.length) return [];
  try {
    const body = JSON.stringify(payload);
    const now = new Date();
    const rows = hooks.map((h) => ({
      id: key ? `${key}:${h.id}` : crypto.randomUUID(),
      webhookId: h.id,
      repositoryId: h.repositoryId,
      event,
      action,
      payload: body,
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    }));
    const ids = (
      await ctx.db
        .insert(webhookDeliveries)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: webhookDeliveries.id })
    ).map((r) => r.id);
    const work = sendDeliveries(ctx.env, ctx.db, ids).catch((e: unknown) =>
      console.error('[webhooks] delivery failed', e)
    );
    if (ctx.after) ctx.after(work);
    else await work;
    return ids;
  } catch (e) {
    console.error('[webhooks] could not record deliveries', event, e);
    return [];
  }
}

/** Takes delivery `id` for one attempt: null when it is done, out of attempts, or another sender holds it. */
async function claim(db: DrizzleDB, id: string, now: number) {
  return (
    (await db
      .update(webhookDeliveries)
      .set({
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        claimedAt: new Date(now),
      })
      .where(
        and(
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.status, 'pending'),
          lt(webhookDeliveries.attempts, MAX_ATTEMPTS),
          or(
            isNull(webhookDeliveries.claimedAt),
            lt(webhookDeliveries.claimedAt, new Date(now - LEASE_MS))
          )
        )
      )
      .returning()
      .get()) ?? null
  );
}

/** One attempt at delivery `id`, recorded on the row and the hook. True when it was delivered. */
export async function sendDelivery(
  env: CloudflareBindings,
  db: DrizzleDB,
  id: string,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  const now = Date.now();
  const d = await claim(db, id, now);
  if (!d) return false;
  const hook = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, d.webhookId))
    .get();
  if (!hook) return false;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'CloudForge-Hookshot/1',
    'X-CloudForge-Event': d.event,
    'X-CloudForge-Delivery': d.id,
    'X-CloudForge-Hook-ID': hook.id,
    'X-GitHub-Event': d.event,
    'X-GitHub-Delivery': d.id,
    'X-GitHub-Hook-ID': hook.id,
  };
  if (hook.secret) {
    const secret = await openSecret(env, hook.id, hook.secret);
    if (secret)
      headers['X-Hub-Signature-256'] = await signature(secret, d.payload);
  }
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  const urlError = webhookUrlError(hook.url, env.BASE_URL);
  const started = Date.now();
  if (urlError) error = urlError;
  else
    try {
      const res = await fetcher(hook.url, {
        method: 'POST',
        headers,
        body: d.payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      responseStatus = res.status;
      responseBody = (await res.text().catch(() => '')).slice(
        0,
        RESPONSE_BODY_MAX
      );
      if (res.status >= 300 && res.status < 400)
        error = 'Redirects are not followed';
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    }
  const ok =
    !error &&
    responseStatus !== null &&
    responseStatus >= 200 &&
    responseStatus < 300;
  const durationMs = Date.now() - started;
  const final = ok || d.attempts >= MAX_ATTEMPTS;
  await db.batch([
    db
      .update(webhookDeliveries)
      .set({
        status: ok ? 'delivered' : final ? 'failed' : 'pending',
        responseStatus,
        responseBody,
        error,
        durationMs,
        claimedAt: null,
        deliveredAt: ok ? new Date() : null,
        nextAttemptAt: final
          ? null
          : new Date(
              Date.now() +
                BACKOFF_MIN[Math.min(d.attempts, BACKOFF_MIN.length) - 1] *
                  60_000
            ),
      })
      .where(eq(webhookDeliveries.id, d.id)),
    db
      .update(webhooks)
      .set({ lastStatus: responseStatus, lastDeliveredAt: new Date() })
      .where(eq(webhooks.id, hook.id)),
  ]);
  return ok;
}

/** Sends `ids` one after another. */
export async function sendDeliveries(
  env: CloudflareBindings,
  db: DrizzleDB,
  ids: string[]
) {
  for (const id of ids) await sendDelivery(env, db, id);
}

/** The frequent cron: sends deliveries due for another attempt (oldest first), then forgets old ones. */
export async function deliverDueWebhooks(
  env: CloudflareBindings,
  db: DrizzleDB,
  opts: { now?: number; limit?: number } = {}
): Promise<number> {
  const now = opts.now ?? Date.now();
  const due = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextAttemptAt, new Date(now))
      )
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(opts.limit ?? 50)
    .all();
  let delivered = 0;
  for (const { id } of due) if (await sendDelivery(env, db, id)) delivered++;
  await db
    .delete(webhookDeliveries)
    .where(lt(webhookDeliveries.createdAt, new Date(now - KEEP_MS)));
  return delivered;
}

/** A delivery sent again as a new one, with the same body. */
export async function redeliver(
  ctx: NotifyCtx,
  hook: Webhook,
  d: WebhookDelivery
): Promise<string[]> {
  return enqueueDeliveries(
    ctx,
    [hook],
    d.event,
    d.action,
    JSON.parse(d.payload)
  );
}

/** A hook's latest deliveries, newest first. */
export function deliveriesOf(db: DrizzleDB, hookId: string, limit = 30) {
  return db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, hookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .all();
}
