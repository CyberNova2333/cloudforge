// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { instanceName } from './lib/settings';
import { afterPush, recordPush } from './lib/push-events';
import { schema } from './db/schema';
import {
  agents,
  personalAccessTokens,
  repositoryDeployTokens,
  type Repository,
} from './db/app.schema';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from './db/auth.schema';
import {
  findRepo,
  gitFor,
  isPublic,
  permissionsFor,
  type RepoPermissions,
} from './lib/repos';
import { hashToken } from './lib/tokens';
import { authenticateDeployToken } from './lib/deploy-tokens';
import { recordAudit } from './lib/audit';
import {
  decidePush,
  needsEmptyCheck,
  readReceiveRequest,
  refusalReport,
  reportsStatus,
  receiveCommandBytes,
  rewriteReceiveRequest,
  successfulPushRefs,
  type PushCommand,
  type ReceiveRequest,
} from './git/push-protection';
import type { GitService } from './git/service';
import { concat } from './git/bytes';
import { buildPack } from './git/pack';
import { ZERO_SHA } from './git/remote';
import { deletePushStaging, PUSH_STAGING_PREFIX } from './lib/push-staging';

const GIT_PATH =
  /^\/([^/]+)\/([^/]+?)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;

export function isGitRequest(url: URL) {
  return GIT_PATH.test(url.pathname);
}

function unauthorized(realm: string) {
  return new Response(
    'Authentication required. Use a personal access token or repository deploy token as the password.\n',
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Basic realm="${realm}"`,
        'Content-Type': 'text/plain',
      },
    }
  );
}

function parseBasic(
  header: string | null
): { user: string; pass: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(':');
    return i < 0
      ? { user: decoded, pass: '' }
      : { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

export type GitAccess = {
  db: DrizzleD1Database<typeof schema>;
  /** Null for anonymous reads and deployment credentials; a deploy token never impersonates its issuer. */
  user: typeof users.$inferSelect | null;
  deployToken?: { id: string; name: string; createdById: string };
  repo: Repository;
  /** Canonical `<owner>/<name>`. */
  fullName: string;
  perms: RepoPermissions;
};

/**
 * Auth for the git and LFS endpoints: PAT or repository deploy token via Basic auth plus read
 * access. With `anonymousRead`, a request without credentials may read a public repository
 * (`user` null, read-only); every other repository still answers 401, so git asks for a token.
 * Returns the context, or a 401/404 Response.
 */
export async function authenticateRepoRequest(
  request: Request,
  env: CloudflareBindings,
  ctx: ExecutionContext,
  owner: string,
  name: string,
  { anonymousRead = false }: { anonymousRead?: boolean } = {}
): Promise<GitAccess | Response> {
  const db = drizzle(env.DB, { schema });
  // Read only when challenging, not on every git request.
  const realm = () => instanceName(db, env);
  const creds = parseBasic(request.headers.get('Authorization'));
  if (!creds) {
    const found = anonymousRead ? await findRepo(db, owner, name) : undefined;
    if (!found || !isPublic(found.repo)) return unauthorized(await realm());
    return {
      db,
      user: null,
      repo: found.repo,
      fullName: `${found.namespace.username}/${found.repo.name}`,
      perms: await permissionsFor(db, found.repo, undefined),
    };
  }
  const token =
    creds.pass && creds.pass !== 'x-oauth-basic' ? creds.pass : creds.user;
  if (token.startsWith('cfd_')) {
    const found = await findRepo(db, owner, name);
    if (!found) return unauthorized(await realm());
    const deploy = await authenticateDeployToken(db, found.repo, token);
    if (!deploy) return unauthorized(await realm());
    ctx.waitUntil(
      db
        .update(repositoryDeployTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(repositoryDeployTokens.id, deploy.id))
        .run()
    );
    return {
      db,
      user: null,
      deployToken: {
        id: deploy.id,
        name: deploy.name,
        createdById: deploy.createdById,
      },
      repo: found.repo,
      fullName: `${found.namespace.username}/${found.repo.name}`,
      perms: { read: true, write: deploy.scope === 'write', admin: false },
    };
  }
  const pat = await db
    .select({ pat: personalAccessTokens, user: users, agent: agents.userId })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .where(eq(personalAccessTokens.tokenHash, await hashToken(token)))
    .get();
  if (
    !pat ||
    pat.agent ||
    pat.user.banned ||
    (pat.pat.expiresAt && pat.pat.expiresAt < new Date())
  )
    return unauthorized(await realm());
  ctx.waitUntil(
    db
      .update(personalAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(personalAccessTokens.id, pat.pat.id))
      .run()
  );
  const found = await findRepo(db, owner, name);
  const perms = found ? await permissionsFor(db, found.repo, pat.user) : null;
  if (!found || !perms?.read)
    return new Response('Repository not found.\n', { status: 404 });
  return {
    db,
    user: pat.user,
    repo: found.repo,
    fullName: `${found.namespace.username}/${found.repo.name}`,
    // A read-only token reads whatever its member may, and changes nothing.
    perms:
      pat.pat.scope === 'read'
        ? { ...perms, write: false, admin: false }
        : perms,
  };
}

/**
 * Smart HTTP at `/<owner>/<repo>.git`: streams to the Artifacts remote with a short-lived
 * repo-scoped token. Artifacts credentials never leave the worker.
 */
export async function handleGitRequest(
  request: Request,
  env: CloudflareBindings,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const [, owner, name, endpoint] = url.pathname.match(GIT_PATH)!;
  const service =
    endpoint === 'info/refs' ? url.searchParams.get('service') : endpoint;
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
    return new Response('Unsupported service\n', { status: 403 });
  }
  const isPush = service === 'git-receive-pack';
  // Clone and fetch of a public repository need no token; push always does.
  const access = await authenticateRepoRequest(request, env, ctx, owner, name, {
    anonymousRead: !isPush,
  });
  if (access instanceof Response) return access;
  const { user, deployToken, repo, perms, fullName } = access;
  // GET ref advertisement or POST pack exchange.
  const expectedMethod = endpoint === 'info/refs' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) {
    return new Response('Method not allowed\n', {
      status: 405,
      headers: { Allow: expectedMethod },
    });
  }
  if (isPush && ((!user && !deployToken) || !perms.write)) {
    return new Response(`Permission to ${owner}/${name}.git denied.\n`, {
      status: 403,
    });
  }

  const headers = new Headers();
  for (const h of [
    'Content-Type',
    'Content-Encoding',
    'Accept',
    'Git-Protocol',
    'User-Agent',
  ]) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const git = gitFor(env, repo);
  let body: ReadableStream<Uint8Array> | null =
    request.method === 'POST' ? request.body : null;
  // A push's commands, read before anything is forwarded: branch protection decides on them, and afterPush tells
  // from them which refs moved.
  let push: ReceiveRequest | null = null;
  let upstream: Response | undefined;
  if (isPush && endpoint === 'git-receive-pack') {
    const gzip = request.headers.get('Content-Encoding') === 'gzip';
    if (gzip) headers.delete('Content-Encoding');
    push = body
      ? await readReceiveRequest(
          gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body
        )
      : null;
    if (!push) return new Response('Malformed push request\n', { status: 400 });
    // Follow-ups adopt a first branch as default. A deployment credential must not use that
    // bootstrap behavior to turn an otherwise ordinary branch into its own protected default.
    if (
      deployToken &&
      !(await git.branches()).some((b) => b.name === repo.defaultBranch)
    ) {
      await push.body.pipeTo(new WritableStream()).catch(() => {});
      return refusedPush(
        push,
        new Map(
          push.commands.map((c) => [
            c.ref,
            'A repository admin must initialize the default branch before deploy tokens can push',
          ])
        )
      );
    }
    const rules = {
      defaultBranch: repo.defaultBranch,
      protectedPatterns: repo.protectedBranches,
      admin: perms.admin,
      empty: false,
    };
    if (!deployToken && needsEmptyCheck(push.commands, rules))
      rules.empty = (await git.branches()).length === 0;
    const decision = decidePush(push.commands, rules);
    if (decision.refused.size) {
      // The pack is never forwarded; read it to the end so the client gets the reply.
      await push.body.pipeTo(new WritableStream()).catch(() => {});
      return refusedPush(push, decision.refused);
    }
    body = push.body;
    if (decision.fastForwardOnly.length) {
      // Replaying push options could run remote hooks twice, once against staging refs. Refuse instead.
      if (push.capabilities.includes('push-options')) {
        await push.body.pipeTo(new WritableStream()).catch(() => {});
        return refusedPush(
          push,
          new Map(
            decision.fastForwardOnly.map((c) => [
              c.ref,
              'push-options are not supported when updating protected branches',
            ])
          )
        );
      }
      const result = await protectedPush(
        git,
        push,
        decision.fastForwardOnly,
        headers,
        `/${endpoint}${url.search}`
      );
      if (result instanceof Map) return refusedPush(push, result);
      upstream = result;
    }
    // Forwarded with the length the client declared, as the request itself would have been.
    const length = Number(request.headers.get('Content-Length'));
    if (!upstream && !gzip && Number.isSafeInteger(length) && length > 0) {
      const fixed = new FixedLengthStream(length);
      body.pipeTo(fixed.writable).catch(() => {});
      body = fixed.readable;
    }
  }
  upstream ??= await git.client.forward(
    `/${endpoint}${url.search}`,
    { method: request.method, headers, body },
    isPush ? 'write' : 'read'
  );
  const respHeaders = new Headers();
  for (const h of ['Content-Type', 'Cache-Control', 'Expires', 'Pragma']) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  if (isPush && (user || deployToken) && push && upstream.ok) {
    // Receive-pack responses are small; buffer to sync metadata after the push lands.
    const reply: Uint8Array = new Uint8Array(await upstream.arrayBuffer());
    let applied: PushCommand[];
    if (reportsStatus(push.capabilities)) {
      const successful = successfulPushRefs(reply, push.capabilities);
      applied = push.commands.filter((c) => successful.has(c.ref));
    } else {
      const { refs } = await git.client.listRefs();
      applied = push.commands.filter(
        (c) => (refs.get(c.ref) ?? ZERO_SHA) === c.new
      );
    }
    // Recorded before the push is answered, so its follow-ups run again if their background is cut off.
    if (applied.length) {
      const event = await recordPush(
        drizzle(env.DB, { schema }),
        repo.id,
        user?.id ?? null,
        applied
      );
      if (deployToken)
        await recordAudit(access.db, {
          repositoryId: repo.id,
          actorId: null,
          actorKind: 'system',
          via: `Deploy token: ${deployToken.name}`,
          action: 'deploy_token.pushed',
          target: deployToken.name,
          data: {
            token: deployToken.id,
            createdById: deployToken.createdById,
            pushEvent: event,
            refs: applied.length,
          },
        });
      ctx.waitUntil(afterPush(env, event, repo.id));
    }
    return new Response(reply, {
      status: upstream.status,
      headers: respHeaders,
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

function refusedPush(
  push: ReceiveRequest,
  reasons: Map<string, string>
): Response {
  if (!reportsStatus(push.capabilities))
    return new Response(`Push refused: ${[...reasons.values()][0]}\n`, {
      status: 403,
    });
  return new Response(
    refusalReport(push.commands, reasons, push.capabilities),
    {
      headers: {
        'Content-Type': 'application/x-git-receive-pack-result',
        'Cache-Control': 'no-cache',
      },
    }
  );
}

/** Upload objects to internal refs first. No branch moves until every protected update is proven safe. */
async function protectedPush(
  git: GitService,
  push: ReceiveRequest,
  checked: PushCommand[],
  headers: Headers,
  path: string
): Promise<Response | Map<string, string>> {
  const prefix = `${PUSH_STAGING_PREFIX}${Date.now()}-${crypto.randomUUID()}/`;
  const staged = push.commands
    .filter((c) => c.new !== ZERO_SHA)
    .map((c, i) => ({ old: ZERO_SHA, new: c.new, ref: `${prefix}${i}` }));
  const caps = [
    'report-status',
    ...push.capabilities.filter(
      (c) =>
        ![
          'report-status',
          'report-status-v2',
          'side-band',
          'side-band-64k',
        ].includes(c)
    ),
  ];
  const refuseAll = (reason: string) =>
    new Map(checked.map((c) => [c.ref, reason]));
  try {
    const stage = await git.client.forward(
      path,
      {
        method: 'POST',
        headers,
        body: rewriteReceiveRequest(push, staged, caps),
      },
      'write'
    );
    const report = new Uint8Array(await stage.arrayBuffer());
    const uploaded = successfulPushRefs(report, caps);
    if (!stage.ok || staged.some((c) => !uploaded.has(c.ref)))
      return refuseAll('could not stage this push for branch protection');
    const refused = new Map<string, string>();
    for (const c of checked) {
      const forward = await git.isAncestor(c.old, c.new);
      if (forward) continue;
      const branch = c.ref.slice('refs/heads/'.length);
      refused.set(
        c.ref,
        forward === null
          ? `${branch} is a protected branch: this push is too large to check as a fast-forward; push it in smaller steps`
          : `${branch} is a protected branch: only fast-forward pushes are allowed`
      );
    }
    if (refused.size) return refused;
    // The original old IDs still CAS each ref. Keep the original capabilities, including atomic if requested:
    // only the remote may promise all-or-nothing updates, never a series of our own per-ref pushes.
    const landed = await git.client.forward(
      path,
      {
        method: 'POST',
        headers,
        body: concat([
          receiveCommandBytes(push.commands, push.capabilities, push.shallow),
          await buildPack([]),
        ]),
      },
      'write'
    );
    // Finish reading the result before cleanup; side-band progress may precede the actual ref transaction.
    return new Response(await landed.arrayBuffer(), {
      status: landed.status,
      headers: landed.headers,
    });
  } catch (error) {
    console.error('[git] protected push failed', error);
    return refuseAll('could not verify or complete this protected push');
  } finally {
    await deletePushStaging(git, staged).catch((error: unknown) => {
      console.error('[git] could not clean staged push refs', error);
    });
  }
}
