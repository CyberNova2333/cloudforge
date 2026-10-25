// Commit statuses (docs/webhooks.md): CI servers report checks on commits, with a session or a personal access token
// (auth/token-auth.ts). Field names follow GitHub's statuses API, so CI plugins written for it work unchanged.
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { commitStatusStates, type CommitStatus } from '../db/app.schema';
import { loadRepo, type RepoEnv } from '../lib/repos';
import { usersById, type PublicUser } from '../lib/users';
import {
  combinedState,
  createStatus,
  latestStatuses,
  statusInputSchema,
  statusesOf,
} from '../lib/commit-statuses';
import { publishChange } from '../live/publish';
import { settleStates } from '../pulls/settle';
import { autoMergeForCommit } from '../review/auto-merge';
import { emitStatus } from '../lib/webhook-events';
import {
  json200Response,
  json201Response,
  json400Response,
  json403Response,
  json404Response,
  json422Response,
  validationHook,
} from './openapi-helpers';
import { ownerRepoParams } from './schemas';

export const statusesRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});
statusesRouter.use('/:owner/:repo/statuses/*', loadRepo);
statusesRouter.use('/:owner/:repo/commits/:ref/status', loadRepo);
statusesRouter.use('/:owner/:repo/commits/:ref/statuses', loadRepo);

const statusSchema = z
  .object({
    id: z.string(),
    sha: z.string(),
    state: z.enum(commitStatusStates),
    context: z.string(),
    description: z.string().nullable(),
    target_url: z.string().nullable(),
    creator: z.object({ login: z.string() }).nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('CommitStatus');

const statusOut = (s: CommitStatus, people: Map<string, PublicUser>) => ({
  id: s.id,
  sha: s.sha,
  state: s.state,
  context: s.context,
  description: s.description,
  target_url: s.targetUrl,
  creator: s.creatorId
    ? { login: people.get(s.creatorId)?.username ?? 'ghost' }
    : null,
  created_at: s.createdAt.toISOString(),
  updated_at: s.createdAt.toISOString(),
});

const shaParams = ownerRepoParams.extend({
  sha: z
    .string()
    .regex(/^[0-9a-fA-F]{40}$/)
    .transform((s) => s.toLowerCase()),
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/statuses/{sha}',
  tags: ['Commit statuses'],
  summary: 'Report a check on a commit',
  description:
    'Needs push access; also takes a personal access token (`Authorization: Bearer …`). Per commit and context the latest status counts: failure or error blocks merging, pending waits.',
  request: {
    params: shaParams,
    body: {
      content: {
        'application/json': {
          schema: statusInputSchema,
        },
      },
    },
  },
  responses: {
    ...json201Response(statusSchema, 'Created'),
    ...json400Response,
    ...json403Response,
    ...json404Response,
    ...json422Response,
  },
});
statusesRouter.openapi(createRouteDef, async (c) => {
  if (!c.get('perms').write)
    return c.json(
      { error: 'You need push access to report statuses on this repository' },
      403
    );
  const { sha } = c.req.valid('param');
  const body = c.req.valid('json');
  const db = c.get('db');
  const repo = c.get('repo');
  if (!(await c.get('git').commit(sha)))
    return c.json(
      { error: `There is no commit ${sha} in this repository` },
      422
    );
  const user = c.get('user')!;
  const created = await createStatus(
    db,
    repo.id,
    sha,
    {
      state: body.state,
      context: body.context,
      description: body.description,
      targetUrl: body.target_url,
    },
    user.id
  );
  if (!created.ok) return c.json({ error: created.error }, 422);
  const after = (work: Promise<unknown>) => c.executionCtx.waitUntil(work);
  after(publishChange(c.env, repo.id, { approvals: true }));
  after(settleStates(c.env, db, repo.id));
  // A passing check may be the last thing a pull request at this commit waited on.
  if (body.state === 'success')
    after(
      autoMergeForCommit(c.env, db, repo.id, sha).catch((e) =>
        console.error('[statuses] auto-merge failed', repo.id, e)
      )
    );
  await emitStatus({ env: c.env, db, after }, repo, created.status, user.id);
  return c.json(statusOut(created.status, await usersById(db, [user.id])), 201);
});

const listRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/statuses/{sha}',
  tags: ['Commit statuses'],
  summary: "A commit's statuses, newest first",
  request: { params: shaParams },
  responses: {
    ...json200Response(z.array(statusSchema), 'Statuses'),
  },
});
statusesRouter.openapi(listRoute, async (c) => {
  const db = c.get('db');
  const rows = await statusesOf(db, c.get('repo').id, c.req.valid('param').sha);
  const people = await usersById(
    db,
    rows.map((r) => r.creatorId ?? '')
  );
  return c.json(
    rows.map((r) => statusOut(r, people)),
    200
  );
});

/** `ref` as a commit: a full SHA, else a branch or tag of the repository. */
async function commitOf(c: Context<RepoEnv>, ref: string) {
  if (/^[0-9a-fA-F]{40}$/.test(ref)) return ref.toLowerCase();
  return c.get('git').resolve(ref);
}

const combinedSchema = z.object({
  /** failure if any context failed or errored, else pending if any is, else success; null without statuses. */
  state: z.enum(['success', 'failure', 'pending']).nullable(),
  sha: z.string(),
  total_count: z.number(),
  /** The latest status of each context. */
  statuses: z.array(statusSchema),
});

for (const path of [
  '/{owner}/{repo}/commits/{ref}/status',
  '/{owner}/{repo}/commits/{ref}/statuses',
] as const) {
  const route = createRoute({
    method: 'get',
    path,
    tags: ['Commit statuses'],
    summary: "A commit's combined status: each context's latest",
    request: { params: ownerRepoParams.extend({ ref: z.string().max(255) }) },
    responses: {
      ...json200Response(combinedSchema, 'Combined status'),
      ...json404Response,
    },
  });
  statusesRouter.openapi(route, async (c) => {
    const sha = await commitOf(c, c.req.valid('param').ref);
    if (!sha) return c.json({ error: 'Not Found' }, 404);
    const db = c.get('db');
    const latest = (await latestStatuses(db, c.get('repo').id, [sha])).get(
      sha
    )!;
    const people = await usersById(
      db,
      latest.map((r) => r.creatorId ?? '')
    );
    return c.json(
      {
        state: combinedState(latest),
        sha,
        total_count: latest.length,
        statuses: latest.map((r) => statusOut(r, people)),
      },
      200
    );
  });
}
