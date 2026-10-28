// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, sql } from 'drizzle-orm';
import { personalAccessTokens } from '../db/app.schema';
import { recordAudit } from '../lib/audit';
import { hashToken, randomToken } from '../lib/tokens';
import type { AppEnv } from '../variables';
import {
  recentAuthorization,
  recentAuthorizationGuard,
  RECENT_AUTHENTICATION_REQUIRED,
} from '../auth/recent';
import {
  json200Response,
  json201Response,
  json409Response,
  json401Response,
  json403Response,
  okSchema,
  validationHook,
} from './openapi-helpers';

/** Unexpired tokens one member may hold: enough for every machine and CI job, few enough to keep track of. */
export const MAX_ACTIVE_TOKENS = 50;

export const tokensRouter = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** read: clone, fetch and LFS downloads; write: also push and LFS uploads. */
  scope: z.enum(['read', 'write']),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

const serialize = (t: typeof personalAccessTokens.$inferSelect) => ({
  id: t.id,
  name: t.name,
  scope: t.scope,
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  expiresAt: t.expiresAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
});

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Tokens'],
  responses: { ...json200Response(z.array(tokenSchema), 'Your tokens') },
});
tokensRouter.openapi(listRoute, async (c) => {
  const rows = await c
    .get('db')
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, c.get('user')!.id))
    .orderBy(desc(personalAccessTokens.createdAt))
    .all();
  return c.json(rows.map(serialize), 200);
});

const createTokenRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Tokens'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100),
            expiresInDays: z
              .number()
              .int()
              .min(1)
              .max(366)
              .nullable()
              .default(30),
            scope: z.enum(['read', 'write']).default('write'),
          }),
        },
      },
    },
  },
  responses: {
    ...json201Response(
      z.object({ token: tokenSchema, plaintext: z.string() }),
      'Token created'
    ),
    ...json409Response,
    ...json401Response,
    ...json403Response,
  },
});
tokensRouter.openapi(createTokenRoute, async (c) => {
  const { name, expiresInDays, scope } = c.req.valid('json');
  const db = c.get('db');
  const userId = c.get('user')!.id;
  const permit = c.get('recentAuthorization');
  if (!permit) return c.json({ error: 'Unauthorized' }, 401);
  const now = new Date();
  // cfp_ = CloudForge personal access token. Tokens are looked up by hash, so ones issued before the rename
  // (gop_, from GitOrange) keep working.
  const plaintext = randomToken('cfp_');
  const row = {
    id: crypto.randomUUID(),
    userId,
    name,
    tokenHash: await hashToken(plaintext),
    scope,
    lastUsedAt: null,
    expiresAt: expiresInDays
      ? new Date(now.getTime() + expiresInDays * 86400_000)
      : null,
    createdAt: now,
  };
  // Count and insert share one statement so concurrent requests cannot each claim the last slot.
  // Keep the column encoders: PAT timestamps are stored in seconds, unlike deployment tokens.
  const inserted = await db.get<{ id: string }>(sql`
    INSERT INTO personal_access_tokens
      (id, user_id, name, token_hash, scope, last_used_at, expires_at, created_at)
    SELECT ${row.id}, ${userId}, ${name}, ${row.tokenHash}, ${scope}, NULL,
      ${sql.param(row.expiresAt, personalAccessTokens.expiresAt)},
      ${sql.param(now, personalAccessTokens.createdAt)}
    WHERE ${recentAuthorizationGuard(permit.sessionId, userId, Date.now(), permit.authVersion)}
      AND (SELECT count(*) FROM personal_access_tokens
      WHERE user_id = ${userId}
        AND (expires_at IS NULL OR expires_at > ${sql.param(now, personalAccessTokens.expiresAt)})) < ${MAX_ACTIVE_TOKENS}
    RETURNING id
  `);
  if (!inserted && !(await recentAuthorization(db, permit.sessionId, userId)))
    return c.json(
      {
        error: 'Verify your identity again to continue.',
        code: RECENT_AUTHENTICATION_REQUIRED,
        sessionId: permit.sessionId,
      },
      403
    );
  if (!inserted)
    return c.json(
      {
        error: `You have ${MAX_ACTIVE_TOKENS} active tokens. Delete the ones you no longer use first.`,
      },
      409
    );
  await recordAudit(db, {
    repositoryId: null,
    actorId: row.userId,
    action: 'token.created',
    target: name,
    data: {
      token: row.id,
      scope,
      expiresAt: row.expiresAt?.getTime() ?? null,
    },
  });
  return c.json({ token: serialize(row), plaintext }, 201);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tokens'],
  request: { params: z.object({ id: z.string() }) },
  responses: { ...json200Response(okSchema, 'Deleted') },
});
tokensRouter.openapi(deleteRoute, async (c) => {
  const deleted = await c
    .get('db')
    .delete(personalAccessTokens)
    .where(
      and(
        eq(personalAccessTokens.id, c.req.valid('param').id),
        eq(personalAccessTokens.userId, c.get('user')!.id)
      )
    )
    .returning({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
    });
  for (const token of deleted)
    await recordAudit(c.get('db'), {
      repositoryId: null,
      actorId: c.get('user')!.id,
      action: 'token.deleted',
      target: token.name,
      data: { token: token.id },
    });
  return c.json({ ok: true as const }, 200);
});
