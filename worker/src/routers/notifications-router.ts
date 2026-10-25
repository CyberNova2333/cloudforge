// Notifications (docs/notifications.md): a member's inbox at /api/notifications, and per repository, watching it and
// subscribing to one issue or pull request.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  issues,
  notificationEvents,
  notificationReasons,
  notifications,
  pullRequests,
  repositories,
  teams,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { AppEnv } from '../variables';
import {
  findRepo,
  loadRepo,
  teamNamespace,
  userNamespace,
  visibleTo,
  type RepoEnv,
} from '../lib/repos';
import { toPublicUser } from '../lib/users';
import { inJsonArray } from '../lib/sql-set';
import {
  setSubscription,
  setWatchLevel,
  subscriptionOf,
  watcherCount,
  watchLevel,
  WATCH_LEVELS,
  type Thread,
} from '../lib/notifications';
import { publishToUsers } from '../live/publish';
import {
  json200Response,
  json400Response,
  json401Response,
  json404Response,
  okSchema,
  validationHook,
} from './openapi-helpers';
import { ownerRepoParams, publicUserSchema } from './schemas';

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

/** The inbox's rows: `userId`'s, in repositories they can still read, about issues and pull requests that exist. */
function inboxWhere(c: Context<AppEnv>, extra: (SQL | undefined)[] = []) {
  const user = c.get('user')!;
  return and(
    eq(notifications.userId, user.id),
    visibleTo(user),
    sql`(${notifications.issueId} IS NOT NULL OR ${notifications.pullRequestId} IS NOT NULL)`,
    ...extra
  );
}

/** The repository filter `owner/name`, or undefined when absent; null when it names nothing. */
async function repoFilter(c: Context<AppEnv>, name: string | undefined) {
  if (!name) return undefined;
  const [owner, repo] = name.split('/');
  const found = owner && repo ? await findRepo(c.get('db'), owner, repo) : null;
  return found ? eq(notifications.repositoryId, found.repo.id) : null;
}

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
  const db = c.get('db');
  const q = c.req.valid('query');
  const repo = await repoFilter(c, q.repo);
  const where = inboxWhere(c, [
    q.filter === 'unread' ? eq(notifications.unread, true) : undefined,
    q.reason ? eq(notifications.reason, q.reason) : undefined,
    repo === null ? sql`0` : repo,
  ]);
  const actor = alias(users, 'actor');
  const owner = alias(users, 'owner');
  const [rows, total, unread] = await Promise.all([
    db
      .select({
        n: notifications,
        repo: repositories,
        owner,
        team: teams,
        actor,
        issue: issues,
        pull: pullRequests,
      })
      .from(notifications)
      .innerJoin(repositories, eq(repositories.id, notifications.repositoryId))
      .innerJoin(owner, eq(owner.id, repositories.ownerId))
      .leftJoin(teams, eq(teams.id, repositories.teamId))
      .leftJoin(actor, eq(actor.id, notifications.actorId))
      .leftJoin(issues, eq(issues.id, notifications.issueId))
      .leftJoin(pullRequests, eq(pullRequests.id, notifications.pullRequestId))
      .where(where)
      .orderBy(desc(notifications.updatedAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .all(),
    countWhere(c, where),
    countWhere(c, inboxWhere(c, [eq(notifications.unread, true)])),
  ]);
  return c.json(
    {
      notifications: rows.flatMap((r) => {
        const ns = r.team ? teamNamespace(r.team) : userNamespace(r.owner);
        const fullName = `${ns.username}/${r.repo.name}`;
        const subject = r.issue
          ? {
              kind: 'issue' as const,
              number: r.issue.number,
              title: r.issue.title,
              state: r.issue.state,
              stateReason: r.issue.stateReason,
            }
          : r.pull
            ? {
                kind: 'pull' as const,
                number: r.pull.number,
                title: r.pull.title,
                state: r.pull.state,
                stateReason: null,
              }
            : null;
        if (!subject) return [];
        return [
          {
            id: r.n.id,
            unread: r.n.unread,
            reason: r.n.reason,
            event: r.n.event,
            actor: r.actor ? toPublicUser(r.actor) : null,
            excerpt: r.n.excerpt,
            repository: fullName,
            subject,
            url: `/${fullName}/${subject.kind === 'issue' ? 'issues' : 'pull'}/${subject.number}`,
            updatedAt: r.n.updatedAt.toISOString(),
          },
        ];
      }),
      unread,
      total,
    },
    200
  );
});

async function countWhere(c: Context<AppEnv>, where: SQL | undefined) {
  const row = await c
    .get('db')
    .select({ n: sql<number>`COUNT(*)` })
    .from(notifications)
    .innerJoin(repositories, eq(repositories.id, notifications.repositoryId))
    .where(where)
    .get();
  return Number(row?.n ?? 0);
}

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
  c.json(
    {
      unread: await countWhere(
        c,
        inboxWhere(c, [eq(notifications.unread, true)])
      ),
    },
    200
  )
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
  const body = c.req.valid('json');
  const user = c.get('user')!;
  const repo = await repoFilter(c, body.repo);
  if (repo === null) return c.json({ updated: 0 }, 200);
  const changed = await c
    .get('db')
    .update(notifications)
    .set({ unread: false })
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.unread, true),
        body.all ? undefined : inJsonArray(notifications.id, body.ids ?? []),
        repo
      )
    )
    .returning({ id: notifications.id });
  if (changed.length) await publishToUsers(c.env, [user.id]);
  return c.json({ updated: changed.length }, 200);
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
