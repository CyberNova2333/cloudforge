// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { Harness } from '@earendil-works/pi-durable';
import { ActionsRun } from '../../actions/run-workflow';
import { JobRunner, type StepRequest } from '../../actions/job-runner';
import { ActionsQueue } from '../../actions/queue';
import { FREQUENT_CRON, runFrequentJobs, runScheduled } from '../../cron';
import { LiveHub } from '../../live/hub';
import { MergeResolver } from '../../merge/resolver';
import { MergeResolutionWorkflow } from '../../merge/workflow';
import { AgentReviewer } from '../../review/agent-reviewer';
import {
  PI_DEFAULT_LIMITS,
  PI_NO_USAGE,
  PI_TOMBSTONE_MS,
  type PiMeta,
  type PiUsage,
} from '../../review/pi-contract';
import { resetAccessRuntimeFixture } from '../helpers/access-runtime';

async function fencedEnv() {
  const DB = await resetAccessRuntimeFixture();
  await fence(DB);
  return { ...env, DB } as CloudflareBindings;
}

async function fence(DB: D1Database) {
  await DB.prepare(
    'UPDATE access_runtime_state SET minimum_protocol = 2, revision = 1 WHERE id = 1'
  ).run();
}

const rejected = (work: Promise<unknown>) =>
  expect(work).rejects.toMatchObject({
    name: 'AccessRuntimeError',
    status: { reason: 'unsupported' },
  });

describe('后台运行时准入围栏', () => {
  it('停止期间，已暂停的真实限额 hook 不能通过迟到 abort 重新打开 Pi', async () => {
    const stub = env.AGENT_REVIEWER.getByName(
      `late-limit-${crypto.randomUUID()}`
    );
    await runInDurableObject(stub, async (instance, state) => {
      const reviewer = instance as unknown as AgentReviewer;
      const internal = reviewer as unknown as {
        install(meta: PiMeta): void;
        usage(): Promise<PiUsage>;
      };
      const meta: PiMeta = {
        ...PI_DEFAULT_LIMITS,
        startedAt: Date.now(),
        handle: 'reviewer',
        suffix: 'test',
        changedPaths: [],
        model: 'test',
        notify: null,
      };
      const registration = vi.spyOn(reviewer.registry, 'install');
      internal.install(meta);
      const hooks = registration.mock.calls[0][0].hooks as unknown as {
        handlers: { beforeRequest?: (...args: unknown[]) => Promise<unknown> };
      }[];
      const beforeRequest = hooks.find((entry) => entry.handlers.beforeRequest)!
        .handlers.beforeRequest!;
      registration.mockRestore();
      await state.storage.put('meta', meta);
      await state.storage.put('limited', 'already limited');
      // Open normally first. No prompt or model request is submitted by this test.
      await reviewer.harness.pending();
      let releaseUsage!: (value: PiUsage) => void;
      const usage = vi.spyOn(internal, 'usage').mockImplementationOnce(
        () =>
          new Promise<PiUsage>((resolve) => {
            releaseUsage = resolve;
          })
      );
      const signal = new AbortController();
      const invocation = beforeRequest(
        {},
        {},
        { abortSignal: signal.signal }
      ).catch(() => undefined);
      let disposing!: () => void;
      const disposeStarted = new Promise<void>((resolve) => {
        disposing = resolve;
      });
      const realDispose = reviewer.harness.dispose.bind(reviewer.harness);
      const dispose = vi
        .spyOn(reviewer.harness, 'dispose')
        .mockImplementation(async () => {
          // Pi closes/aborts existing invocations and joins them before deleting storage.
          // The actual registered hook is held at its real usage await, then released here.
          await realDispose();
          signal.abort();
          disposing();
          await invocation;
        });
      const reopened = vi.spyOn(Harness, 'open');
      const abort = vi.spyOn(reviewer.harness, 'abort');
      try {
        const stopping = reviewer.stop();
        await disposeStarted;
        releaseUsage(PI_NO_USAGE);
        await invocation;
        await Promise.allSettled(
          abort.mock.results.map((result) => result.value)
        );
        await stopping;
        expect(abort).not.toHaveBeenCalled();
        expect(reopened).not.toHaveBeenCalled();
        expect([...(await state.storage.list()).keys()]).toEqual(['stopped']);
      } finally {
        usage.mockRestore();
        dispose.mockRestore();
        reopened.mockRestore();
        abort.mockRestore();
        await realDispose();
      }
    });
  });
  it.each([
    ['Actions', ActionsRun],
    ['Merge', MergeResolutionWorkflow],
  ])(
    '%s Workflow 在缓存步骤和运行记录之前检查当前协议',
    async (_name, Type) => {
      const runtime = await fencedEnv();
      const workflow = Object.assign(Object.create(Type.prototype), {
        env: runtime,
      }) as ActionsRun | MergeResolutionWorkflow;
      const step = { do: vi.fn(), waitForEvent: vi.fn() };
      await rejected(workflow.run({ payload: {} } as never, step as never));
      expect(step.do).not.toHaveBeenCalled();
      expect(step.waitForEvent).not.toHaveBeenCalled();
    }
  );

  it('定时入口和直接调用的频繁任务都在业务读写之前关闭', async () => {
    const runtime = await fencedEnv();
    // The dedicated D1 has only runtime fixtures: touching business tables would
    // produce a different error, and must not be swallowed by individual jobs.
    await rejected(runScheduled({ cron: FREQUENT_CRON }, runtime));
    await rejected(runFrequentJobs(runtime));
  });

  it('容器 RPC 每次重读协议，阻止后续启动、命令和日志读取', async () => {
    const DB = await resetAccessRuntimeFixture();
    const start = vi.fn();
    const exec = vi.fn();
    const setAlarm = vi.fn();
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      env: { ...env, DB },
      ctx: { container: { running: true, start, exec }, storage: { setAlarm } },
      liveStep: { number: 1, text: 'secret output', masks: ['secret'] },
    }) as JobRunner;
    expect(await runner.live(1)).toBe('*** output');
    await fence(DB);
    await rejected(runner.live(1));
    await rejected(runner.boot('standard-1', 60_000));
    await rejected(runner.runStep({} as StepRequest));
    expect(start).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it('围栏不阻断容器硬停止，停止失败仍保留闹钟', async () => {
    const runtime = await fencedEnv();
    let fail = true;
    const container = {
      running: true,
      destroy: vi.fn(async () => {
        if (fail) throw new Error('stop failed');
        container.running = false;
      }),
    };
    const deleteAlarm = vi.fn();
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      env: runtime,
      ctx: { container, storage: { deleteAlarm } },
    }) as JobRunner;
    await expect(runner.destroy()).rejects.toThrow('stop failed');
    expect(deleteAlarm).not.toHaveBeenCalled();
    fail = false;
    await runner.alarm();
    expect(container.running).toBe(false);
    await runner.destroy();
    expect(deleteAlarm).toHaveBeenCalledOnce();
  });

  it('队列围栏保留已占容量、等待作业和恢复闹钟，不顺带启动下一项', async () => {
    const runtime = await fencedEnv();
    const stub = env.ACTIONS_QUEUE.getByName(`runtime-${crypto.randomUUID()}`);
    await runInDurableObject(stub, async (instance, state) => {
      const queue = instance as unknown as ActionsQueue;
      const request = (jobId: string) => ({
        jobId,
        runId: 'run',
        maxMinutes: 30,
        limit: 1,
      });
      expect((await queue.acquire(request('first'))).granted).toBe(true);
      expect((await queue.acquire(request('waiting'))).granted).toBe(false);
      const rows = () =>
        state.storage.sql.exec('SELECT * FROM entries ORDER BY seq').toArray();
      const before = rows();
      const alarm = await state.storage.getAlarm();
      const mutable = queue as unknown as { env: CloudflareBindings };
      const original = mutable.env;
      mutable.env = runtime;
      try {
        await rejected(queue.acquire(request('third')));
        await rejected(queue.started('first'));
        await rejected(queue.release('first'));
        await rejected(queue.cancelRun('run'));
        await rejected(queue.positions(['waiting']));
        await rejected(queue.reclaim());
        await rejected(queue.alarm());
        expect(rows()).toEqual(before);
        expect(await state.storage.getAlarm()).toBe(alarm);
      } finally {
        mutable.env = original;
      }
    });
  });

  it('实时 Hub 拒绝新连接和广播，已有连接仍可关闭', async () => {
    const runtime = await fencedEnv();
    const send = vi.fn();
    const acceptWebSocket = vi.fn();
    const getWebSockets = vi.fn(() => [{ send }]);
    const hub = Object.assign(Object.create(LiveHub.prototype), {
      env: runtime,
      ctx: { acceptWebSocket, getWebSockets },
    }) as LiveHub;
    await rejected(hub.fetch(new Request('https://test.local')));
    await rejected(hub.publish('repo:1', '{"type":"repo"}'));
    await rejected(hub.publishMany(['repo:1', 'repo:2'], '{"type":"repo"}'));
    expect(acceptWebSocket).not.toHaveBeenCalled();
    expect(getWebSockets).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const close = vi.fn();
    await hub.webSocketClose({ close } as unknown as WebSocket, 1005);
    expect(close).toHaveBeenCalledWith(1000, 'closing');
  });

  it('审查器拒绝启动、读取及 Lifecycle fetch，闹钟仅做停止和墓碑清理', async () => {
    const runtime = await fencedEnv();
    const stub = env.AGENT_REVIEWER.getByName(`runtime-${crypto.randomUUID()}`);
    await runInDurableObject(stub, async (instance, state) => {
      const reviewer = instance as unknown as AgentReviewer;
      const mutable = reviewer as unknown as { env: CloudflareBindings };
      const original = mutable.env;
      mutable.env = runtime;
      const alarm = vi.spyOn(reviewer.lifecycle, 'alarm');
      const fetch = vi.spyOn(reviewer.lifecycle, 'fetch');
      try {
        await rejected(reviewer.start({} as never));
        await rejected(reviewer.startLearning({} as never));
        await rejected(reviewer.status());
        await rejected(reviewer.learned());
        await rejected(reviewer.fetch(new Request('https://test.local')));
        expect(fetch).not.toHaveBeenCalled();
        await reviewer.alarm();
        expect(alarm).not.toHaveBeenCalled();
        const stopped = await state.storage.get<number>('stopped');
        expect(stopped).toBeTypeOf('number');
        await reviewer.stop();
        expect(await state.storage.get<number>('stopped')).toBe(stopped);
        await reviewer.alarm();
        expect(await state.storage.getAlarm()).toBe(stopped! + PI_TOMBSTONE_MS);
        await state.storage.put('stopped', Date.now() - PI_TOMBSTONE_MS - 1);
        await reviewer.alarm();
        expect(await state.storage.get('stopped')).toBeUndefined();
      } finally {
        alarm.mockRestore();
        fetch.mockRestore();
        mutable.env = original;
      }
    });
  });

  it('冲突解析器在 RPC、Lifecycle fetch 和闹钟恢复前拒绝旧协议', async () => {
    const lifecycle = { fetch: vi.fn(), alarm: vi.fn() };
    const resolver = Object.assign(Object.create(MergeResolver.prototype), {
      env: await fencedEnv(),
      lifecycle,
    }) as MergeResolver;
    await rejected(resolver.resolve({} as never));
    await rejected(resolver.fetch(new Request('https://test.local')));
    await rejected(resolver.alarm());
    expect(lifecycle.fetch).not.toHaveBeenCalled();
    expect(lifecycle.alarm).not.toHaveBeenCalled();
  });

  it.each([
    ['meta', 'alarm'],
    ['draft', 'alarm'],
    ['meta', 'stop'],
    ['meta', 'expire'],
  ] as const)(
    '冷审查器带 %s 时，%s 清理不能初始化或恢复 Pi',
    async (key, entry) => {
      const runtime = await fencedEnv();
      const stub = env.AGENT_REVIEWER.getByName(
        `cleanup-${crypto.randomUUID()}`
      );
      await runInDurableObject(stub, async (instance, state) => {
        const reviewer = instance as unknown as AgentReviewer;
        const mutable = reviewer as unknown as { env: CloudflareBindings };
        const original = mutable.env;
        mutable.env = runtime;
        // A prior run left a checkpoint, but this instance has never opened Pi.
        // Teardown only needs to know that there is state to remove.
        await state.storage.put(key, { mode: 'review', startedAt: Date.now() });
        await state.storage.put('private-checkout', 'must be removed');
        const startup = vi.spyOn(reviewer.harness, 'onStart');
        const abort = vi.spyOn(reviewer.harness, 'abort');
        const dispose = vi.spyOn(reviewer.harness, 'dispose');
        try {
          if (entry === 'expire')
            await reviewer.onJob({ job: { fn: 'expire' } });
          else await reviewer[entry]();
          expect(startup).not.toHaveBeenCalled();
          expect(abort).not.toHaveBeenCalled();
          expect(dispose).toHaveBeenCalledOnce();
          expect([...(await state.storage.list()).keys()]).toEqual(['stopped']);
          expect(await state.storage.getAlarm()).toBe(
            (await state.storage.get<number>('stopped'))! + PI_TOMBSTONE_MS
          );
        } finally {
          startup.mockRestore();
          abort.mockRestore();
          dispose.mockRestore();
          mutable.env = original;
        }
      });
    }
  );
});
