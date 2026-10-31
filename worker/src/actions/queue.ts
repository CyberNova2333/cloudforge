// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { DurableObject } from 'cloudflare:workers';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { workflowJobs, workflowRuns } from '../db/app.schema';
import { schema } from '../db/schema';
import { stopAbandonedRun } from './abandon';
import type { DrizzleDB } from '../db/middleware';

/**
 * The instance's Actions job queue: at most `actions.max_concurrent_jobs` jobs hold a slot (run a
 * container) at once; the rest wait first-in, first-out. One Durable Object for the whole
 * instance, so the limit holds exactly however many runs ask at the same time.
 */
export const QUEUE_NAME = 'instance';
/**
 * A started job's slot is reclaimed this long after its deadline (start + timeout-minutes + its
 * cache-save window); the runner's own hard stop is 10 minutes past the timeout.
 */
export const RECLAIM_MARGIN_MS = 15 * 60_000;
/** How often the queue checks its entries against D1 while it isn't empty. */
export const SWEEP_MS = 5 * 60_000;
/** How long a waiting job waits for its grant event before asking again: 5, 10, 20, then 30 minutes. */
const RECHECKS = ['5 minutes', '10 minutes', '20 minutes', '30 minutes'];
export const slotRecheck = (i: number) =>
  RECHECKS[Math.min(Math.max(i, 1), RECHECKS.length) - 1];
/** The longest recheck: a granted job whose event was lost notices within this long. */
export const MAX_RECHECK_MS = 30 * 60_000;
/** A run whose entries are all waiting, the newest for less than this, isn't checked against its Workflow. */
export const FRESH_WAIT_MS = 10 * 60_000;
/** Job ids per D1 lookup (bound-parameter limit). */
const CHUNK = 50;
const RESERVATION_CURSOR = 'reservation-recovery-cursor';
/** Extra margin after the runner's timeout + 10 minute hard-stop alarm. */
const HARD_STOP_MARGIN_MS = 5 * 60_000;

export interface SlotRequest {
  jobId: string;
  runId: string;
  /** The job's timeout-minutes plus its cache-save window: a started job holding its slot much longer is reclaimed. */
  maxMinutes: number;
  /** `actions.max_concurrent_jobs` when the job asked; the newest value wins. */
  limit: number;
  /** The job's repository, for the per-repository limit. */
  repositoryId?: string;
  /** `actions.max_concurrent_jobs_per_repo` when the job asked (null: none); the newest value wins. */
  repoLimit?: number | null;
}

export interface SlotStatus {
  granted: boolean;
  /** Jobs waiting in front of this one (0 once granted). */
  ahead: number;
}

/** A waiting job that was just given a slot; its Workflow is told with `slotEventType`. */
export interface Grant {
  jobId: string;
  runId: string;
}

/** RPC surface of the Durable Object. */
export interface ActionsQueueApi {
  acquire(req: SlotRequest): Promise<SlotStatus>;
  /** The job's container is starting: its reclaim deadline counts from now. */
  started(jobId: string, now?: number): Promise<void>;
  release(jobId: string): Promise<Grant[]>;
  cancelRun(runId: string): Promise<Grant[]>;
  positions(jobIds: string[]): Promise<Record<string, number>>;
  reclaim(now?: number): Promise<{ reclaimed: string[]; grants: Grant[] }>;
}

/** The Workflow event a waiting job listens for. */
export const slotEventType = (jobId: string) => `slot-${jobId}`;

export function queueConfigured(env: CloudflareBindings): boolean {
  return Boolean((env as Partial<CloudflareBindings>).ACTIONS_QUEUE);
}

export function actionsQueue(env: CloudflareBindings): ActionsQueueApi {
  return env.ACTIONS_QUEUE.getByName(QUEUE_NAME) as unknown as ActionsQueueApi;
}

/** Tells each granted job's Workflow to go on. Never throws: a lost event costs one recheck. */
export async function notifyGranted(
  env: CloudflareBindings,
  grants: Grant[]
): Promise<void> {
  if (!grants.length || !(env as Partial<CloudflareBindings>).ACTIONS_RUN)
    return;
  await Promise.allSettled(
    grants.map(async (g) => {
      const instance = await env.ACTIONS_RUN.get(g.runId);
      await instance.sendEvent({ type: slotEventType(g.jobId), payload: {} });
    })
  );
}

/** Gives a job's slot back and starts whoever was next. Never throws: a leak is reclaimed later. */
export async function releaseSlot(env: CloudflareBindings, jobId: string) {
  if (!queueConfigured(env)) return;
  try {
    await notifyGranted(env, await actionsQueue(env).release(jobId));
  } catch (e) {
    console.warn('[actions] could not release slot', jobId, e);
  }
}

/**
 * Marks a granted job as started (its container is about to boot). Throws, so a Workflow step
 * around it can retry; the caller decides what a final failure means.
 */
export async function markStarted(env: CloudflareBindings, jobId: string) {
  if (!queueConfigured(env)) return;
  await actionsQueue(env).started(jobId);
}

/** Takes a finished (cancelled or abandoned) run's jobs out of the queue. Never throws. */
export async function dropRun(env: CloudflareBindings, runId: string) {
  if (!queueConfigured(env)) return;
  try {
    await notifyGranted(env, await actionsQueue(env).cancelRun(runId));
  } catch (e) {
    console.warn('[actions] could not drop run from the queue', runId, e);
  }
}

/** Jobs ahead of each waiting job, for the run page. Never throws. */
export async function queuePositions(
  env: CloudflareBindings,
  jobIds: string[]
): Promise<Record<string, number>> {
  if (!jobIds.length || !queueConfigured(env)) return {};
  try {
    return await actionsQueue(env).positions(jobIds);
  } catch (e) {
    console.warn('[actions] could not read queue positions', e);
    return {};
  }
}

type Entry = {
  seq: number;
  job_id: string;
  run_id: string;
  max_ms: number;
  granted_at: number | null;
  started_at: number | null;
  queued_at: number;
};

export class ActionsQueue
  extends DurableObject<CloudflareBindings>
  implements ActionsQueueApi
{
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // seq is the arrival order; granted_at is null while the job waits; started_at is set when
    // its container starts booting.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS entries (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL,
      max_ms INTEGER NOT NULL,
      granted_at INTEGER,
      started_at INTEGER,
      queued_at INTEGER NOT NULL DEFAULT 0
    )`);
    this.sql.exec(
      'CREATE INDEX IF NOT EXISTS entries_run_idx ON entries (run_id)'
    );
    // Added with the per-repository limit; entries from before have none and count for no repository.
    const columns = this.sql
      .exec<{ name: string }>('PRAGMA table_info(entries)')
      .toArray()
      .map((c) => c.name);
    if (!columns.includes('repo_id'))
      this.sql.exec('ALTER TABLE entries ADD COLUMN repo_id TEXT');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)'
    );
  }

  private limit(): number {
    const row = this.sql
      .exec<{ value: number }>("SELECT value FROM meta WHERE key = 'limit'")
      .toArray()[0];
    return row?.value ?? 10;
  }

  /** Slots one repository's jobs may hold at once; 0 when only the instance's limit applies. */
  private repoLimit(): number {
    const row = this.sql
      .exec<{
        value: number;
      }>("SELECT value FROM meta WHERE key = 'repo_limit'")
      .toArray()[0];
    return row?.value ?? 0;
  }

  private statusOf(jobId: string): SlotStatus | null {
    const row = this.sql
      .exec<{
        seq: number;
        granted_at: number | null;
      }>('SELECT seq, granted_at FROM entries WHERE job_id = ?', jobId)
      .toArray()[0];
    if (!row) return null;
    if (row.granted_at !== null) return { granted: true, ahead: 0 };
    const { n } = this.sql
      .exec<{
        n: number;
      }>(
        'SELECT COUNT(*) AS n FROM entries WHERE granted_at IS NULL AND seq < ?',
        row.seq
      )
      .one();
    return { granted: false, ahead: n };
  }

  /** Gives free slots to the longest-waiting jobs. Synchronous, so no other call interleaves. */
  private pump(now = Date.now()): Grant[] {
    const { n } = this.sql
      .exec<{
        n: number;
      }>('SELECT COUNT(*) AS n FROM entries WHERE granted_at IS NOT NULL')
      .one();
    const free = this.limit() - n;
    if (free <= 0) return [];
    const perRepo = this.repoLimit();
    let next: { job_id: string; run_id: string }[];
    if (!perRepo)
      next = this.sql
        .exec<{
          job_id: string;
          run_id: string;
        }>(
          'SELECT job_id, run_id FROM entries WHERE granted_at IS NULL ORDER BY seq LIMIT ?',
          free
        )
        .toArray();
    else {
      // The longest-waiting jobs whose repository holds fewer than its share: one busy repository can't take every
      // slot while others wait.
      const held = new Map(
        this.sql
          .exec<{
            repo_id: string | null;
            n: number;
          }>(
            'SELECT repo_id, COUNT(*) AS n FROM entries WHERE granted_at IS NOT NULL GROUP BY repo_id'
          )
          .toArray()
          .map((r) => [r.repo_id, r.n])
      );
      next = [];
      for (const e of this.sql
        .exec<{
          job_id: string;
          run_id: string;
          repo_id: string | null;
        }>(
          'SELECT job_id, run_id, repo_id FROM entries WHERE granted_at IS NULL ORDER BY seq'
        )
        .toArray()) {
        if (next.length >= free) break;
        const holds = held.get(e.repo_id) ?? 0;
        if (e.repo_id !== null && holds >= perRepo) continue;
        held.set(e.repo_id, holds + 1);
        next.push(e);
      }
    }
    for (const e of next)
      this.sql.exec(
        'UPDATE entries SET granted_at = ? WHERE job_id = ?',
        now,
        e.job_id
      );
    return next.map((e) => ({ jobId: e.job_id, runId: e.run_id }));
  }

  /** An alarm sweeps for leaked slots while anything is queued or running. */
  private async keepSweeping() {
    const { n } = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM entries')
      .one();
    const reserved =
      !n &&
      (await this.env.DB.prepare(
        "SELECT 1 FROM workflow_jobs WHERE status = 'in_progress' LIMIT 1"
      ).first());
    if (!n && !reserved) await this.ctx.storage.deleteAlarm();
    else if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  async acquire(req: SlotRequest): Promise<SlotStatus> {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('limit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      Math.max(1, Math.floor(req.limit))
    );
    if (req.repoLimit !== undefined)
      this.sql.exec(
        "INSERT INTO meta (key, value) VALUES ('repo_limit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        req.repoLimit === null ? 0 : Math.max(1, Math.floor(req.repoLimit))
      );
    // Asking again (a replayed Workflow step) keeps the job's place.
    if (!this.statusOf(req.jobId))
      this.sql.exec(
        'INSERT INTO entries (job_id, run_id, max_ms, queued_at, repo_id) VALUES (?, ?, ?, ?, ?)',
        req.jobId,
        req.runId,
        Math.round(req.maxMinutes * 60_000),
        Date.now(),
        req.repositoryId ?? null
      );
    // A raised limit can start others too; they hear about it by event.
    const others = this.pump().filter((g) => g.jobId !== req.jobId);
    const status = this.statusOf(req.jobId)!;
    await this.keepSweeping();
    await notifyGranted(this.env, others);
    return status;
  }

  async started(jobId: string, now = Date.now()): Promise<void> {
    this.sql.exec(
      'UPDATE entries SET started_at = ? WHERE job_id = ? AND granted_at IS NOT NULL',
      now,
      jobId
    );
  }

  async release(jobId: string): Promise<Grant[]> {
    this.sql.exec('DELETE FROM entries WHERE job_id = ?', jobId);
    const grants = this.pump();
    await this.keepSweeping();
    return grants;
  }

  async cancelRun(runId: string): Promise<Grant[]> {
    this.sql.exec('DELETE FROM entries WHERE run_id = ?', runId);
    const grants = this.pump();
    await this.keepSweeping();
    return grants;
  }

  async positions(jobIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of jobIds) {
      const s = this.statusOf(id);
      if (s && !s.granted) out[id] = s.ahead;
    }
    return out;
  }

  /** HTTP cancellation and queue recovery use the same confirmed-stop boundary. */
  private async stopAbandonedRun(
    db: DrizzleDB,
    runId: string,
    conclusion: 'failure' | 'cancelled'
  ): Promise<boolean> {
    const stopped = await stopAbandonedRun(this.env, db, runId, conclusion);
    if (stopped) await this.ctx.storage.delete(`stop-run:${runId}`);
    return stopped;
  }

  /**
   * Frees slots a crash leaked: entries whose job row is gone (its repository was deleted) or
   * already finished; entries of runs that are finished in D1, or whose Workflow errored, was
   * terminated, or completed; and slots held past their deadline plus RECLAIM_MARGIN_MS. Reserved
   * jobs are released only after their Workflow and containers stop; failures retain capacity.
   * D1 reservations with no queue entry are swept too. A started job's deadline is
   * its start plus timeout-minutes and cache-save window; a granted job that hasn't started yet
   * gets the longest recheck to notice its grant.
   */
  async reclaim(
    now = Date.now()
  ): Promise<{ reclaimed: string[]; grants: Grant[] }> {
    const entries = this.sql
      .exec<Entry>(
        'SELECT seq, job_id, run_id, max_ms, granted_at, started_at, queued_at FROM entries ORDER BY seq'
      )
      .toArray();
    const expired = new Set<string>();
    for (const e of entries) {
      if (e.granted_at === null) continue;
      const deadline =
        e.started_at !== null
          ? e.started_at + e.max_ms
          : e.granted_at + MAX_RECHECK_MS;
      if (now > deadline + RECLAIM_MARGIN_MS) expired.add(e.job_id);
    }
    const ids = entries.map((e) => e.job_id);
    const open = new Set<string>();
    const running = new Set<string>();
    const deadlines = new Map<string, number>();
    const db = drizzle(this.env.DB, { schema });
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await db
        .select({
          id: workflowJobs.id,
          status: workflowJobs.status,
          deadline: sql<
            number | null
          >`(SELECT max(deadline_at) FROM runner_sessions WHERE job_id = workflow_jobs.id)`,
        })
        .from(workflowJobs)
        .where(inArray(workflowJobs.id, ids.slice(i, i + CHUNK)))
        .all();
      for (const r of rows) {
        if (r.status !== 'completed') open.add(r.id);
        if (r.status === 'in_progress') running.add(r.id);
        if (r.deadline !== null) deadlines.set(r.id, r.deadline);
      }
    }
    const reclaimed = new Set<string>();
    for (const id of ids) if (!open.has(id)) reclaimed.add(id);

    // Fallback can reserve D1 without ever creating a DO entry. Sweep a bounded durable page too.
    const cursor =
      (await this.ctx.storage.get<string>(RESERVATION_CURSOR)) ?? '';
    const reservations = await db
      .select({
        id: workflowJobs.id,
        runId: workflowJobs.runId,
        deadline: sql<
          number | null
        >`(SELECT max(deadline_at) FROM runner_sessions WHERE job_id = workflow_jobs.id)`,
      })
      .from(workflowJobs)
      .where(
        and(eq(workflowJobs.status, 'in_progress'), gt(workflowJobs.id, cursor))
      )
      .orderBy(asc(workflowJobs.id))
      .limit(CHUNK + 1)
      .all();
    const page = reservations.slice(0, CHUNK);
    const timedOutRuns = new Set<string>();
    for (const r of page)
      if (r.deadline !== null && now > r.deadline + HARD_STOP_MARGIN_MS)
        timedOutRuns.add(r.runId);
    for (const e of entries) {
      if (!expired.has(e.job_id) || reclaimed.has(e.job_id)) continue;
      if (!running.has(e.job_id)) {
        // An unstarted stale grant holds no D1 capacity and can simply be offered again.
        reclaimed.add(e.job_id);
      } else if (now > (deadlines.get(e.job_id) ?? 0) + HARD_STOP_MARGIN_MS) {
        timedOutRuns.add(e.run_id);
      }
    }
    // Include expired holders: excluding them here would bypass Workflow termination and D1 cleanup.
    const runIds = [
      ...new Set([
        ...entries.filter((e) => !reclaimed.has(e.job_id)).map((e) => e.run_id),
        ...page.map((r) => r.runId),
      ]),
    ];
    const terminal = new Map<string, 'failure' | 'cancelled'>();
    for (let i = 0; i < runIds.length; i += CHUNK) {
      const rows = await db
        .select({
          id: workflowRuns.id,
          status: workflowRuns.status,
          conclusion: workflowRuns.conclusion,
        })
        .from(workflowRuns)
        .where(inArray(workflowRuns.id, runIds.slice(i, i + CHUNK)))
        .all();
      for (const r of rows)
        if (r.status === 'completed')
          terminal.set(
            r.id,
            r.conclusion === 'cancelled' ? 'cancelled' : 'failure'
          );
    }
    // Only runs holding a slot, or waiting a while, are worth a Workflow status call: a fresh
    // waiter's Workflow is plainly alive (it just asked).
    const worthChecking = new Set(
      entries
        .filter(
          (e) =>
            !reclaimed.has(e.job_id) &&
            (e.granted_at !== null || now - e.queued_at > FRESH_WAIT_MS)
        )
        .map((e) => e.run_id)
        .concat(page.map((r) => r.runId))
    );
    const finished = new Set<string>();
    if ((this.env as Partial<CloudflareBindings>).ACTIONS_RUN)
      for (const runId of runIds) {
        if (!terminal.has(runId) && !worthChecking.has(runId)) continue;
        try {
          const { status } = await (
            await this.env.ACTIONS_RUN.get(runId)
          ).status();
          if (
            terminal.has(runId) ||
            timedOutRuns.has(runId) ||
            status === 'errored' ||
            status === 'terminated' ||
            status === 'complete'
          ) {
            const conclusion =
              terminal.get(runId) ??
              (status === 'terminated' ? 'cancelled' : 'failure');
            if (await this.stopAbandonedRun(db, runId, conclusion))
              finished.add(runId);
          }
        } catch {
          // Unknown instance or a transient error: the D1 checks above still apply.
        }
      }
    for (const e of entries)
      if (finished.has(e.run_id)) reclaimed.add(e.job_id);

    for (const id of reclaimed)
      this.sql.exec('DELETE FROM entries WHERE job_id = ?', id);
    await this.ctx.storage.put(
      RESERVATION_CURSOR,
      reservations.length > CHUNK ? page.at(-1)!.id : ''
    );
    const grants = this.pump(now);
    await this.keepSweeping();
    await notifyGranted(this.env, grants);
    if (reclaimed.size)
      console.warn('[actions] reclaimed queue slots', [...reclaimed]);
    return { reclaimed: [...reclaimed], grants };
  }

  async alarm() {
    await this.reclaim();
  }
}
