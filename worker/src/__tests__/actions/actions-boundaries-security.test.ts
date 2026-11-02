// CloudForge fork addition (2026-11-02). SPDX-License-Identifier: GPL-3.0-or-later.
import { expect, it, vi } from 'vitest';
import { JobRunner, type StepRequest } from '../../actions/job-runner';
import { enforceCacheLimit } from '../../actions/cache';
import {
  harness,
  pushFiles,
  runDetail,
  runs,
  script,
  setup,
} from '../helpers/actions';
import { resetAccessRuntimeFixture } from '../helpers/access-runtime';

/** Actual admission with a dedicated real D1 that is temporarily unavailable. */
async function refusal(req: StepRequest) {
  const DB = await resetAccessRuntimeFixture({ seed: false });
  await DB.prepare('DROP TABLE access_runtime_state').run();
  const exec = vi.fn();
  const runner = Object.assign(Object.create(JobRunner.prototype), {
    env: { DB },
    ctx: { container: { running: true, exec } },
  }) as JobRunner;
  try {
    const result = await runner.runStep(req);
    expect(exec).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refused: 'runtime-admission', exitCode: 1 });
    expect(result.interrupted).toBeUndefined();
    // Model the data-only RPC contract; no Error instance identity is available.
    return JSON.parse(JSON.stringify(result)) as typeof result;
  } finally {
    await resetAccessRuntimeFixture();
  }
}

it('准入短暂失败后不重放已完成命令，也不再执行 always/收尾步骤', async () => {
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
      - run: unreachable
        if: always()
`,
  });
  const [run] = (await runs(s.t, s.admin)).runs;
  let refused = false;
  const executed: string[] = [];
  const h = harness(
    s.t,
    async (req) => {
      if (script(req) === 'after-deploy' && !refused) {
        refused = true;
        return refusal(req);
      }
      executed.push(script(req));
      return {};
    },
    { retrySteps: true }
  );
  expect(await h.run(run.id)).toBe('failure');
  expect(executed).toEqual(['deploy-once']);
  expect(h.boots).toHaveLength(1);
  expect(h.destroyed).toHaveLength(1);
  expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
  const { jobs } = await runDetail(s.t, s.admin, run.runNumber);
  expect(jobs[0].steps.map((s) => s.conclusion)).toEqual([
    'success',
    'success',
    'failure',
    'skipped',
    'success',
  ]);
});

it('复合动作的子命令准入拒绝不重放先前完成的子命令', async () => {
  const s = await setup();
  await pushFiles(s, 'main', {
    '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/composite
`,
    '.github/actions/composite/action.yml': `runs:
  using: composite
  steps:
    - run: deploy-once
      shell: bash
    - run: after-deploy
      shell: bash
    - run: unreachable
      shell: bash
      if: always()
`,
  });
  const [run] = (await runs(s.t, s.admin)).runs;
  const executed: string[] = [];
  const h = harness(s.t, async (req) => {
    if (script(req) === 'after-deploy') return refusal(req);
    executed.push(script(req));
    return {};
  });
  expect(await h.run(run.id)).toBe('failure');
  expect(executed).toEqual(['deploy-once']);
  expect(h.boots).toHaveLength(1);
  expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
});

it.each(['action-post', 'cache-post'] as const)(
  '%s 准入拒绝必须失败，不能被当作最佳努力的中断而成功',
  async (phase) => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/first
      - uses: ./.github/actions/second
      ${phase === 'cache-post' ? '- uses: actions/cache@v4\n        with:\n          key: cache-key\n          path: deps' : ''}
`,
      '.github/actions/first/action.yml':
        'runs:\n  using: node24\n  main: first.js\n  post: cleanup-first.js\n',
      '.github/actions/second/action.yml':
        'runs:\n  using: node24\n  main: second.js\n  post: cleanup-second.js\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const executed: string[] = [];
    const h = harness(s.t, async (req) => {
      if (
        (phase === 'action-post' &&
          script(req).includes('cleanup-second.js')) ||
        (phase === 'cache-post' && req.env.CACHE_URL)
      )
        return refusal(req);
      executed.push(script(req));
      return {};
    });
    expect(await h.run(run.id)).toBe('failure');
    expect(executed).toHaveLength(phase === 'cache-post' ? 3 : 2);
    expect(executed.some((s) => s.includes('cleanup-'))).toBe(false);
    expect(h.boots).toHaveLength(1);
    expect(h.stepNames.some((n) => n.endsWith(':restart'))).toBe(false);
    const { jobs } = await runDetail(s.t, s.admin, run.runNumber);
    expect(jobs[0].steps.every((s) => s.status === 'completed')).toBe(true);
    expect(
      jobs[0].steps.filter((s) => s.conclusion === 'failure')
    ).toHaveLength(1);
  }
);

/** A paginated R2 substitute enforces the documented per-delete API limit. */
function cacheBucket(count: number) {
  const objects = new Map(
    Array.from({ length: count + 2 }, (_, i) => {
      const key = `actions-cache/a/${String(i).padStart(5, '0')}`;
      return [
        key,
        { key, size: i < count ? 1 : 5 * 1024 ** 3, uploaded: new Date(i) },
      ] as const;
    })
  );
  const attempts: string[][] = [];
  let failAt: number | undefined;
  const bucket = {
    list: async ({ cursor }: { cursor?: string }) => {
      const offset = Number(cursor ?? 0);
      const all = [...objects.values()];
      const page = all.slice(offset, offset + 337);
      return {
        objects: page,
        truncated: offset + 337 < all.length,
        cursor: String(offset + 337),
      };
    },
    delete: async (keys: string[]) => {
      attempts.push(keys);
      if (keys.length > 1000)
        throw new Error('R2 delete supports at most 1000 keys');
      if (attempts.length === failAt)
        throw new Error('temporary R2 delete failure');
      for (const key of keys) objects.delete(key);
    },
  };
  return {
    objects,
    attempts,
    fail: (at: number) => {
      failAt = at;
    },
    env: { ACTIONS_CACHE: bucket } as unknown as CloudflareBindings,
  };
}

it.each([0, 1, 1000, 1001, 2001])(
  '缓存淘汰 %i 个旧条目时，每次删除不超过 1000 键',
  async (count) => {
    const b = cacheBucket(count);
    const evicted = await enforceCacheLimit(b.env, 'a');
    expect(evicted).toHaveLength(count);
    expect(b.attempts.flat()).toEqual(evicted);
    expect(b.attempts.map((keys) => keys.length)).toEqual(
      Array.from({ length: Math.ceil(count / 1000) }, (_, i) =>
        Math.min(1000, count - i * 1000)
      )
    );
    expect(b.objects.size).toBe(2);
    expect([...b.objects.values()].every((o) => o.size === 5 * 1024 ** 3)).toBe(
      true
    );
  }
);

it('部分删除失败后报告错误，下次只淘汰剩余旧缓存并保留新缓存', async () => {
  const b = cacheBucket(2001);
  b.fail(2);
  await expect(enforceCacheLimit(b.env, 'a')).rejects.toThrow(
    'temporary R2 delete failure'
  );
  expect(b.objects.size).toBe(1003);
  expect(b.attempts.map((keys) => keys.length)).toEqual([1000, 1000]);
  const remaining = [...b.objects.keys()].slice(0, 1001);
  expect(await enforceCacheLimit(b.env, 'a')).toEqual(remaining);
  expect(b.attempts.slice(2).map((keys) => keys.length)).toEqual([1000, 1]);
  expect(b.objects.size).toBe(2);
  expect([...b.objects.values()].every((o) => o.size === 5 * 1024 ** 3)).toBe(
    true
  );
});
