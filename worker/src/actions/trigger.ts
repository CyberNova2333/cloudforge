// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { deleteRepositoryCache } from './cache';
import { deleteRepositoryArtifacts } from './artifacts';
import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { schema } from '../db/schema';
import {
  pullRequests,
  workflowJobs,
  workflowRuns,
  workflowSteps,
  type Repository,
} from '../db/app.schema';
import { ZERO_SHA } from '../git/remote';
import type { GitService } from '../git/service';
import { decoder } from '../git/bytes';
import { gitFor } from '../lib/repos';
import {
  planJobs,
  pullRequestMatches,
  pushMatches,
  type PlannedJob,
} from './plan';
import {
  parseWorkflow,
  WorkflowFileError,
  type WorkflowDef,
} from './workflow-file';
import { landTargetOf } from '../lib/land-target';
import { getSetting } from '../lib/settings';
import type { Value } from './expressions';

type Db = DrizzleD1Database<typeof schema>;

export const WORKFLOWS_DIR = '.github/workflows';

export type ActionsEvent =
  | {
      kind: 'push';
      ref: string;
      before: string;
      after: string;
      actorId: string | null;
    }
  | {
      kind: 'pull_request';
      number: number;
      title: string;
      baseRef: string;
      headRef: string;
      headSha: string;
      actorId: string | null;
    };

export type RefUpdate = { ref: string; old: string; new: string };

export function actionsConfigured(env: CloudflareBindings): boolean {
  return Boolean((env as Partial<CloudflareBindings>).ACTIONS_RUN);
}

/** Every `.yml`/`.yaml` file directly under `.github/workflows` at `sha`. */
export async function readWorkflowFiles(
  git: GitService,
  sha: string
): Promise<{ path: string; text: string }[]> {
  const dir = await git.entryAt(sha, WORKFLOWS_DIR);
  if (dir?.type !== 'tree') return [];
  const files = dir.entries.filter(
    (e) => e.type === 'blob' && /\.ya?ml$/i.test(e.name)
  );
  const out: { path: string; text: string }[] = [];
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const bytes = await git.blob(f.hash);
    if (bytes)
      out.push({
        path: `${WORKFLOWS_DIR}/${f.name}`,
        text: decoder.decode(bytes),
      });
  }
  return out;
}

async function changedPaths(
  git: GitService,
  from: string,
  to: string
): Promise<string[] | null> {
  if (from === ZERO_SHA) return null;
  const [a, b] = await Promise.all([git.commit(from), git.commit(to)]);
  if (!a || !b) return null;
  return (await git.diffTrees(a.treeHash, b.treeHash)).map((c) => c.path);
}

/** The `github` expression context known when a run is created. */
export function githubContext(
  repoFullName: string,
  run: {
    event: string;
    ref: string;
    headSha: string;
    runNumber?: number;
    id?: string;
  },
  extra: {
    actor?: string;
    workflow?: string;
    baseRef?: string;
    headRef?: string;
    serverUrl?: string;
    number?: number;
    title?: string;
  } = {}
) {
  const refName = run.ref.replace(/^refs\/(heads|tags)\//, '');
  return {
    event_name: run.event,
    ref: run.ref,
    ref_name: refName,
    ref_type: run.ref.startsWith('refs/tags/') ? 'tag' : 'branch',
    sha: run.headSha,
    repository: repoFullName,
    repository_owner: repoFullName.split('/')[0],
    actor: extra.actor ?? '',
    workflow: extra.workflow ?? '',
    run_id: run.id ?? '',
    run_number: run.runNumber ?? 0,
    run_attempt: 1,
    base_ref: extra.baseRef ?? '',
    head_ref: extra.headRef ?? '',
    server_url: extra.serverUrl ?? '',
    workspace: '/workspace',
    event: (extra.number
      ? {
          number: extra.number,
          pull_request: {
            number: extra.number,
            title: extra.title ?? '',
            base: { ref: extra.baseRef ?? '' },
            head: { ref: extra.headRef ?? '', sha: run.headSha },
          },
        }
      : {}) as Record<string, Value>,
  };
}

/**
 * Queues runs for every workflow the event triggers, then starts one Workflow per run.
 * Rows are written first, so a crash in between leaves a visible queued run.
 */
export async function queueRuns(
  env: CloudflareBindings,
  db: Db,
  repo: Repository,
  repoFullName: string,
  event: ActionsEvent,
  eventId?: string
): Promise<string[]> {
  if (!actionsConfigured(env)) return [];
  const git = gitFor(env, repo);
  const headSha = event.kind === 'push' ? event.after : event.headSha;
  const files = await readWorkflowFiles(git, headSha);
  if (!files.length) return [];

  let changed: string[] | null | undefined;
  const changes = async () => {
    if (changed !== undefined) return changed;
    if (event.kind === 'push')
      changed = await changedPaths(git, event.before, event.after);
    else {
      const baseSha = await git.resolveBranch(event.baseRef);
      const base = baseSha ? await git.mergeBase(baseSha, event.headSha) : null;
      changed = base ? await changedPaths(git, base, event.headSha) : null;
    }
    return changed;
  };

  const ref =
    event.kind === 'push' ? event.ref : `refs/pull/${event.number}/head`;
  const displayTitle =
    event.kind === 'push'
      ? ((await git.commit(event.after))?.message.split('\n')[0] ?? event.ref)
      : event.title;
  const github = githubContext(
    repoFullName,
    { event: event.kind, ref, headSha },
    {
      baseRef: event.kind === 'pull_request' ? event.baseRef : '',
      headRef: event.kind === 'pull_request' ? event.headRef : '',
    }
  );

  const maxRunner = await getSetting(db, env, 'actions.max_runner_size');
  const created: string[] = [];
  for (const file of files) {
    let wf: WorkflowDef | null = null;
    let jobs: PlannedJob[] = [];
    let error: string | null = null;
    try {
      wf = parseWorkflow(file.text);
      const filter = event.kind === 'push' ? wf.on.push : wf.on.pullRequest;
      if (!filter) continue;
      const matches =
        event.kind === 'push'
          ? pushMatches(
              filter,
              event.ref,
              filter.paths || filter.pathsIgnore ? await changes() : null
            )
          : pullRequestMatches(
              filter,
              event.baseRef,
              filter.paths || filter.pathsIgnore ? await changes() : null
            );
      if (!matches) continue;
      jobs = planJobs(
        wf,
        { ...github, workflow: wf.name ?? file.path },
        { maxRunner }
      );
    } catch (e) {
      if (!(e instanceof WorkflowFileError)) throw e;
      error = `Invalid workflow file: ${file.path}\n${e.message}`;
    }
    const id = await insertRun(db, {
      repo,
      path: file.path,
      name: wf?.name ?? file.path,
      event: event.kind,
      eventData:
        event.kind === 'pull_request'
          ? {
              baseRef: event.baseRef,
              headRef: event.headRef,
              number: event.number,
              title: event.title,
            }
          : null,
      triggerKey: eventId
        ? JSON.stringify([eventId, event.kind, ref, file.path])
        : null,
      ref,
      headSha,
      displayTitle,
      actorId: event.actorId,
      jobs,
      error,
    });
    if (!error) await startRun(env, db, id, Boolean(eventId));
    created.push(id);
  }
  return created;
}

/** Starts a queued run's Workflow; a start failure is recorded on the run. */
async function startRun(
  env: CloudflareBindings,
  db: Db,
  id: string,
  strict = false
) {
  const run = await db
    .select({ status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .get();
  if (run?.status === 'completed') return;
  try {
    await env.ACTIONS_RUN.create({ id, params: { runId: id } });
  } catch (e) {
    // Creation may have committed before its response was lost. The fixed id
    // identifies that same instance on retry; never start a second execution.
    if (strict) {
      try {
        await (await env.ACTIONS_RUN.get(id)).status();
        return;
      } catch {
        // There is no observable instance yet: retain queued state for strict delivery.
      }
      throw e;
    }
    console.error('[actions] could not start run', id, e);
    await db
      .update(workflowRuns)
      .set({
        status: 'completed',
        conclusion: 'failure',
        errorMessage: 'The run could not be started. Try re-running it.',
        completedAt: new Date(),
      })
      .where(eq(workflowRuns.id, id));
  }
}

/** "Re-run all jobs": a new run at the same commit. */
export async function rerun(
  env: CloudflareBindings,
  db: Db,
  repo: Repository,
  repoFullName: string,
  run: typeof workflowRuns.$inferSelect,
  actorId: string
): Promise<string> {
  const files = await readWorkflowFiles(gitFor(env, repo), run.headSha);
  const file = files.find((f) => f.path === run.workflowPath);
  let jobs: PlannedJob[] = [];
  let error: string | null = null;
  let name = run.name;
  if (!file)
    error = `${run.workflowPath} does not exist at ${run.headSha.slice(0, 7)}.`;
  else {
    try {
      const wf = parseWorkflow(file.text);
      name = wf.name ?? file.path;
      jobs = planJobs(
        wf,
        {
          ...githubContext(repoFullName, run, run.eventData ?? {}),
          workflow: name,
        },
        { maxRunner: await getSetting(db, env, 'actions.max_runner_size') }
      );
    } catch (e) {
      if (!(e instanceof WorkflowFileError)) throw e;
      error = `Invalid workflow file: ${run.workflowPath}\n${e.message}`;
    }
  }
  const id = await insertRun(db, {
    repo,
    path: run.workflowPath,
    name,
    event: run.event,
    eventData: run.eventData,
    triggerKey: null,
    ref: run.ref,
    headSha: run.headSha,
    displayTitle: run.displayTitle,
    actorId,
    jobs,
    error,
  });
  if (!error) await startRun(env, db, id);
  return id;
}

// D1 caps bound parameters per statement.
const ROWS_PER_INSERT = 10;

async function insertRun(
  db: Db,
  r: {
    repo: Repository;
    path: string;
    name: string;
    event: 'push' | 'pull_request';
    eventData: typeof workflowRuns.$inferSelect.eventData;
    triggerKey: string | null;
    ref: string;
    headSha: string;
    displayTitle: string;
    actorId: string | null;
    jobs: PlannedJob[];
    error: string | null;
  }
): Promise<string> {
  if (r.triggerKey) {
    const existing = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.repositoryId, r.repo.id),
          eq(workflowRuns.triggerKey, r.triggerKey)
        )
      )
      .get();
    if (existing) return existing.id;
  }
  const id = crypto.randomUUID();
  const now = new Date();
  const children = [];
  for (const job of r.jobs) {
    const jobId = crypto.randomUUID();
    children.push(
      db.insert(workflowJobs).values({
        id: jobId,
        runId: id,
        jobKey: job.key,
        name: job.name,
        runsOn: job.runsOn,
        needs: job.needs,
        matrixValues: job.matrix,
      })
    );
    for (let i = 0; i < job.steps.length; i += ROWS_PER_INSERT)
      children.push(
        db.insert(workflowSteps).values(
          job.steps.slice(i, i + ROWS_PER_INSERT).map((s) => ({
            id: crypto.randomUUID(),
            jobId,
            number: s.number,
            name: s.name.slice(0, 500),
          }))
        )
      );
  }
  // Run number is claimed in the INSERT; concurrent pushes retry on the unique index.
  for (let attempt = 0; ; attempt++) {
    try {
      await db.batch([
        db.insert(workflowRuns).values({
          id,
          repositoryId: r.repo.id,
          runNumber:
            sql`(SELECT COALESCE(MAX(run_number), 0) + 1 FROM workflow_runs WHERE repository_id = ${r.repo.id})` as unknown as number,
          workflowPath: r.path,
          name: r.name,
          event: r.event,
          eventData: r.eventData,
          triggerKey: r.triggerKey,
          ref: r.ref,
          headSha: r.headSha,
          displayTitle: r.displayTitle.slice(0, 500),
          actorId: r.actorId,
          status: r.error ? 'completed' : 'queued',
          conclusion: r.error ? 'failure' : null,
          errorMessage: r.error,
          createdAt: now,
          completedAt: r.error ? now : null,
        }),
        ...children,
      ]);
      break;
    } catch (e) {
      if (r.triggerKey) {
        const existing = await db
          .select({ id: workflowRuns.id })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.repositoryId, r.repo.id),
              eq(workflowRuns.triggerKey, r.triggerKey)
            )
          )
          .get();
        if (existing) return existing.id;
      }
      if (attempt >= 4 || !String(e).includes('UNIQUE')) throw e;
    }
  }
  return id;
}

/** After refs change: queues `push` runs per ref and `pull_request` runs for moved PR heads. */
export async function onRefsUpdated(
  env: CloudflareBindings,
  db: Db,
  repo: Repository,
  repoFullName: string,
  updates: RefUpdate[],
  actorId: string | null,
  eventId?: string
): Promise<void> {
  if (!actionsConfigured(env)) return;
  for (const u of updates) {
    if (u.new === ZERO_SHA) continue;
    if (!u.ref.startsWith('refs/heads/') && !u.ref.startsWith('refs/tags/'))
      continue;
    try {
      await queueRuns(
        env,
        db,
        repo,
        repoFullName,
        {
          kind: 'push',
          ref: u.ref,
          before: u.old,
          after: u.new,
          actorId,
        },
        eventId
      );
      if (!u.ref.startsWith('refs/heads/')) continue;
      const branch = u.ref.slice('refs/heads/'.length);
      const prs = await db
        .select()
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.repositoryId, repo.id),
            eq(pullRequests.state, 'open'),
            eq(pullRequests.headRef, branch)
          )
        );
      for (const pr of prs)
        await queueRuns(
          env,
          db,
          repo,
          repoFullName,
          {
            kind: 'pull_request',
            number: pr.number,
            title: pr.title,
            baseRef: landTargetOf(pr),
            headRef: pr.headRef,
            headSha: u.new,
            actorId,
          },
          eventId
        );
    } catch (e) {
      if (eventId) throw e;
      console.error('[actions] could not queue runs for', u.ref, e);
    }
  }
}

/** Diffs two ref snapshots into the updates a push made. */
export function diffRefs(
  before: Map<string, string>,
  after: Map<string, string>
): RefUpdate[] {
  const out: RefUpdate[] = [];
  for (const [ref, sha] of after) {
    const old = before.get(ref) ?? ZERO_SHA;
    if (old !== sha) out.push({ ref, old, new: sha });
  }
  for (const [ref, sha] of before)
    if (!after.has(ref)) out.push({ ref, old: sha, new: ZERO_SHA });
  return out;
}

/** Deletes a repository's R2 logs (Actions step logs, merge-resolution transcripts). */
export async function deleteRepositoryLogs(
  env: CloudflareBindings,
  repositoryId: string
) {
  for (const prefix of [
    `actions/${repositoryId}/`,
    `merge-resolutions/${repositoryId}/`,
  ]) {
    let cursor: string | undefined;
    do {
      const page = await env.ACTIONS_LOGS.list({ prefix, cursor, limit: 1000 });
      if (page.objects.length)
        await env.ACTIONS_LOGS.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  await deleteRepositoryCache(env, repositoryId);
  await deleteRepositoryArtifacts(env, repositoryId);
}
