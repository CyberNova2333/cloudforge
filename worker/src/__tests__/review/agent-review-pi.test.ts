// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PI_FALLBACK_NOTE, PI_GONE } from '../../review/outcome';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import type { StepRunner } from '../../merge/resolution';
import {
  executeHeadReview,
  REVIEW_STALE_MS,
  REVIEW_STOPPED,
  stopStaleReviews,
} from '../../review/head';
import {
  isWaitTimeout,
  piBudgetSpent,
  PI_CLOSED,
  PI_LOST,
  PI_SUPERSEDED,
  piTimeUp,
} from '../../review/pi';
import {
  PI_DEFAULT_LIMITS,
  piChecks,
  piEventType,
  piReviewerName,
} from '../../review/pi-contract';
import {
  AGENT_MD,
  agentModels,
  appRepo,
  APPROVE,
  BASE,
  fakePi,
  flags,
  invitedAgent,
  openPull,
  reviewers,
  runReviews,
  startReview,
} from '../helpers/reviews';
import { call } from '../helpers/app';
import { commitPaths } from '../helpers/seed';

const CHANGE = {
  'src/auth.ts': 'export const token = "x";\nexport const ttl = 60;\n',
};

/** Changes a Site admin setting as `cookie` (a site admin). */
const setting = (t: T, cookie: string, key: string, value: unknown) =>
  call(t, `/api/admin/settings/${key}`, {
    cookie,
    method: 'PUT',
    json: { value },
  });

type T = Awaited<ReturnType<typeof appRepo>>['t'];

/** octocat/app with @secagent (engine: pi) invited and pull request #1's head under review. */
async function piReview(
  md = AGENT_MD({ engine: 'pi', body: 'Check tokens.' })
) {
  const { t, admin, repo } = await appRepo();
  const agent = await invitedAgent(t, admin, 'secagent', md);
  const pull = await openPull(t, admin, repo, CHANGE);
  const review = await startReview(t);
  return { t, admin, repo, agentSha: agent.sha, reviewId: review!.id, ...pull };
}

const done = (review: unknown) => ({
  state: 'done' as const,
  text: JSON.stringify(review),
});

const FINDINGS = {
  verdict: 'findings',
  summary: 'Read the token handling and its callers.',
  findings: [
    {
      kind: 'needs_person',
      title: 'Hard-coded token',
      detail: 'Adds a literal token to the source.',
      changes: [{ what: 'token', before: 'none', after: 'literal "x"' }],
      diagram: null,
      snippets: [{ path: 'src/auth.ts', start: 1, end: 1, why: 'the literal' }],
      files: ['src/auth.ts'],
    },
    {
      kind: 'change_requested',
      title: 'Fixed TTL',
      detail: 'Read the TTL from configuration instead of hard-coding 60.',
      changes: [{ what: 'ttl', before: 'none', after: '60' }],
      diagram: null,
      snippets: [],
      files: ['src/auth.ts'],
    },
  ],
};

/** The (only) reviewer row's id and generation. */
async function attempt(t: T) {
  const r = await t.env.DB.prepare(
    'SELECT id, created_at FROM pr_reviewers ORDER BY created_at DESC'
  ).first<{ id: string; created_at: number }>();
  return { id: r!.id, generation: r!.created_at * 1000 };
}

describe('engine: pi 审查引擎', () => {
  it('在 Pi 工作区使用单轮审查的输入进行审查，并记录批准结果', async () => {
    const { t, head, agentSha, reviewId } = await piReview();
    const pi = fakePi(() =>
      done({ ...APPROVE, summary: 'Read the callers; fine.' })
    );
    const { models, calls } = agentModels();
    await runReviews(t, models, { pi: pi.api });

    expect((await reviewers(t))[0]).toMatchObject({
      status: 'approved',
      summary: 'Read the callers; fine.',
    });
    expect(calls.reviewed).toEqual([]);
    const { id, generation } = await attempt(t);
    const name = piReviewerName(id, generation);
    expect(pi.starts).toEqual([name]);
    const { request } = pi.objects.get(name)!;
    expect(request).toMatchObject({
      reviewerId: id,
      generation,
      handle: 'secagent',
      headSha: head,
      changedPaths: ['src/auth.ts'],
      model: '@cf/zai-org/glm-5.3',
      limits: PI_DEFAULT_LIMITS,
      ignoreText: null,
      input: {
        handle: 'secagent',
        agentSha,
        instructions: 'Check tokens.',
        title: 'Change things',
      },
    });
    expect(request.input.diffs).toContain('export const token');
    expect(request.notify).toEqual({
      instanceId: expect.stringMatching(/^review-/),
      type: piEventType(id, generation),
    });
    // Ended: the DO is told to delete its workspace and transcript.
    expect(pi.stopped).toEqual([name]);
    const usage = await t.env.DB.prepare(
      "SELECT id, model, requests, tokens_in, tokens_out, classification_id FROM ai_usage WHERE feature = 'review-agent-pi'"
    ).all();
    expect(usage.results).toEqual([
      {
        id: `review-agent-pi:${id}:${generation}`,
        model: '@cf/zai-org/glm-5.3',
        requests: 2,
        tokens_in: 2000,
        tokens_out: 200,
        classification_id: reviewId,
      },
    ]);
  });

  it('将审查意见记录为智能体所有的标记，并从真实差异中截取片段', async () => {
    const { t, agentSha } = await piReview();
    const pi = fakePi(() => done(FINDINGS));
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'changes_requested',
      summary: 'Read the token handling and its callers.',
    });
    const [first, second] = await flags(t);
    expect(first).toMatchObject({
      agent: 'secagent',
      kind: 'needs_person',
      agent_sha: agentSha,
    });
    expect(first.detail).toContain('Adds a literal token to the source.');
    expect(first.detail).toContain('```diff\n+export const token = "x";');
    expect(second).toMatchObject({ kind: 'change_requested' });
  });

  it('Pi 工作期间持续等待', async () => {
    const { t } = await piReview();
    const pi = fakePi((n) => (n < 4 ? { state: 'running' } : done(APPROVE)));
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0].status).toBe('approved');
    const [object] = [...pi.objects.values()];
    expect(object.checks).toBe(4);
  });

  it('Pi 答复不符合约定时，以解析器消息报告失败', async () => {
    const { t } = await piReview();
    const pi = fakePi(() => ({
      state: 'done',
      text: 'Looks good to me, approving.',
    }));
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: 'The review model failed: The review model did not answer in JSON',
    });
    expect(await flags(t)).toEqual([]);
    expect(pi.stopped).toHaveLength(1);
  });

  // One instance per test (setup runs once), so each case is its own test.
  it('Pi 放弃时报告失败', async () => {
    const gaveUp = await piReview();
    await runReviews(gaveUp.t, agentModels().models, {
      pi: fakePi(() => ({ state: 'unanswered', reason: 'model error' })).api,
    });
    expect((await reviewers(gaveUp.t))[0]).toMatchObject({
      status: 'failed',
      error: 'The review model failed: Pi did not finish (model error).',
    });
  });

  it('工作区消失时报告失败', async () => {
    const lost = await piReview();
    await runReviews(lost.t, agentModels().models, {
      pi: fakePi(() => ({ state: 'missing' })).api,
    });
    expect((await reviewers(lost.t))[0]).toMatchObject({
      status: 'failed',
      error: PI_LOST,
    });
  });

  it('超过实际耗时上限时停止审查', async () => {
    const slow = await piReview();
    const late = fakePi(() => ({ state: 'running' }), {
      startedAt: Date.now() - PI_DEFAULT_LIMITS.wallClockMs - 1000,
    });
    await runReviews(slow.t, agentModels().models, { pi: late.api });
    expect((await reviewers(slow.t))[0]).toMatchObject({
      status: 'failed',
      error: piTimeUp(PI_DEFAULT_LIMITS),
    });
    expect(late.stopped).toHaveLength(1);
  });

  it('超出预算时停止审查', async () => {
    const costly = await piReview();
    const spender = fakePi(() => ({ state: 'running' }), {
      turnsPerCheck: PI_DEFAULT_LIMITS.maxModelCalls + 1,
    });
    await runReviews(costly.t, agentModels().models, { pi: spender.api });
    expect((await reviewers(costly.t))[0]).toMatchObject({
      status: 'failed',
      error: piBudgetSpent(PI_DEFAULT_LIMITS),
    });
    // Its spend is on the record.
    const usage = await costly.t.env.DB.prepare(
      "SELECT requests FROM ai_usage WHERE feature = 'review-agent-pi'"
    ).first<{ requests: number }>();
    expect(usage!.requests).toBe(PI_DEFAULT_LIMITS.maxModelCalls + 1);
  });

  it('将 Durable Object 自行强制执行的预算上限报告为预算已用尽', async () => {
    const { t } = await piReview();
    const pi = fakePi(() => ({
      state: 'unanswered',
      reason: 'The Pi review used up its budget (80 model calls).',
    }));
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: piBudgetSpent(PI_DEFAULT_LIMITS),
    });
    expect(pi.stopped).toHaveLength(1);
  });

  it('遵循审查启动时从站点管理读取的调低限额', async () => {
    const { t, admin } = await piReview();
    expect(
      (await setting(t, admin, 'review.pi_max_model_calls', 5)).status
    ).toBe(200);
    expect(
      (await setting(t, admin, 'review.pi_max_tool_calls', 12)).status
    ).toBe(200);
    expect((await setting(t, admin, 'review.pi_minutes', 5)).status).toBe(200);
    const lowered = {
      wallClockMs: 5 * 60_000,
      maxToolCalls: 12,
      maxModelCalls: 5,
      maxInputTokens: PI_DEFAULT_LIMITS.maxInputTokens,
    };
    // 6 model calls by the first check: over the lowered budget of 5, far under the default 80.
    const pi = fakePi(() => ({ state: 'running' }), { turnsPerCheck: 6 });
    await runReviews(t, agentModels().models, { pi: pi.api });
    const [object] = [...pi.objects.values()];
    // The DO gets the review's limits (it enforces the tool budget and expires after the wall clock).
    expect(object.request.limits).toEqual(lowered);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: piBudgetSpent(lowered),
    });
    expect(piBudgetSpent(lowered)).toBe(
      'The Pi review used up its budget (5 model calls or 4,000,000 input tokens).'
    );
  });

  it('遵循调低的实际耗时上限', async () => {
    const { t, admin } = await piReview();
    expect((await setting(t, admin, 'review.pi_minutes', 5)).status).toBe(200);
    // Started 6 minutes ago: past the lowered 5 minutes, well inside the default 30.
    const pi = fakePi(() => ({ state: 'running' }), {
      startedAt: Date.now() - 6 * 60_000,
    });
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: 'The Pi review ran out of time (5 minutes).',
    });
  });

  it('使用深度审查模型运行，并将用量记录到该模型', async () => {
    const { t, admin } = await piReview();
    expect(
      (await setting(t, admin, 'ai.review_pi_model', '@cf/qwen/qwen3-coder'))
        .status
    ).toBe(200);
    const pi = fakePi(() => done(APPROVE));
    await runReviews(t, agentModels().models, { pi: pi.api });
    const [object] = [...pi.objects.values()];
    expect(object.request.model).toBe('@cf/qwen/qwen3-coder');
    const usage = await t.env.DB.prepare(
      "SELECT model FROM ai_usage WHERE feature = 'review-agent-pi'"
    ).all<{ model: string }>();
    expect(usage.results).toEqual([{ model: '@cf/qwen/qwen3-coder' }]);
  });

  it('等待超时后立即检查；因其他原因失败时等待完整间隔', async () => {
    expect(isWaitTimeout(new Error('pi-wait:secagent:1: timed out'))).toBe(
      true
    );
    expect(isWaitTimeout(new Error('waitForEvent timeout'))).toBe(true);
    // The Workflows engine's own wording (miniflare), and its error's name.
    expect(isWaitTimeout(new Error('Execution timed out after 120000ms'))).toBe(
      true
    );
    expect(
      isWaitTimeout(
        Object.assign(new Error('gone'), { name: 'WorkflowTimeoutError' })
      )
    ).toBe(true);
    expect(isWaitTimeout(new Error('waitForEvent is not supported'))).toBe(
      false
    );
    const { t, reviewId } = await piReview();
    const pi = fakePi((n) => (n < 3 ? { state: 'running' } : done(APPROVE)));
    const slept: string[] = [];
    const failingWaits = {
      do: async (_name: string, a: unknown, b?: unknown) =>
        ((b ?? a) as () => Promise<unknown>)(),
      sleep: async (name: string) => void slept.push(name),
      waitForEvent: async () => {
        throw new Error('waitForEvent is not supported');
      },
    } as unknown as StepRunner;
    await executeHeadReview(
      {
        env: t.env,
        db: drizzle(t.env.DB, { schema }),
        step: failingWaits,
        models: agentModels().models,
        pi: pi.api,
        instanceId: 'review-failing-waits',
      },
      reviewId
    );
    // One interval before each check, never back-to-back checks; the review still ends on its answer.
    expect(slept.filter((n) => n.startsWith('pi-wait:'))).toEqual([
      'pi-wait:secagent:1:sleep',
      'pi-wait:secagent:2:sleep',
      'pi-wait:secagent:3:sleep',
    ]);
    expect((await reviewers(t))[0].status).toBe('approved');
  });

  it('未配置 Pi 时回退到单轮审查，并说明原因', async () => {
    const { t } = await piReview();
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.reviewed).toHaveLength(1);
    const [row] = await reviewers(t);
    expect(row.status).toBe('approved');
    expect(row.summary).toBe(`${APPROVE.summary} ${PI_FALLBACK_NOTE}`);
  });

  it('即使配置了 Pi，engine: pass 智能体仍执行单轮审查', async () => {
    const { t } = await piReview(AGENT_MD());
    const pi = fakePi();
    const { models, calls } = agentModels();
    await runReviews(t, models, { pi: pi.api });
    expect(calls.reviewed).toHaveLength(1);
    expect(pi.starts).toEqual([]);
    expect((await reviewers(t))[0].summary).toBe(APPROVE.summary);
  });

  describe('在所有退出路径中停止 Durable Object', () => {
    /** Runs the head review inline with `steps` (waits that time out unless given). */
    const runWith = (
      t: T,
      reviewId: string,
      pi: ReturnType<typeof fakePi>,
      steps: Partial<Record<'waitForEvent' | 'sleep', unknown>> = {}
    ) =>
      executeHeadReview(
        {
          env: t.env,
          db: drizzle(t.env.DB, { schema }),
          step: {
            do: async (_name: string, a: unknown, b?: unknown) =>
              ((b ?? a) as () => Promise<unknown>)(),
            sleep: async () => {},
            waitForEvent: async (name: string) => {
              throw new Error(`${name}: timed out`);
            },
            ...steps,
          } as unknown as StepRunner,
          models: agentModels().models,
          pi: pi.api,
          instanceId: 'review-inline',
        },
        reviewId
      );

    const usageOf = (t: T) =>
      t.env.DB.prepare(
        "SELECT id, model, requests FROM ai_usage WHERE feature = 'review-agent-pi'"
      ).all<{ id: string; model: string; requests: number }>();

    it('对象已启动后启动步骤失败时，停止审查器并记录消耗', async () => {
      const { t } = await piReview();
      const pi = fakePi(() => ({ state: 'running' }), { failStart: true });
      await runReviews(t, agentModels().models, { pi: pi.api });
      const { id, generation } = await attempt(t);
      expect((await reviewers(t))[0]).toMatchObject({
        status: 'failed',
        error: 'The review failed: start timed out',
      });
      expect(pi.stopped).toEqual([piReviewerName(id, generation)]);
      expect((await usageOf(t)).results).toEqual([
        {
          id: `review-agent-pi:${id}:${generation}`,
          model: '@cf/zai-org/glm-5.3',
          requests: 2,
        },
      ]);
    });

    it('智能体在审查中被移除时停止审查，且不写入任何内容', async () => {
      const { t, admin } = await piReview();
      const pi = fakePi(async (n) => {
        if (n === 1) {
          const res = await call(t, '/api/repos/octocat/app/agents/secagent', {
            cookie: admin,
            method: 'DELETE',
          });
          expect(res.status).toBe(200);
          return { state: 'running' };
        }
        return done(FINDINGS);
      });
      await runReviews(t, agentModels().models, { pi: pi.api });
      expect(pi.stopped).toHaveLength(1);
      expect(await flags(t)).toEqual([]);
      const row = await t.env.DB.prepare(
        'SELECT status, summary FROM pr_reviewers'
      ).first();
      expect(row).toEqual({
        status: 'not_needed',
        summary: 'Removed from the repository.',
      });
    });

    it('记录在审查中被删除时停止审查', async () => {
      const { t } = await piReview();
      const pi = fakePi(async (n) => {
        if (n === 1) await t.env.DB.prepare('DELETE FROM pr_reviewers').run();
        return n === 1 ? { state: 'running' } : done(FINDINGS);
      });
      await runReviews(t, agentModels().models, { pi: pi.api });
      expect(pi.stopped).toHaveLength(1);
      expect(await flags(t)).toEqual([]);
    });

    it('状态查询持续失败时停止审查器，并将记录标记为失败', async () => {
      const { t, reviewId } = await piReview();
      const pi = fakePi(() => {
        throw new Error('the object is unreachable');
      });
      await runWith(t, reviewId, pi);
      const { id, generation } = await attempt(t);
      expect((await reviewers(t))[0]).toMatchObject({
        status: 'failed',
        error: 'The review failed: the object is unreachable',
      });
      expect(pi.stopped).toEqual([piReviewerName(id, generation)]);
    });

    it('检查最终失败时，尽力记录已读取的消耗', async () => {
      const { t, reviewId } = await piReview();
      // Running, then a failing check, then (read by the failure step) running again.
      const pi = fakePi((n) => {
        if (n === 2) throw new Error('the object is unreachable');
        return { state: 'running' };
      });
      await runWith(t, reviewId, pi);
      const { id, generation } = await attempt(t);
      expect((await reviewers(t))[0].status).toBe('failed');
      expect((await usageOf(t)).results).toEqual([
        {
          id: `review-agent-pi:${id}:${generation}`,
          model: '@cf/zai-org/glm-5.3',
          requests: 6,
        },
      ]);
    });
  });

  describe('最后一次检查', () => {
    // Events that arrive before Pi settles (a notification for an earlier state) make checks come early.
    const early = { waitForEvent: async () => ({ payload: null }) };

    it('检查提前完成时，允许审查在实际耗时上限内继续超过 piChecks', async () => {
      const { t, reviewId } = await piReview();
      const n = piChecks(PI_DEFAULT_LIMITS);
      const pi = fakePi((i) => (i <= n ? { state: 'running' } : done(APPROVE)));
      await executeHeadReview(
        {
          env: t.env,
          db: drizzle(t.env.DB, { schema }),
          step: {
            do: async (_name: string, a: unknown, b?: unknown) =>
              ((b ?? a) as () => Promise<unknown>)(),
            sleep: async () => {},
            ...early,
          } as unknown as StepRunner,
          models: agentModels().models,
          pi: pi.api,
          instanceId: 'review-early',
        },
        reviewId
      );
      expect((await reviewers(t))[0].status).toBe('approved');
      expect([...pi.objects.values()][0].checks).toBe(n + 1);
    });

    it('超过 piChecks 两次检查后结束审查，不受时钟结果影响', async () => {
      const { t, reviewId } = await piReview();
      const pi = fakePi(() => ({ state: 'running' }));
      await executeHeadReview(
        {
          env: t.env,
          db: drizzle(t.env.DB, { schema }),
          step: {
            do: async (_name: string, a: unknown, b?: unknown) =>
              ((b ?? a) as () => Promise<unknown>)(),
            sleep: async () => {},
            ...early,
          } as unknown as StepRunner,
          models: agentModels().models,
          pi: pi.api,
          instanceId: 'review-early',
        },
        reviewId
      );
      expect((await reviewers(t))[0]).toMatchObject({
        status: 'failed',
        error: piTimeUp(PI_DEFAULT_LIMITS),
      });
      expect([...pi.objects.values()][0].checks).toBe(
        piChecks(PI_DEFAULT_LIMITS) + 2
      );
    });
  });

  it('携带 Durable Object 实际使用的模型和限额，而非重新读取设置', async () => {
    const { t } = await piReview();
    const effective = {
      model: '@cf/qwen/qwen3-coder',
      limits: { maxModelCalls: 5 },
    };
    const pi = fakePi(() => ({ state: 'running' }), {
      turnsPerCheck: 6,
      effective,
    });
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: piBudgetSpent({ ...PI_DEFAULT_LIMITS, maxModelCalls: 5 }),
    });
    const usage = await t.env.DB.prepare(
      "SELECT model FROM ai_usage WHERE feature = 'review-agent-pi'"
    ).all<{ model: string }>();
    expect(usage.results).toEqual([{ model: '@cf/qwen/qwen3-coder' }]);
  });
});

afterEach(() => vi.useRealTimers());

const retry = async (t: T, cookie: string, id: string) => {
  const createdAt = await t.env.DB.prepare(
    'SELECT created_at FROM pr_reviewers WHERE id = ?'
  )
    .bind(id)
    .first<number>('created_at');
  const nextSecond = Math.max(Date.now(), (createdAt! + 1) * 1000);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(nextSecond);
  return call(t, `/api/repos/octocat/app/pulls/1/reviewers/${id}/retry`, {
    cookie,
    method: 'POST',
  });
};

/** Like a Workflow replaying: a step that already completed returns its stored result without running again. */
function replayingStep() {
  const cache = new Map<string, unknown>();
  return {
    do: async (name: string, a: unknown, b?: unknown) => {
      if (cache.has(name)) return cache.get(name);
      const out = await ((b ?? a) as () => Promise<unknown>)();
      const stored =
        out === undefined ? undefined : JSON.parse(JSON.stringify(out));
      cache.set(name, stored);
      return stored;
    },
    sleep: async () => {},
    waitForEvent: async (name: string) => {
      throw new Error(`${name}: timed out`);
    },
  } as unknown as StepRunner;
}

describe('进行中的 Pi 审查', () => {
  it('智能体从仓库移除时停止，且不写入任何内容', async () => {
    const { t, admin } = await piReview();
    const pi = fakePi(async (n) => {
      if (n === 1) {
        const res = await call(t, '/api/repos/octocat/app/agents/secagent', {
          cookie: admin,
          method: 'DELETE',
        });
        expect(res.status).toBe(200);
      }
      return { state: 'running' };
    });
    const { models, calls } = agentModels();
    await runReviews(t, models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'not_needed',
      summary: 'Removed from the repository.',
    });
    expect(await flags(t)).toEqual([]);
    expect(calls.reviewed).toEqual([]);
    expect(pi.stopped).toHaveLength(1);
    // What it spent before it was stopped is still on the record.
    const usage = await t.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_usage WHERE feature = 'review-agent-pi'"
    ).first<{ n: number }>();
    expect(usage!.n).toBe(1);
  });

  it('新提交替换头提交时停止', async () => {
    const { t, repo, head } = await piReview();
    const pi = fakePi(async (n) => {
      if (n === 1)
        await commitPaths(
          repo,
          'feature',
          { ...BASE, ...CHANGE, 'src/more.ts': 'export const m = 1;\n' },
          'More'
        );
      return n === 1 ? { state: 'running' } : done(FINDINGS);
    });
    await runReviews(t, agentModels().models, { pi: pi.api });
    const old = (await reviewers(t)).find((r) => r.head_sha === head)!;
    expect(old).toMatchObject({ status: 'not_needed', summary: PI_SUPERSEDED });
    expect(await flags(t)).toEqual([]);
    expect(pi.stopped).toHaveLength(1);
  });

  it('拉取请求关闭时报告失败，以便重新打开后重试审查', async () => {
    const { t, admin } = await piReview();
    const pi = fakePi(async (n) => {
      if (n === 1)
        await call(t, '/api/repos/octocat/app/pulls/1', {
          cookie: admin,
          method: 'PATCH',
          json: { state: 'closed' },
        });
      return { state: 'running' };
    });
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: PI_CLOSED,
    });
    expect(pi.stopped).toHaveLength(1);
  });

  it('Pi 审查失败后重试时，启动全新的 Pi 审查器', async () => {
    const { t, admin } = await piReview();
    let gaveUp = true;
    const pi = fakePi(() =>
      gaveUp ? { state: 'unanswered', reason: 'model error' } : done(APPROVE)
    );
    await runReviews(t, agentModels().models, { pi: pi.api });
    const [failed] = await reviewers(t);
    expect(failed.status).toBe('failed');
    gaveUp = false;
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0].status).toBe('approved');
    // Two attempts, two objects: the second never sees the first one's workspace.
    expect(new Set(pi.starts).size).toBe(2);
    expect(pi.stopped).toEqual(pi.starts);
  });

  it('尝试在答复期间已被重试时，不记录旧答复', async () => {
    const { t } = await piReview();
    const pi = fakePi(async () => {
      // A Retry renewed the row while Pi was answering.
      await t.env.DB.prepare(
        'UPDATE pr_reviewers SET created_at = created_at + 5'
      ).run();
      return done(FINDINGS);
    });
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0].status).toBe('reviewing');
    expect(await flags(t)).toEqual([]);
    expect(pi.stopped).toHaveLength(1);
  });

  it('过期恢复后的检查不写入任何内容', async () => {
    // (That the limits stay inside the stale window is pinned once, by Task 5's settings test.)
    const { t } = await piReview();
    const db = drizzle(t.env.DB, { schema });
    const pi = fakePi(async (n) => {
      // The daily job runs as if this review's Workflow had died 2 hours ago.
      if (n === 1)
        await stopStaleReviews(
          t.env,
          db,
          new Date(Date.now() + REVIEW_STALE_MS + 60_000)
        );
      return n === 1 ? { state: 'running' } : done(FINDINGS);
    });
    await runReviews(t, agentModels().models, { pi: pi.api });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: REVIEW_STOPPED,
    });
    expect(await flags(t)).toEqual([]);
    expect(pi.stopped).toHaveLength(1);
  });

  it('Workflow 丢失 AgentReviewer 绑定时，将已启动审查标记为失败以便重试', async () => {
    const { t, reviewId } = await piReview();
    // The start step's result is cached (the review started), then the binding was removed and the Workflow resumed.
    const step = {
      do: async (name: string, a: unknown, b?: unknown) =>
        name === 'review:secagent'
          ? {
              verdict: 'started',
              needsPerson: 0,
              changeRequested: 0,
              engine: 'pi',
              started: {
                generation: (await attempt(t)).generation,
                startedAt: Date.now(),
                model: '@cf/zai-org/glm-5.3',
                limits: PI_DEFAULT_LIMITS,
              },
            }
          : ((b ?? a) as () => Promise<unknown>)(),
      sleep: async () => {},
      waitForEvent: async (name: string) => {
        throw new Error(`${name}: timed out`);
      },
    } as unknown as StepRunner;
    await executeHeadReview(
      {
        env: t.env,
        db: drizzle(t.env.DB, { schema }),
        step,
        models: agentModels().models,
      },
      reviewId
    );
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: PI_GONE,
    });
  });

  it('检查结束审查时才通知实时页面', async () => {
    const { t, reviewId } = await piReview();
    const pi = fakePi((n) => (n < 3 ? { state: 'running' } : done(FINDINGS)));
    const log: string[] = [];
    const env = {
      ...t.env,
      LIVE: {
        getByName: () => ({
          publish: async (channel: string) => {
            if (channel.startsWith('repo:')) log.push('ping');
          },
        }),
      },
    } as unknown as typeof t.env;
    await executeHeadReview(
      {
        env,
        db: drizzle(t.env.DB, { schema }),
        step: {
          do: async (name: string, a: unknown, b?: unknown) => {
            const out = await ((b ?? a) as () => Promise<unknown>)();
            log.push(name);
            return out;
          },
          sleep: async () => {},
          waitForEvent: async (name: string) => {
            throw new Error(`${name}: timed out`);
          },
        } as unknown as StepRunner,
        models: agentModels().models,
        pi: pi.api,
        instanceId: 'review-live',
      },
      reviewId
    );
    const after = (name: string) => log[log.indexOf(name) + 1];
    // Two checks found Pi still working: nothing anyone sees changed, so no ping.
    expect(after('pi:secagent:1')).not.toBe('ping');
    expect(after('pi:secagent:2')).not.toBe('ping');
    // The check that recorded the answer pings, as does the start.
    expect(after('pi:secagent:3')).toBe('ping');
    expect(after('review:secagent')).toBe('ping');
  });

  it('Workflow 重放时不重复启动，也不重复记录', async () => {
    const { t, reviewId } = await piReview();
    const pi = fakePi((n) => (n < 2 ? { state: 'running' } : done(FINDINGS)));
    const db = drizzle(t.env.DB, { schema });
    const deps = {
      env: t.env,
      db,
      step: replayingStep(),
      models: agentModels().models,
      pi: pi.api,
      instanceId: 'review-replay',
    };
    await executeHeadReview(deps, reviewId);
    const before = {
      flags: await flags(t),
      checks: [...pi.objects.values()][0].checks,
    };
    // The Workflow replays: every step comes back from the cache.
    await executeHeadReview(deps, reviewId);
    expect(pi.starts).toHaveLength(1);
    expect([...pi.objects.values()][0].checks).toBe(before.checks);
    expect(await flags(t)).toEqual(before.flags);
    expect((await reviewers(t))[0].status).toBe('changes_requested');
    const usage = await t.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_usage WHERE feature = 'review-agent-pi'"
    ).first<{ n: number }>();
    expect(usage!.n).toBe(1);
  });
});
