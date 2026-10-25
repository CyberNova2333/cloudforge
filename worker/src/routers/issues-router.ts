// Issues and labels (docs/issues.md). Readers of the repository see them; signed-in readers open issues and comment;
// the author or a person with push access edits, closes and reopens; push access sets labels and assignees and manages
// the repository's labels; an admin deletes an issue.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  issueComments,
  issueEvents,
  issueEventKinds,
  issueLabels,
  issueStateReasons,
  issues,
  labels,
  pullRequests,
  type Issue,
  type Label,
} from '../db/app.schema';
import { loadRepo, type RepoEnv } from '../lib/repos';
import { usersById, userByUsername, type PublicUser } from '../lib/users';
import { recordAudit } from '../lib/audit';
import {
  addIssueComment,
  assigneesNamed,
  assigneesOf,
  closeIssue,
  editIssue,
  getIssue,
  ISSUE_BODY_MAX,
  ISSUE_TITLE_MAX,
  LABEL_COLOR_RE,
  LABEL_DESCRIPTION_MAX,
  LABEL_NAME_MAX,
  labelsNamed,
  labelsOf,
  listIssues,
  MAX_ISSUE_ASSIGNEES,
  MAX_ISSUE_LABELS,
  MAX_REPO_LABELS,
  openIssue,
  reopenIssue,
  setIssueAssignees,
  setIssueLabels,
} from '../lib/issues';
import { pullsNaming } from '../lib/issue-links';
import type { NotifyCtx } from '../lib/notifications';
import {
  errorSchema,
  json200Response,
  json201Response,
  json400Response,
  json403Response,
  json404Response,
  json409Response,
  json422Response,
  okSchema,
  validationHook,
} from './openapi-helpers';
import { ownerRepoParams, publicUserSchema } from './schemas';

export const issuesRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});
issuesRouter.use('/:owner/:repo/issues', loadRepo);
issuesRouter.use('/:owner/:repo/issues/*', loadRepo);
issuesRouter.use('/:owner/:repo/labels', loadRepo);
issuesRouter.use('/:owner/:repo/labels/*', loadRepo);

/** A repository with issues turned off has neither the pages nor the API. */
const issuesOn: MiddlewareHandler<RepoEnv> = async (c, next) => {
  if (!c.get('repo').hasIssues)
    return c.json({ error: 'Issues are turned off for this repository' }, 404);
  await next();
};
issuesRouter.use('/:owner/:repo/issues', issuesOn);
issuesRouter.use('/:owner/:repo/issues/*', issuesOn);
issuesRouter.use('/:owner/:repo/labels', issuesOn);
issuesRouter.use('/:owner/:repo/labels/*', issuesOn);

const ghost: PublicUser = {
  id: 'ghost',
  username: 'ghost',
  name: 'Deleted user',
  image: null,
};

export const labelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Six hex digits, no '#'. */
    color: z.string(),
    description: z.string(),
  })
  .openapi('Label');

const issueSchema = z
  .object({
    id: z.string(),
    number: z.number(),
    title: z.string(),
    body: z.string(),
    state: z.enum(['open', 'closed']),
    /** Why it was closed; null while open. */
    stateReason: z.enum(issueStateReasons).nullable(),
    author: publicUserSchema,
    labels: z.array(labelSchema),
    assignees: z.array(publicUserSchema),
    commentCount: z.number(),
    closedAt: z.string().nullable(),
    closedBy: publicUserSchema.nullable(),
    /** The pull request whose landing closed it; null when a person closed it. */
    closedByPull: z.number().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Issue');

const commentSchema = z
  .object({
    id: z.string(),
    author: publicUserSchema,
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('IssueComment');

const eventSchema = z
  .object({
    id: z.string(),
    kind: z.enum(issueEventKinds),
    /** Null: CloudForge itself (a landing that closed it). */
    actor: publicUserSchema.nullable(),
    /** assigned/unassigned: who. */
    user: publicUserSchema.nullable(),
    /**
     * closed { reason, pull? }, labeled/unlabeled { label, color }, renamed { from, to }, referenced { pull, closes }.
     */
    data: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .openapi('IssueEvent');

const labelOut = (l: Label) => ({
  id: l.id,
  name: l.name,
  color: l.color,
  description: l.description,
});

/** `rows` as the API shows them, with one query each for their labels, assignees and people. */
async function serializeIssues(
  c: Context<RepoEnv>,
  rows: { issue: Issue; comments: number }[]
) {
  const db = c.get('db');
  const ids = rows.map((r) => r.issue.id);
  const [labelMap, assigneeMap, closedBy] = await Promise.all([
    labelsOf(db, ids),
    assigneesOf(db, ids),
    closingPulls(
      c,
      rows.map((r) => r.issue)
    ),
  ]);
  const people = await usersById(db, [
    ...rows.flatMap((r) => [r.issue.authorId, r.issue.closedById ?? '']),
    ...[...assigneeMap.values()].flat(),
  ]);
  return rows.map(({ issue, comments }) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.stateReason,
    author: people.get(issue.authorId) ?? ghost,
    labels: (labelMap.get(issue.id) ?? []).map(labelOut),
    assignees: (assigneeMap.get(issue.id) ?? []).flatMap((id) => {
      const u = people.get(id);
      return u ? [u] : [];
    }),
    commentCount: Number(comments),
    closedAt: issue.closedAt?.toISOString() ?? null,
    closedBy: issue.closedById ? (people.get(issue.closedById) ?? ghost) : null,
    closedByPull: issue.closedByPullId
      ? (closedBy.get(issue.closedByPullId) ?? null)
      : null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  }));
}

/** The numbers of the pull requests that closed `list`, by pull request id. */
async function closingPulls(c: Context<RepoEnv>, list: Issue[]) {
  const ids = [
    ...new Set(
      list.flatMap((i) => (i.closedByPullId ? [i.closedByPullId] : []))
    ),
  ];
  if (!ids.length) return new Map<string, number>();
  const rows = await c
    .get('db')
    .select({ id: pullRequests.id, number: pullRequests.number })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.repositoryId, c.get('repo').id),
        sql`${pullRequests.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
      )
    )
    .all();
  return new Map(rows.map((r) => [r.id, r.number]));
}

async function issueOut(c: Context<RepoEnv>, issue: Issue) {
  const comments = await c
    .get('db')
    .select({ n: sql<number>`COUNT(*)` })
    .from(issueComments)
    .where(eq(issueComments.issueId, issue.id))
    .get();
  return (
    await serializeIssues(c, [{ issue, comments: Number(comments?.n ?? 0) }])
  )[0];
}

const numberParams = ownerRepoParams.extend({
  number: z.coerce.number().int().min(1),
});

/** Notifications from this request: written now, their emails sent after the response. */
const notifyCtx = (c: Context<RepoEnv>): NotifyCtx => ({
  env: c.env,
  db: c.get('db'),
  after: (work) => c.executionCtx.waitUntil(work),
});

/** The author, or someone with push access. */
const mayEdit = (c: Context<RepoEnv>, authorId: string) =>
  c.get('perms').write || c.get('user')?.id === authorId;

// ── list / create ────────────────────────────────────────────────────────────

const listRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/issues',
  tags: ['Issues'],
  request: {
    params: ownerRepoParams,
    query: z.object({
      state: z.enum(['open', 'closed', 'all']).default('open'),
      /** Every word must match: a number (`#12`), or part of the title or the author's username or name. */
      q: z.string().trim().max(100).optional(),
      /** A label's name. */
      label: z.string().trim().max(LABEL_NAME_MAX).optional(),
      /** A username, or `none` for issues nobody is assigned to. */
      assignee: z.string().trim().max(100).optional(),
      /** The author's username. */
      author: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      page: z.coerce.number().int().min(1).default(1),
    }),
  },
  responses: {
    ...json200Response(
      z.object({
        issues: z.array(issueSchema),
        /** The repository's open and closed issues, whatever the filters. */
        openCount: z.number(),
        closedCount: z.number(),
        /** How many issues the filters match, before paging. */
        total: z.number(),
      }),
      'Issues'
    ),
  },
});
issuesRouter.openapi(listRoute, async (c) => {
  const db = c.get('db');
  const query = c.req.valid('query');
  // A username nobody has matches nothing.
  const userId = async (name: string | undefined) =>
    name ? ((await userByUsername(db, name))?.id ?? 'nobody') : undefined;
  const result = await listIssues(db, c.get('repo').id, {
    state: query.state,
    q: query.q,
    label: query.label,
    assignee:
      query.assignee?.toLowerCase() === 'none'
        ? 'none'
        : await userId(query.assignee),
    authorId: await userId(query.author),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  return c.json(
    {
      issues: await serializeIssues(c, result.rows),
      openCount: result.openCount,
      closedCount: result.closedCount,
      total: result.total,
    },
    200
  );
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/issues',
  tags: ['Issues'],
  request: {
    params: ownerRepoParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().trim().min(1).max(ISSUE_TITLE_MAX),
            body: z.string().max(ISSUE_BODY_MAX).default(''),
            /** Label names; needs push access. */
            labels: z
              .array(z.string().max(LABEL_NAME_MAX))
              .max(MAX_ISSUE_LABELS)
              .optional(),
            /** Usernames of people with push access; needs push access. */
            assignees: z
              .array(z.string().max(100))
              .max(MAX_ISSUE_ASSIGNEES)
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    ...json201Response(issueSchema, 'Created'),
    ...json400Response,
    ...json403Response,
    ...json422Response,
  },
});
issuesRouter.openapi(createRouteDef, async (c) => {
  const db = c.get('db');
  const repo = c.get('repo');
  const body = c.req.valid('json');
  if ((body.labels?.length || body.assignees?.length) && !c.get('perms').write)
    return c.json(
      {
        error:
          'Only people with push access can set labels or assignees on an issue',
      },
      403
    );
  const named = await labelsNamed(db, repo.id, body.labels ?? []);
  if (!named.ok) return c.json({ error: named.error }, 422);
  const assignees = await assigneesNamed(db, repo, body.assignees ?? []);
  if (!assignees.ok) return c.json({ error: assignees.error }, 422);
  const issue = await openIssue({
    db,
    repo,
    authorId: c.get('user')!.id,
    title: body.title,
    body: body.body,
    labels: named.labels,
    assigneeIds: assignees.users.map((u) => u.id),
    notify: notifyCtx(c),
  });
  return c.json(await issueOut(c, issue), 201);
});

// ── one issue ────────────────────────────────────────────────────────────────

const getRouteDef = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/issues/{number}',
  tags: ['Issues'],
  request: { params: numberParams },
  responses: {
    ...json200Response(
      z.object({
        issue: issueSchema,
        comments: z.array(commentSchema),
        events: z.array(eventSchema),
        /** The pull requests that name it in their title or description, newest first. */
        pulls: z.array(
          z.object({
            number: z.number(),
            title: z.string(),
            state: z.enum(['open', 'closed', 'merged']),
            /** It closes this issue when it lands on the default branch. */
            closes: z.boolean(),
          })
        ),
      }),
      'Issue'
    ),
    404: {
      content: {
        'application/json': {
          schema: errorSchema.extend({
            /** The number belongs to this pull request instead. */
            pullNumber: z.number().optional(),
          }),
        },
      },
      description: 'Not Found',
    },
  },
});
issuesRouter.openapi(getRouteDef, async (c) => {
  const db = c.get('db');
  const repo = c.get('repo');
  const n = c.req.valid('param').number;
  const issue = await getIssue(db, repo.id, n);
  if (!issue) {
    const pr = await db
      .select({ number: pullRequests.number })
      .from(pullRequests)
      .where(
        and(eq(pullRequests.repositoryId, repo.id), eq(pullRequests.number, n))
      )
      .get();
    return c.json(
      { error: 'Not Found', ...(pr ? { pullNumber: pr.number } : {}) },
      404
    );
  }
  const [comments, events, pulls] = await Promise.all([
    db
      .select()
      .from(issueComments)
      .where(eq(issueComments.issueId, issue.id))
      .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
      .all(),
    db
      .select()
      .from(issueEvents)
      .where(eq(issueEvents.issueId, issue.id))
      .orderBy(asc(issueEvents.createdAt))
      .all(),
    pullsNaming(db, issue.id),
  ]);
  const people = await usersById(db, [
    ...comments.map((m) => m.authorId),
    ...events.flatMap((e) => [
      e.actorId ?? '',
      typeof e.data.user === 'string' ? e.data.user : '',
    ]),
  ]);
  const [out] = await serializeIssues(c, [
    { issue, comments: comments.length },
  ]);
  return c.json(
    {
      issue: out,
      comments: comments.map((m) => ({
        id: m.id,
        author: people.get(m.authorId) ?? ghost,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        actor: e.actorId ? (people.get(e.actorId) ?? ghost) : null,
        user:
          typeof e.data.user === 'string'
            ? (people.get(e.data.user) ?? ghost)
            : null,
        data: e.data,
        createdAt: e.createdAt.toISOString(),
      })),
      pulls,
    },
    200
  );
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/{owner}/{repo}/issues/{number}',
  tags: ['Issues'],
  request: {
    params: numberParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().trim().min(1).max(ISSUE_TITLE_MAX).optional(),
            body: z.string().max(ISSUE_BODY_MAX).optional(),
            state: z.enum(['open', 'closed']).optional(),
            /** Why it is closed (with `state: closed`); defaults to completed. */
            stateReason: z.enum(issueStateReasons).optional(),
            /** The label names it has from now on; needs push access. */
            labels: z
              .array(z.string().max(LABEL_NAME_MAX))
              .max(MAX_ISSUE_LABELS)
              .optional(),
            /** The usernames assigned from now on; needs push access. */
            assignees: z
              .array(z.string().max(100))
              .max(MAX_ISSUE_ASSIGNEES)
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    ...json200Response(issueSchema, 'Updated'),
    ...json400Response,
    ...json403Response,
    ...json404Response,
    ...json422Response,
  },
});
issuesRouter.openapi(updateRouteDef, async (c) => {
  const db = c.get('db');
  const repo = c.get('repo');
  const issue = await getIssue(db, repo.id, c.req.valid('param').number);
  if (!issue) return c.json({ error: 'Not Found' }, 404);
  const user = c.get('user')!;
  const body = c.req.valid('json');
  if (!mayEdit(c, issue.authorId))
    return c.json(
      {
        error:
          'Only its author or people with push access can change this issue',
      },
      403
    );
  if (
    (body.labels !== undefined || body.assignees !== undefined) &&
    !c.get('perms').write
  )
    return c.json(
      {
        error:
          'Only people with push access can set labels or assignees on an issue',
      },
      403
    );
  // Everything is checked before anything is written.
  const named = body.labels
    ? await labelsNamed(db, repo.id, body.labels)
    : null;
  if (named && !named.ok) return c.json({ error: named.error }, 422);
  const assignees = body.assignees
    ? await assigneesNamed(db, repo, body.assignees)
    : null;
  if (assignees && !assignees.ok)
    return c.json({ error: assignees.error }, 422);
  await editIssue(db, issue, { title: body.title, body: body.body }, user.id);
  if (named?.ok) await setIssueLabels(db, issue, named.labels, user.id);
  if (assignees?.ok)
    await setIssueAssignees(db, issue, assignees.users, user.id, notifyCtx(c));
  if (body.state === 'closed')
    await closeIssue(db, issue, {
      actorId: user.id,
      reason: body.stateReason ?? 'completed',
      notify: notifyCtx(c),
    });
  if (body.state === 'open')
    await reopenIssue(db, issue, user.id, notifyCtx(c));
  const fresh = (await getIssue(db, repo.id, issue.number))!;
  return c.json(await issueOut(c, fresh), 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{owner}/{repo}/issues/{number}',
  tags: ['Issues'],
  request: { params: numberParams },
  responses: {
    ...json200Response(okSchema, 'Deleted'),
    ...json403Response,
    ...json404Response,
  },
});
issuesRouter.openapi(deleteRouteDef, async (c) => {
  const db = c.get('db');
  const repo = c.get('repo');
  if (!c.get('perms').admin)
    return c.json({ error: 'Only repository admins can delete an issue' }, 403);
  const issue = await getIssue(db, repo.id, c.req.valid('param').number);
  if (!issue) return c.json({ error: 'Not Found' }, 404);
  // Its number is never handed out again: the counter only grows.
  await db.delete(issues).where(eq(issues.id, issue.id));
  await recordAudit(db, {
    repositoryId: repo.id,
    actorId: c.get('user')!.id,
    action: 'issue.deleted',
    target: `#${issue.number}`,
    data: { title: issue.title },
  });
  return c.json({ ok: true as const }, 200);
});

// ── comments ─────────────────────────────────────────────────────────────────

const commentParams = numberParams.extend({ commentId: z.string() });

const createCommentRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/issues/{number}/comments',
  tags: ['Issues'],
  request: {
    params: numberParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({ body: z.string().min(1).max(ISSUE_BODY_MAX) }),
        },
      },
    },
  },
  responses: {
    ...json201Response(commentSchema, 'Created'),
    ...json404Response,
  },
});
issuesRouter.openapi(createCommentRoute, async (c) => {
  const db = c.get('db');
  const issue = await getIssue(
    db,
    c.get('repo').id,
    c.req.valid('param').number
  );
  if (!issue) return c.json({ error: 'Not Found' }, 404);
  const user = c.get('user')!;
  const row = await addIssueComment(
    db,
    issue,
    user.id,
    c.req.valid('json').body,
    notifyCtx(c)
  );
  const people = await usersById(db, [user.id]);
  return c.json(
    {
      id: row.id,
      author: people.get(user.id) ?? ghost,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    201
  );
});

/** Comment `commentId` of issue `number`, if both exist in this repository. */
async function findComment(
  c: Context<RepoEnv>,
  number: number,
  commentId: string
) {
  const issue = await getIssue(c.get('db'), c.get('repo').id, number);
  if (!issue) return null;
  const comment = await c
    .get('db')
    .select()
    .from(issueComments)
    .where(
      and(eq(issueComments.id, commentId), eq(issueComments.issueId, issue.id))
    )
    .get();
  return comment ? { issue, comment } : null;
}

const updateCommentRoute = createRoute({
  method: 'patch',
  path: '/{owner}/{repo}/issues/{number}/comments/{commentId}',
  tags: ['Issues'],
  request: {
    params: commentParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({ body: z.string().min(1).max(ISSUE_BODY_MAX) }),
        },
      },
    },
  },
  responses: {
    ...json200Response(commentSchema, 'Updated'),
    ...json403Response,
    ...json404Response,
  },
});
issuesRouter.openapi(updateCommentRoute, async (c) => {
  const { number, commentId } = c.req.valid('param');
  const found = await findComment(c, number, commentId);
  if (!found) return c.json({ error: 'Not Found' }, 404);
  if (!mayEdit(c, found.comment.authorId))
    return c.json(
      {
        error:
          'Only its author or people with push access can edit this comment',
      },
      403
    );
  const now = new Date();
  const body = c.req.valid('json').body;
  await c
    .get('db')
    .update(issueComments)
    .set({ body, updatedAt: now })
    .where(eq(issueComments.id, commentId));
  const people = await usersById(c.get('db'), [found.comment.authorId]);
  return c.json(
    {
      id: commentId,
      author: people.get(found.comment.authorId) ?? ghost,
      body,
      createdAt: found.comment.createdAt.toISOString(),
      updatedAt: now.toISOString(),
    },
    200
  );
});

const deleteCommentRoute = createRoute({
  method: 'delete',
  path: '/{owner}/{repo}/issues/{number}/comments/{commentId}',
  tags: ['Issues'],
  request: { params: commentParams },
  responses: {
    ...json200Response(okSchema, 'Deleted'),
    ...json403Response,
    ...json404Response,
  },
});
issuesRouter.openapi(deleteCommentRoute, async (c) => {
  const { number, commentId } = c.req.valid('param');
  const found = await findComment(c, number, commentId);
  if (!found) return c.json({ error: 'Not Found' }, 404);
  if (!mayEdit(c, found.comment.authorId))
    return c.json(
      {
        error:
          'Only its author or people with push access can delete this comment',
      },
      403
    );
  const db = c.get('db');
  await db.delete(issueComments).where(eq(issueComments.id, commentId));
  const user = c.get('user')!;
  // Someone else's comment taken down is moderation: the audit log keeps who did it.
  if (found.comment.authorId !== user.id)
    await recordAudit(db, {
      repositoryId: c.get('repo').id,
      actorId: user.id,
      action: 'issue.comment_deleted',
      target: `#${found.issue.number}`,
      data: { author: found.comment.authorId },
    });
  return c.json({ ok: true as const }, 200);
});

// ── labels ───────────────────────────────────────────────────────────────────

const labelBody = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(LABEL_NAME_MAX)
    .refine((s) => !/[,\n]/.test(s), 'A label name has no commas or newlines'),
  color: z
    .string()
    .trim()
    .transform((s) => s.replace(/^#/, '').toLowerCase())
    .refine((s) => LABEL_COLOR_RE.test(s), 'Six hex digits, like d73a4a'),
  description: z.string().trim().max(LABEL_DESCRIPTION_MAX).default(''),
});

const labelWithCount = labelSchema.extend({
  /** Open issues with it. */
  openIssues: z.number(),
});

const listLabelsRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/labels',
  tags: ['Issues'],
  request: { params: ownerRepoParams },
  responses: {
    ...json200Response(z.array(labelWithCount), 'Labels'),
  },
});
issuesRouter.openapi(listLabelsRoute, async (c) => {
  const rows = await c
    .get('db')
    .select({
      label: labels,
      // Spelled out: a single-table select drops the table name from columns in its fields.
      open: sql<number>`(SELECT COUNT(*) FROM issue_labels il INNER JOIN issues i ON i.id = il.issue_id WHERE il.label_id = labels.id AND i.state = 'open')`,
    })
    .from(labels)
    .where(eq(labels.repositoryId, c.get('repo').id))
    .orderBy(sql`lower(${labels.name})`)
    .all();
  return c.json(
    rows.map((r) => ({ ...labelOut(r.label), openIssues: Number(r.open) })),
    200
  );
});

const pushOnly = (c: Context<RepoEnv>) =>
  c.get('perms').write
    ? null
    : c.json({ error: 'Only people with push access can manage labels' }, 403);

/** Whether another label of the repository already has `name`, ignoring case. */
async function nameTaken(c: Context<RepoEnv>, name: string, except?: string) {
  const row = await c
    .get('db')
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        eq(labels.repositoryId, c.get('repo').id),
        sql`lower(${labels.name}) = ${name.toLowerCase()}`
      )
    )
    .get();
  return !!row && row.id !== except;
}

const createLabelRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/labels',
  tags: ['Issues'],
  request: {
    params: ownerRepoParams,
    body: { content: { 'application/json': { schema: labelBody } } },
  },
  responses: {
    ...json201Response(labelSchema, 'Created'),
    ...json400Response,
    ...json403Response,
    ...json409Response,
    ...json422Response,
  },
});
issuesRouter.openapi(createLabelRoute, async (c) => {
  const refused = pushOnly(c);
  if (refused) return refused;
  const db = c.get('db');
  const repo = c.get('repo');
  const body = c.req.valid('json');
  const count = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(labels)
    .where(eq(labels.repositoryId, repo.id))
    .get();
  if (Number(count?.n ?? 0) >= MAX_REPO_LABELS)
    return c.json(
      { error: `A repository can have at most ${MAX_REPO_LABELS} labels` },
      422
    );
  if (await nameTaken(c, body.name))
    return c.json({ error: `A label named "${body.name}" exists` }, 409);
  const row: Label = {
    id: crypto.randomUUID(),
    repositoryId: repo.id,
    name: body.name,
    color: body.color,
    description: body.description,
    createdAt: new Date(),
  };
  // The unique index has the last word on a name taken meanwhile.
  const inserted = await db
    .insert(labels)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: labels.id });
  if (!inserted.length)
    return c.json({ error: `A label named "${body.name}" exists` }, 409);
  await recordAudit(db, {
    repositoryId: repo.id,
    actorId: c.get('user')!.id,
    action: 'label.created',
    target: row.name,
    data: { color: row.color },
  });
  return c.json(labelOut(row), 201);
});

const labelParams = ownerRepoParams.extend({ labelId: z.string() });

async function findLabel(c: Context<RepoEnv>, id: string) {
  return c
    .get('db')
    .select()
    .from(labels)
    .where(and(eq(labels.id, id), eq(labels.repositoryId, c.get('repo').id)))
    .get();
}

const updateLabelRoute = createRoute({
  method: 'patch',
  path: '/{owner}/{repo}/labels/{labelId}',
  tags: ['Issues'],
  request: {
    params: labelParams,
    body: {
      content: { 'application/json': { schema: labelBody.partial() } },
    },
  },
  responses: {
    ...json200Response(labelSchema, 'Updated'),
    ...json400Response,
    ...json403Response,
    ...json404Response,
    ...json409Response,
  },
});
issuesRouter.openapi(updateLabelRoute, async (c) => {
  const refused = pushOnly(c);
  if (refused) return refused;
  const label = await findLabel(c, c.req.valid('param').labelId);
  if (!label) return c.json({ error: 'Not Found' }, 404);
  const body = c.req.valid('json');
  if (body.name !== undefined && (await nameTaken(c, body.name, label.id)))
    return c.json({ error: `A label named "${body.name}" exists` }, 409);
  const next = {
    name: body.name ?? label.name,
    color: body.color ?? label.color,
    description: body.description ?? label.description,
  };
  try {
    await c.get('db').update(labels).set(next).where(eq(labels.id, label.id));
  } catch {
    // The unique index: another label took the name meanwhile.
    return c.json({ error: `A label named "${next.name}" exists` }, 409);
  }
  const changed = Object.fromEntries(
    (['name', 'color', 'description'] as const)
      .filter((k) => next[k] !== label[k])
      .map((k) => [k, { from: label[k], to: next[k] }])
  );
  if (Object.keys(changed).length)
    await recordAudit(c.get('db'), {
      repositoryId: label.repositoryId,
      actorId: c.get('user')!.id,
      action: 'label.updated',
      target: label.name,
      data: changed,
    });
  return c.json(labelOut({ ...label, ...next }), 200);
});

const deleteLabelRoute = createRoute({
  method: 'delete',
  path: '/{owner}/{repo}/labels/{labelId}',
  tags: ['Issues'],
  request: { params: labelParams },
  responses: {
    ...json200Response(okSchema, 'Deleted'),
    ...json403Response,
    ...json404Response,
  },
});
issuesRouter.openapi(deleteLabelRoute, async (c) => {
  const refused = pushOnly(c);
  if (refused) return refused;
  const label = await findLabel(c, c.req.valid('param').labelId);
  if (!label) return c.json({ error: 'Not Found' }, 404);
  // Its issues lose it with the row (cascade); their timelines keep the name.
  await c.get('db').delete(labels).where(eq(labels.id, label.id));
  await recordAudit(c.get('db'), {
    repositoryId: label.repositoryId,
    actorId: c.get('user')!.id,
    action: 'label.deleted',
    target: label.name,
    data: { color: label.color },
  });
  return c.json({ ok: true as const }, 200);
});
