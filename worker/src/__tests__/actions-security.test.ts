import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { executeRun, type StepRunner } from '../actions/executor';
import {
  JobRunner,
  type StepRequest,
  type StepResult,
} from '../actions/job-runner';
import { expandMatrix } from '../actions/plan';
import { openState, persistState, sealState } from '../actions/state';
import { saveVariable } from '../actions/secrets';
import { onRefsUpdated } from '../actions/trigger';
import { mask, workflowCommands } from '../actions/commands';
import { call, settle } from './helpers/app';
import {
  harness,
  pushFiles,
  runDetail,
  runs,
  script,
  setup,
} from './helpers/actions';

it('honors short masks and masks overlapping values without exposing the longer suffix', () => {
  const parsed = workflowCommands(
    '::add-mask::xy\n::add-mask::abcd\n::add-mask::abcdef\nxy abcdef'
  );
  expect(mask(parsed.text, parsed.masks)).toBe('*** ***');
});

it('redacts the union of crossing and self-overlapping secret matches', () => {
  expect(mask('abcdef', ['abcd', 'cdef'])).toBe('***');
  expect(mask('abcdef', ['cdef', 'abcd'])).toBe('***');
  expect(mask('ababa', ['aba'])).toBe('***');
  expect(mask('x and *', ['x', '*'])).toBe('*** and ***');
});

it('redacts a full-size log with a densely self-overlapping secret', () => {
  expect(mask('a'.repeat(4 * 1024 * 1024), ['a'.repeat(1024)])).toBe('***');
});

function failStateReads(
  env: CloudflareBindings,
  shouldFail: (key: string, read: number) => boolean
) {
  const original = env.ACTIONS_LOGS;
  let reads = 0;
  env.ACTIONS_LOGS = new Proxy(original, {
    get(target, property) {
      if (property === 'get')
        return async (key: string) => {
          if (
            key.includes('/state/') &&
            shouldFail(decodeURIComponent(key), ++reads)
          )
            throw new Error('injected R2 read outage');
          return target.get(key);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    reads: () => reads,
    restore: () => {
      env.ACTIONS_LOGS = original;
    },
  };
}

describe('Actions durable secret state', () => {
  it('does not replay completed commands when the next step cannot update D1', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - run: deploy-once
      - run: after-deploy
        continue-on-error: true
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    await s.t.env.DB.prepare(
      `CREATE TRIGGER fail_next_action_start BEFORE UPDATE ON workflow_steps
      WHEN NEW.number = 3 AND NEW.status = 'in_progress'
      BEGIN SELECT RAISE(ABORT, 'injected step update outage'); END;`
    ).run();
    const h = harness(s.t);
    try {
      expect(await h.run(run.id)).toBe('failure');
      expect(h.requests.map(script)).toEqual(['deploy-once']);
      expect(h.boots).toHaveLength(1);
      expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
    } finally {
      await s.t.env.DB.exec('DROP TRIGGER fail_next_action_start');
    }
  });
  it.each(['state', 'log', 'persistent logs'])(
    'never repeats a completed command after an R2 %s write fails',
    async (kind) => {
      const s = await setup();
      await pushFiles(s, 'main', {
        '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - run: deploy-once
        continue-on-error: true
      - run: after-deploy
        if: always()
`,
      });
      const [run] = (await runs(s.t, s.admin)).runs;
      const original = s.t.env.ACTIONS_LOGS;
      let armed = false;
      let failures = 0;
      s.t.env.ACTIONS_LOGS = new Proxy(original, {
        get(target, property) {
          if (property === 'put')
            return async (key: string, ...args: unknown[]) => {
              if (
                armed &&
                (failures === 0 || kind === 'persistent logs') &&
                (kind === 'state'
                  ? key.includes('/state/')
                  : kind === 'persistent logs'
                    ? key.endsWith('.log')
                    : key.endsWith('/2.log'))
              ) {
                failures++;
                throw new Error('injected R2 write outage');
              }
              return (target.put as (...a: unknown[]) => unknown)(key, ...args);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const h = harness(s.t, () => {
        armed = true;
        return { outputs: { large: 'x'.repeat(600 * 1024) } };
      });
      try {
        const result = await h.run(run.id);
        expect(failures).toBeGreaterThan(0);
        expect(h.requests.map(script)).toEqual(['deploy-once']);
        expect(result).toBe('failure');
        expect(h.boots).toHaveLength(1);
        expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
        const detail = await runDetail(s.t, s.admin, run.runNumber);
        expect(detail.run.conclusion).toBe('failure');
        expect(detail.jobs[0].conclusion).toBe('failure');
        expect(detail.jobs[0].status).toBe('completed');
      } finally {
        s.t.env.ACTIONS_LOGS = original;
      }
    }
  );

  it('persists a replayable failure marker without exception text or secret-bearing state', async () => {
    const s = await setup();
    const saved = await persistState(async () => {
      throw new Error('secret-bearing-failure');
    });
    const replayed = JSON.parse(JSON.stringify(saved));
    expect(replayed).toEqual({ unavailable: true });
    await expect(
      openState(s.t.env, 'repo', 'run', 'step', replayed)
    ).rejects.toThrow('could not be saved');
    await expect(
      openState(
        s.t.env,
        'repo',
        'run',
        'step',
        JSON.parse(JSON.stringify({ unavailable: true, preparation: true }))
      )
    ).rejects.toThrow('preparation failed');
  });

  it('stops later cleanup commands when a post result cannot be saved', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/first
      - uses: ./.github/actions/second
`,
      '.github/actions/first/action.yml':
        'runs:\n  using: node24\n  main: first.js\n  post: cleanup-first.js\n',
      '.github/actions/second/action.yml':
        'runs:\n  using: node24\n  main: second.js\n  post: cleanup-second.js\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const original = s.t.env.ACTIONS_LOGS;
    s.t.env.ACTIONS_LOGS = new Proxy(original, {
      get(target, property) {
        if (property === 'put')
          return async (key: string, ...args: unknown[]) => {
            if (decodeURIComponent(key).includes(':post:'))
              throw new Error('injected post write failure');
            return (target.put as (...a: unknown[]) => unknown)(key, ...args);
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const h = harness(s.t, () => ({ masks: ['x'.repeat(600 * 1024)] }));
    try {
      expect(await h.run(run.id)).toBe('failure');
      expect(h.requests).toHaveLength(3);
      expect(script(h.requests[2])).toContain('cleanup-second.js');
      expect(
        h.requests.some((r) => script(r).includes('cleanup-first.js'))
      ).toBe(false);
      expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
    } finally {
      s.t.env.ACTIONS_LOGS = original;
    }
  });
  it.each([false, true])(
    'retries only R2 reads and never repeats a completed command (persistent outage: %s)',
    async (persistent) => {
      const s = await setup();
      await pushFiles(s, 'main', {
        '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - run: deploy-once
        continue-on-error: true
      - run: after-deploy
        if: always()
`,
      });
      const [run] = (await runs(s.t, s.admin)).runs;
      const h = harness(s.t, (req) =>
        script(req) === 'deploy-once'
          ? { outputs: { large: 'x'.repeat(600 * 1024) } }
          : {}
      );
      const fault = failStateReads(
        s.t.env,
        (_key, read) => persistent || read < 3
      );
      try {
        expect(await h.run(run.id)).toBe(persistent ? 'failure' : 'success');
        expect(h.boots).toHaveLength(1);
        expect(h.requests.map(script)).toEqual(
          persistent ? ['deploy-once'] : ['deploy-once', 'after-deploy']
        );
        expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
        expect(fault.reads()).toBe(3);
        const detail = await runDetail(s.t, s.admin, run.runNumber);
        expect(detail.jobs[0].conclusion).toBe(
          persistent ? 'failure' : 'success'
        );
        if (persistent)
          expect(detail.run.errorMessage).toContain(
            'could not be read after 3 attempts'
          );
      } finally {
        fault.restore();
      }
    }
  );

  it('fails explicitly when completed job outputs cannot be hydrated, without executing commands again', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      large: \${{ steps.deploy.outputs.large }}
    steps:
      - run: deploy-once
        id: deploy
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({
      outputs: { large: 'x'.repeat(600 * 1024) },
    }));
    const fault = failStateReads(s.t.env, (key) =>
      key.endsWith(':complete.enc')
    );
    try {
      expect(await h.run(run.id)).toBe('failure');
      expect(h.requests).toHaveLength(1);
      expect(h.boots).toHaveLength(1);
      expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
      const detail = await runDetail(s.t, s.admin, run.runNumber);
      expect(detail.jobs[0].conclusion).toBe('failure');
      expect(detail.jobs[0].steps.at(-1)?.conclusion).toBe('failure');
    } finally {
      fault.restore();
    }
  });

  it('stops later post commands when post masks cannot be restored', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/first
      - uses: ./.github/actions/second
`,
      '.github/actions/first/action.yml':
        'runs:\n  using: node24\n  main: first.js\n  post: cleanup-first.js\n',
      '.github/actions/second/action.yml':
        'runs:\n  using: node24\n  main: second.js\n  post: cleanup-second.js\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({ masks: ['x'.repeat(600 * 1024)] }));
    const fault = failStateReads(s.t.env, (key) => key.includes(':post:'));
    try {
      expect(await h.run(run.id)).toBe('failure');
      expect(h.requests).toHaveLength(3);
      expect(script(h.requests[2])).toContain('cleanup-second.js');
      expect(
        h.requests.some((r) => script(r).includes('cleanup-first.js'))
      ).toBe(false);
      expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
      const detail = await runDetail(s.t, s.admin, run.runNumber);
      expect(detail.jobs[0].conclusion).toBe('failure');
      expect(
        detail.jobs[0].steps.find((step) => step.number === 5)?.conclusion
      ).toBe('skipped');
    } finally {
      fault.restore();
    }
  });

  it('does not copy large unused static secrets into each durable result', async () => {
    const s = await setup();
    const db = drizzle(s.t.env.DB, { schema });
    const repo = (await db.select().from(schema.repositories).get())!;
    for (let i = 0; i < 16; i++)
      await saveVariable(s.t.env, db, {
        repositoryId: repo.id,
        kind: 'secret',
        name: `LARGE_${i}`,
        value: `${i}`.padStart(3, '0') + 'x'.repeat(48 * 1024 - 3),
        userId: repo.ownerId!,
      });
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml':
        'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const sizes: number[] = [];
    const step = {
      do: async (_name: string, a: unknown, b?: unknown) => {
        const value = await ((b ?? a) as () => Promise<unknown>)();
        sizes.push(JSON.stringify(value ?? null).length);
        return value;
      },
    } as StepRunner;
    const runner = {
      boot: async () => ({ ms: 0 }),
      destroy: async () => {},
      runStep: async () => ({
        exitCode: 0,
        timedOut: false,
        log: 'ok',
        outputs: {},
        envAdds: {},
        pathAdds: [],
      }),
    };
    expect(
      await executeRun({ env: s.t.env, db, step, runner: () => runner }, run.id)
    ).toBe('success');
    expect(Math.max(...sizes)).toBeLessThan(16 * 1024);
    expect(
      (
        await s.t.env.ACTIONS_LOGS.list({
          prefix: `actions/${repo.id}/${run.id}/state/`,
        })
      ).objects
    ).toHaveLength(0);
  });

  it('encrypts command files, post inputs and masks, then restores them on replay', async () => {
    const s = await setup();
    const secret = 'configured-secret-12345';
    const generated = 'generated-secret-67890';
    const save = (value: string) =>
      call(s.t, '/api/repos/octocat/app/actions/secrets/TOKEN', {
        cookie: s.admin,
        method: 'PUT',
        json: { value },
      });
    await save(secret);
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      token: \${{ steps.tool.outputs.token }}
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/tool
        id: tool
        with:
          token: \${{ secrets.TOKEN }}
      - run: echo "\${{ steps.tool.outputs.token }} $GENERATED"
`,
      '.github/actions/tool/action.yml':
        'runs:\n  using: node24\n  main: index.js\n  post: cleanup.js\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const persisted = new Map<string, unknown>();
    const step = {
      do: async (name: string, a: unknown, b?: unknown) => {
        if (persisted.has(name)) return structuredClone(persisted.get(name));
        const value = await ((b ?? a) as () => Promise<unknown>)();
        persisted.set(name, JSON.parse(JSON.stringify(value ?? null)));
        return value;
      },
    } as StepRunner;
    const requests: StepRequest[] = [];
    const runner = {
      boot: async () => ({ ms: 0 }),
      destroy: async () => {},
      runStep: async (req: StepRequest): Promise<StepResult> => {
        requests.push(req);
        return {
          exitCode: 0,
          timedOut: false,
          log: `${secret} ${generated}`,
          ...(script(req).includes('index.js')
            ? {
                outputs: { token: generated },
                envAdds: { GENERATED: generated },
                pathAdds: [`/tmp/${generated}`],
                state: { credential: secret },
                masks: [generated],
              }
            : { outputs: {}, envAdds: {}, pathAdds: [] }),
        };
      },
    };
    const runIt = () =>
      executeRun(
        {
          env: s.t.env,
          db: drizzle(s.t.env.DB, { schema }),
          step,
          runner: () => runner,
        },
        run.id
      );
    expect(await runIt()).toBe('success');
    const post = requests.find((r) => script(r).includes('cleanup.js'))!;
    expect(post.env.INPUT_TOKEN).toBe(secret);
    expect(post.env.STATE_credential).toBe(secret);
    expect(JSON.stringify([...persisted.values()])).not.toContain(secret);
    expect(JSON.stringify([...persisted.values()])).not.toContain(generated);
    const complete = [...persisted.entries()].find(([n]) =>
      n.endsWith(':complete')
    )!;
    expect(
      await openState<{ outputs: { token: string } }>(
        s.t.env,
        (await drizzle(s.t.env.DB, { schema })
          .select()
          .from(schema.repositories)
          .get())!.id,
        run.id,
        complete[0],
        complete[1] as any
      )
    ).toMatchObject({ outputs: { token: '' } });

    // Model an unfinished Workflow replay after a credential update. A completed
    // run is terminal; only the earlier durable steps have finished in this case.
    await save('replacement-secret-54321');
    await s.t.env.DB.prepare(
      "UPDATE workflow_runs SET status = 'in_progress', conclusion = NULL, completed_at = NULL WHERE id = ?"
    )
      .bind(run.id)
      .run();
    for (const key of persisted.keys())
      if (
        /:step:4(?::done)?$|:post:5$|:complete$|^(finish-run|auto-merge|states)$/.test(
          key
        )
      )
        persisted.delete(key);
    requests.length = 0;
    expect(await runIt()).toBe('success');
    expect(requests).toHaveLength(2);
    expect(requests[0].env.GENERATED).toBe(generated);
    expect(requests[0].masks).toEqual(
      expect.arrayContaining([secret, generated])
    );
    expect(requests[1].env.INPUT_TOKEN).toBe(secret);
    expect(requests[1].env.STATE_credential).toBe(secret);
    expect(JSON.stringify([...persisted.values()])).not.toContain(secret);
    expect(JSON.stringify([...persisted.values()])).not.toContain(generated);
  });

  it('retains request credentials as encrypted masks across replay and withholds matching job outputs', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      token: \${{ steps.checkout.outputs.token }}
    steps:
      - uses: actions/checkout@v4
        id: checkout
      - run: echo "$SAVED_TOKEN"
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const persisted = new Map<string, unknown>();
    const step = {
      do: async (name: string, a: unknown, b?: unknown) => {
        if (persisted.has(name)) return structuredClone(persisted.get(name));
        const value = await ((b ?? a) as () => Promise<unknown>)();
        persisted.set(name, JSON.parse(JSON.stringify(value ?? null)));
        return value;
      },
    } as StepRunner;
    let token = '';
    const requests: StepRequest[] = [];
    const runner = {
      boot: async () => ({ ms: 0 }),
      destroy: async () => {},
      runStep: async (req: StepRequest): Promise<StepResult> => {
        requests.push(req);
        if (req.env.CLOUDFORGE_TOKEN) token = req.env.CLOUDFORGE_TOKEN;
        return {
          exitCode: 0,
          timedOut: false,
          log: token,
          outputs: { token },
          envAdds: { SAVED_TOKEN: token },
          pathAdds: [],
        };
      },
    };
    const db = drizzle(s.t.env.DB, { schema });
    const runIt = () =>
      executeRun({ env: s.t.env, db, step, runner: () => runner }, run.id);
    expect(await runIt()).toBe('success');
    expect(requests[1].masks).toContain(token);
    expect(JSON.stringify([...persisted.values()])).not.toContain(token);
    const complete = [...persisted.entries()].find(([name]) =>
      name.endsWith(':complete')
    )!;
    const repo = (await db.select().from(schema.repositories).get())!;
    expect(
      await openState(s.t.env, repo.id, run.id, complete[0], complete[1] as any)
    ).toMatchObject({ outputs: { token: '' } });
    // Resume an unfinished run, preserving only its earlier durable results.
    await s.t.env.DB.prepare(
      "UPDATE workflow_runs SET status = 'in_progress', conclusion = NULL, completed_at = NULL WHERE id = ?"
    )
      .bind(run.id)
      .run();
    for (const name of persisted.keys())
      if (
        /:step:3(?::done)?$|:complete$|^(finish-run|auto-merge|states)$/.test(
          name
        )
      )
        persisted.delete(name);
    requests.length = 0;
    expect(await runIt()).toBe('success');
    expect(requests).toHaveLength(1);
    expect(requests[0].masks).toContain(token);
  });

  it('binds encrypted state to its run and step and works without configured Actions secrets', async () => {
    const s = await setup();
    const env = { ...s.t.env, ACTIONS_SECRETS_KEY: '' };
    const saved = await sealState(env, 'repo-a', 'run-a', 'step-a', {
      token: 'dynamic-token',
    });
    expect(JSON.stringify(saved)).not.toContain('dynamic-token');
    expect(await openState(env, 'repo-a', 'run-a', 'step-a', saved)).toEqual({
      token: 'dynamic-token',
    });
    await expect(
      openState(env, 'repo-a', 'run-b', 'step-a', saved)
    ).rejects.toThrow(/could not be decrypted/);
    await expect(
      openState(env, 'repo-a', 'run-a', 'step-b', saved)
    ).rejects.toThrow(/could not be decrypted/);
    await expect(
      openState(
        { ...env, BETTER_AUTH_SECRET: 'rotated' },
        'repo-a',
        'run-a',
        'step-a',
        saved
      )
    ).rejects.toThrow(/could not be decrypted/);
  });

  it('stores large state encrypted in R2 while keeping Workflow results small', async () => {
    const s = await setup();
    const value = { output: 'large-sensitive-value'.repeat(80_000) };
    const saved = await sealState(
      s.t.env,
      'repo-a',
      'large-run',
      'step',
      value
    );
    expect('key' in saved).toBe(true);
    expect(JSON.stringify(saved).length).toBeLessThan(512);
    expect(
      await openState(s.t.env, 'repo-a', 'large-run', 'step', saved)
    ).toEqual(value);
    const object = await s.t.env.ACTIONS_LOGS.get(
      (saved as { key: string }).key
    );
    expect(await object!.text()).not.toContain('large-sensitive-value');
    await expect(
      openState(s.t.env, 'other-repo', 'large-run', 'step', saved)
    ).rejects.toThrow(/reference does not match/);
  });
});

describe('JobRunner masks and process lifetime', () => {
  it('masks crossing secrets in live and saved runner logs', async () => {
    let release!: () => void;
    const container = {
      running: true,
      exec: async (argv: string[]) => {
        if (argv[0] !== '/usr/bin/timeout')
          return {
            exitCode: Promise.resolve(0),
            output: async () => ({
              stdout: new TextEncoder().encode('\0\0\0'),
            }),
          };
        return {
          exitCode: new Promise<number>((resolve) => {
            release = () => resolve(0);
          }),
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  '::add-mask::abcd\n::add-mask::cdef\nabcdef\n'
                )
              );
              controller.close();
            },
          }),
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
      masks: [],
    });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const live = await runner.live(2);
    release();
    const saved = await pending;
    expect(live?.trim()).toBe('***');
    expect(saved.log.trim()).toBe('***');
  });
  it('fails when stdout reading fails after the process exited successfully', async () => {
    const container = {
      running: true,
      exec: async (argv: string[]) => {
        if (argv[0] !== '/usr/bin/timeout')
          return {
            exitCode: Promise.resolve(0),
            output: async () => ({
              stdout: new TextEncoder().encode('\0\0\0'),
            }),
          };
        return {
          exitCode: Promise.resolve(0),
          stdout: new ReadableStream<Uint8Array>({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, 5));
              controller.error(new Error('stdout unavailable'));
            },
          }),
        };
      },
    };
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      ctx: { container },
      masks: [],
      registeredMasks: [],
    }) as JobRunner;
    const result = await runner.runStep({
      number: 2,
      argv: ['bash', '-c', 'test'],
      cwd: '/',
      env: {},
      timeoutMs: 1000,
      masks: [],
    });
    expect(result.exitCode).toBe(1);
    expect(result.log).toContain('stdout unavailable');
    expect(result.interrupted).toBeUndefined();
  });

  it('keeps dynamic masks across chunks, truncation, live logs and later steps', async () => {
    const token = 'runtime-credential-12345';
    let release!: () => void;
    let first = true;
    const container = {
      running: true,
      exec: async (argv: string[], opts?: any) => {
        if (argv[0] !== '/usr/bin/timeout')
          return {
            exitCode: Promise.resolve(0),
            output: async () => ({
              stdout: new TextEncoder().encode('\0\0\0'),
            }),
          };
        expect(opts.signal).toBeUndefined();
        if (!first)
          return {
            exitCode: Promise.resolve(0),
            stdout: new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(token));
                c.close();
              },
            }),
          };
        first = false;
        const done = new Promise<number>((r) => {
          release = () => r(0);
        });
        return {
          exitCode: done,
          stdout: new ReadableStream({
            start(c) {
              for (const text of [
                '::add-ma',
                `sk::${token}\n`,
                'x'.repeat(3 * 1024 * 1024) + '\n',
                'y'.repeat(3 * 1024 * 1024) + '\n',
                token + '\n',
              ])
                c.enqueue(new TextEncoder().encode(text));
              c.close();
            },
          }),
        };
      },
    };
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      ctx: { container },
      masks: [],
      registeredMasks: [],
    }) as JobRunner;
    const req = {
      number: 2,
      argv: ['bash', '-c', 'test'],
      cwd: '/workspace',
      env: {},
      timeoutMs: 1000,
      masks: [],
    };
    const pending = runner.runStep(req);
    while (!release) await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 10));
    expect(await runner.live(2)).toContain('***');
    expect(await runner.live(2)).not.toContain(token);
    release();
    const result = await pending;
    expect(result.log).toContain('log truncated');
    expect(result.log).not.toContain(token);
    expect(result.masks).toContain(token);
    expect((await runner.runStep({ ...req, number: 3 })).log).toBe('***');
  });

  it('uses a process-group timeout and does not wait forever on a daemon holding stdout', async () => {
    let cancelled = false;
    const exec = vi.fn(async (argv: string[], options?: any) => {
      if (argv[0] !== '/usr/bin/timeout')
        return {
          exitCode: Promise.resolve(0),
          output: async () => ({ stdout: new TextEncoder().encode('\0\0\0') }),
        };
      expect(argv).toEqual([
        '/usr/bin/timeout',
        '--kill-after=5s',
        '0.25s',
        'bash',
        '-c',
        'sleep 100',
      ]);
      expect(options.signal).toBeUndefined();
      return {
        exitCode: Promise.resolve(124),
        stdout: new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      };
    });
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      ctx: { container: { running: true, exec } },
      masks: [],
      registeredMasks: [],
    }) as JobRunner;
    const result = await runner.runStep({
      number: 2,
      argv: ['bash', '-c', 'sleep 100'],
      cwd: '/',
      env: { PATH: '/workspace/custom-tools' },
      timeoutMs: 250,
      masks: [],
    });
    expect(cancelled).toBe(true);
    expect(result).toMatchObject({ timedOut: true, exitCode: 1 });
    expect(result.interrupted).toBeUndefined();
  });
});

it('rejects huge matrix products before copying any combination', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const map = vi.spyOn(values, 'map');
  expect(() =>
    expandMatrix({
      axes: Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [`x${i}`, values])
      ),
      include: [],
      exclude: [],
    })
  ).toThrow(/planning limit/);
  expect(map).not.toHaveBeenCalled();
  map.mockRestore();
});

it('preserves PR branch snapshots for execution and reruns after retargeting', async () => {
  const s = await setup();
  const yml = `on: pull_request
jobs:
  build:
    if: github.base_ref == 'main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ github.base_ref }} \${{ github.head_ref }}"
`;
  await pushFiles(s, 'main', { '.github/workflows/ci.yml': yml });
  s.repo.refs.set('refs/heads/feature', s.repo.refs.get('refs/heads/main')!);
  await pushFiles(s, 'feature', {
    '.github/workflows/ci.yml': yml,
    'new.txt': 'new',
  });
  expect(
    (
      await call(s.t, '/api/repos/octocat/app/pulls', {
        cookie: s.admin,
        json: { title: 'PR', base: 'main', head: 'feature' },
      })
    ).status
  ).toBe(201);
  await settle(s.t);
  await s.t.env.DB.prepare(
    "UPDATE pull_requests SET base_ref='changed-base', head_ref='changed-head'"
  ).run();
  const [run] = (await runs(s.t, s.admin)).runs;
  const h = harness(s.t);
  expect(await h.run(run.id)).toBe('success');
  expect(script(h.requests[0])).toBe('echo "main feature"');
  expect(h.requests[0].env).toMatchObject({
    GITHUB_BASE_REF: 'main',
    GITHUB_HEAD_REF: 'feature',
  });
  expect(
    (
      await call(s.t, '/api/repos/octocat/app/actions/runs/1/rerun', {
        cookie: s.admin,
        method: 'POST',
      })
    ).status
  ).toBe(201);
  const [again] = (await runs(s.t, s.admin)).runs;
  const h2 = harness(s.t);
  expect(await h2.run(again.id)).toBe('success');
  expect(script(h2.requests[0])).toBe('echo "main feature"');
});

it('retries a failed landing delivery with one run and one Workflow instance', async () => {
  const s = await setup();
  const sha = await pushFiles(s, 'main', {
    '.github/workflows/ci.yml':
      'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
  });
  const db = drizzle(s.t.env.DB, { schema });
  const repo = await db.select().from(schema.repositories).get();
  let unavailable = true;
  const started = new Set<string>();
  const original = s.t.env.ACTIONS_RUN;
  s.t.env.ACTIONS_RUN = {
    create: async ({ id }: { id: string }) => {
      if (unavailable || started.has(id))
        throw new Error('unavailable or exists');
      started.add(id);
    },
    get: async (id: string) => ({
      status: async () => {
        if (!started.has(id)) throw new Error('not found');
        return { status: 'running' };
      },
    }),
  } as any;
  const deliver = () =>
    onRefsUpdated(
      s.t.env,
      db,
      repo!,
      'octocat/app',
      [{ ref: 'refs/heads/main', old: '0'.repeat(40), new: sha }],
      null,
      'landing:stable'
    );
  try {
    await expect(deliver()).rejects.toThrow('unavailable');
    unavailable = false;
    await deliver();
    await deliver();
    expect(started.size).toBe(1);
    const rows = await s.t.env.DB.prepare(
      'SELECT id FROM workflow_runs WHERE trigger_key IS NOT NULL'
    ).all();
    expect(rows.results).toHaveLength(1);
    expect(
      (
        await s.t.env.DB.prepare(
          'SELECT COUNT(*) AS n FROM workflow_jobs WHERE run_id = ?'
        )
          .bind(rows.results[0].id)
          .first<{ n: number }>()
      )?.n
    ).toBe(1);
  } finally {
    s.t.env.ACTIONS_RUN = original;
  }
});
