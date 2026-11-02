// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { can } from '../../repositories/permissions';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  commitStatusStates,
  workflowJobs,
  workflowRuns,
  workflowSteps,
  type WorkflowRun,
} from '../../db/app.schema';
import { actionsConfigured, rerun } from '../trigger';
import {
  combinedState,
  latestStatuses,
} from '../../repositories/commit-statuses';
import { loadRepo, type RepoEnv } from '../../repositories/service';
import type { DrizzleDB } from '../../db/middleware';
import { usersById, type PublicUser } from '../../members/users';
import {
  json200Response,
  json201Response,
  json400Response,
  json403Response,
  json404Response,
  validationHook,
} from '../../http/openapi-helpers';
import { ownerRepoParams, publicUserSchema } from '../../http/schemas';
import {
  actionsQueue,
  dropRun,
  queueConfigured,
  queuePositions,
} from '../queue';
import { stopAbandonedRun } from '../abandon';
import { deleteArtifact, listRunArtifacts } from '../artifacts';
import { recordAudit } from '../../audit/service';
import { inJsonArray } from '../../shared/sql-set';

export const actionsRouter = new OpenAPIHono<RepoEnv>({
  defaultHook: validationHook,
});
actionsRouter.use('/:owner/:repo/*', loadRepo);

const statusEnum = z.enum(['queued', 'in_progress', 'completed']);
const conclusionEnum = z
  .enum(['success', 'failure', 'cancelled', 'skipped'])
  .nullable();

const runSchema = z
  .object({
    id: z.string(),
    runNumber: z.number(),
    name: z.string(),
    workflowPath: z.string(),
    event: z.enum(['push', 'pull_request']),
    ref: z.string(),
    /** Branch or tag name for pushes; the head branch's PR number for pull_request runs. */
    refName: z.string(),
    pullRequestNumber: z.number().nullable(),
    headSha: z.string(),
    displayTitle: z.string(),
    actor: publicUserSchema.nullable(),
    status: statusEnum,
    conclusion: conclusionEnum,
    errorMessage: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .openapi('WorkflowRun');

const stepSchema = z.object({
  number: z.number(),
  name: z.string(),
  status: statusEnum,
  conclusion: conclusionEnum,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

const jobSchema = z
  .object({
    id: z.string(),
    jobKey: z.string(),
    name: z.string(),
    runsOn: z.string(),
    needs: z.array(z.string()),
    /** Jobs ahead of this one in the instance's queue; null when it isn't waiting for a slot. */
    queuedAhead: z.number().nullable(),
    status: statusEnum,
    conclusion: conclusionEnum,
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    steps: z.array(stepSchema),
  })
  .openapi('WorkflowJob');

function serializeRun(r: WorkflowRun, people: Map<string, PublicUser>) {
  const pr = /^refs\/pull\/(\d+)\/head$/.exec(r.ref);
  return {
    id: r.id,
    runNumber: r.runNumber,
    name: r.name,
    workflowPath: r.workflowPath,
    event: r.event,
    ref: r.ref,
    refName: r.ref.replace(/^refs\/(heads|tags)\//, ''),
    pullRequestNumber: pr ? Number(pr[1]) : null,
    headSha: r.headSha,
    displayTitle: r.displayTitle,
    actor: r.actorId ? (people.get(r.actorId) ?? null) : null,
    status: r.status,
    conclusion: r.conclusion,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

const PAGE_SIZE = 25;

// ── list ─────────────────────────────────────────────────────────────────────

const listRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/actions/runs',
  tags: ['Actions'],
  request: {
    params: ownerRepoParams,
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      workflow: z.string().optional(),
    }),
  },
  responses: {
    ...json200Response(
      z.object({
        configured: z.boolean(),
        totalCount: z.number(),
        workflows: z.array(z.object({ path: z.string(), name: z.string() })),
        runs: z.array(runSchema),
      }),
      'Workflow runs, newest first'
    ),
  },
});
actionsRouter.openapi(listRoute, async (c) => {
  const db = c.get('db');
  const repo = c.get('repo');
  const { page, workflow } = c.req.valid('query');
  const where = and(
    eq(workflowRuns.repositoryId, repo.id),
    workflow ? eq(workflowRuns.workflowPath, workflow) : undefined
  );
  const [total, rows, workflows] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(workflowRuns)
      .where(where)
      .get(),
    db
      .select()
      .from(workflowRuns)
      .where(where)
      .orderBy(desc(workflowRuns.runNumber))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .all(),
    // SQLite bare columns: with MAX(), the other columns come from each file's newest run.
    db
      .select({
        path: workflowRuns.workflowPath,
        name: workflowRuns.name,
        latest: sql<number>`MAX(${workflowRuns.runNumber})`,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.repositoryId, repo.id))
      .groupBy(workflowRuns.workflowPath)
      .orderBy(asc(workflowRuns.workflowPath))
      .all()
      .then((list) => list.map(({ path, name }) => ({ path, name }))),
  ]);
  const people = await usersById(
    db,
    rows.map((r) => r.actorId ?? '')
  );
  return c.json(
    {
      configured: actionsConfigured(c.env),
      totalCount: Number(total?.n ?? 0),
      workflows,
      runs: rows.map((r) => serializeRun(r, people)),
    },
    200
  );
});

// ── one run ──────────────────────────────────────────────────────────────────

const runParams = ownerRepoParams.extend({
  number: z.coerce.number().int().min(1),
});

async function getRun(
  c: { get: (k: 'db' | 'repo') => any },
  number: number
): Promise<WorkflowRun | undefined> {
  const db = c.get('db');
  return db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.repositoryId, c.get('repo').id),
        eq(workflowRuns.runNumber, number)
      )
    )
    .get();
}

/** Retain stopped-run inventory until the same bounded cleanup used by the queue confirms it. */
async function stopRun(
  env: CloudflareBindings,
  db: RepoEnv['Variables']['db'],
  runId: string,
  conclusion: 'cancelled' | 'failure'
) {
  if (await stopAbandonedRun(env, db, runId, conclusion)) {
    await dropRun(env, runId);
  } else if (queueConfigured(env)) {
    // Even fallback reservations without a queue entry need a durable alarm once the queue is reachable.
    try {
      await actionsQueue(env).reclaim();
    } catch (error) {
      console.warn('[actions] could not resume stop recovery', runId, error);
    }
  }
}

/** Reconciles an unfinished run with its Workflow, which may have died without updating it. */
async function reconcile(
  env: CloudflareBindings,
  db: RepoEnv['Variables']['db'],
  run: WorkflowRun
): Promise<WorkflowRun> {
  if (run.status === 'completed' || !actionsConfigured(env)) return run;
  if (Date.now() - run.createdAt.getTime() < 60_000) return run;
  try {
    const { status } = await (await env.ACTIONS_RUN.get(run.id)).status();
    if (status !== 'errored' && status !== 'terminated') return run;
    await stopRun(
      env,
      db,
      run.id,
      status === 'terminated' ? 'cancelled' : 'failure'
    );
    return (await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id))
      .get())!;
  } catch {
    return run;
  }
}

const getRunRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/actions/runs/{number}',
  tags: ['Actions'],
  request: { params: runParams },
  responses: {
    ...json200Response(
      z.object({ run: runSchema, jobs: z.array(jobSchema) }),
      'A run with its jobs and steps'
    ),
    ...json404Response,
  },
});
actionsRouter.openapi(getRunRoute, async (c) => {
  const db = c.get('db');
  const found = await getRun(c, c.req.valid('param').number);
  if (!found) return c.json({ error: 'Not Found' }, 404);
  const run = await reconcile(c.env, db, found);
  const jobs = await db
    .select()
    .from(workflowJobs)
    .where(eq(workflowJobs.runId, run.id))
    .all();
  const steps = jobs.length
    ? await db
        .select()
        .from(workflowSteps)
        .where(
          inJsonArray(
            workflowSteps.jobId,
            jobs.map((j) => j.id)
          )
        )
        .orderBy(asc(workflowSteps.number))
        .all()
    : [];
  const people = await usersById(db, [run.actorId ?? '']);
  // A restarted job waits again while still in_progress, so ask about every unfinished job.
  const waiting =
    run.status === 'completed'
      ? []
      : jobs.filter((j) => j.status !== 'completed').map((j) => j.id);
  const ahead = await queuePositions(c.env, waiting);
  return c.json(
    {
      run: serializeRun(run, people),
      jobs: jobs.map((j) => ({
        id: j.id,
        jobKey: j.jobKey,
        name: j.name,
        runsOn: j.runsOn,
        needs: j.needs,
        queuedAhead: ahead[j.id] ?? null,
        status: j.status,
        conclusion: j.conclusion,
        startedAt: iso(j.startedAt),
        completedAt: iso(j.completedAt),
        steps: steps
          .filter((s) => s.jobId === j.id)
          .map((s) => ({
            number: s.number,
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            startedAt: iso(s.startedAt),
            completedAt: iso(s.completedAt),
          })),
      })),
    },
    200
  );
});

// ── logs ─────────────────────────────────────────────────────────────────────

const logsRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/actions/runs/{number}/jobs/{jobId}/steps/{step}/logs',
  tags: ['Actions'],
  request: {
    params: runParams.extend({
      jobId: z.string(),
      step: z.coerce.number().int().min(1),
    }),
  },
  responses: {
    200: {
      content: { 'text/plain': { schema: z.string() } },
      description: 'The step log; partial while the step is running',
    },
    ...json404Response,
  },
});
actionsRouter.openapi(logsRoute, async (c) => {
  const db = c.get('db');
  const { number, jobId, step } = c.req.valid('param');
  const run = await getRun(c, number);
  if (!run) return c.json({ error: 'Not Found' }, 404);
  const row = await db
    .select({ step: workflowSteps })
    .from(workflowSteps)
    .innerJoin(workflowJobs, eq(workflowJobs.id, workflowSteps.jobId))
    .where(
      and(
        eq(workflowJobs.runId, run.id),
        eq(workflowSteps.jobId, jobId),
        eq(workflowSteps.number, step)
      )
    )
    .get();
  if (!row) return c.json({ error: 'Not Found' }, 404);
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  // The running step's output from its runner, else the stored log streamed from R2 (never read whole).
  let body: string | ReadableStream = '';
  if (row.step.status === 'in_progress' && actionsConfigured(c.env)) {
    try {
      const live = await c.env.JOB_RUNNER.getByName(jobId).live(step);
      if (live !== null) body = live;
    } catch {
      // The runner is between steps or gone; fall through to the stored log.
    }
  }
  if (body === '' && row.step.logR2Key) {
    const obj = await c.env.ACTIONS_LOGS.get(row.step.logR2Key);
    if (obj) body = obj.body;
  }
  // As the raw file route streams: the route's text/plain response, without making a string of it first.
  return new Response(body, { headers }) as never;
});

// ── artifacts ────────────────────────────────────────────────────────────────

const artifactSchema = z
  .object({
    name: z.string(),
    id: z.string(),
    /** Zipped size in bytes. */
    size: z.number(),
    createdAt: z.string(),
    /** The job that uploaded it. */
    jobId: z.string(),
  })
  .openapi('WorkflowArtifact');

const artifactsRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/actions/runs/{number}/artifacts',
  tags: ['Actions'],
  request: { params: runParams },
  responses: {
    ...json200Response(
      z.object({ artifacts: z.array(artifactSchema) }),
      "The run's artifacts (actions/upload-artifact), by name"
    ),
    ...json404Response,
  },
});
actionsRouter.openapi(artifactsRoute, async (c) => {
  const run = await getRun(c, c.req.valid('param').number);
  if (!run) return c.json({ error: 'Not Found' }, 404);
  const artifacts = await listRunArtifacts(c.env, run.repositoryId, run.id);
  return c.json(
    {
      artifacts: artifacts.map((a) => ({
        name: a.name,
        id: a.id,
        size: a.size,
        createdAt: a.createdAt.toISOString(),
        jobId: a.jobId,
      })),
    },
    200
  );
});

const artifactParams = runParams.extend({ name: z.string().min(1) });

const artifactZipRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/actions/runs/{number}/artifacts/{name}/zip',
  tags: ['Actions'],
  request: { params: artifactParams },
  responses: {
    200: {
      content: { 'application/zip': { schema: z.string() } },
      description: 'The artifact as a zip file',
    },
    ...json404Response,
  },
});
actionsRouter.openapi(artifactZipRoute, async (c) => {
  const { number, name } = c.req.valid('param');
  const run = await getRun(c, number);
  if (!run) return c.json({ error: 'Not Found' }, 404);
  const a = (await listRunArtifacts(c.env, run.repositoryId, run.id)).find(
    (x) => x.name === name
  );
  const obj = a ? await c.env.ACTIONS_CACHE.get(a.objectKey) : null;
  if (!obj) return c.json({ error: 'Not Found' }, 404);
  const file = `${name.replace(/[^\w.-]+/g, '_')}.zip`;
  return c.body(obj.body, 200, {
    'Content-Type': 'application/zip',
    'Content-Length': String(obj.size),
    'Content-Disposition': `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`,
    'Cache-Control': 'private, no-store',
  });
});

const deleteArtifactRoute = createRoute({
  method: 'delete',
  path: '/{owner}/{repo}/actions/runs/{number}/artifacts/{name}',
  tags: ['Actions'],
  request: { params: artifactParams },
  responses: {
    ...json200Response(z.object({ ok: z.literal(true) }), 'Deleted'),
    ...json403Response,
    ...json404Response,
  },
});
actionsRouter.openapi(deleteArtifactRoute, async (c) => {
  if (!can(c.get('perms'), 'runActions'))
    return c.json(
      { error: 'You do not have permission to delete artifacts' },
      403
    );
  const { number, name } = c.req.valid('param');
  const run = await getRun(c, number);
  if (!run) return c.json({ error: 'Not Found' }, 404);
  const a = (await listRunArtifacts(c.env, run.repositoryId, run.id)).find(
    (x) => x.name === name
  );
  if (!a) return c.json({ error: 'Not Found' }, 404);
  await deleteArtifact(c.env, a);
  await recordAudit(c.get('db'), {
    repositoryId: run.repositoryId,
    actorId: c.get('user')!.id,
    action: 'artifact.deleted',
    target: name,
    data: { run: run.runNumber, size: a.size },
  });
  return c.json({ ok: true as const }, 200);
});

// ── cancel / re-run ──────────────────────────────────────────────────────────

const cancelRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/actions/runs/{number}/cancel',
  tags: ['Actions'],
  request: { params: runParams },
  responses: {
    ...json200Response(z.object({ ok: z.literal(true) }), 'Cancelled'),
    ...json400Response,
    ...json403Response,
    ...json404Response,
  },
});
actionsRouter.openapi(cancelRoute, async (c) => {
  if (!can(c.get('perms'), 'runActions'))
    return c.json({ error: 'You do not have permission to cancel runs' }, 403);
  const db = c.get('db');
  const run = await getRun(c, c.req.valid('param').number);
  if (!run) return c.json({ error: 'Not Found' }, 404);
  if (run.status === 'completed' && run.conclusion !== 'cancelled')
    return c.json({ error: 'This run has already finished' }, 400);
  await stopRun(c.env, db, run.id, 'cancelled');
  return c.json({ ok: true as const }, 200);
});

const rerunRoute = createRoute({
  method: 'post',
  path: '/{owner}/{repo}/actions/runs/{number}/rerun',
  tags: ['Actions'],
  request: { params: runParams },
  responses: {
    ...json201Response(z.object({ runNumber: z.number() }), 'The new run'),
    ...json400Response,
    ...json403Response,
    ...json404Response,
  },
});
actionsRouter.openapi(rerunRoute, async (c) => {
  if (!can(c.get('perms'), 'runActions'))
    return c.json({ error: 'You do not have permission to re-run runs' }, 403);
  if (!actionsConfigured(c.env))
    return c.json({ error: 'Actions is not set up on this server' }, 400);
  const db = c.get('db');
  const run = await getRun(c, c.req.valid('param').number);
  if (!run) return c.json({ error: 'Not Found' }, 404);
  const ns = c.get('namespace');
  const id = await rerun(
    c.env,
    db,
    c.get('repo'),
    `${ns.username}/${c.get('repo').name}`,
    run,
    c.get('user')!.id
  );
  const created = await db
    .select({ runNumber: workflowRuns.runNumber })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .get();
  return c.json({ runNumber: created!.runNumber }, 201);
});

// ── commit status ────────────────────────────────────────────────────────────

/** A status a CI server reported: its context's latest. */
const reportedSchema = z.object({
  context: z.string(),
  state: z.enum(commitStatusStates),
  description: z.string().nullable(),
  targetUrl: z.string().nullable(),
  createdAt: z.string(),
});

const checksSchema = z.object({
  state: z.enum(['success', 'failure', 'pending']).nullable(),
  runs: z.array(runSchema),
  /** Statuses CI servers reported (docs/webhooks.md); they count in `state`. */
  statuses: z.array(reportedSchema),
});

const checksRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/commits/{sha}/runs',
  tags: ['Actions'],
  request: {
    params: ownerRepoParams.extend({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  },
  responses: {
    ...json200Response(
      checksSchema,
      'The latest run of each workflow for a commit, the reported statuses, and their combined state'
    ),
  },
});
actionsRouter.openapi(checksRoute, async (c) => {
  const db = c.get('db');
  const { sha } = c.req.valid('param');
  const checks = await commitChecks(db, c.get('repo').id, [sha]);
  return c.json(checks[sha], 200);
});

/** Each commit's latest run per workflow and event, and their combined state (null if none). */
async function commitChecks(
  db: DrizzleDB,
  repositoryId: string,
  shas: string[]
) {
  // Sorted here rather than in SQL: with ORDER BY run_number and several SHAs, SQLite walks
  // every run of the repository by run number instead of looking up just these commits'.
  const rows = shas.length
    ? (
        await db
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.repositoryId, repositoryId),
              inJsonArray(workflowRuns.headSha, shas)
            )
          )
          .all()
      ).sort((a, b) => b.runNumber - a.runNumber)
    : [];
  const people = await usersById(
    db,
    rows.map((r) => r.actorId ?? '')
  );
  // Statuses CI servers reported (docs/webhooks.md) count with the runs.
  const statuses = await latestStatuses(db, repositoryId, shas);
  const out: Record<
    string,
    {
      state: 'success' | 'failure' | 'pending' | null;
      runs: ReturnType<typeof serializeRun>[];
      statuses: z.infer<typeof reportedSchema>[];
    }
  > = {};
  for (const sha of shas) {
    const seen = new Set<string>();
    const latest = rows.filter((r) => {
      if (r.headSha !== sha) return false;
      const k = `${r.workflowPath}\0${r.event}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const runState = !latest.length
      ? null
      : latest.some((r) => r.status !== 'completed')
        ? 'pending'
        : latest.some(
              (r) => r.conclusion === 'failure' || r.conclusion === 'cancelled'
            )
          ? 'failure'
          : 'success';
    const reported = statuses.get(sha) ?? [];
    const states = [runState, combinedState(reported)];
    const state = states.includes('failure')
      ? 'failure'
      : states.includes('pending')
        ? 'pending'
        : states.includes('success')
          ? 'success'
          : null;
    out[sha] = {
      state,
      runs: latest.map((r) => serializeRun(r, people)),
      statuses: reported.map((s) => ({
        context: s.context,
        state: s.state,
        description: s.description,
        targetUrl: s.targetUrl,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }
  return out;
}

const batchChecksRoute = createRoute({
  method: 'get',
  path: '/{owner}/{repo}/commit-statuses',
  tags: ['Actions'],
  request: {
    params: ownerRepoParams,
    query: z.object({
      /** Comma-separated commit SHAs, up to 100. */
      shas: z
        .string()
        .transform((v) => [...new Set(v.split(',').filter(Boolean))])
        .pipe(z.array(z.string().regex(/^[0-9a-f]{40}$/)).max(100)),
    }),
  },
  responses: {
    ...json200Response(
      z.record(z.string(), checksSchema),
      'Checks for each commit, keyed by SHA (for commit and pull request lists)'
    ),
  },
});
actionsRouter.openapi(batchChecksRoute, async (c) => {
  const { shas } = c.req.valid('query');
  return c.json(await commitChecks(c.get('db'), c.get('repo').id, shas), 200);
});
