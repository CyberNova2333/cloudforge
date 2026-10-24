// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { OpenAPIHono } from '@hono/zod-openapi';
import { settleStates } from './pulls/settle';
import { swaggerUI } from '@hono/swagger-ui';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { createAuth } from './auth';
import { currentUser } from './auth/session';
import {
  requireAdmin,
  requireAuth,
  requireAuthUnlessPublicRead,
} from './auth/guards';
import { injectDb } from './db/middleware';
import { handleGitRequest, isGitRequest } from './git-http';
import { handleLfsRequest, isLfsRequest } from './lfs-http';
import { invitesRouter } from './routers/invites-router';
import { actionsRouter } from './routers/actions-router';
import {
  actionsVariablesRouter,
  adminActionsVariablesRouter,
} from './routers/actions-variables-router';
import { agentRunsRouter } from './routers/agent-runs-router';
import { pullsRouter } from './routers/pulls-router';
import { reposRouter } from './routers/repos-router';
import { setupRouter } from './routers/setup-router';
import { tokensRouter } from './routers/tokens-router';
import { emailsRouter } from './routers/emails-router';
import { usersRouter } from './routers/users-router';
import { namespacesRouter, teamRouter } from './routers/teams-router';
import { mcpApiRouter, mcpRouter } from './mcp';
import { wellKnownRouter } from './mcp/well-known';
import { installRouter } from './routers/install-router';
import type { AppEnv } from './variables';
import type { Context, MiddlewareHandler } from 'hono';
import type { RepoEnv } from './lib/repos';
import { publishChange } from './live/publish';
import { liveSocket } from './live/route';
import { approvalsRouter } from './routers/approvals-router';
import { meRouter } from './routers/me-router';
import { insightsRouter } from './routers/insights-router';
import { adminSetupRouter } from './routers/admin-setup-router';
import { adminRouter } from './routers/admin-router';
import {
  adminAgentsRouter,
  agentsRouter,
  repoAgentsRouter,
} from './routers/agents-router';
import { usageRouter } from './routers/usage-router';
import { adminAuditRouter, repoAuditRouter } from './routers/audit-router';
import { branchesRouter } from './routers/branches-router';
import { releasesRouter } from './routers/releases-router';
import { sessionsRouter } from './routers/sessions-router';
import { queueRouter } from './routers/queue-router';
import { healthRouter } from './routers/health-router';
import { searchRouter } from './routers/search-router';
import { runScheduled } from './cron';

const app = new OpenAPIHono<AppEnv>();

/** Largest request body better-auth's routes take (sign-in, sign-up, OAuth client registration, …). */
export const AUTH_BODY_LIMIT = 64 * 1024;
/** Largest request body of the rest of the API and /mcp: a 64K-character PR body is the biggest field. */
export const API_BODY_LIMIT = 1024 * 1024;

app.use('*', injectDb);
app.use('*', logger());
// Every JSON field the API takes is bounded well below these. An oversized body is refused before anything parses it:
// validating a huge array costs memory per element (zod keeps one issue each), enough to exhaust an isolate.
const tooLarge = (c: Context) =>
  c.json({ error: 'The request body is too large.' }, 413);
app.use(
  '/api/auth/*',
  bodyLimit({ maxSize: AUTH_BODY_LIMIT, onError: tooLarge })
);
app.use('/api/*', bodyLimit({ maxSize: API_BODY_LIMIT, onError: tooLarge }));
app.use('/mcp', bodyLimit({ maxSize: API_BODY_LIMIT, onError: tooLarge }));
app.use('*', async (c, next) => {
  const auth = createAuth(c.env);
  c.set('auth', auth);
  // /mcp and OAuth discovery use bearer tokens, never cookies.
  const p = c.req.path;
  if (p === '/mcp' || p.startsWith('/.well-known/')) return next();
  // Read straight from `sessions` (auth/session.ts): better-auth's own getSession costs several
  // times the two reads on every request of every page.
  const user = await currentUser(c.get('db'), c.env, c.req.raw.headers);
  if (user) c.set('user', user);
  await next();
});

app.on(['GET', 'POST'], '/api/auth/*', (c) => c.get('auth').handler(c.req.raw));

app.route('/', wellKnownRouter);
app.route('/', installRouter);
app.route('/mcp', mcpRouter);

// Public
app.route('/api/setup', setupRouter);
app.route('/api/invites', invitesRouter);

// Members only, except reads of public repositories
app.use('/api/repos/*', requireAuthUnlessPublicRead);
app.use('/api/repos', requireAuthUnlessPublicRead);
// Successful repo mutations ping live pages (and approval inboxes for pull changes).
const pingAfterChange: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.req.method === 'GET' || c.res.status >= 400) return;
  const repo = (c as unknown as Context<RepoEnv>).get('repo');
  if (repo) {
    c.executionCtx.waitUntil(
      publishChange(c.env, repo.id, {
        approvals: c.req.path.includes('/pulls'),
      })
    );
    // The change may move a pull request to another state: record it for the timeline.
    c.executionCtx.waitUntil(
      settleStates(c.env, (c as unknown as Context<RepoEnv>).get('db'), repo.id)
    );
  }
};
app.use('/api/repos/:owner/:repo', pingAfterChange);
app.use('/api/repos/:owner/:repo/*', pingAfterChange);
app.use('/api/admin/*', requireAuth);
app.route('/api/admin', adminRouter);
app.route('/api/admin/agents', adminAgentsRouter);
app.route('/api/admin/audit', adminAuditRouter);
app.route('/api/admin/actions', adminActionsVariablesRouter);
app.use('/api/agents', requireAuth);
app.use('/api/agents/*', requireAuth);
app.route('/api/agents', agentsRouter);
app.use('/api/approvals', requireAuth);
app.use('/api/approvals/*', requireAuth);
app.route('/api/approvals', approvalsRouter);
app.use('/api/me/*', requireAuth);
app.route('/api/me', meRouter);
app.use('/api/live', requireAuth);
app.get('/api/live', liveSocket);
app.route('/api/repos', reposRouter);
app.route('/api/repos', pullsRouter);
app.route('/api/repos', actionsRouter);
app.route('/api/repos', actionsVariablesRouter);
app.route('/api/repos', agentRunsRouter);
app.route('/api/repos', insightsRouter);
app.route('/api/repos', repoAgentsRouter);
app.route('/api/repos', repoAuditRouter);
app.route('/api/repos', sessionsRouter);
app.route('/api/repos', branchesRouter);
app.route('/api/repos', releasesRouter);
app.route('/api/repos', queueRouter);
app.route('/api/repos', healthRouter);
app.use('/api/search', requireAuth);
app.route('/api/search', searchRouter);
app.use('/api/users/*', requireAuth);
app.use('/api/users', requireAuth);
app.route('/api/users', usersRouter);
app.use('/api/team', requireAuth);
app.route('/api/team', teamRouter);
app.use('/api/namespaces/*', requireAuth);
app.route('/api/namespaces', namespacesRouter);
app.use('/api/mcp/*', requireAuth);
app.use('/api/mcp', requireAuth);
app.route('/api/mcp', mcpApiRouter);
app.use('/api/tokens/*', requireAuth);
app.use('/api/tokens', requireAuth);
app.route('/api/tokens', tokensRouter);
app.use('/api/admin/usage/*', requireAdmin);
app.use('/api/admin/usage', requireAdmin);
app.route('/api/admin/usage', usageRouter);
app.use('/api/emails/*', requireAuth);
app.use('/api/emails', requireAuth);
app.route('/api/emails', emailsRouter);
// Site admin → Setup: what's misconfigured and how to fix it.
app.use('/api/admin/setup', requireAdmin);
app.use('/api/admin/setup/*', requireAdmin);
app.route('/api/admin/setup', adminSetupRouter);

app.doc('/api/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'CloudForge',
    description: 'Single-tenant git hosting on Cloudflare Artifacts',
  },
});
app.get('/api/swagger-ui', swaggerUI({ url: '/api/doc' }));

app.onError((err, c) => {
  console.error('[api] unhandled', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

export { app };
export { ActionsRun } from './actions/run-workflow';
export { JobRunner } from './actions/job-runner';
export { ActionsQueue } from './actions/queue';
export { MergeResolver } from './merge/resolver';
export { AgentReviewer } from './review/agent-reviewer';
export { MergeResolutionWorkflow } from './merge/workflow';
export { LiveHub } from './live/hub';

export default {
  /**
   * Daily housekeeping (Cron Trigger): deletes Actions runs past their
   * retention and syncs usage analytics from Cloudflare.
   */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduled(controller, env).catch((e) =>
        console.error('[cron] failed', controller.cron, e)
      )
    );
  },
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isGitRequest(url)) return handleGitRequest(request, env, ctx);
    if (isLfsRequest(url)) return handleLfsRequest(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareBindings>;
