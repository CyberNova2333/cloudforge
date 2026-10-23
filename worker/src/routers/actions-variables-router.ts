import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireAdmin } from '../auth/guards';
import {
  deleteVariable,
  listVariables,
  nameError,
  normalizeName,
  saveVariable,
  secretsConfigured,
  valueError,
  VariableError,
  type VariableKind,
} from '../actions/secrets';
import { recordAudit } from '../lib/audit';
import { loadRepo, type RepoEnv } from '../lib/repos';
import { usersById } from '../lib/users';
import type { DrizzleDB } from '../db/middleware';
import type { AppEnv } from '../variables';
import {
  json200Response,
  json400Response,
  json403Response,
  json404Response,
  json409Response,
  validationHook,
} from './openapi-helpers';
import { ownerRepoParams, publicUserSchema } from './schemas';

// Actions secrets and variables (worker/src/actions/secrets.ts): a repository's, managed by its admins, and the
// instance-wide ones, managed by site admins. A secret's value is write-only: no route returns it.

const KINDS: [path: 'secrets' | 'variables', kind: VariableKind][] = [
  ['secrets', 'secret'],
  ['variables', 'variable'],
];

const itemSchema = z
  .object({
    name: z.string(),
    /** A variable's value; always null for a secret. */
    value: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    updatedBy: publicUserSchema.nullable(),
  })
  .openapi('ActionsVariable');

const listSchema = z.object({
  /** Whether the server has ACTIONS_SECRETS_KEY, so secrets can be saved and read in jobs. */
  configured: z.boolean(),
  items: z.array(itemSchema),
  /** On a repository: the instance-wide ones of this kind it doesn't override (names; values of variables). */
  inherited: z.array(
    z.object({ name: z.string(), value: z.string().nullable() })
  ),
});

const saveBody = z.object({ value: z.string() });
const nameParam = z.object({ name: z.string().min(1) });

async function listBody(
  env: CloudflareBindings,
  db: DrizzleDB,
  repositoryId: string | null,
  kind: VariableKind
) {
  const rows = await listVariables(db, repositoryId, kind);
  const people = await usersById(
    db,
    rows.map((r) => r.updatedById ?? '')
  );
  const own = new Set(rows.map((r) => r.name));
  const inherited =
    repositoryId === null
      ? []
      : (await listVariables(db, null, kind))
          .filter((r) => !own.has(r.name))
          .map((r) => ({
            name: r.name,
            value: kind === 'variable' ? r.value : null,
          }));
  return {
    configured: secretsConfigured(env),
    items: rows.map((r) => ({
      name: r.name,
      value: kind === 'variable' ? r.value : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedById ? (people.get(r.updatedById) ?? null) : null,
    })),
    inherited,
  };
}

/** Validates and saves; the error to return, or what happened. */
async function save(
  env: CloudflareBindings,
  db: DrizzleDB,
  o: {
    repositoryId: string | null;
    kind: VariableKind;
    rawName: string;
    value: string;
    userId: string;
  }
): Promise<
  { error: string; status: 400 | 409 } | { name: string; created: boolean }
> {
  const name = normalizeName(o.rawName);
  const bad = nameError(name) ?? valueError(o.value);
  if (bad) return { error: bad, status: 400 };
  try {
    const { created } = await saveVariable(env, db, {
      repositoryId: o.repositoryId,
      kind: o.kind,
      name,
      value: o.value,
      userId: o.userId,
    });
    return { name, created };
  } catch (e) {
    if (e instanceof VariableError)
      return { error: e.message, status: e.status };
    throw e;
  }
}

const NOT_ADMIN = 'Only repository admins manage Actions secrets and variables';

// ── /api/repos/{owner}/{repo}/actions/secrets|variables ──────────────────────

export const actionsVariablesRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});
actionsVariablesRouter.use('/:owner/:repo/actions/secrets', loadRepo);
actionsVariablesRouter.use('/:owner/:repo/actions/secrets/*', loadRepo);
actionsVariablesRouter.use('/:owner/:repo/actions/variables', loadRepo);
actionsVariablesRouter.use('/:owner/:repo/actions/variables/*', loadRepo);

for (const [path, kind] of KINDS) {
  actionsVariablesRouter.openapi(
    createRoute({
      method: 'get',
      path: `/{owner}/{repo}/actions/${path}`,
      tags: ['Actions'],
      summary: `The repository's Actions ${path}`,
      request: { params: ownerRepoParams },
      responses: {
        ...json200Response(listSchema, `The repository's ${path}`),
        ...json403Response,
        ...json404Response,
      },
    }),
    async (c) => {
      if (!c.get('perms').admin) return c.json({ error: NOT_ADMIN }, 403);
      return c.json(
        await listBody(c.env, c.get('db'), c.get('repo').id, kind),
        200
      );
    }
  );

  actionsVariablesRouter.openapi(
    createRoute({
      method: 'put',
      path: `/{owner}/{repo}/actions/${path}/{name}`,
      tags: ['Actions'],
      summary: `Create or replace one of the repository's Actions ${path}`,
      request: {
        params: ownerRepoParams.merge(nameParam),
        body: { content: { 'application/json': { schema: saveBody } } },
      },
      responses: {
        ...json200Response(
          z.object({ name: z.string(), created: z.boolean() }),
          'Saved'
        ),
        ...json400Response,
        ...json403Response,
        ...json404Response,
        ...json409Response,
      },
    }),
    async (c) => {
      if (!c.get('perms').admin) return c.json({ error: NOT_ADMIN }, 403);
      const repo = c.get('repo');
      const user = c.get('user')!;
      const r = await save(c.env, c.get('db'), {
        repositoryId: repo.id,
        kind,
        rawName: c.req.valid('param').name,
        value: c.req.valid('json').value,
        userId: user.id,
      });
      if ('error' in r) return c.json({ error: r.error }, r.status);
      await recordAudit(c.get('db'), {
        repositoryId: repo.id,
        actorId: user.id,
        action: `${kind}.saved`,
        target: r.name,
        data: { scope: 'repository', created: r.created },
      });
      return c.json({ name: r.name, created: r.created }, 200);
    }
  );

  actionsVariablesRouter.openapi(
    createRoute({
      method: 'delete',
      path: `/{owner}/{repo}/actions/${path}/{name}`,
      tags: ['Actions'],
      summary: `Delete one of the repository's Actions ${path}`,
      request: { params: ownerRepoParams.merge(nameParam) },
      responses: {
        ...json200Response(z.object({ ok: z.literal(true) }), 'Deleted'),
        ...json403Response,
        ...json404Response,
      },
    }),
    async (c) => {
      if (!c.get('perms').admin) return c.json({ error: NOT_ADMIN }, 403);
      const repo = c.get('repo');
      const name = normalizeName(c.req.valid('param').name);
      if (!(await deleteVariable(c.get('db'), repo.id, kind, name)))
        return c.json({ error: 'Not Found' }, 404);
      await recordAudit(c.get('db'), {
        repositoryId: repo.id,
        actorId: c.get('user')!.id,
        action: `${kind}.deleted`,
        target: name,
        data: { scope: 'repository' },
      });
      return c.json({ ok: true as const }, 200);
    }
  );
}

// ── /api/admin/actions/secrets|variables ─────────────────────────────────────

export const adminActionsVariablesRouter = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});
adminActionsVariablesRouter.use('*', requireAdmin);

for (const [path, kind] of KINDS) {
  adminActionsVariablesRouter.openapi(
    createRoute({
      method: 'get',
      path: `/${path}`,
      tags: ['Admin'],
      summary: `The instance-wide Actions ${path}`,
      responses: {
        ...json200Response(listSchema, `The instance-wide ${path}`),
        ...json403Response,
      },
    }),
    async (c) => c.json(await listBody(c.env, c.get('db'), null, kind), 200)
  );

  adminActionsVariablesRouter.openapi(
    createRoute({
      method: 'put',
      path: `/${path}/{name}`,
      tags: ['Admin'],
      summary: `Create or replace an instance-wide Actions ${kind}`,
      request: {
        params: nameParam,
        body: { content: { 'application/json': { schema: saveBody } } },
      },
      responses: {
        ...json200Response(
          z.object({ name: z.string(), created: z.boolean() }),
          'Saved'
        ),
        ...json400Response,
        ...json403Response,
        ...json409Response,
      },
    }),
    async (c) => {
      const user = c.get('user')!;
      const r = await save(c.env, c.get('db'), {
        repositoryId: null,
        kind,
        rawName: c.req.valid('param').name,
        value: c.req.valid('json').value,
        userId: user.id,
      });
      if ('error' in r) return c.json({ error: r.error }, r.status);
      await recordAudit(c.get('db'), {
        repositoryId: null,
        actorId: user.id,
        action: `${kind}.saved`,
        target: r.name,
        data: { scope: 'instance', created: r.created },
      });
      return c.json({ name: r.name, created: r.created }, 200);
    }
  );

  adminActionsVariablesRouter.openapi(
    createRoute({
      method: 'delete',
      path: `/${path}/{name}`,
      tags: ['Admin'],
      summary: `Delete an instance-wide Actions ${kind}`,
      request: { params: nameParam },
      responses: {
        ...json200Response(z.object({ ok: z.literal(true) }), 'Deleted'),
        ...json403Response,
        ...json404Response,
      },
    }),
    async (c) => {
      const name = normalizeName(c.req.valid('param').name);
      if (!(await deleteVariable(c.get('db'), null, kind, name)))
        return c.json({ error: 'Not Found' }, 404);
      await recordAudit(c.get('db'), {
        repositoryId: null,
        actorId: c.get('user')!.id,
        action: `${kind}.deleted`,
        target: name,
        data: { scope: 'instance' },
      });
      return c.json({ ok: true as const }, 200);
    }
  );
}
