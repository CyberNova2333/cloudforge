import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import {
  repositoryDeployTokens,
  type RepositoryDeployToken,
} from '../db/app.schema';
import { loadRepo, type RepoEnv } from '../lib/repos';
import { recordAudit } from '../lib/audit';
import {
  canManageDeployTokens,
  createDeployToken,
  deployTokenAdmin,
  MAX_DEPLOY_TOKENS_PER_REPO,
} from '../lib/deploy-tokens';
import {
  json200Response,
  json201Response,
  json400Response,
  json403Response,
  json404Response,
  json409Response,
  okSchema,
  validationHook,
} from './openapi-helpers';
import { ownerRepoParams } from './schemas';

export const deployTokensRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});

const adminOnly: MiddlewareHandler<RepoEnv> = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  if (
    !user ||
    !(await canManageDeployTokens(c.get('db'), c.get('repo').id, user.id))
  )
    return c.json(
      { error: 'Only repository admins can manage deploy tokens' },
      403
    );
  await next();
};
for (const path of [
  '/:owner/:repo/deploy-tokens',
  '/:owner/:repo/deploy-tokens/*',
]) {
  deployTokensRouter.use(path, loadRepo, adminOnly);
}

const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['read', 'write']),
  createdById: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

const tokenOut = (row: RepositoryDeployToken) => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  createdById: row.createdById,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

const listRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/deploy-tokens',
  tags: ['Deploy tokens'],
  request: { params: ownerRepoParams },
  responses: {
    ...json200Response(
      z.array(tokenSchema),
      'Repository deployment credentials'
    ),
    ...json403Response,
    ...json404Response,
  },
});
deployTokensRouter.openapi(listRoute, async (c) => {
  const repositoryId = c.get('repo').id;
  const rows = await c
    .get('db')
    .select()
    .from(repositoryDeployTokens)
    .where(
      and(
        eq(repositoryDeployTokens.repositoryId, repositoryId),
        deployTokenAdmin(repositoryId, c.get('user')!.id)
      )
    )
    .orderBy(
      desc(repositoryDeployTokens.createdAt),
      desc(repositoryDeployTokens.id)
    )
    .all();
  return c.json(rows.map(tokenOut), 200);
});

const createTokenRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/deploy-tokens',
  tags: ['Deploy tokens'],
  request: {
    params: ownerRepoParams,
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().trim().min(1).max(100),
            scope: z.enum(['read', 'write']).default('read'),
            expiresInDays: z.number().int().min(1).max(366).default(30),
          }),
        },
      },
    },
  },
  responses: {
    ...json201Response(
      z.object({ token: tokenSchema, plaintext: z.string() }),
      'Created; plaintext is shown once'
    ),
    ...json400Response,
    ...json403Response,
    ...json404Response,
    ...json409Response,
  },
});
deployTokensRouter.openapi(createTokenRoute, async (c) => {
  const db = c.get('db');
  const repositoryId = c.get('repo').id;
  const createdById = c.get('user')!.id;
  const created = await createDeployToken(
    db,
    repositoryId,
    createdById,
    c.req.valid('json')
  );
  if (!created) {
    if (!(await canManageDeployTokens(db, repositoryId, createdById)))
      return c.json(
        { error: 'Only repository admins can manage deploy tokens' },
        403
      );
    return c.json(
      {
        error: `A repository can have at most ${MAX_DEPLOY_TOKENS_PER_REPO} deploy tokens. Revoke unused tokens first.`,
      },
      409
    );
  }
  const { token, plaintext } = created;
  await recordAudit(db, {
    repositoryId,
    actorId: createdById,
    action: 'deploy_token.created',
    target: token.name,
    data: {
      token: token.id,
      scope: token.scope,
      expiresAt: token.expiresAt.getTime(),
    },
  });
  return c.json({ token: tokenOut(token), plaintext }, 201);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{owner}/{repo}/deploy-tokens/{id}',
  tags: ['Deploy tokens'],
  request: { params: ownerRepoParams.extend({ id: z.string() }) },
  responses: {
    ...json200Response(okSchema, 'Revoked'),
    ...json403Response,
    ...json404Response,
  },
});
deployTokensRouter.openapi(deleteRoute, async (c) => {
  const db = c.get('db');
  const repositoryId = c.get('repo').id;
  const actorId = c.get('user')!.id;
  const deleted = await db
    .delete(repositoryDeployTokens)
    .where(
      and(
        eq(repositoryDeployTokens.id, c.req.valid('param').id),
        eq(repositoryDeployTokens.repositoryId, repositoryId),
        deployTokenAdmin(repositoryId, actorId)
      )
    )
    .returning({
      id: repositoryDeployTokens.id,
      name: repositoryDeployTokens.name,
    })
    .get();
  if (!deleted) return c.json({ error: 'Deploy token not found' }, 404);
  await recordAudit(db, {
    repositoryId,
    actorId,
    action: 'deploy_token.deleted',
    target: deleted.name,
    data: { token: deleted.id },
  });
  return c.json({ ok: true as const }, 200);
});
