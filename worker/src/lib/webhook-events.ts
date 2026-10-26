// The events webhooks receive (docs/webhooks.md), as GitHub-style JSON: `repository`, `sender`, and per event its
// object (`pull_request`, `issue`, `comment`, `release`, push fields). Each emit reads the repository's hooks first and
// builds nothing when none takes the event. Never throws.
import { and, eq } from 'drizzle-orm';
import {
  issueAssignees,
  issueComments,
  issueLabels,
  issues,
  labels,
  pullRequestComments,
  pullRequests,
  type CommitStatus,
  type Issue,
  type PullRequest,
  type Repository,
  type Webhook,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import { ZERO_SHA } from '../git/remote';
import { findRepoById, gitFor } from './repos';
import type { NotifyCtx, NotifyEvent } from './notifications';
import { enqueueDeliveries, hooksFor, PAYLOAD_MAX } from './webhooks';
import { landTargetOf } from './land-target';
import { inJsonArray } from './sql-set';

const base = (env: CloudflareBindings) =>
  (env.BASE_URL ?? '').replace(/\/+$/, '');

async function repoContext(ctx: NotifyCtx, repositoryId: string) {
  const found = await findRepoById(ctx.db, repositoryId);
  if (!found) return null;
  const fullName = `${found.namespace.username}/${found.repo.name}`;
  const html = `${base(ctx.env)}/${fullName}`;
  return {
    repo: found.repo,
    fullName,
    html,
    payload: {
      id: found.repo.id,
      name: found.repo.name,
      full_name: fullName,
      private: found.repo.visibility === 'private',
      visibility: found.repo.visibility,
      html_url: html,
      clone_url: `${html}.git`,
      default_branch: found.repo.defaultBranch,
      owner: { login: found.namespace.username },
    },
  };
}

async function sender(ctx: NotifyCtx, userId: string | null) {
  if (!userId) return { login: 'cloudforge', type: 'Bot' };
  const u = await ctx.db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return u
    ? { id: u.id, login: u.username ?? u.id, type: 'User' }
    : { login: 'ghost', type: 'User' };
}

async function logins(ctx: NotifyCtx, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = unique.length
    ? await ctx.db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inJsonArray(users.id, unique))
        .all()
    : [];
  const map = new Map(rows.map((r) => [r.id, r.username ?? r.id]));
  return (id: string | null) => (id ? { login: map.get(id) ?? 'ghost' } : null);
}

/** Runs `build` and enqueues its payload for the repository's hooks that take `event`. */
async function emit(
  ctx: NotifyCtx,
  repositoryId: string,
  event: string,
  action: string | null,
  build: (hooks: Webhook[]) => Promise<Record<string, unknown> | null>,
  key?: string
) {
  try {
    const hooks = await hooksFor(ctx.db, repositoryId, event);
    if (!hooks.length) return;
    const payload = await build(hooks);
    if (payload)
      await enqueueDeliveries(ctx, hooks, event, action, payload, key);
  } catch (e) {
    console.error(
      '[webhooks] could not build an event',
      event,
      repositoryId,
      e
    );
  }
}

function pullPayload(
  pr: PullRequest,
  html: string,
  login: (id: string | null) => { login: string } | null,
  sha: string | null
) {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state === 'open' ? 'open' : 'closed',
    merged: pr.state === 'merged',
    html_url: `${html}/pull/${pr.number}`,
    user: login(pr.authorId),
    head: { ref: pr.headRef, sha },
    base: { ref: landTargetOf(pr) },
    merge_commit_sha: pr.mergeCommitSha,
    merged_by: login(pr.mergedById),
    created_at: pr.createdAt.toISOString(),
    updated_at: pr.updatedAt.toISOString(),
    closed_at: pr.closedAt?.toISOString() ?? null,
    merged_at: pr.mergedAt?.toISOString() ?? null,
  };
}

async function issuePayload(ctx: NotifyCtx, issue: Issue, html: string) {
  // Read here rather than through lib/issues.ts, which notifies (and so imports this module).
  const [labelRows, assigneeRows] = await Promise.all([
    ctx.db
      .select({ name: labels.name, color: labels.color })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(eq(issueLabels.issueId, issue.id))
      .all(),
    ctx.db
      .select({ userId: issueAssignees.userId })
      .from(issueAssignees)
      .where(eq(issueAssignees.issueId, issue.id))
      .all(),
  ]);
  const ids = assigneeRows.map((a) => a.userId);
  const login = await logins(ctx, [issue.authorId, ...ids]);
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    state_reason: issue.stateReason,
    html_url: `${html}/issues/${issue.number}`,
    user: login(issue.authorId),
    labels: labelRows.sort((a, b) => a.name.localeCompare(b.name)),
    assignees: ids.map((id) => login(id)),
    created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(),
    closed_at: issue.closedAt?.toISOString() ?? null,
  };
}

/**
 * An issue or pull request event (the same calls that notify people): `issues`, `pull_request` or, for a comment,
 * `issue_comment`.
 */
export async function emitThreadEvent(ctx: NotifyCtx, e: NotifyEvent) {
  const kind = e.thread.kind;
  if (e.event === 'commented') {
    await emit(
      ctx,
      e.thread.repositoryId,
      'issue_comment',
      'created',
      async () => {
        const rc = await repoContext(ctx, e.thread.repositoryId);
        if (!rc) return null;
        const table = kind === 'issue' ? issueComments : pullRequestComments;
        const comment = e.commentId
          ? await ctx.db
              .select()
              .from(table)
              .where(eq(table.id, e.commentId))
              .get()
          : undefined;
        const subject =
          kind === 'issue'
            ? await ctx.db
                .select()
                .from(issues)
                .where(eq(issues.id, e.thread.id))
                .get()
            : await ctx.db
                .select()
                .from(pullRequests)
                .where(eq(pullRequests.id, e.thread.id))
                .get();
        if (!subject) return null;
        const login = await logins(ctx, [
          subject.authorId,
          comment?.authorId ?? '',
        ]);
        const url = `${rc.html}/${kind === 'issue' ? 'issues' : 'pull'}/${subject.number}`;
        return {
          action: 'created',
          issue: {
            number: subject.number,
            title: subject.title,
            state: subject.state === 'open' ? 'open' : 'closed',
            html_url: url,
            user: login(subject.authorId),
            ...(kind === 'pull' ? { pull_request: { html_url: url } } : {}),
          },
          comment: comment
            ? {
                id: comment.id,
                body: comment.body,
                user: login(comment.authorId),
                html_url: url,
                created_at: comment.createdAt.toISOString(),
              }
            : { body: e.text ?? '', user: login(e.actorId) },
          repository: rc.payload,
          sender: await sender(ctx, e.actorId),
        };
      }
    );
    return;
  }
  if (kind === 'issue') {
    // Issues: opened, closed, reopened, assigned.
    if (e.event === 'merged') return;
    const action = e.event;
    await emit(ctx, e.thread.repositoryId, 'issues', action, async () => {
      const rc = await repoContext(ctx, e.thread.repositoryId);
      const issue = await ctx.db
        .select()
        .from(issues)
        .where(eq(issues.id, e.thread.id))
        .get();
      if (!rc || !issue) return null;
      const login = await logins(ctx, e.assigned ?? []);
      return {
        action,
        issue: await issuePayload(ctx, issue, rc.html),
        ...(action === 'assigned' && e.assigned?.length
          ? { assignee: login(e.assigned[0]) }
          : {}),
        repository: rc.payload,
        sender: await sender(ctx, e.actorId),
      };
    });
    return;
  }
  // Pull requests: opened, closed (merged or not), reopened.
  if (e.event === 'assigned') return;
  const action = e.event === 'merged' ? 'closed' : e.event;
  await emit(ctx, e.thread.repositoryId, 'pull_request', action, async () => {
    const rc = await repoContext(ctx, e.thread.repositoryId);
    const pr = await ctx.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, e.thread.id))
      .get();
    if (!rc || !pr) return null;
    const sha =
      pr.state === 'merged'
        ? pr.mergeCommitSha
        : await gitFor(ctx.env, rc.repo)
            .resolveBranch(pr.headRef)
            .catch(() => null);
    const login = await logins(ctx, [pr.authorId, pr.mergedById ?? '']);
    return {
      action,
      number: pr.number,
      pull_request: pullPayload(pr, rc.html, login, sha),
      repository: rc.payload,
      sender: await sender(ctx, e.actorId),
    };
  });
}

type RefUpdate = { ref: string; old: string; new: string };

/**
 * A push: one event per ref it updated (`created`/`deleted` for new and removed refs), with up to 20 commits. `key`
 * (the push event's id, a landing's) makes a follow-up that runs again deliver nothing twice.
 */
export async function emitPush(
  ctx: NotifyCtx,
  repo: Repository,
  updates: RefUpdate[],
  actorId: string | null,
  key: string
) {
  for (const u of updates)
    await emit(
      ctx,
      repo.id,
      'push',
      null,
      async () => {
        const rc = await repoContext(ctx, repo.id);
        if (!rc) return null;
        const git = gitFor(ctx.env, rc.repo);
        const created = u.old === ZERO_SHA;
        const deleted = u.new === ZERO_SHA;
        const commits = deleted
          ? []
          : created
            ? await git.log(u.new, 1).catch(() => [])
            : (await git.commitsBetween(u.old, u.new).catch(() => [])).slice(
                0,
                20
              );
        const head = deleted
          ? null
          : (commits[0] ?? (await git.commit(u.new).catch(() => null)));
        const commit = (c: NonNullable<typeof head>) => ({
          id: c.hash,
          message: c.message,
          timestamp: new Date(c.authoredAt * 1000).toISOString(),
          url: `${rc.html}/commit/${c.hash}`,
          author: c.author,
          committer: c.committer,
        });
        const payload = {
          ref: u.ref,
          before: u.old,
          after: u.new,
          created,
          deleted,
          compare:
            created || deleted
              ? null
              : `${rc.html}/compare/${u.old}...${u.new}`,
          commits: commits.map(commit),
          head_commit: head ? commit(head) : null,
          repository: rc.payload,
          pusher: await sender(ctx, actorId),
          sender: await sender(ctx, actorId),
        };
        // A huge commit list is cut before the body grows past what a delivery keeps.
        while (
          JSON.stringify(payload).length > PAYLOAD_MAX &&
          payload.commits.length
        )
          payload.commits.pop();
        return payload;
      },
      `push:${key}:${u.ref}`
    );
}

/** `synchronize` for each open pull request whose head branch a push moved. */
export async function emitSynchronize(
  ctx: NotifyCtx,
  repo: Repository,
  updates: RefUpdate[],
  actorId: string | null,
  key: string
) {
  const branches = updates
    .filter(
      (u) =>
        u.ref.startsWith('refs/heads/') &&
        u.new !== ZERO_SHA &&
        u.old !== ZERO_SHA
    )
    .map((u) => ({
      branch: u.ref.slice('refs/heads/'.length),
      sha: u.new,
      before: u.old,
    }));
  if (!branches.length) return;
  await emit(ctx, repo.id, 'pull_request', 'synchronize', async (hooks) => {
    const open = await ctx.db
      .select()
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.repositoryId, repo.id),
          eq(pullRequests.state, 'open')
        )
      )
      .all();
    const rc = await repoContext(ctx, repo.id);
    if (!rc) return null;
    // One delivery per moved pull request: enqueued here, so the shared one below is skipped.
    for (const pr of open) {
      const moved = branches.find((b) => b.branch === pr.headRef);
      if (!moved) continue;
      const login = await logins(ctx, [pr.authorId]);
      await enqueueDeliveries(
        ctx,
        hooks,
        'pull_request',
        'synchronize',
        {
          action: 'synchronize',
          number: pr.number,
          before: moved.before,
          after: moved.sha,
          pull_request: pullPayload(pr, rc.html, login, moved.sha),
          repository: rc.payload,
          sender: await sender(ctx, actorId),
        },
        `sync:${key}:${pr.id}`
      );
    }
    return null;
  });
}

/** A release was published. */
export async function emitRelease(
  ctx: NotifyCtx,
  repo: Repository,
  release: {
    id: string;
    tag: string;
    title: string;
    notes: string;
    createdAt: Date;
  },
  actorId: string | null
) {
  await emit(ctx, repo.id, 'release', 'published', async () => {
    const rc = await repoContext(ctx, repo.id);
    if (!rc) return null;
    return {
      action: 'published',
      release: {
        id: release.id,
        tag_name: release.tag,
        name: release.title,
        body: release.notes,
        html_url: `${rc.html}/releases/${encodeURIComponent(release.tag)}`,
        created_at: release.createdAt.toISOString(),
        published_at: release.createdAt.toISOString(),
        author: await sender(ctx, actorId),
      },
      repository: rc.payload,
      sender: await sender(ctx, actorId),
    };
  });
}

/** A commit status was reported. */
export async function emitStatus(
  ctx: NotifyCtx,
  repo: Repository,
  status: CommitStatus,
  actorId: string | null
) {
  await emit(ctx, repo.id, 'status', null, async () => {
    const rc = await repoContext(ctx, repo.id);
    if (!rc) return null;
    return {
      id: status.id,
      sha: status.sha,
      state: status.state,
      context: status.context,
      description: status.description,
      target_url: status.targetUrl,
      commit: { sha: status.sha, html_url: `${rc.html}/commit/${status.sha}` },
      created_at: status.createdAt.toISOString(),
      updated_at: status.createdAt.toISOString(),
      repository: rc.payload,
      sender: await sender(ctx, actorId),
    };
  });
}

/** `ping` to one hook: on creation, or from "Send a test". */
export async function emitPing(
  ctx: NotifyCtx,
  hook: Webhook,
  actorId: string | null
) {
  try {
    const rc = await repoContext(ctx, hook.repositoryId);
    if (!rc) return [];
    return await enqueueDeliveries(ctx, [hook], 'ping', null, {
      zen: 'Keep it logically awesome.',
      hook_id: hook.id,
      hook: {
        id: hook.id,
        type: 'Repository',
        events: hook.events,
        active: hook.active,
        config: { url: hook.url, content_type: 'json' },
      },
      repository: rc.payload,
      sender: await sender(ctx, actorId),
    });
  } catch (e) {
    console.error('[webhooks] could not ping', hook.id, e);
    return [];
  }
}
