import { OpenAPIHono, z } from '@hono/zod-openapi';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../../variables';
import { POLICY_VERSION_SQL } from '../../auth/policy';
import { RECENT_SESSION_HEADER } from '../../auth/recent';
import { OidcError } from '../errors';
import { hashValue, providerFrom } from '../provider';
import * as oidc from '../service';

const browser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user'),
    session = c.get('browserSession');
  if (!user || !session) throw new OidcError('UNAUTHORIZED', 401);
  if (
    session.policy.access !== 'full' ||
    session.authentication.strength === 'impersonated'
  )
    throw new OidcError('OIDC_BROWSER_NOT_ALLOWED', 403);
  const live = await c.env.DB.prepare(
    `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND u.id=? AND s.expires_at>? AND s.auth_version=u.auth_version
    AND s.policy_version=${POLICY_VERSION_SQL} AND coalesce(u.banned,0)=0 AND coalesce(s.impersonated_by,'')=''
    AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id=u.id)`
  )
    .bind(session.id, user.id, Date.now())
    .first();
  if (!live) throw new OidcError('UNAUTHORIZED', 401);
  if (
    !['GET', 'HEAD'].includes(c.req.method) &&
    c.req.header(RECENT_SESSION_HEADER) !== session.id
  )
    throw new OidcError('SESSION_CHANGED', 401);
  await next();
};
const admin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user')?.role !== 'admin') throw new OidcError('FORBIDDEN', 403);
  await next();
};
function router() {
  const r = new OpenAPIHono<AppEnv>();
  r.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    await next();
  });
  r.onError((e, c) => {
    const error =
      e instanceof OidcError ? e : new OidcError('OIDC_OPERATION_FAILED', 500);
    return c.json(
      {
        code: error.code,
        error: error.message,
        sessionId: c.get('browserSession')?.id,
      },
      error.status as ContentfulStatusCode
    );
  });
  r.use('*', browser);
  return r;
}
async function body<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new OidcError('OIDC_INVALID_REQUEST', 400);
  return parsed.data;
}
const empty = z.object({}).strict();
const plan = z
  .object({
    previewId: z.string().uuid(),
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
const action = z.object({ actionId: z.string().uuid() }).strict();
const user = (c: Context<AppEnv>) => c.get('user')!.id;
const session = (c: Context<AppEnv>) => c.get('browserSession')!.id;

export const oidcMeRouter = router();
oidcMeRouter.get('/', async (c) =>
  c.json(await oidc.ownStatus(c.env, user(c), session(c)))
);
oidcMeRouter.post('/preview', async (c) => {
  await body(c, empty);
  return c.json(await oidc.preview(c.env, user(c), session(c), 'link'));
});
oidcMeRouter.post('/start', async (c) => {
  const p = await body(c, plan),
    result = await oidc.start(
      c.env,
      user(c),
      session(c),
      p.previewId,
      p.digest
    );
  setCookie(c, result.cookie.name, result.cookie.value, {
    path: result.cookie.path,
    secure: result.cookie.secure,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: result.cookie.maxAge,
  });
  return c.json({ authorizationUrl: result.authorizationUrl });
});
oidcMeRouter.get('/actions/:actionId', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('actionId'));
  if (!id.success) throw new OidcError('OIDC_INVALID_REQUEST', 400);
  return c.json(await oidc.actionStatus(c.env, user(c), session(c), id.data));
});
oidcMeRouter.post('/confirm', async (c) => {
  const a = await body(c, action);
  return c.json(await oidc.confirm(c.env, user(c), session(c), a.actionId));
});
oidcMeRouter.post('/cancel', async (c) => {
  const a = await body(c, action);
  return c.json(await oidc.cancel(c.env, user(c), session(c), a.actionId));
});
oidcMeRouter.post('/revoke', async (c) => {
  const p = await body(
    c,
    z
      .object({
        bindingId: z.string().uuid(),
        revision: z.number().int().positive().safe(),
      })
      .strict()
  );
  return c.json(
    await oidc.revoke(c.env, user(c), session(c), p.bindingId, p.revision)
  );
});

export const oidcAdminRouter = router();
oidcAdminRouter.use('*', admin);
oidcAdminRouter.get('/', async (c) =>
  c.json(await oidc.adminStatus(c.env, session(c)))
);
oidcAdminRouter.post('/preview', async (c) => {
  await body(c, empty);
  return c.json(await oidc.preview(c.env, user(c), session(c), 'configure'));
});
oidcAdminRouter.post('/apply', async (c) => {
  const p = await body(c, plan);
  return c.json(
    await oidc.applyConfiguration(
      c.env,
      user(c),
      session(c),
      p.previewId,
      p.digest
    )
  );
});
oidcAdminRouter.post('/retire-preview', async (c) => {
  await body(c, empty);
  return c.json(await oidc.preview(c.env, user(c), session(c), 'retire'));
});
oidcAdminRouter.post('/retire', async (c) => {
  const p = await body(c, plan);
  return c.json(
    await oidc.retireConfiguration(
      c.env,
      user(c),
      session(c),
      p.previewId,
      p.digest
    )
  );
});

export const oidcCallbackRouter = router();
oidcCallbackRouter.get('/callback/:providerId', async (c) => {
  const state = c.req.query('state'),
    code = c.req.query('error') ? null : (c.req.query('code') ?? null);
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    (code !== null && (!code || code.length > 8192))
  )
    throw new OidcError('OIDC_CALLBACK_INVALID', 400);
  const p = await providerFrom(c.env);
  if (!p) throw new OidcError('OIDC_NOT_CONFIGURED', 409);
  const cookie = oidc.stateCookie(p, await hashValue(state));
  const result = await oidc.callback(
    c.env,
    user(c),
    session(c),
    c.req.param('providerId'),
    state,
    getCookie(c, cookie.name) ?? '',
    code
  );
  deleteCookie(c, cookie.name, {
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: true,
    sameSite: 'Lax',
  });
  return c.redirect(
    `/settings/security?${new URLSearchParams({ oidc_action: result.actionId, oidc_status: result.status })}`
  );
});
