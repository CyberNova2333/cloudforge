// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { expect, it } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import {
  executeRun,
  MAX_JOB_ATTEMPTS,
  type StepRunner,
} from '../actions/executor';
import { JobRunner } from '../actions/job-runner';
import { call, settle } from './helpers/app';
import { harness, pushFiles, runDetail, runs, setup } from './helpers/actions';

it('停止容器失败时保留孤儿硬停止闹钟，成功后才删除', async () => {
  let alarmScheduled = true;
  let failStop = true;
  const container = {
    running: true,
    destroy: async () => {
      if (failStop) throw new Error('container stop unavailable');
      container.running = false;
    },
  };
  const runner = Object.assign(Object.create(JobRunner.prototype), {
    ctx: {
      container,
      storage: {
        deleteAlarm: async () => {
          alarmScheduled = false;
        },
      },
    },
    masks: [],
    registeredMasks: [],
  }) as JobRunner;
  await expect(runner.destroy()).rejects.toThrow('container stop unavailable');
  expect(container.running).toBe(true);
  expect(alarmScheduled).toBe(true);
  failStop = false;
  await runner.alarm();
  expect(container.running).toBe(false);
  await runner.destroy();
  expect(alarmScheduled).toBe(false);
});

it.each(['exec', 'stdout'])(
  '截去实时日志和已保存日志的开头前，先脱敏 %s 异常文本',
  async (source) => {
    const secret = 'sensitive-error-credential';
    const tail = 'x'.repeat(4 * 1024 * 1024 - 5);
    let release!: () => void;
    const container = {
      running: true,
      exec: async (argv: string[]) => {
        if (argv[0] === '/usr/bin/timeout') {
          if (source === 'exec') throw new Error(secret + tail);
          return {
            exitCode: Promise.resolve(0),
            stdout: new ReadableStream<Uint8Array>({
              start(c) {
                c.error(new Error(secret + tail));
              },
            }),
          };
        }
        return {
          exitCode: Promise.resolve(0),
          output: async () => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return { stdout: new TextEncoder().encode('\0\0\0') };
          },
        };
      },
    };
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      ctx: { container },
      masks: [],
      registeredMasks: [],
    }) as JobRunner;
    const pending = runner.runStep({
      number: 2,
      argv: ['bash', '-c', 'test'],
      cwd: '/',
      env: {},
      timeoutMs: 1000,
      masks: [secret],
    });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    const live = await runner.live(2);
    release();
    const result = await pending;
    expect(result.exitCode).toBe(1);
    expect(live?.includes('tial')).toBe(false);
    expect(result.log.includes('tial')).toBe(false);
  }
);

it('Workflow 终止失败时，仍对已取消的最后一次尝试诊断进行脱敏', async () => {
  const s = await setup();
  await pushFiles(s, 'main', {
    '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`,
  });
  const [run] = (await runs(s.t, s.admin)).runs;
  const secret = 'final-attempt-dynamic-credential';
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finish: ((code: number) => void) | undefined;
  const container = {
    running: true,
    destroy: async () => {
      container.running = false;
      if (controller) {
        controller.error(new Error(`stream stopped: ${secret}`));
        controller = undefined;
        finish!(1);
      }
    },
    exec: async (argv: string[]) => {
      if (!container.running) throw new Error('container stopped');
      if (argv[0] === '/usr/bin/timeout')
        return {
          exitCode: new Promise<number>((resolve) => {
            finish = resolve;
          }),
          stdout: new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
              c.enqueue(
                new TextEncoder().encode(`::add-mask::${secret}\nready\n`)
              );
            },
          }),
        };
      return { exitCode: Promise.resolve(0) };
    },
  };
  const runner = Object.assign(Object.create(JobRunner.prototype), {
    ctx: { container, storage: { deleteAlarm: async () => {} } },
    masks: [],
    registeredMasks: [],
  }) as JobRunner;
  const originalWorkflow = s.t.env.ACTIONS_RUN;
  s.t.env.ACTIONS_RUN = {
    ...originalWorkflow,
    get: async (id: string) => ({
      ...(await originalWorkflow.get(id)),
      terminate: async () => {
        throw new Error('injected Workflow termination outage');
      },
    }),
  } as unknown as CloudflareBindings['ACTIONS_RUN'];
  s.t.env.JOB_RUNNER = {
    getByName: () => runner,
  } as unknown as CloudflareBindings['JOB_RUNNER'];
  let attempts = 0;
  const pending = executeRun(
    {
      env: s.t.env,
      db: drizzle(s.t.env.DB, { schema }),
      step: {
        do: async (_name: string, a: unknown, b?: unknown) =>
          ((b ?? a) as () => Promise<unknown>)(),
      } as StepRunner,
      restartDelayMs: 0,
      runner: () => ({
        boot: async () => {
          container.running = true;
          return { ms: 0 };
        },
        destroy: () => runner.destroy(),
        runStep: async (req) => {
          if (++attempts < MAX_JOB_ATTEMPTS)
            throw new Error('injected runner interruption');
          return runner.runStep(req);
        },
      }),
    },
    run.id
  );
  while (!(await runner.live(2))?.includes('ready'))
    await new Promise((resolve) => setTimeout(resolve, 0));
  const cancelled = await call(
    s.t,
    `/api/repos/octocat/app/actions/runs/${run.runNumber}/cancel`,
    {
      cookie: s.admin,
      method: 'POST',
    }
  );
  expect(cancelled.status).toBe(200);
  await settle(s.t);
  // The cancellation cannot claim the runner stopped while Workflow termination
  // failed. Simulate the runner's independent hard stop before its late diagnostic.
  expect(container.running).toBe(true);
  await runner.destroy();
  await pending;
  const detail = await runDetail(s.t, s.admin, run.runNumber);
  expect(detail.run.conclusion).toBe('cancelled');
  expect(detail.jobs[0].conclusion).toBe('cancelled');
  expect(
    detail.jobs[0].steps.find((step) => step.number === 2)?.conclusion
  ).toBe('cancelled');
  const log = await call(
    s.t,
    `/api/repos/octocat/app/actions/runs/${run.runNumber}/jobs/${detail.jobs[0].id}/steps/2/logs`,
    { cookie: s.admin }
  );
  expect(log.status).toBe(200);
  const text = await log.text();
  expect(text).toContain('stream stopped: ***');
  expect(text).not.toContain(secret);
  expect(attempts).toBe(MAX_JOB_ATTEMPTS);
});

it('不恢复在持久化加载快照之后被取消的运行', async () => {
  const s = await setup();
  await pushFiles(s, 'main', {
    '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo must-not-start
`,
  });
  const [run] = (await runs(s.t, s.admin)).runs;
  let boots = 0;
  let commands = 0;
  await executeRun(
    {
      env: s.t.env,
      db: drizzle(s.t.env.DB, { schema }),
      step: {
        do: async (name: string, a: unknown, b?: unknown) => {
          const value = await ((b ?? a) as () => Promise<unknown>)();
          if (name === 'load') {
            const cancelled = await call(
              s.t,
              `/api/repos/octocat/app/actions/runs/${run.runNumber}/cancel`,
              {
                cookie: s.admin,
                method: 'POST',
              }
            );
            expect(cancelled.status).toBe(200);
          }
          return value;
        },
      } as StepRunner,
      runner: () => ({
        boot: async () => {
          boots++;
          return { ms: 0 };
        },
        destroy: async () => {},
        runStep: async () => {
          commands++;
          return {
            exitCode: 0,
            timedOut: false,
            log: '',
            outputs: {},
            envAdds: {},
            pathAdds: [],
          };
        },
      }),
    },
    run.id
  );
  expect(boots).toBe(0);
  expect(commands).toBe(0);
  const detail = await runDetail(s.t, s.admin, run.runNumber);
  expect(detail.run.conclusion).toBe('cancelled');
  expect(detail.run.status).toBe('completed');
});

it.each(['steps', 'composite'])(
  '已取消的命令返回成功后，不在 %s 中启动另一条命令',
  async (kind) => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
${
  kind === 'composite'
    ? '      - uses: ./.github/actions/tool'
    : `      - run: echo in-flight
      - run: echo must-not-start
        if: always()`
}
`,
      ...(kind === 'composite'
        ? {
            '.github/actions/tool/action.yml': `name: cancellation test
runs:
  using: composite
  steps:
    - run: echo in-flight
      shell: bash
    - run: echo must-not-start
      shell: bash
      if: always()
`,
          }
        : {}),
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const original = s.t.env.ACTIONS_RUN;
    s.t.env.ACTIONS_RUN = {
      ...original,
      get: async (id: string) => ({
        ...(await original.get(id)),
        terminate: async () => {
          throw new Error('injected termination failure');
        },
      }),
    } as unknown as CloudflareBindings['ACTIONS_RUN'];
    const h = harness(s.t, async () => {
      expect(
        (
          await call(
            s.t,
            `/api/repos/octocat/app/actions/runs/${run.runNumber}/cancel`,
            {
              cookie: s.admin,
              method: 'POST',
            }
          )
        ).status
      ).toBe(200);
      return { exitCode: 0 };
    });
    await h.run(run.id);
    await settle(s.t);
    expect(h.requests).toHaveLength(1);
    const detail = await runDetail(s.t, s.admin, run.runNumber);
    expect(detail.run.conclusion).toBe('cancelled');
    expect(detail.jobs[0].conclusion).toBe('cancelled');
    expect(
      detail.jobs[0].steps.find((step) => step.number === 2)?.conclusion
    ).toBe('cancelled');
    expect(
      detail.jobs[0].steps.find((step) => step.number === 3)?.conclusion
    ).toBe('skipped');
  }
);

it.each(['stdout', 'exception'])(
  'destroy 与最终 %s 并发发生时，保留活动步骤的脱敏规则',
  async (source) => {
    const secret = 'dynamic-credential-during-cancel';
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let finish!: (code: number) => void;
    const container = {
      running: true,
      destroy: async () => {
        container.running = false;
        if (source === 'stdout') {
          controller.enqueue(new TextEncoder().encode(`${secret}\n`));
          controller.close();
        } else controller.error(new Error(`stream stopped: ${secret}`));
        finish(1);
      },
      exec: async (argv: string[]) => {
        if (argv[0] === '/usr/bin/timeout')
          return {
            exitCode: new Promise<number>((resolve) => {
              finish = resolve;
            }),
            stdout: new ReadableStream<Uint8Array>({
              start(c) {
                controller = c;
                c.enqueue(
                  new TextEncoder().encode(`::add-mask::${secret}\nready\n`)
                );
              },
            }),
          };
        if (!container.running) throw new Error('container stopped');
        return { exitCode: Promise.resolve(0) };
      },
    };
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      ctx: { container, storage: { deleteAlarm: async () => {} } },
      masks: [],
      registeredMasks: [],
    }) as JobRunner;
    const pending = runner.runStep({
      number: 2,
      argv: ['bash', '-c', 'test'],
      cwd: '/',
      env: {},
      timeoutMs: 1000,
      masks: [],
    });
    while (!(await runner.live(2))?.includes('ready'))
      await new Promise((resolve) => setTimeout(resolve, 0));
    await runner.destroy();
    const result = await pending;
    expect(result.log).not.toContain(secret);
    expect(result.masks).toContain(secret);
    expect(result.exitCode).toBe(1);
    expect(result.interrupted).toBeTruthy();
    expect(await runner.live(2)).toBeNull();
  }
);

it.each(['complete', 'restart', 'cancelled-restart'])(
  '执行器%s销毁失败保留容量和使用量，仅重试清理后才释放',
  async (mode) => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo stop-proof
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const job = (await s.t.env.DB.prepare(
      'SELECT id FROM workflow_jobs WHERE run_id=?'
    )
      .bind(run.id)
      .first<{ id: string }>())!;
    const stopError = new Error('injected container stop failure');
    let failStop = true;
    let commands = 0;
    let stops = 0;
    let boots = 0;
    const completed = new Map<string, unknown>();
    const failedCommands = new Map<string, unknown>();
    // A completed durable step is replayed from its saved value. The already failed
    // interrupted command remains failed; only its distinct cleanup step is retried.
    const step = {
      do: async (name: string, a: unknown, b?: unknown) => {
        if (completed.has(name)) return completed.get(name);
        if (failedCommands.has(name)) throw failedCommands.get(name);
        try {
          const result = await ((b ?? a) as () => Promise<unknown>)();
          completed.set(name, result);
          return result;
        } catch (error) {
          if (/^job:.*:step:\d+$/.test(name)) failedCommands.set(name, error);
          throw error;
        }
      },
    } as StepRunner;
    const deps = {
      env: s.t.env,
      db: drizzle(s.t.env.DB, { schema }),
      step,
      restartDelayMs: 0,
      runner: () => ({
        boot: async () => {
          boots++;
          return { ms: 0 };
        },
        destroy: async () => {
          stops++;
          if (failStop) throw stopError;
        },
        runStep: async () => {
          commands++;
          if (mode !== 'complete' && commands === 1) {
            if (mode === 'cancelled-restart') {
              await s.t.env.DB.prepare(
                "UPDATE workflow_runs SET status='completed',conclusion='cancelled',completed_at=? WHERE id=?"
              )
                .bind(Date.now(), run.id)
                .run();
            }
            throw new Error('injected command interruption');
          }
          return {
            exitCode: 0,
            timedOut: false,
            log: 'done',
            outputs: {},
            envAdds: {},
            pathAdds: [],
          };
        },
      }),
    };
    const outcome = await executeRun(deps, run.id).catch(
      (error: unknown) => error
    );
    const retained = await s.t.env.DB.prepare(
      'SELECT status FROM workflow_jobs WHERE id=?'
    )
      .bind(job.id)
      .first();
    const usage = await s.t.env.DB.prepare(
      'SELECT stopped_at FROM runner_sessions WHERE job_id=? ORDER BY id'
    )
      .bind(job.id)
      .all();
    const stub = s.t.env.ACTIONS_QUEUE.getByName('actions');
    const slot = await runInDurableObject(stub, async (_obj, state) =>
      state.storage.sql
        .exec<{ job_id: string }>(
          'SELECT job_id FROM entries WHERE job_id=?',
          job.id
        )
        .toArray()
    );
    expect({
      threwStopError: outcome === stopError,
      job: retained,
      usage: usage.results,
      slot,
    }).toEqual({
      threwStopError: true,
      job: { status: 'in_progress' },
      usage: [{ stopped_at: null }],
      slot: [{ job_id: job.id }],
    });
    expect(commands).toBe(1);
    expect(boots).toBe(1);
    failStop = false;
    expect(await executeRun(deps, run.id)).toBe(
      mode === 'cancelled-restart' ? 'cancelled' : 'success'
    );
    expect(commands).toBe(mode === 'restart' ? 2 : 1);
    expect(boots).toBe(mode === 'restart' ? 2 : 1);
    expect(stops).toBeGreaterThanOrEqual(2);
    expect(
      await s.t.env.DB.prepare('SELECT status FROM workflow_jobs WHERE id=?')
        .bind(job.id)
        .first()
    ).toEqual({ status: 'completed' });
    expect(
      (
        await s.t.env.DB.prepare(
          'SELECT stopped_at FROM runner_sessions WHERE job_id=?'
        )
          .bind(job.id)
          .all<{ stopped_at: number | null }>()
      ).results.every((session) => session.stopped_at !== null)
    ).toBe(true);
    expect(
      await runInDurableObject(stub, async (_obj, state) =>
        state.storage.sql
          .exec('SELECT job_id FROM entries WHERE job_id=?', job.id)
          .toArray()
      )
    ).toEqual([]);
  }
);
