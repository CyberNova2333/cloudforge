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

it('支持短脱敏值，对重叠值脱敏时不泄露较长值的后缀', () => {
  const parsed = workflowCommands(
    '::add-mask::xy\n::add-mask::abcd\n::add-mask::abcdef\nxy abcdef'
  );
  expect(mask(parsed.text, parsed.masks)).toBe('*** ***');
});

it('对交叉和自重叠密钥匹配的并集进行脱敏', () => {
  expect(mask('abcdef', ['abcd', 'cdef'])).toBe('***');
  expect(mask('abcdef', ['cdef', 'abcd'])).toBe('***');
  expect(mask('ababa', ['aba'])).toBe('***');
  expect(mask('x and *', ['x', '*'])).toBe('*** and ***');
});

it('对完整长度日志中密集自重叠的密钥进行脱敏', () => {
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

describe('Actions 持久化密钥状态', () => {
  it('下一步骤无法更新 D1 时，不重放已完成的命令', async () => {
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
    'R2 %s 写入失败后，不重复已完成的命令',
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

  it('持久化可重放的失败标记，且不包含异常文本或含密钥的状态', async () => {
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

  it('无法保存收尾结果时，停止后续清理命令', async () => {
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
    '仅重试 R2 读取，不重复已完成的命令（持续故障：%s）',
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

  it('无法恢复已完成作业的输出时明确报告失败，且不重新执行命令', async () => {
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

  it('无法恢复收尾步骤的脱敏规则时，停止后续收尾命令', async () => {
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

  it('不将未使用的大型静态密钥复制到每个持久化结果中', async () => {
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

  it('加密命令文件、收尾输入和脱敏规则，并在重放时恢复', async () => {
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

  it('跨重放将请求凭据保留为加密脱敏规则，并禁止输出与其匹配的作业结果', async () => {
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

  it('将加密状态绑定到所属运行和步骤，未配置 Actions 密钥时也可工作', async () => {
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

  it('将大型状态加密存入 R2，同时保持 Workflow 结果精简', async () => {
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

describe('JobRunner 脱敏与进程生命周期', () => {
  it('对运行器实时日志和已保存日志中交叉的密钥进行脱敏', async () => {
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
  it('进程成功退出后读取 stdout 失败时，报告失败', async () => {
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

  it('跨数据块、截断、实时日志和后续步骤保留动态脱敏规则', async () => {
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

  it('使用进程组超时，不无限等待持有 stdout 的守护进程', async () => {
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
        // GNU timeout's own exit, once the deadline has passed.
        exitCode: new Promise<number>((r) => setTimeout(() => r(124), 300)),
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

  /** A runner over a fake container whose step prints `stdout` and exits with `code`. */
  const fakeRunner = (stdout: string, code: number) => {
    const exec = vi.fn(async (argv: string[]) =>
      argv[0] !== '/usr/bin/timeout'
        ? {
            exitCode: Promise.resolve(0),
            output: async () => ({
              stdout: new TextEncoder().encode('\0\0\0'),
            }),
          }
        : {
            exitCode: Promise.resolve(code),
            stdout: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(stdout));
                controller.close();
              },
            }),
          }
    );
    return Object.assign(Object.create(JobRunner.prototype), {
      ctx: { container: { running: true, exec } },
      masks: [],
      registeredMasks: [],
    }) as JobRunner;
  };
  const step = {
    number: 2,
    argv: ['bash', '-c', 'node build.js'],
    cwd: '/',
    env: {},
    timeoutMs: 60_000,
    masks: [],
  };

  it('提前以 137（被 OOM 杀掉）或 124 退出算步骤自身失败，不算超时', async () => {
    for (const code of [137, 124]) {
      const result = await fakeRunner('Killed\n', code).runStep(step);
      expect(result).toMatchObject({ timedOut: false, exitCode: code });
      expect(result.log).not.toContain('exceeded its timeout');
      expect(result.interrupted).toBeUndefined();
    }
  });

  it('遮蔽多行 add-mask 值，但不会把日志里所有花括号都遮掉', async () => {
    const result = await fakeRunner(
      '::add-mask::{%0A  "token": "s3cr3t-value"%0A}\n{"ok":true} "token": "s3cr3t-value"\n',
      0
    ).runStep(step);
    expect(result.log.trim()).toBe('{"ok":true} ***');
    expect(result.masks).toContain('"token": "s3cr3t-value"');
    expect(result.masks).not.toContain('{');
    expect(result.masks).not.toContain('}');
  });
});

it('复制任何组合前，拒绝过大的矩阵笛卡尔积', () => {
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

it('重新指定目标分支后，执行及重跑仍保留 PR 分支快照', async () => {
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

it('通过单个运行和单个 Workflow 实例重试失败的合并投递', async () => {
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
    // The push itself queued its run under its own event; this delivery's runs carry its key.
    const rows = await s.t.env.DB.prepare(
      "SELECT id FROM workflow_runs WHERE instr(trigger_key, 'landing:stable') > 0"
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
