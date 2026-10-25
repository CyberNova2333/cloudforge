// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { drizzle } from 'drizzle-orm/d1';
import { refreshAgentConfig } from './agents/refresh';
import { settleStates } from './pulls/settle';
import { eq } from 'drizzle-orm';
import { publishChange } from './live/publish';
import { instanceName } from './lib/settings';
import { schema } from './db/schema';
import {
  agents,
  personalAccessTokens,
  repositories,
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
import {
  actionsConfigured,
  onRefsUpdated,
  type RefUpdate,
} from './actions/trigger';
import {
  decidePush,
  needsEmptyCheck,
  readReceiveRequest,
  refusalReport,
  reportsStatus,
  rewriteReport,
  type PushCommand,
  type ReceiveRequest,
} from './git/push-protection';
import { ZERO_SHA } from './git/remote';
import type { GitService } from './git/service';
import { startSweep } from './merge/auto';
import { carryApprovalsOnSameTree } from './review/carry';
import { resolutionConfigured } from './merge/resolution';

const GIT_PATH =
  /^\/([^/]+)\/([^/]+?)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;

export function isGitRequest(url: URL) {
  return GIT_PATH.test(url.pathname);
}

function unauthorized(realm: string) {
  return new Response(
    'Authentication required. Use a personal access token as the password.\n',
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
  /** Null: no credentials, reading a public repository. */
  user: typeof users.$inferSelect | null;
  repo: Repository;
  /** Canonical `<owner>/<name>`. */
  fullName: string;
  perms: RepoPermissions;
};

/**
 * Auth for the git and LFS endpoints: PAT via Basic auth (either slot, like GitHub) plus read
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
  const { user, repo, perms, fullName } = access;
  // GET ref advertisement or POST pack exchange.
  const expectedMethod = endpoint === 'info/refs' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) {
    return new Response('Method not allowed\n', {
      status: 405,
      headers: { Allow: expectedMethod },
    });
  }
  // A push always carries credentials (anonymousRead was off), so `user` is set here.
  if (isPush && (!user || !perms.write)) {
    return new Response(
      `Permission to ${owner}/${name}.git denied to ${user?.username}.\n`,
      { status: 403 }
    );
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
  let fastForwardOnly: PushCommand[] = [];
  if (isPush && endpoint === 'git-receive-pack') {
    const gzip = request.headers.get('Content-Encoding') === 'gzip';
    if (gzip) headers.delete('Content-Encoding');
    push = body
      ? await readReceiveRequest(
          gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body
        )
      : null;
    if (!push) return new Response('Malformed push request\n', { status: 400 });
    const rules = {
      defaultBranch: repo.defaultBranch,
      protectedPatterns: repo.protectedBranches,
      admin: perms.admin,
      empty: false,
    };
    if (needsEmptyCheck(push.commands, rules))
      rules.empty = (await git.branches()).length === 0;
    const decision = decidePush(push.commands, rules);
    if (decision.refused.size) {
      // The pack is never forwarded; read it to the end so the client gets the reply.
      await push.body.pipeTo(new WritableStream()).catch(() => {});
      if (!reportsStatus(push.capabilities))
        return new Response(
          `Push refused: ${[...decision.refused.values()][0]}\n`,
          { status: 403 }
        );
      return new Response(
        refusalReport(push.commands, decision.refused, push.capabilities),
        {
          headers: {
            'Content-Type': 'application/x-git-receive-pack-result',
            'Cache-Control': 'no-cache',
          },
        }
      );
    }
    fastForwardOnly = decision.fastForwardOnly;
    body = push.body;
    // Forwarded with the length the client declared, as the request itself would have been.
    const length = Number(request.headers.get('Content-Length'));
    if (!gzip && Number.isSafeInteger(length) && length > 0) {
      const fixed = new FixedLengthStream(length);
      body.pipeTo(fixed.writable).catch(() => {});
      body = fixed.readable;
    }
  }
  const upstream = await git.client.forward(
    `/${endpoint}${url.search}`,
    { method: request.method, headers, body },
    isPush ? 'write' : 'read'
  );
  const respHeaders = new Headers();
  for (const h of ['Content-Type', 'Cache-Control', 'Expires', 'Pragma']) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  if (isPush && user && push && upstream.ok) {
    // Receive-pack responses are small; buffer to sync metadata after the push lands.
    let reply: Uint8Array = new Uint8Array(await upstream.arrayBuffer());
    const undone = await undoForcedUpdates(git, fastForwardOnly);
    if (undone.size)
      reply = rewriteReport(reply, push.capabilities, undone) ?? reply;
    ctx.waitUntil(
      afterPush(
        env,
        repo.id,
        user.id,
        push.commands.filter((c) => !undone.has(c.ref)),
        fullName
      )
    );
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

/**
 * An admin's push may move a protected branch only forward. Its objects are in once receive-pack answers, so each
 * such update that landed is checked; one that rewrote history is put back (compare-and-swap on what was pushed).
 * Returns the refs that were refused this way, with the reason the client is told.
 */
async function undoForcedUpdates(
  git: GitService,
  commands: PushCommand[]
): Promise<Map<string, string>> {
  const undone = new Map<string, string>();
  if (!commands.length) return undone;
  const refs = (await git.client.listRefs()).refs;
  for (const c of commands) {
    if (refs.get(c.ref) !== c.new) continue;
    const forward = await git.isAncestor(c.old, c.new);
    if (forward) continue;
    const branch = c.ref.slice('refs/heads/'.length);
    try {
      await git.client.push([{ ref: c.ref, old: c.new, new: c.old }], []);
    } catch (e) {
      console.error('[git] could not undo a forced update', c.ref, e);
      continue;
    }
    undone.set(
      c.ref,
      forward === null
        ? `${branch} is a protected branch: this push is too large to check as a fast-forward; push it in smaller steps`
        : `${branch} is a protected branch: only fast-forward pushes are allowed`
    );
  }
  return undone;
}

/**
 * Bumps `updated_at`, adopts the first pushed branch as default if missing, queues Actions runs,
 * and starts AI resolution for newly conflicting pull requests.
 */
async function afterPush(
  env: CloudflareBindings,
  repoId: string,
  actorId: string,
  commands: PushCommand[],
  fullName: string
) {
  const db = drizzle(env.DB, { schema });
  const patch: { updatedAt: Date; defaultBranch?: string } = {
    updatedAt: new Date(),
  };
  const repo = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .get();
  if (!repo) return;
  let refsAfter: Map<string, string> | null = null;
  try {
    const git = gitFor(env, repo);
    refsAfter = await git.refs();
    const branches = await git.branches();
    if (
      branches.length &&
      !branches.some((b) => b.name === repo.defaultBranch)
    ) {
      patch.defaultBranch =
        branches.find((b) => b.name === 'main')?.name ?? branches[0].name;
    }
  } catch (e) {
    console.error('[git] post-push sync failed', e);
  }
  await db.update(repositories).set(patch).where(eq(repositories.id, repoId));
  if (refsAfter && (actionsConfigured(env) || resolutionConfigured(env))) {
    // The commands that took effect: their refs are where the push put them. A ref moved again since is that
    // push's to report.
    const updates: RefUpdate[] = commands.filter((c) =>
      c.new === ZERO_SHA
        ? !refsAfter.has(c.ref)
        : refsAfter.get(c.ref) === c.new
    );
    await onRefsUpdated(env, db, repo, fullName, updates, actorId);
    // Before the sweep and the state settling below: they read approvals of the new head.
    await carryApprovalsOnSameTree(
      db,
      gitFor(env, repo),
      repoId,
      updates
    ).catch((e) => console.error('[git] could not carry approvals', repoId, e));
    await startSweep(env, repo, updates);
  }
  await publishChange(env, repoId, { approvals: true });
  await settleStates(env, db, repoId);
  // An agent's repository: re-read AGENT.md if its default branch moved. Last, so it delays nothing above.
  await refreshAgentConfig(env, db, repoId);
}
