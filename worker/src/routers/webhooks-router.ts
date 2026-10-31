// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Repository webhooks (docs/webhooks.md): repository admins add, change and remove them, read their recent deliveries,
// send one again, and send a test ping. Secrets are write-only.
import { can } from '../lib/repo-permissions';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import {
  webhookDeliveries,
  webhookEvents,
  webhooks,
  type Webhook,
  type WebhookDelivery,
} from '../db/app.schema';
import { loadRepo, type RepoEnv } from '../lib/repos';
import { recordAudit } from '../lib/audit';
import type { NotifyCtx } from '../lib/notifications';
import {
  deliveriesOf,
  MAX_WEBHOOKS_PER_REPO,
  redeliver,
  sealSecret,
  webhookUrlError,
} from '../lib/webhooks';
import { emitPing } from '../lib/webhook-events';
import {
  json200Response,
  json201Response,
  json400Response,
  json403Response,
  json404Response,
  json422Response,
  okSchema,
  validationHook,
} from './openapi-helpers';
import { ownerRepoParams } from './schemas';

export const webhooksRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});
webhooksRouter.use('/:owner/:repo/hooks', loadRepo);
webhooksRouter.use('/:owner/:repo/hooks/*', loadRepo);

const EVENT_NAMES = [...webhookEvents, '*'] as const;

const hookSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    /** Event names, or ['*'] for every event. */
    events: z.array(z.string()),
    active: z.boolean(),
    /** A secret is set (it is never shown again). */
    hasSecret: z.boolean(),
    /** The latest delivery's HTTP status; null without a response or before any delivery. */
    lastStatus: z.number().nullable(),
    lastDeliveredAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Webhook');

const deliverySchema = z
  .object({
    id: z.string(),
    event: z.string(),
    action: z.string().nullable(),
    status: z.enum(['pending', 'delivered', 'failed']),
    attempts: z.number(),
    responseStatus: z.number().nullable(),
    /** The first 2 KB of the response. */
    responseBody: z.string().nullable(),
    error: z.string().nullable(),
    durationMs: z.number().nullable(),
    /** The JSON body that was (or will be) sent. */
    payload: z.string(),
    createdAt: z.string(),
    deliveredAt: z.string().nullable(),
  })
  .openapi('WebhookDelivery');

const hookOut = (h: Webhook) => ({
  id: h.id,
  url: h.url,
  events: h.events,
  active: h.active,
  hasSecret: !!h.secret,
  lastStatus: h.lastStatus,
  lastDeliveredAt: h.lastDeliveredAt?.toISOString() ?? null,
  createdAt: h.createdAt.toISOString(),
  updatedAt: h.updatedAt.toISOString(),
});

const deliveryOut = (d: WebhookDelivery) => ({
  id: d.id,
  event: d.event,
  action: d.action,
  status: d.status,
  attempts: d.attempts,
  responseStatus: d.responseStatus,
  responseBody: d.responseBody,
  error: d.error,
  durationMs: d.durationMs,
  payload: d.payload,
  createdAt: d.createdAt.toISOString(),
  deliveredAt: d.deliveredAt?.toISOString() ?? null,
});

const adminOnly = (c: Context<RepoEnv>) =>
  can(c.get('perms'), 'manageWebhooks')
    ? null
    : c.json({ error: 'Only repository admins can manage webhooks' }, 403);

const notifyCtx = (c: Context<RepoEnv>): NotifyCtx => ({
  env: c.env,
  db: c.get('db'),
  after: (work) => c.executionCtx.waitUntil(work),
});

async function findHook(c: Context<RepoEnv>, id: string) {
  return c
    .get('db')
    .select()
    .from(webhooks)
    .where(
      and(eq(webhooks.id, id), eq(webhooks.repositoryId, c.get('repo').id))
    )
    .get();
}

const eventsSchema = z
  .array(z.enum(EVENT_NAMES))
  .min(1)
  .max(EVENT_NAMES.length)
  .transform((list) => (list.includes('*') ? ['*'] : [...new Set(list)]));

const secretSchema = z.string().min(1).max(256);

const listRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/hooks',
  tags: ['Webhooks'],
  request: { params: ownerRepoParams },
  responses: {
    ...json200Response(z.array(hookSchema), 'Webhooks'),
    ...json403Response,
  },
});
webhooksRouter.openapi(listRoute, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const rows = await c
    .get('db')
    .select()
    .from(webhooks)
    .where(eq(webhooks.repositoryId, c.get('repo').id))
    .orderBy(webhooks.createdAt)
    .all();
  return c.json(rows.map(hookOut), 200);
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/hooks',
  tags: ['Webhooks'],
  request: {
    params: ownerRepoParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            url: z.string().trim().min(1).max(2000),
            secret: secretSchema.nullable().optional(),
            events: eventsSchema.default(['push']),
            active: z.boolean().default(true),
          }),
        },
      },
    },
  },
  responses: {
    ...json201Response(hookSchema, 'Created'),
    ...json400Response,
    ...json403Response,
    ...json422Response,
  },
});
webhooksRouter.openapi(createRouteDef, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const db = c.get('db');
  const repo = c.get('repo');
  const body = c.req.valid('json');
  const urlError = webhookUrlError(body.url, c.env.BASE_URL);
  if (urlError) return c.json({ error: urlError }, 422);
  const count = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(webhooks)
    .where(eq(webhooks.repositoryId, repo.id))
    .get();
  if (Number(count?.n ?? 0) >= MAX_WEBHOOKS_PER_REPO)
    return c.json(
      {
        error: `A repository can have at most ${MAX_WEBHOOKS_PER_REPO} webhooks`,
      },
      422
    );
  const id = crypto.randomUUID();
  const now = new Date();
  const hook: Webhook = {
    id,
    repositoryId: repo.id,
    url: body.url,
    secret: body.secret ? await sealSecret(c.env, id, body.secret) : null,
    events: body.events,
    active: body.active,
    createdById: c.get('user')!.id,
    lastStatus: null,
    lastDeliveredAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(webhooks).values(hook);
  await recordAudit(db, {
    repositoryId: repo.id,
    actorId: c.get('user')!.id,
    action: 'webhook.created',
    target: new URL(hook.url).host,
    data: { events: hook.events },
  });
  // GitHub's habit: a new hook is pinged at once, so its receiver shows up working (or not) right away.
  if (hook.active) await emitPing(notifyCtx(c), hook, c.get('user')!.id);
  return c.json(hookOut(hook), 201);
});

const hookParams = ownerRepoParams.extend({ hookId: z.string().max(64) });

const getRouteDef = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/hooks/{hookId}',
  tags: ['Webhooks'],
  request: { params: hookParams },
  responses: {
    ...json200Response(
      hookSchema.extend({ deliveries: z.array(deliverySchema) }),
      'The webhook and its latest deliveries'
    ),
    ...json403Response,
    ...json404Response,
  },
});
webhooksRouter.openapi(getRouteDef, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const hook = await findHook(c, c.req.valid('param').hookId);
  if (!hook) return c.json({ error: 'Not Found' }, 404);
  const deliveries = await deliveriesOf(c.get('db'), hook.id);
  return c.json(
    { ...hookOut(hook), deliveries: deliveries.map(deliveryOut) },
    200
  );
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/{owner}/{repo}/hooks/{hookId}',
  tags: ['Webhooks'],
  request: {
    params: hookParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            url: z.string().trim().min(1).max(2000).optional(),
            /** A new secret; null removes it; absent keeps it. */
            secret: secretSchema.nullable().optional(),
            events: eventsSchema.optional(),
            active: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    ...json200Response(hookSchema, 'Updated'),
    ...json400Response,
    ...json403Response,
    ...json404Response,
    ...json422Response,
  },
});
webhooksRouter.openapi(updateRouteDef, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const hook = await findHook(c, c.req.valid('param').hookId);
  if (!hook) return c.json({ error: 'Not Found' }, 404);
  const body = c.req.valid('json');
  if (body.url !== undefined) {
    const urlError = webhookUrlError(body.url, c.env.BASE_URL);
    if (urlError) return c.json({ error: urlError }, 422);
  }
  const patch: Partial<Webhook> = { updatedAt: new Date() };
  if (body.url !== undefined) patch.url = body.url;
  if (body.events !== undefined) patch.events = body.events;
  if (body.active !== undefined) patch.active = body.active;
  if (body.secret !== undefined)
    patch.secret = body.secret
      ? await sealSecret(c.env, hook.id, body.secret)
      : null;
  await c.get('db').update(webhooks).set(patch).where(eq(webhooks.id, hook.id));
  const changed = (['url', 'events', 'active', 'secret'] as const).filter(
    (k) => body[k] !== undefined
  );
  if (changed.length)
    await recordAudit(c.get('db'), {
      repositoryId: hook.repositoryId,
      actorId: c.get('user')!.id,
      action: 'webhook.updated',
      target: new URL(patch.url ?? hook.url).host,
      // Never the secret itself: only that it changed.
      data: { fields: changed },
    });
  return c.json(hookOut({ ...hook, ...patch }), 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{owner}/{repo}/hooks/{hookId}',
  tags: ['Webhooks'],
  request: { params: hookParams },
  responses: {
    ...json200Response(okSchema, 'Deleted'),
    ...json403Response,
    ...json404Response,
  },
});
webhooksRouter.openapi(deleteRouteDef, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const hook = await findHook(c, c.req.valid('param').hookId);
  if (!hook) return c.json({ error: 'Not Found' }, 404);
  // Its deliveries go with it (cascade).
  await c.get('db').delete(webhooks).where(eq(webhooks.id, hook.id));
  await recordAudit(c.get('db'), {
    repositoryId: hook.repositoryId,
    actorId: c.get('user')!.id,
    action: 'webhook.deleted',
    target: new URL(hook.url).host,
    data: { events: hook.events },
  });
  return c.json({ ok: true as const }, 200);
});

const pingRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/hooks/{hookId}/pings',
  tags: ['Webhooks'],
  summary: 'Send a test (a ping event)',
  request: { params: hookParams },
  responses: {
    ...json200Response(z.object({ delivery: z.string().nullable() }), 'Queued'),
    ...json403Response,
    ...json404Response,
  },
});
webhooksRouter.openapi(pingRoute, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const hook = await findHook(c, c.req.valid('param').hookId);
  if (!hook) return c.json({ error: 'Not Found' }, 404);
  const [id] = await emitPing(notifyCtx(c), hook, c.get('user')!.id);
  return c.json({ delivery: id ?? null }, 200);
});

const redeliverRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/hooks/{hookId}/deliveries/{deliveryId}/redeliver',
  tags: ['Webhooks'],
  summary: 'Send a delivery again, as a new delivery with the same body',
  request: {
    params: hookParams.extend({ deliveryId: z.string().max(200) }),
  },
  responses: {
    ...json200Response(z.object({ delivery: z.string().nullable() }), 'Queued'),
    ...json403Response,
    ...json404Response,
  },
});
webhooksRouter.openapi(redeliverRoute, async (c) => {
  const refused = adminOnly(c);
  if (refused) return refused;
  const { hookId, deliveryId } = c.req.valid('param');
  const hook = await findHook(c, hookId);
  if (!hook) return c.json({ error: 'Not Found' }, 404);
  const d = await c
    .get('db')
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.webhookId, hook.id)
      )
    )
    .get();
  if (!d) return c.json({ error: 'Not Found' }, 404);
  const [id] = await redeliver(notifyCtx(c), hook, d);
  return c.json({ delivery: id ?? null }, 200);
});
