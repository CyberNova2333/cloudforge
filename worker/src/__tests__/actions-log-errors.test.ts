import { expect, it } from 'vitest';
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

it.each(['exec', 'stdout'])(
  'redacts %s exception text before dropping the beginning of live and saved logs',
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

it('keeps a cancelled final attempt diagnostic masked when Workflow termination fails', async () => {
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

it('does not revive a run cancelled after its durable load snapshot', async () => {
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
  'does not start another command in %s after a cancelled command returns success',
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
  'retains active step masks when destroy races with its final %s',
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
