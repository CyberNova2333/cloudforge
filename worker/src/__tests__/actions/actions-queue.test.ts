// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import {
  FRESH_WAIT_MS,
  MAX_RECHECK_MS,
  RECLAIM_MARGIN_MS,
  slotRecheck,
  type ActionsQueue,
  type ActionsQueueApi,
  type SlotRequest,
} from '../../actions/queue';
import { actionsQueue } from '../../actions/queue';
import { bootstrapAdmin, call, makeEnv, settle } from '../helpers/app';
import { commitPaths } from '../helpers/seed';
import {
  CI,
  harness,
  pushFiles,
  runDetail,
  runs,
  setup,
  type Setup,
} from '../helpers/actions';

/** A queue of its own: tests share storage, so each one names a fresh instance. */
const fresh = (): ActionsQueueApi => {
  const stub = env.ACTIONS_QUEUE.getByName(`unit-${crypto.randomUUID()}`);
  const q = stub as unknown as ActionsQueueApi;
  return {
    acquire: (request) => q.acquire(request),
    started: (id, now) => q.started(id, now),
    release: (id) => q.release(id),
    cancelRun: (id) => q.cancelRun(id),
    positions: (ids) => q.positions(ids),
    reclaim: (now) =>
      runInDurableObject(stub, async (obj) => {
        // Unit fixtures have real D1/queue storage but no real Workflow or containers.
        (obj as unknown as { env: CloudflareBindings }).env = {
          ...env,
          ACTIONS_RUN: {
            get: async () => ({
              status: async () => ({ status: 'running' }),
              terminate: async () => {},
              sendEvent: async () => {},
            }),
          },
          JOB_RUNNER: { getByName: () => ({ destroy: async () => {} }) },
        } as unknown as CloudflareBindings;
        return (obj as unknown as ActionsQueue).reclaim(now);
      }),
  };
};
const ask = (
  jobId: string,
  limit: number,
  extra: Partial<SlotRequest> = {}
): SlotRequest => ({ jobId, runId: 'run-1', maxMinutes: 30, limit, ...extra });

describe('ActionsQueue 作业队列', () => {
  it('即使多个作业同时申请，也不超出并发上限', async () => {
    const q = fresh();
    const all = await Promise.all(
      Array.from({ length: 25 }, (_, i) => q.acquire(ask(`job-${i}`, 3)))
    );
    expect(all.filter((s) => s.granted)).toHaveLength(3);
    expect(
      all
        .filter((s) => !s.granted)
        .map((s) => s.ahead)
        .sort((a, b) => a - b)
    ).toEqual(Array.from({ length: 22 }, (_, i) => i));
  });

  it('设置了每仓库上限时，一个仓库占满份额后先分配给其他仓库', async () => {
    const q = fresh();
    const repo = (jobId: string, repositoryId: string) =>
      ask(jobId, 3, { repositoryId, repoLimit: 1 });
    expect((await q.acquire(repo('a1', 'A'))).granted).toBe(true);
    expect((await q.acquire(repo('a2', 'A'))).granted).toBe(false);
    // Arrived after a2, but its repository holds nothing yet.
    expect((await q.acquire(repo('b1', 'B'))).granted).toBe(true);
    expect(await q.positions(['a2'])).toEqual({ a2: 0 });
    const grants = await q.release('a1');
    expect(grants.map((g) => g.jobId)).toEqual(['a2']);
    // Cleared (null): only the instance's limit applies again.
    expect(
      (await q.acquire(ask('a3', 3, { repositoryId: 'A', repoLimit: null })))
        .granted
    ).toBe(true);
  });

  it('空位释放后按到达顺序分配', async () => {
    const q = fresh();
    expect(await q.acquire(ask('a', 1))).toEqual({ granted: true, ahead: 0 });
    expect(await q.acquire(ask('b', 1))).toEqual({ granted: false, ahead: 0 });
    expect(await q.acquire(ask('c', 1, { runId: 'run-2' }))).toEqual({
      granted: false,
      ahead: 1,
    });
    expect(await q.positions(['a', 'b', 'c', 'nope'])).toEqual({ b: 0, c: 1 });
    expect(await q.release('a')).toEqual([{ jobId: 'b', runId: 'run-1' }]);
    expect(await q.release('b')).toEqual([{ jobId: 'c', runId: 'run-2' }]);
    expect(await q.release('c')).toEqual([]);
  });

  it('重复申请保持幂等，释放未知作业不产生影响', async () => {
    const q = fresh();
    await q.acquire(ask('a', 1));
    expect(await q.acquire(ask('a', 1))).toEqual({ granted: true, ahead: 0 });
    expect(await q.acquire(ask('b', 1))).toEqual({ granted: false, ahead: 0 });
    expect(await q.acquire(ask('b', 1))).toEqual({ granted: false, ahead: 0 });
    expect(await q.release('ghost')).toEqual([]);
    expect(await q.positions(['b'])).toEqual({ b: 0 });
  });

  it('释放等待中的作业时将其移出队列', async () => {
    const q = fresh();
    await q.acquire(ask('a', 1));
    await q.acquire(ask('b', 1));
    await q.acquire(ask('c', 1));
    expect(await q.release('b')).toEqual([]);
    expect(await q.positions(['c'])).toEqual({ c: 0 });
  });

  it('取消运行时移除其所有等待或运行中的作业，并为下一次运行分配空位', async () => {
    const q = fresh();
    await q.acquire(ask('a1', 2));
    await q.acquire(ask('a2', 2));
    await q.acquire(ask('a3', 2));
    await q.acquire(ask('b1', 2, { runId: 'run-2' }));
    expect(await q.cancelRun('run-1')).toEqual([
      { jobId: 'b1', runId: 'run-2' },
    ]);
    expect(await q.positions(['a3'])).toEqual({});
    expect(await q.acquire(ask('c1', 2, { runId: 'run-3' }))).toEqual({
      granted: true,
      ahead: 0,
    });
  });

  it('提高上限后在下一次请求时分配空位；降低上限仅阻止新增分配', async () => {
    const q = fresh();
    await q.acquire(ask('a', 2));
    await q.acquire(ask('b', 2));
    expect(await q.acquire(ask('c', 2))).toEqual({ granted: false, ahead: 0 });
    // The limit came from Site admin when the job asked; a later job brings the new value.
    expect(await q.acquire(ask('d', 3))).toEqual({ granted: false, ahead: 0 });
    expect(await q.acquire(ask('c', 3))).toEqual({ granted: true, ahead: 0 });
    // Lowered to 1: the three running keep going, nothing new starts until fewer than 1 run.
    expect(await q.acquire(ask('e', 1))).toEqual({ granted: false, ahead: 1 });
    expect(await q.release('a')).toEqual([]);
    expect(await q.release('b')).toEqual([]);
    expect(await q.release('c')).toEqual([{ jobId: 'd', runId: 'run-1' }]);
  });

  it('回收已消失或已结束作业占用的空位，以及超时占用的空位', async () => {
    // Real job rows: one workflow with three jobs.
    const t = makeEnv({ actions: true });
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'app', addReadme: true, visibility: 'internal' },
    });
    const repo = [...t.fake.repos.values()][0];
    const repoId = (await t.env.DB.prepare(
      "SELECT id FROM repositories WHERE name = 'app'"
    ).first<{ id: string }>())!.id;
    const runId = crypto.randomUUID();
    const sha = await commitPaths(repo, 'main', { 'a.txt': 'a' }, 'One');
    await t.env.DB.prepare(
      `INSERT INTO workflow_runs (id, repository_id, run_number, workflow_path, name, event, ref, head_sha, display_title, status, created_at)
       VALUES (?, ?, 1, '.github/workflows/ci.yml', 'CI', 'push', 'refs/heads/main', ?, 'One', 'in_progress', ?)`
    )
      .bind(runId, repoId, sha, Math.floor(Date.now() / 1000))
      .run();
    for (const [id, status] of [
      ['job-a', 'in_progress'],
      ['job-b', 'completed'],
      ['job-c', 'queued'],
    ])
      await t.env.DB.prepare(
        `INSERT INTO workflow_jobs (id, run_id, job_key, name, runs_on, needs, status)
         VALUES (?, ?, ?, ?, 'ubuntu-latest', '[]', ?)`
      )
        .bind(id, runId, id, id, status)
        .run();

    const q = fresh();
    await q.acquire(ask('job-a', 3, { runId, maxMinutes: 30 }));
    await q.acquire(ask('job-b', 3, { runId }));
    await q.acquire(ask('ghost', 3, { runId: 'deleted-run' }));
    await q.acquire(ask('job-c', 3, { runId, maxMinutes: 120 }));
    const t0 = Date.now();
    await q.started('job-a', t0);

    const first = await q.reclaim(t0);
    expect(first.reclaimed.sort()).toEqual(['ghost', 'job-b']);
    expect(first.grants).toEqual([{ jobId: 'job-c', runId }]);
    await q.started('job-c', t0);

    // job-a ran 30 minutes plus the margin; job-c (120 minutes) is still within its timeout.
    const later = await q.reclaim(
      t0 + 30 * 60_000 + RECLAIM_MARGIN_MS + 60_000
    );
    // A timed-out executor is fenced as a whole before its slots can be reused.
    expect(later.reclaimed.sort()).toEqual(['job-a', 'job-c']);
    expect(await q.acquire(ask('next-run', 3, { runId: 'next-run' }))).toEqual({
      granted: true,
      ahead: 0,
    });
  });
});

/** A repository ("app") to seed workflow runs into; `seed` adds one run with the given jobs. */
async function runSeeder() {
  const t = makeEnv({ actions: true });
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', addReadme: true, visibility: 'internal' },
  });
  const repo = [...t.fake.repos.values()][0];
  const repoId = (await t.env.DB.prepare(
    "SELECT id FROM repositories WHERE name = 'app'"
  ).first<{ id: string }>())!.id;
  const sha = await commitPaths(repo, 'main', { 'a.txt': 'a' }, 'One');
  let n = 0;
  return async (
    jobs: [string, string][],
    runStatus = 'in_progress'
  ): Promise<string> => {
    const runId = crypto.randomUUID();
    await t.env.DB.prepare(
      `INSERT INTO workflow_runs (id, repository_id, run_number, workflow_path, name, event, ref, head_sha, display_title, status, created_at)
       VALUES (?, ?, ?, '.github/workflows/ci.yml', 'CI', 'push', 'refs/heads/main', ?, 'One', ?, ?)`
    )
      .bind(runId, repoId, ++n, sha, runStatus, Math.floor(Date.now() / 1000))
      .run();
    for (const [id, status] of jobs)
      await t.env.DB.prepare(
        `INSERT INTO workflow_jobs (id, run_id, job_key, name, runs_on, needs, status)
         VALUES (?, ?, ?, ?, 'ubuntu-latest', '[]', ?)`
      )
        .bind(id, runId, id, id, status)
        .run();
    return runId;
  };
}
const seedRun = async (jobs: [string, string][], runStatus?: string) =>
  (await runSeeder())(jobs, runStatus);

describe('ActionsQueue 空位回收', () => {
  it('停止超过一页的作业会持久推进，后页失败保留容量并在恢复后收尾', async () => {
    const seed = await runSeeder();
    const runId = await seed([]);
    const nextRunId = await seed([['next', 'queued']]);
    const ids = Array.from(
      { length: 53 },
      (_, i) => `stop-page-${String(i).padStart(3, '0')}`
    );
    await env.DB.prepare(
      "INSERT INTO workflow_jobs (id,run_id,job_key,name,runs_on,needs,status) SELECT value,?,value,value,'ubuntu-latest','[]','in_progress' FROM json_each(?)"
    )
      .bind(runId, JSON.stringify(ids))
      .run();
    const stopped: string[] = [];
    let fails = true;
    const stub = env.ACTIONS_QUEUE.getByName(`unit-${crypto.randomUUID()}`);
    await runInDurableObject(stub, async (obj) => {
      (obj as unknown as { env: CloudflareBindings }).env = {
        ...env,
        ACTIONS_RUN: {
          get: async () => ({
            status: async () => ({ status: 'terminated' }),
            sendEvent: async () => {},
          }),
        },
        JOB_RUNNER: {
          getByName: (id: string) => ({
            destroy: async () => {
              if (fails && id === ids[50])
                throw new Error('later page stop unavailable');
              stopped.push(id);
            },
          }),
        },
      } as unknown as CloudflareBindings;
    });
    const q = stub as unknown as ActionsQueueApi;
    await q.acquire(ask(ids[52], 1, { runId }));
    await q.acquire(ask('next', 1, { runId: nextRunId }));
    await env.DB.prepare(
      "UPDATE workflow_runs SET status='completed',conclusion='cancelled' WHERE id=?"
    )
      .bind(runId)
      .run();
    expect((await q.reclaim()).reclaimed).toEqual([]);
    expect(stopped).toEqual(ids.slice(0, 50));
    const remaining = () =>
      env.DB.prepare(
        "SELECT count(*) AS n FROM workflow_jobs WHERE run_id=? AND status='in_progress'"
      )
        .bind(runId)
        .first('n');
    expect(await remaining()).toBe(3);
    expect((await q.reclaim()).reclaimed).toEqual([]);
    expect(stopped).toHaveLength(50);
    expect(await remaining()).toBe(3);
    expect(
      await runInDurableObject(stub, async (_obj, state) =>
        state.storage.getAlarm()
      )
    ).not.toBeNull();
    expect(
      (await q.acquire(ask('next', 1, { runId: nextRunId }))).granted
    ).toBe(false);
    fails = false;
    expect((await q.reclaim()).reclaimed).toContain(ids[52]);
    expect(stopped).toEqual(ids);
    expect(await remaining()).toBe(0);
    expect(
      (await q.acquire(ask('next', 1, { runId: nextRunId }))).granted
    ).toBe(true);
  });

  it('在 5、10、20 分钟后重新检查，之后每 30 分钟检查一次', () => {
    expect([1, 2, 3, 4, 5, 50].map(slotRecheck)).toEqual([
      '5 minutes',
      '10 minutes',
      '20 minutes',
      '30 minutes',
      '30 minutes',
      '30 minutes',
    ]);
  });

  it('从作业启动时而非空位分配时计算占用截止时间', async () => {
    const id = `late-${crypto.randomUUID()}`;
    const runId = await seedRun([[id, 'in_progress']]);
    const q = fresh();
    await q.acquire(ask(id, 1, { runId, maxMinutes: 30 }));
    const t0 = Date.now();
    // The grant was noticed late (a lost event and a recheck): the container started 20 minutes on.
    await q.started(id, t0 + 20 * 60_000);
    const oldDeadline = t0 + 30 * 60_000 + RECLAIM_MARGIN_MS + 60_000;
    expect((await q.reclaim(oldDeadline)).reclaimed).toEqual([]);
    expect((await q.reclaim(oldDeadline + 20 * 60_000)).reclaimed).toEqual([
      id,
    ]);
  });

  it('队列期限已过但新 runner 的硬停期限未到时保留预留', async () => {
    const id = `new-boot-${crypto.randomUUID()}`;
    const runId = await seedRun([[id, 'in_progress']]);
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO runner_sessions (id, job_id, instance_type, started_at, deadline_at) VALUES (?, ?, 'standard-2', ?, ?)"
    )
      .bind(`${id}:1`, id, now, now + 10 * 60_000)
      .run();
    const q = fresh();
    await q.acquire(ask(id, 1, { runId, maxMinutes: 1 }));
    await q.started(id, now - RECLAIM_MARGIN_MS - 2 * 60_000);
    expect((await q.reclaim(now)).reclaimed).toEqual([]);
    expect(
      await env.DB.prepare('SELECT status FROM workflow_jobs WHERE id = ?')
        .bind(id)
        .first('status')
    ).toBe('in_progress');
    expect((await q.reclaim(now + 16 * 60_000)).reclaimed).toEqual([id]);
  });

  it('为已分配空位但尚未启动的作业保留最长复查间隔以接收通知', async () => {
    const id = `granted-${crypto.randomUUID()}`;
    const runId = await seedRun([[id, 'queued']]);
    const q = fresh();
    await q.acquire(ask(id, 1, { runId, maxMinutes: 5 }));
    const t0 = Date.now();
    // Its own timeout (5 minutes) plus the margin has passed, but it may still be waiting to recheck.
    expect(
      (await q.reclaim(t0 + MAX_RECHECK_MS + RECLAIM_MARGIN_MS - 60_000))
        .reclaimed
    ).toEqual([]);
    expect(
      (await q.reclaim(t0 + MAX_RECHECK_MS + RECLAIM_MARGIN_MS + 60_000))
        .reclaimed
    ).toEqual([id]);
  });

  it('回收 D1 中已结束运行占用的空位', async () => {
    const id = `done-${crypto.randomUUID()}`;
    // The run was finished (cancelled or reconciled) but its job row was left open.
    const runId = await seedRun([[id, 'in_progress']], 'completed');
    const q = fresh();
    await q.acquire(ask(id, 1, { runId }));
    expect((await q.reclaim()).reclaimed).toEqual([id]);
  });

  it('回收 Workflow 出错或被终止的运行所占空位，并结束运行', async () => {
    const crashed = `crashed-${crypto.randomUUID()}`;
    const crashedWaiting = `crashed-w-${crypto.randomUUID()}`;
    const killed = `killed-${crypto.randomUUID()}`;
    const alive = `alive-${crypto.randomUUID()}`;
    const seed = await runSeeder();
    const crashedRun = await seed([
      [crashed, 'in_progress'],
      [crashedWaiting, 'queued'],
    ]);
    const killedRun = await seed([[killed, 'in_progress']]);
    const aliveRun = await seed([[alive, 'queued']]);
    const statuses: Record<string, string> = {
      [crashedRun]: 'errored',
      [killedRun]: 'terminated',
      [aliveRun]: 'running',
    };
    const stub = env.ACTIONS_QUEUE.getByName(`unit-${crypto.randomUUID()}`);
    const result = await runInDurableObject(stub, async (obj) => {
      const instance = obj as unknown as ActionsQueue;
      // The test config has no Workflow binding: give the object a fake one.
      (instance as unknown as { env: CloudflareBindings }).env = {
        ...env,
        ACTIONS_RUN: {
          get: async (id: string) => ({
            status: async () => ({ status: statuses[id] ?? 'unknown' }),
            sendEvent: async () => {},
          }),
        },
        JOB_RUNNER: { getByName: () => ({ destroy: async () => {} }) },
      } as unknown as CloudflareBindings;
      await instance.acquire(ask(crashed, 2, { runId: crashedRun }));
      await instance.acquire(ask(killed, 2, { runId: killedRun }));
      await instance.acquire(ask(crashedWaiting, 2, { runId: crashedRun }));
      await instance.acquire(ask(alive, 2, { runId: aliveRun }));
      return instance.reclaim();
    });
    expect(result.reclaimed.sort()).toEqual(
      [crashed, crashedWaiting, killed].sort()
    );
    expect(result.grants).toEqual([{ jobId: alive, runId: aliveRun }]);
    const run = (id: string) =>
      env.DB.prepare(
        'SELECT status, conclusion FROM workflow_runs WHERE id = ?'
      )
        .bind(id)
        .first<{ status: string; conclusion: string }>();
    expect(await run(crashedRun)).toEqual({
      status: 'completed',
      conclusion: 'failure',
    });
    expect(await run(killedRun)).toEqual({
      status: 'completed',
      conclusion: 'cancelled',
    });
    expect(await run(aliveRun)).toMatchObject({ status: 'in_progress' });
  });
  it('仅查询占用空位或等待超过 10 分钟的运行对应的 Workflow', async () => {
    const seed = await runSeeder();
    const holder = `holder-${crypto.randomUUID()}`;
    const waiter = `waiter-${crypto.randomUUID()}`;
    const holderRun = await seed([[holder, 'in_progress']]);
    const waiterRun = await seed([[waiter, 'queued']]);
    const asked: string[] = [];
    const stub = env.ACTIONS_QUEUE.getByName(`unit-${crypto.randomUUID()}`);
    const [fresh10, stale] = await runInDurableObject(stub, async (obj) => {
      const instance = obj as unknown as ActionsQueue;
      (instance as unknown as { env: CloudflareBindings }).env = {
        ...env,
        ACTIONS_RUN: {
          get: async (id: string) => ({
            status: async () => {
              asked.push(id);
              return { status: 'running' };
            },
            sendEvent: async () => {},
          }),
        },
      } as unknown as CloudflareBindings;
      await instance.acquire(ask(holder, 1, { runId: holderRun }));
      await instance.acquire(ask(waiter, 1, { runId: waiterRun }));
      const t0 = Date.now();
      await instance.reclaim(t0);
      const first = [...asked];
      asked.length = 0;
      await instance.reclaim(t0 + FRESH_WAIT_MS + 60_000);
      return [first, [...asked]];
    });
    expect(fresh10).toEqual([holderRun]);
    expect(stale.sort()).toEqual([holderRun, waiterRun].sort());
  });
});

const MATRIX = `on: push
jobs:
  work:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        n: [1, 2, 3, 4, 5]
    steps:
      - run: work-\${{ matrix.n }}
`;

const setLimit = async (s: Setup, n: number) =>
  expect(
    (
      await call(s.t, '/api/admin/settings/actions.max_concurrent_jobs', {
        cookie: s.admin,
        method: 'PUT',
        json: { value: n },
      })
    ).status
  ).toBe(200);

/** A slot is free right now (every job gave its slot back). */
const queueIsEmpty = async (s: Setup) =>
  expect(
    await actionsQueue(s.t.env).acquire({
      jobId: `probe-${crypto.randomUUID()}`,
      runId: 'probe',
      maxMinutes: 1,
      limit: 1,
    })
  ).toEqual({ granted: true, ahead: 0 });

const slow = async () => {
  await new Promise((r) => setTimeout(r, 20));
  return {};
};

describe('Actions 作业等待空位', () => {
  it('同时运行的作业不超出上限，空位释放后启动等待中的作业', async () => {
    const s = await setup();
    await setLimit(s, 2);
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': MATRIX });
    const [queued] = (await runs(s.t, s.admin)).runs;
    // Its own event log: the queue reaches the Workflow of this run lazily, and a grant meant for
    // another test's run must not be read here as this one's.
    const h = harness(s.t, slow, { events: [] });
    expect(await h.run(queued.id)).toBe('success');
    expect(h.boots).toHaveLength(5);
    expect(h.peak()).toBe(2);
    expect(
      h.stepNames.filter((n) => n.includes(':queue:wait:')).length
    ).toBeGreaterThanOrEqual(3);
    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(jobs.every((j) => j.conclusion === 'success')).toBe(true);
    await queueIsEmpty(s);
  });

  it('即使所有分配事件丢失，也会启动等待中的作业', async () => {
    const s = await setup();
    await setLimit(s, 1);
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': MATRIX });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, slow, { loseEvents: true, events: [] });
    expect(await h.run(queued.id)).toBe('success');
    expect(h.boots).toHaveLength(5);
    expect(h.peak()).toBe(1);
  });

  it('作业失败时归还空位', async () => {
    const s = await setup();
    await setLimit(s, 1);
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({ exitCode: 1 }));
    expect(await h.run(queued.id)).toBe('failure');
    await queueIsEmpty(s);
  });

  it('运行器中断时归还空位，并在重启时重新排队', async () => {
    const s = await setup();
    await setLimit(s, 1);
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    let interrupted = false;
    const h = harness(s.t, (r) => {
      if (r.argv[r.argv.length - 1] === 'pnpm test' && !interrupted) {
        interrupted = true;
        throw new Error('Durable Object reset because its code was updated.');
      }
      return {};
    });
    expect(await h.run(queued.id)).toBe('success');
    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(h.stepNames).toContain(`job:${jobs[0].id}:queue`);
    expect(h.stepNames).toContain(`job:${jobs[0].id}:attempt:2:queue`);
    await queueIsEmpty(s);
  });

  it('缺少队列绑定时不限制并发作业数量', async () => {
    const s = await setup();
    await setLimit(s, 1);
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': MATRIX });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const t = {
      ...s.t,
      env: { ...s.t.env, ACTIONS_QUEUE: undefined },
    } as unknown as typeof s.t;
    const h = harness(t, slow);
    expect(await h.run(queued.id)).toBe('success');
    expect(h.peak()).toBe(5);
    expect(h.stepNames.some((n) => n.endsWith(':queue'))).toBe(false);
  });
});

describe('运行页面和取消操作中的排队作业', () => {
  it('显示前方等待作业数量，取消后将运行移出队列', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    const { jobs } = await runDetail(s.t, s.admin, 1);
    const q = actionsQueue(s.t.env);
    await q.acquire({
      jobId: 'busy',
      runId: 'other',
      maxMinutes: 30,
      limit: 1,
    });
    await q.acquire({
      jobId: 'next',
      runId: 'other',
      maxMinutes: 30,
      limit: 1,
    });
    await q.acquire({
      jobId: jobs[0].id,
      runId: run.id,
      maxMinutes: 30,
      limit: 1,
    });
    expect((await runDetail(s.t, s.admin, 1)).jobs[0].queuedAhead).toBe(1);

    const res = await call(
      s.t,
      '/api/repos/octocat/app/actions/runs/1/cancel',
      { cookie: s.admin, method: 'POST' }
    );
    expect(res.status).toBe(200);
    await settle(s.t);
    expect(await q.positions([jobs[0].id])).toEqual({});
    expect((await runDetail(s.t, s.admin, 1)).jobs[0].queuedAhead).toBeNull();
    expect(await q.release('busy')).toEqual([
      { jobId: 'next', runId: 'other' },
    ]);
  });

  it('不启动所属运行已被取消的等待作业', async () => {
    const s = await setup();
    await setLimit(s, 1);
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const q = actionsQueue(s.t.env);
    await q.acquire({
      jobId: 'busy',
      runId: 'other',
      maxMinutes: 30,
      limit: 1,
    });
    const h = harness(s.t);
    const done = h.run(queued.id);
    while (!h.stepNames.some((n) => n.includes(':queue:wait:')))
      await new Promise((r) => setTimeout(r, 5));
    const res = await call(
      s.t,
      '/api/repos/octocat/app/actions/runs/1/cancel',
      { cookie: s.admin, method: 'POST' }
    );
    expect(res.status).toBe(200);
    await settle(s.t);
    expect(await q.release('busy')).toEqual([]);
    expect(await done).toBe('cancelled');
    expect(h.boots).toHaveLength(0);
  });

  it('查看运行时移除其已崩溃 Workflow 对应的作业', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    const { jobs } = await runDetail(s.t, s.admin, 1);
    const q = actionsQueue(s.t.env);
    await q.acquire({
      jobId: 'busy',
      runId: 'other',
      maxMinutes: 30,
      limit: 1,
    });
    await q.acquire({
      jobId: jobs[0].id,
      runId: run.id,
      maxMinutes: 30,
      limit: 1,
    });
    // reconcile() only looks at runs older than a minute.
    await s.t.env.DB.prepare(
      'UPDATE workflow_runs SET created_at = created_at - 600'
    ).run();
    s.t.actions.instanceStatus.set(run.id, 'errored');
    const detail = await runDetail(s.t, s.admin, 1);
    expect(detail.run.conclusion).toBe('failure');
    expect(await q.positions([jobs[0].id])).toEqual({});
  });
});

describe('作业队列故障与重启', () => {
  it('清理日志失败也先落库完成再释放队列，命令不会重放', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml':
        'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: once\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const real = actionsQueue(s.t.env);
    const released: unknown[] = [];
    const logs = s.t.env.ACTIONS_LOGS;
    s.t.env.ACTIONS_LOGS = new Proxy(logs, {
      get(target, property) {
        if (property === 'put')
          return async (key: string, ...args: unknown[]) => {
            if (key.endsWith('/3.log'))
              throw new Error('cleanup log unavailable');
            return (target.put as (...a: unknown[]) => unknown)(key, ...args);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const t = {
      ...s.t,
      env: {
        ...s.t.env,
        ACTIONS_QUEUE: {
          getByName: () => ({
            acquire: (request: SlotRequest) => real.acquire(request),
            started: (id: string) => real.started(id),
            release: async (id: string) => {
              released.push(
                await s.t.env.DB.prepare(
                  'SELECT status FROM workflow_jobs WHERE id = ?'
                )
                  .bind(id)
                  .first('status')
              );
              return real.release(id);
            },
            reclaim: (now?: number) => real.reclaim(now),
          }),
        },
      },
    } as unknown as typeof s.t;
    const h = harness(t);
    expect(await h.run(run.id)).toBe('failure');
    expect(h.requests).toHaveLength(1);
    expect(released).toEqual(['completed']);
  });

  it.each([true, false])(
    '回收死亡作业的 D1 预留后 executor 能启动下一作业（队列记录：%s）',
    async (hasEntry) => {
      const s = await setup();
      await setLimit(s, 1);
      await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
      const [abandoned] = (await runs(s.t, s.admin)).runs;
      await pushFiles(s, 'main', {
        '.github/workflows/ci.yml': CI,
        'next.txt': 'next',
      });
      const [next] = (await runs(s.t, s.admin)).runs;
      const job = (await s.t.env.DB.prepare(
        'SELECT id FROM workflow_jobs WHERE run_id = ?'
      )
        .bind(abandoned.id)
        .first<{ id: string }>())!;
      await s.t.env.DB.batch([
        s.t.env.DB.prepare(
          "UPDATE workflow_runs SET status = 'in_progress' WHERE id = ?"
        ).bind(abandoned.id),
        s.t.env.DB.prepare(
          "UPDATE workflow_jobs SET status = 'in_progress' WHERE id = ?"
        ).bind(job.id),
      ]);
      const stopped: string[] = [];
      const stub = s.t.env.ACTIONS_QUEUE.getByName('instance');
      await runInDurableObject(stub, async (obj) => {
        (obj as unknown as { env: CloudflareBindings }).env = {
          ...env,
          ACTIONS_RUN: {
            get: async (id: string) => ({
              status: async () => ({
                status:
                  id === abandoned.id && !hasEntry ? 'errored' : 'running',
              }),
              terminate: async () => {},
              sendEvent: async () => {},
            }),
          },
          JOB_RUNNER: {
            getByName: (id: string) => ({
              destroy: async () => {
                stopped.push(id);
              },
            }),
          },
        } as unknown as CloudflareBindings;
      });
      const q = actionsQueue(s.t.env);
      if (hasEntry) {
        await q.acquire(ask(job.id, 1, { runId: abandoned.id, maxMinutes: 1 }));
        await q.started(job.id, Date.now() - RECLAIM_MARGIN_MS - 2 * 60_000);
      }
      await q.reclaim();
      const h = harness(s.t, slow, { loseEvents: true });
      const done = h.run(next.id);
      try {
        // The old code grants in the DO but leaves B stuck behind A's D1 in_progress row.
        for (
          let i = 0;
          i < 200 &&
          !h.boots.length &&
          !h.stepNames.some((n) => n.endsWith(':capacity:wait:1'));
          i++
        )
          await new Promise((r) => setTimeout(r, 10));
        expect(h.boots).toHaveLength(1);
        expect(stopped).toContain(job.id);
        expect(await done).toBe('success');
      } finally {
        // Even a failed regression must leave no live executor waiting across test teardown.
        await s.t.env.DB.batch([
          s.t.env.DB.prepare(
            "UPDATE workflow_jobs SET status = 'completed' WHERE run_id = ?"
          ).bind(abandoned.id),
          s.t.env.DB.prepare(
            "UPDATE workflow_runs SET status = 'completed' WHERE id = ?"
          ).bind(abandoned.id),
        ]);
        await q.release(job.id);
        await done;
      }
    }
  );

  it.each(['runner', 'workflow'])(
    '超时回收无法停止 %s 时保留 D1 和队列名额，停止成功后才释放',
    async (failure) => {
      const id = `stuck-${crypto.randomUUID()}`;
      const runId = await seedRun([[id, 'in_progress']]);
      const stub = env.ACTIONS_QUEUE.getByName(`unit-${crypto.randomUUID()}`);
      let failStop = true;
      await runInDurableObject(stub, async (obj) => {
        (obj as unknown as { env: CloudflareBindings }).env = {
          ...env,
          ACTIONS_RUN: {
            get: async () => ({
              status: async () => ({ status: 'running' }),
              terminate: async () => {
                if (failStop && failure === 'workflow')
                  throw new Error('Workflow termination unavailable');
              },
              sendEvent: async () => {},
            }),
          },
          JOB_RUNNER: {
            getByName: () => ({
              destroy: async () => {
                if (failStop && failure === 'runner')
                  throw new Error('container stop unavailable');
              },
            }),
          },
        } as unknown as CloudflareBindings;
      });
      const q = stub as unknown as ActionsQueueApi;
      await q.acquire(ask(id, 1, { runId, maxMinutes: 1 }));
      await q.started(id, Date.now() - RECLAIM_MARGIN_MS - 2 * 60_000);
      expect((await q.reclaim()).reclaimed).toEqual([]);
      expect(
        await env.DB.prepare('SELECT status FROM workflow_jobs WHERE id = ?')
          .bind(id)
          .first('status')
      ).toBe('in_progress');
      expect((await q.acquire(ask('next', 1))).granted).toBe(false);
      failStop = false;
      expect((await q.reclaim()).reclaimed).toContain(id);
      expect(
        await env.DB.prepare('SELECT status FROM workflow_jobs WHERE id = ?')
          .bind(id)
          .first('status')
      ).toBe('completed');
    }
  );

  it.each([
    { limit: 1, repoLimit: null, mixed: false },
    { limit: 5, repoLimit: 1, mixed: false },
    { limit: 1, repoLimit: 1, mixed: true },
  ])(
    '队列故障时并行申请仍遵守全局和仓库上限：%j',
    async ({ limit, repoLimit, mixed }) => {
      const s = await setup();
      await setLimit(s, limit);
      await call(
        s.t,
        '/api/admin/settings/actions.max_concurrent_jobs_per_repo',
        {
          cookie: s.admin,
          method: 'PUT',
          json: { value: repoLimit },
        }
      );
      await pushFiles(s, 'main', { '.github/workflows/ci.yml': MATRIX });
      const [queued] = (await runs(s.t, s.admin)).runs;
      const real = actionsQueue(s.t.env);
      let asks = 0;
      const broken = () => {
        throw new Error('queue unavailable');
      };
      const t = {
        ...s.t,
        env: {
          ...s.t.env,
          ACTIONS_QUEUE: {
            getByName: () => ({
              acquire: (request: SlotRequest) =>
                mixed && ++asks % 2 === 0 ? real.acquire(request) : broken(),
              started: (id: string) => real.started(id),
              release: (id: string) => real.release(id),
              cancelRun: (id: string) => real.cancelRun(id),
              positions: (ids: string[]) => real.positions(ids),
            }),
          },
        },
      } as unknown as typeof s.t;
      const h = harness(t, slow, { loseEvents: true, events: [] });
      expect(await h.run(queued.id)).toBe('success');
      expect(h.boots).toHaveLength(5);
      expect(h.peak()).toBe(1);
    }
  );

  it('无法连接队列时，无需空位即可运行作业', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const broken = () => {
      throw new Error('queue unavailable');
    };
    const t = {
      ...s.t,
      env: {
        ...s.t.env,
        ACTIONS_QUEUE: {
          getByName: () => ({
            acquire: broken,
            started: broken,
            release: broken,
            cancelRun: broken,
            positions: broken,
          }),
        },
      },
    } as unknown as typeof s.t;
    const h = harness(t);
    expect(await h.run(queued.id)).toBe('success');
    expect(h.boots).toHaveLength(1);
  });

  it('无法连接队列时，只在运行中的作业少于上限时启动', async () => {
    const s = await setup();
    await s.t.env.DB.prepare(
      "INSERT INTO instance_settings (key, value, updated_at) VALUES ('actions.max_concurrent_jobs', '1', 0)"
    ).run();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    // Another job of another run already holds the instance's one slot, as D1 counts it.
    await pushFiles(
      s,
      'main',
      { '.github/workflows/ci.yml': CI, 'b.txt': 'b\n' },
      'Another run'
    );
    const busy = (await s.t.env.DB.prepare(
      'SELECT j.id FROM workflow_jobs j JOIN workflow_runs r ON r.id = j.run_id WHERE r.id != ? LIMIT 1'
    )
      .bind(queued.id)
      .first<{ id: string }>())!;
    await s.t.env.DB.prepare(
      "UPDATE workflow_jobs SET status = 'in_progress' WHERE id = ?"
    )
      .bind(busy.id)
      .run();
    const broken = () => {
      throw new Error('queue unavailable');
    };
    const t = {
      ...s.t,
      env: {
        ...s.t.env,
        ACTIONS_QUEUE: {
          getByName: () => ({
            acquire: broken,
            started: broken,
            release: broken,
            cancelRun: broken,
            positions: broken,
          }),
        },
      },
    } as unknown as typeof s.t;
    const h = harness(t, undefined, { loseEvents: true });
    const done = h.run(queued.id);
    // It waits, counting again after each wait, until the other job finishes.
    while (!h.stepNames.some((n) => n.endsWith(':queue-down:wait:2')))
      await new Promise((r) => setTimeout(r, 5));
    expect(h.boots).toHaveLength(0);
    await s.t.env.DB.prepare(
      "UPDATE workflow_jobs SET status = 'completed' WHERE id = ?"
    )
      .bind(busy.id)
      .run();
    expect(await done).toBe('success');
    expect(h.boots).toHaveLength(1);
  });

  it('重启后重新等待空位的作业显示为排队中', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    const { jobs } = await runDetail(s.t, s.admin, 1);
    // The first attempt started the job; its runner was interrupted and it queues again.
    await s.t.env.DB.prepare(
      "UPDATE workflow_jobs SET status = 'in_progress', started_at = ? WHERE id = ?"
    )
      .bind(Math.floor(Date.now() / 1000), jobs[0].id)
      .run();
    const q = actionsQueue(s.t.env);
    await q.acquire({
      jobId: 'busy',
      runId: 'other',
      maxMinutes: 30,
      limit: 1,
    });
    await q.acquire({
      jobId: jobs[0].id,
      runId: run.id,
      maxMinutes: 30,
      limit: 1,
    });
    const job = (await runDetail(s.t, s.admin, 1)).jobs[0];
    expect(job.status).toBe('in_progress');
    expect(job.queuedAhead).toBe(0);
  });

  /** The test's real queue, with `started` failing the first `failures` times. */
  const flakyStarted = (s: Setup, failures: number) => {
    const real = actionsQueue(s.t.env);
    const calls = { started: 0 };
    const queue: ActionsQueueApi = {
      acquire: (r) => real.acquire(r),
      started: async (id, now) => {
        if (++calls.started <= failures) throw new Error('queue hiccup');
        return real.started(id, now);
      },
      release: (id) => real.release(id),
      cancelRun: (id) => real.cancelRun(id),
      positions: (ids) => real.positions(ids),
      reclaim: (now) => real.reclaim(now),
    };
    const t = {
      ...s.t,
      env: { ...s.t.env, ACTIONS_QUEUE: { getByName: () => queue } },
    } as unknown as typeof s.t;
    return { t, calls, real };
  };

  it('重试标记作业已启动，确保从实际启动时间计算空位占用', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const { t, calls, real } = flakyStarted(s, 1);
    let kept: string[] | null = null;
    const h = harness(
      t,
      async () => {
        // Past a granted-but-unstarted job's deadline: only a started job keeps its slot.
        kept ??= (
          await real.reclaim(
            Date.now() + MAX_RECHECK_MS + RECLAIM_MARGIN_MS + 60_000
          )
        ).reclaimed;
        return {};
      },
      { retrySteps: true }
    );
    expect(await h.run(queued.id)).toBe('success');
    expect(calls.started).toBe(2);
    expect(kept).toEqual([]);
  });

  it('标记作业已启动持续失败时，仍运行作业', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const { t, calls } = flakyStarted(s, Infinity);
    const h = harness(t, () => ({}), { retrySteps: true });
    expect(await h.run(queued.id)).toBe('success');
    expect(calls.started).toBe(4);
    expect(h.boots).toHaveLength(1);
  });
});
