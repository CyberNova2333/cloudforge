// Notifications (docs/notifications.md): a member's inbox at /api/notifications, and per repository, watching it and
// subscribing to one issue or pull request.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import {
  issues,
  notificationEvents,
  notificationReasons,
  notifications,
  pullRequests,
} from '../../db/app.schema';
import type { AppEnv } from '../../variables';
import { loadRepo, type RepoEnv } from '../../repositories/service';
import {
  setSubscription,
  setWatchLevel,
  subscriptionOf,
  watcherCount,
  watchLevel,
  WATCH_LEVELS,
  type Thread,
} from '../service';
import { publishToUsers } from '../../live/publish';
import { listInbox, markRead, unreadCount } from '../inbox';
import {
  json200Response,
  json400Response,
  json401Response,
  json404Response,
  okSchema,
  validationHook,
} from '../../http/openapi-helpers';
import { ownerRepoParams, publicUserSchema } from '../../http/schemas';

export const notificationsRouter = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

const notificationSchema = z
  .object({
    id: z.string(),
    unread: z.boolean(),
    reason: z.enum(notificationReasons),
    event: z.enum(notificationEvents),
    /** Null: CloudForge itself (a merge by auto-merge). */
    actor: publicUserSchema.nullable(),
    excerpt: z.string().nullable(),
    repository: z.string(),
    subject: z.object({
      kind: z.enum(['issue', 'pull']),
      number: z.number(),
      title: z.string(),
      state: z.enum(['open', 'closed', 'merged']),
      /** Issues: why it was closed. */
      stateReason: z.enum(['completed', 'not_planned']).nullable(),
    }),
    /** The page it is about, e.g. `/octocat/app/issues/12`. */
    url: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Notification');

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notifications'],
  request: {
    query: z.object({
      filter: z.enum(['unread', 'all']).default('unread'),
      reason: z.enum(notificationReasons).optional(),
      /** `owner/name`. */
      repo: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      page: z.coerce.number().int().min(1).default(1),
    }),
  },
  responses: {
    ...json200Response(
      z.object({
        notifications: z.array(notificationSchema),
        /** Unread notifications, whatever the filters. */
        unread: z.number(),
        /** How many match the filters, before paging. */
        total: z.number(),
      }),
      'Your notifications, newest first'
    ),
    ...json401Response,
  },
});
notificationsRouter.openapi(listRoute, async (c) => {
  const q = c.req.valid('query');
  const inbox = await listInbox(c.get('db'), c.get('user')!, {
    filter: q.filter,
    reason: q.reason,
    repo: q.repo,
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
  });
  return c.json(
    { notifications: inbox.items, unread: inbox.unread, total: inbox.total },
    200
  );
});

const countRoute = createRoute({
  method: 'get',
  path: '/count',
  tags: ['Notifications'],
  responses: {
    ...json200Response(z.object({ unread: z.number() }), 'Unread count'),
    ...json401Response,
  },
});
notificationsRouter.openapi(countRoute, async (c) =>
  c.json({ unread: await unreadCount(c.get('db'), c.get('user')!) }, 200)
);

const markReadRoute = createRoute({
  method: 'post',
  path: '/read',
  tags: ['Notifications'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              ids: z.array(z.string().max(64)).max(100).optional(),
              /** Every notification (in `repo` when given). */
              all: z.boolean().optional(),
              repo: z.string().max(200).optional(),
            })
            .refine((b) => !!b.ids?.length || b.all, 'Give ids or all'),
        },
      },
    },
  },
  responses: {
    ...json200Response(z.object({ updated: z.number() }), 'Marked read'),
    ...json400Response,
    ...json401Response,
  },
});
notificationsRouter.openapi(markReadRoute, async (c) => {
  const user = c.get('user')!;
  const updated = await markRead(c.get('db'), user.id, c.req.valid('json'));
  if (updated) await publishToUsers(c.env, [user.id]);
  return c.json({ updated }, 200);
});

const idParams = z.object({ id: z.string().max(64) });

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Notifications'],
  request: {
    params: idParams,
    body: {
      content: {
        'application/json': { schema: z.object({ unread: z.boolean() }) },
      },
    },
  },
  responses: {
    ...json200Response(okSchema, 'Updated'),
    ...json404Response,
  },
});
notificationsRouter.openapi(updateRoute, async (c) => {
  const user = c.get('user')!;
  const done = await c
    .get('db')
    .update(notifications)
    .set({ unread: c.req.valid('json').unread })
    .where(
      and(
        eq(notifications.id, c.req.valid('param').id),
        eq(notifications.userId, user.id)
      )
    )
    .returning({ id: notifications.id });
  if (!done.length) return c.json({ error: 'Not Found' }, 404);
  await publishToUsers(c.env, [user.id]);
  return c.json({ ok: true as const }, 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Notifications'],
  summary: 'Done: removes it from the inbox until the next event on its thread',
  request: { params: idParams },
  responses: {
    ...json200Response(okSchema, 'Removed'),
    ...json404Response,
  },
});
notificationsRouter.openapi(deleteRoute, async (c) => {
  const user = c.get('user')!;
  const done = await c
    .get('db')
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, c.req.valid('param').id),
        eq(notifications.userId, user.id)
      )
    )
    .returning({ id: notifications.id });
  if (!done.length) return c.json({ error: 'Not Found' }, 404);
  await publishToUsers(c.env, [user.id]);
  return c.json({ ok: true as const }, 200);
});

// ── per repository ───────────────────────────────────────────────────────────

export const repoNotificationsRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});
repoNotificationsRouter.use('/:owner/:repo/watch', loadRepo);
repoNotificationsRouter.use(
  '/:owner/:repo/issues/:number/subscription',
  loadRepo
);
repoNotificationsRouter.use(
  '/:owner/:repo/pulls/:number/subscription',
  loadRepo
);

const watchSchema = z.object({
  /** participating (the default): only threads you follow; watching: every issue and pull request; ignoring: none. */
  level: z.enum(WATCH_LEVELS),
  /** People watching the repository. */
  watchers: z.number(),
});

const getWatchRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/watch',
  tags: ['Notifications'],
  request: { params: ownerRepoParams },
  responses: {
    ...json200Response(watchSchema, 'How you follow this repository'),
    ...json404Response,
  },
});
repoNotificationsRouter.openapi(getWatchRoute, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const repo = c.get('repo');
  return c.json(
    {
      level: user ? await watchLevel(db, user.id, repo.id) : 'participating',
      watchers: await watcherCount(db, repo.id),
    },
    200
  );
});

const putWatchRoute = createRoute({
  method: 'put',
  path: '/{owner}/{repo}/watch',
  tags: ['Notifications'],
  request: {
    params: ownerRepoParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({ level: z.enum(WATCH_LEVELS) }),
        },
      },
    },
  },
  responses: {
    ...json200Response(watchSchema, 'How you follow this repository now'),
    ...json404Response,
  },
});
repoNotificationsRouter.openapi(putWatchRoute, async (c) => {
  const db = c.get('db');
  const repo = c.get('repo');
  const level = c.req.valid('json').level;
  await setWatchLevel(db, c.get('user')!.id, repo.id, level);
  return c.json({ level, watchers: await watcherCount(db, repo.id) }, 200);
});

const threadParams = ownerRepoParams.extend({
  number: z.coerce.number().int().min(1),
});

const subscriptionSchema = z.object({
  subscribed: z.boolean(),
  /** Why: author, assign, mention, participating, manual, or watching (the repository). */
  reason: z.string().nullable(),
});

/** The issue or pull request `number` of the loaded repository as a thread, or null. */
async function threadOf(
  c: Context<RepoEnv>,
  kind: 'issue' | 'pull',
  number: number
): Promise<Thread | null> {
  const repo = c.get('repo');
  const table = kind === 'issue' ? issues : pullRequests;
  const row = await c
    .get('db')
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.repositoryId, repo.id), eq(table.number, number)))
    .get();
  return row ? { kind, id: row.id, repositoryId: repo.id } : null;
}

for (const [segment, kind] of [
  ['issues', 'issue'],
  ['pulls', 'pull'],
] as const) {
  const getRoute = createRoute({
    method: 'get',
    path: `/{owner}/{repo}/${segment}/{number}/subscription`,
    tags: ['Notifications'],
    request: { params: threadParams },
    responses: {
      ...json200Response(subscriptionSchema, 'Whether you are subscribed'),
      ...json404Response,
    },
  });
  repoNotificationsRouter.openapi(getRoute, async (c) => {
    const thread = await threadOf(c, kind, c.req.valid('param').number);
    if (!thread) return c.json({ error: 'Not Found' }, 404);
    const user = c.get('user');
    return c.json(
      user
        ? await subscriptionOf(c.get('db'), user.id, thread)
        : { subscribed: false, reason: null },
      200
    );
  });
  const putRoute = createRoute({
    method: 'put',
    path: `/{owner}/{repo}/${segment}/{number}/subscription`,
    tags: ['Notifications'],
    request: {
      params: threadParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({ subscribed: z.boolean() }),
          },
        },
      },
    },
    responses: {
      ...json200Response(subscriptionSchema, 'Whether you are subscribed now'),
      ...json404Response,
    },
  });
  repoNotificationsRouter.openapi(putRoute, async (c) => {
    const thread = await threadOf(c, kind, c.req.valid('param').number);
    if (!thread) return c.json({ error: 'Not Found' }, 404);
    const userId = c.get('user')!.id;
    await setSubscription(
      c.get('db'),
      userId,
      thread,
      c.req.valid('json').subscribed
    );
    return c.json(await subscriptionOf(c.get('db'), userId, thread), 200);
  });
}
