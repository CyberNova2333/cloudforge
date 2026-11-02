// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/schema';
import { pullRequests } from '../../db/app.schema';
import {
  executeHeadReview,
  executeReviewerRetry,
  retryHeadReview,
} from '../../review/head';
import type { StepRunner } from '../../merge/resolution';
import { retryReviewer } from '../../review/reviewers';
import { MergeResolutionWorkflow } from '../../merge/workflow';
import { runActionsRetention } from '../../actions/retention';
import { headReviewId } from '../../review/keys';
import { step } from '../helpers/reviews';
import { addMember, call, settle } from '../helpers/app';
import { newAgent } from '../helpers/agents';
import { commitPaths } from '../helpers/seed';
import {
  AGENT_MD,
  agentModels,
  appRepo,
  BASE,
  flags,
  invitedAgent,
  openPull,
  reviewers,
  runReviews,
  startReview,
} from '../helpers/reviews';

const CHANGE = { 'src/auth.ts': 'export const token = "x";\n' };

async function failedReview(md = AGENT_MD({ above: 1 })) {
  const { t, admin, repo } = await appRepo();
  const { repo: agent } = await invitedAgent(t, admin, 'secagent', md);
  const pull = await openPull(t, admin, repo, CHANGE);
  await startReview(t);
  return { t, admin, repo, agent, ...pull };
}

const FINDING = {
  verdict: 'findings' as const,
  summary: '',
  findings: [
    {
      kind: 'needs_person' as const,
      title: 'Token',
      detail: 'Hard-codes a token.',
      changes: [],
      diagram: null,
      snippets: [],
      paths: ['src/auth.ts'],
    },
  ],
};

type T = Awaited<ReturnType<typeof appRepo>>['t'];

function workflows(t: T) {
  return (
    t.env as unknown as {
      MERGE_RESOLUTION: { create: (o: unknown) => Promise<unknown> };
    }
  ).MERGE_RESOLUTION;
}

async function pullOne(t: T) {
  const db = drizzle(t.env.DB, { schema });
  const pr = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  return { db, pr };
}

async function headReviewStatus(t: T) {
  return (await t.env.DB.prepare(
    'SELECT status FROM pr_classifications'
  ).first<{ status: string }>())!.status;
}

const retry = (
  t: Awaited<ReturnType<typeof appRepo>>['t'],
  cookie: string,
  id: string
) =>
  call(t, `/api/repos/octocat/app/pulls/1/reviewers/${id}/retry`, {
    cookie,
    method: 'POST',
  });

describe('重试审查器', () => {
  it('使用智能体仓库当前的 AGENT.md 重新执行失败的审查', async () => {
    const { t, admin, agent } = await failedReview();
    const { models, calls } = agentModels();
    await runReviews(t, models);
    const [failed] = await reviewers(t);
    expect(failed.status).toBe('failed');
    const fixed = await commitPaths(
      agent,
      'main',
      { 'AGENT.md': AGENT_MD({ body: 'Fixed.' }) },
      'Fix'
    );
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    await runReviews(t, models);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'approved',
      agent_sha: fixed,
      error: null,
    });
    expect(calls.reviewed[0].instructions).toBe('Fixed.');
  });

  it('AGENT.md 仍无效时保持失败状态，并展示当前错误', async () => {
    const { t, admin } = await failedReview();
    await runReviews(t, agentModels().models);
    const [failed] = await reviewers(t);
    const before = t.actions.resolutions.length;
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    expect(t.actions.resolutions).toHaveLength(before);
    expect((await reviewers(t))[0].status).toBe('failed');
    expect((await reviewers(t))[0].error).toContain('trigger.above');
  });

  it('审查模型失败后重新审查', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    const [failed] = await reviewers(t);
    expect(failed.status).toBe('failed');
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    await runReviews(t, agentModels().models);
    expect((await reviewers(t))[0].status).toBe('approved');
  });

  it('拒绝重试未失败的审查、旧提交审查及没有合并权限的用户请求', async () => {
    const { t, admin, repo } = await failedReview();
    await runReviews(t, agentModels().models);
    const [failed] = await reviewers(t);
    const mona = await addMember(t, admin, 'mona');
    expect((await retry(t, mona, failed.id)).status).toBe(403);
    expect((await retry(t, admin, 'nope')).status).toBe(404);
    await commitPaths(repo, 'feature', { ...BASE, 'b.txt': 'b\n' }, 'More');
    const old = await retry(t, admin, failed.id);
    expect(old.status).toBe(400);
    expect(await old.text()).toContain('older commit');
  });
});

describe('审查器重试的异常情况', () => {
  it('Workflow 无法启动时保持审查失败，而非运行中', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    const [failed] = await reviewers(t);
    expect(await headReviewStatus(t)).toBe('done');
    workflows(t).create = async () => {
      throw new Error('Workflows down');
    };
    expect((await retry(t, admin, failed.id)).status).toBe(503);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: 'The review could not be started. Try again.',
    });
    expect(await headReviewStatus(t)).toBe('done');
  });

  it('重试竞争失败时保留胜出者的审查意见', async () => {
    const { t, admin, head } = await failedReview(AGENT_MD());
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    const [failed] = await reviewers(t);
    const { db, pr } = await pullOne(t);
    // The losing retry reads the row as failed, then waits on git while the winner retries and reviews.
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let reached!: () => void;
    const waiting = new Promise<void>((r) => (reached = r));
    const artifacts = t.env.ARTIFACTS as unknown as Record<string, unknown>;
    const slow = new Proxy(artifacts, {
      get(target, prop) {
        const v = target[prop as string];
        if (typeof v !== 'function') return v;
        return async (...args: unknown[]) => {
          reached();
          await gate;
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const loser = retryReviewer(
      { ...t.env, ARTIFACTS: slow } as unknown as typeof t.env,
      db,
      pr,
      failed.id,
      head,
      () => {}
    );
    await waiting;
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    await runReviews(t, agentModels({ review: () => FINDING }).models);
    expect((await reviewers(t))[0].status).toBe('flagged');
    expect(await flags(t)).toHaveLength(1);
    open();
    expect(await loser).toMatchObject({ ok: false, status: 400 });
    expect(await flags(t)).toHaveLength(1);
    expect((await reviewers(t))[0].status).toBe('flagged');
  });
});

describe('审查器 Workflow', () => {
  it('使用 Workers AI 进行重试，并将用量计入该提交的审查', async () => {
    const { t, admin, head } = await failedReview(AGENT_MD());
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    const [failed] = await reviewers(t);
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    const started = t.actions.resolutions.at(-1)!;
    expect(started.params).toEqual({ reviewer: { id: failed.id } });
    const AI = {
      run: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'approve',
                summary: 'Fine.',
                findings: [],
              }),
            },
          },
        ],
      }),
    };
    const env = { ...t.env, AI } as unknown as typeof t.env;
    // workerd's WorkflowEntrypoint constructor wants a real ExecutionContext; run() only reads this.env.
    const workflow = Object.assign(
      Object.create(MergeResolutionWorkflow.prototype),
      { env }
    ) as MergeResolutionWorkflow;
    await workflow.run(
      {
        payload: started.params,
        instanceId: started.id,
        timestamp: new Date(),
      } as never,
      step as never
    );
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'approved',
      summary: 'Fine.',
    });
    const { pr } = await pullOne(t);
    const usage = await t.env.DB.prepare(
      "SELECT classification_id FROM ai_usage WHERE feature = 'review-agent'"
    ).all<{ classification_id: string }>();
    expect(usage.results).toEqual([
      { classification_id: headReviewId(pr.id, head) },
    ]);
  });
});

describe('整个提交的审查失败', () => {
  it('重试时重新启动', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    const binding = (
      t.env as unknown as {
        MERGE_RESOLUTION: { create: (o: unknown) => Promise<unknown> };
      }
    ).MERGE_RESOLUTION;
    const create = binding.create;
    // Workflows is down while the review starts (from the opening, once task 9 wires it, or from startReview).
    binding.create = async () => {
      throw new Error('Workflows down');
    };
    const { head } = await openPull(t, admin, repo, CHANGE);
    expect((await startReview(t))!.status).toBe('failed');
    binding.create = create;
    const db = drizzle(t.env.DB, { schema });
    const pr = (await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.number, 1))
      .get())!;
    expect(await retryHeadReview(t.env, db, pr, { head })).toEqual({
      ok: true,
    });
    await runReviews(t, agentModels().models);
    expect((await reviewers(t))[0].status).toBe('approved');
  });

  it('点击审查重试按钮后重新启动', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    const binding = workflows(t);
    const create = binding.create;
    binding.create = async () => {
      throw new Error('Workflows down');
    };
    await openPull(t, admin, repo, CHANGE);
    expect((await startReview(t))!.status).toBe('failed');
    binding.create = create;
    const res = await call(t, '/api/repos/octocat/app/pulls/1/review/retry', {
      cookie: admin,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    await runReviews(t, agentModels().models);
    expect(await headReviewStatus(t)).toBe('done');
    expect((await reviewers(t))[0].status).toBe('approved');
  });
});

describe('Workflow 终止导致审查未完成', () => {
  const STOPPED = 'The review stopped unexpectedly. Try again.';
  const HOURS = 3600;
  /** Moves every head review's and reviewer's created_at `hours` into the past. */
  async function age(t: T, hours: number) {
    const s = Math.floor(Date.now() / 1000) - hours * HOURS;
    await t.env.DB.batch([
      t.env.DB.prepare('UPDATE pr_classifications SET created_at = ?').bind(s),
      t.env.DB.prepare('UPDATE pr_reviewers SET created_at = ?').bind(s),
    ]);
  }
  const reviewRow = (t: T) =>
    t.env.DB.prepare(
      'SELECT status, error_message AS error FROM pr_classifications'
    ).first<{ status: string; error: string | null }>();
  const retention = (t: T) =>
    runActionsRetention(t.env, drizzle(t.env.DB, { schema }));
  /** A finished review, its rows then put back in progress as a Workflow that died would leave them. */
  async function stuck(review = 'reviewing', reviewer = 'reviewing') {
    const { t, admin } = await failedReview(AGENT_MD());
    // A finding keeps the pull request open (an approval would auto-merge it).
    await runReviews(t, agentModels({ review: () => FINDING }).models);
    await t.env.DB.batch([
      t.env.DB.prepare(
        'UPDATE pr_classifications SET status = ?, finished_at = NULL'
      ).bind(review),
      t.env.DB.prepare(
        'UPDATE pr_reviewers SET status = ?, finished_at = NULL'
      ).bind(reviewer),
    ]);
    return { t, admin };
  }

  it('两小时后再次查看提交时停止审查，且可通过重试重新启动', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    // Never run: its Workflow died. Under 2 hours it's still reused as running.
    expect((await startReview(t))!.status).toBe('summarizing');
    await age(t, 1);
    expect((await startReview(t))!.status).toBe('summarizing');
    await age(t, 3);
    expect(await startReview(t)).toMatchObject({
      status: 'failed',
      errorMessage: STOPPED,
    });
    const res = await call(t, '/api/repos/octocat/app/pulls/1/review/retry', {
      cookie: admin,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    await runReviews(t, agentModels().models);
    expect(await headReviewStatus(t)).toBe('done');
    expect((await reviewers(t))[0].status).toBe('approved');
  });

  it('每日保留清理在两小时后停止审查及其审查器，且可通过重试重新启动', async () => {
    const { t, admin } = await stuck();
    await age(t, 1);
    await retention(t);
    expect((await reviewRow(t))!.status).toBe('reviewing');
    await age(t, 3);
    const status = await retention(t);
    expect(status.stoppedReviews).toBe(1);
    expect(await reviewRow(t)).toEqual({ status: 'failed', error: STOPPED });
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: STOPPED,
    });
    const res = await call(t, '/api/repos/octocat/app/pulls/1/review/retry', {
      cookie: admin,
      method: 'POST',
    });
    expect(res.status).toBe(200);
    await runReviews(t, agentModels().models);
    expect(await headReviewStatus(t)).toBe('done');
  });

  it('停止持续审查两小时的审查器重试，且仍可再次重试', async () => {
    const { t, admin } = await stuck('done', 'reviewing');
    await age(t, 3);
    const status = await retention(t);
    expect(status.stoppedReviewers).toBe(1);
    const [row] = await reviewers(t);
    expect(row).toMatchObject({ status: 'failed', error: STOPPED });
    expect((await reviewRow(t))!.status).toBe('done');
    expect((await retry(t, admin, row.id)).status).toBe(200);
    await runReviews(t, agentModels().models);
    expect((await reviewers(t))[0].status).toBe('approved');
  });

  /** Runs the commit's review Workflow inline; `meanwhile` runs during its first summary (the Workflow is slow). */
  async function slowRun(t: T, meanwhile: () => Promise<void>) {
    const review = (await startReview(t))!;
    // Started 3 hours ago: stale once something stops it, and a Retry's row is a new generation.
    await age(t, 3);
    const { models, calls } = agentModels();
    const summarize = models.summarize.bind(models);
    let first = true;
    models.summarize = async (...args: Parameters<typeof summarize>) => {
      if (first) {
        first = false;
        await meanwhile();
      }
      return summarize(...args);
    };
    await executeHeadReview(
      { env: t.env, db: drizzle(t.env.DB, { schema }), step, models },
      review.id
    );
    return calls;
  }

  it('仍在运行的旧任务不恢复已停止的审查，也不再调用模型', async () => {
    const { t } = await failedReview(AGENT_MD());
    const calls = await slowRun(t, async () => {
      await retention(t);
    });
    expect(await reviewRow(t)).toEqual({ status: 'failed', error: STOPPED });
    expect(calls.triggered).toEqual([]);
    expect(calls.reviewed).toEqual([]);
    expect(await reviewers(t)).toEqual([]);
  });

  it('仍在运行的旧任务不覆盖通过重试重新启动的审查', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    const calls = await slowRun(t, async () => {
      await retention(t);
      const res = await call(t, '/api/repos/octocat/app/pulls/1/review/retry', {
        cookie: admin,
        method: 'POST',
      });
      expect(res.status).toBe(200);
    });
    // The new review is untouched: still waiting for its own run.
    expect(
      await t.env.DB.prepare(
        'SELECT status, files FROM pr_classifications'
      ).first()
    ).toEqual({ status: 'summarizing', files: null });
    expect(calls.triggered).toEqual([]);
    expect(await reviewers(t)).toEqual([]);
  });

  it('从重试时而非首次审查提交时开始计算两小时', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    await age(t, 3);
    const [failed] = await reviewers(t);
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    // The retry's Workflow hasn't run yet: neither the reviewer nor its commit's review is stale.
    await retention(t);
    expect((await reviewers(t))[0].status).toBe('reviewing');
    expect((await reviewRow(t))!.status).toBe('reviewing');
    expect((await startReview(t))!.status).toBe('reviewing');
  });
});

describe('移除与删除智能体', () => {
  it('从仓库移除智能体时取消其进行中的审查', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    await runReviews(
      t,
      agentModels({
        review: async () => {
          const res = await call(t, '/api/repos/octocat/app/agents/secagent', {
            cookie: admin,
            method: 'DELETE',
          });
          expect(res.status).toBe(200);
          return {
            verdict: 'findings',
            summary: '',
            findings: [
              {
                kind: 'needs_person',
                title: 'Token',
                detail: 'Hard-codes a token.',
                changes: [],
                diagram: null,
                snippets: [],
                paths: ['src/auth.ts'],
              },
            ],
          };
        },
      }).models
    );
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'not_needed',
      requested: 0,
      summary: 'Removed from the repository.',
    });
    // Its finding, returned after the removal, was never written.
    expect(await flags(t)).toEqual([]);
  });

  it('删除智能体时取消其在所有仓库中的审查', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    await runReviews(
      t,
      agentModels({
        review: async (i) => {
          await call(t, '/api/admin/agents/secagent', {
            cookie: admin,
            method: 'DELETE',
          });
          return { verdict: 'approve', summary: i.handle, findings: [] };
        },
      }).models
    );
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'not_needed',
      summary: 'Removed from the repository.',
    });
  });

  it('即使邀请并发发生，也不超过 10 个智能体', async () => {
    const { t, admin } = await appRepo();
    for (let i = 0; i < 9; i++)
      await invitedAgent(t, admin, `agent${i}`, AGENT_MD());
    await newAgent(t, admin, 'agent9', 'Agent 9');
    await newAgent(t, admin, 'agent10', 'Agent 10');
    const statuses = (
      await Promise.all(
        ['agent9', 'agent10'].map((h) =>
          call(t, `/api/repos/octocat/app/agents/${h}`, {
            cookie: admin,
            method: 'PUT',
          })
        )
      )
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([200, 400]);
    const { n } = (await t.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM repository_agents'
    ).first<{ n: number }>())!;
    expect(n).toBe(10);
  });

  it('每个仓库最多邀请 10 个智能体', async () => {
    const { t, admin } = await appRepo();
    for (let i = 0; i < 10; i++)
      await invitedAgent(t, admin, `agent${i}`, AGENT_MD());
    await newAgent(t, admin, 'agent10', 'Agent 10');
    const refused = await call(t, '/api/repos/octocat/app/agents/agent10', {
      cookie: admin,
      method: 'PUT',
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('at most 10 agents');
    const again = await call(t, '/api/repos/octocat/app/agents/agent3', {
      cookie: admin,
      method: 'PUT',
    });
    expect(again.status).toBe(200);
  });
});

/** Steps run inline, renewing the reviewer row (as a Retry does) just before the step named `name`. */
function renewingBefore(t: T, name: string): StepRunner {
  return {
    do: async (n: string, a: unknown, b?: unknown) => {
      if (n === name)
        await t.env.DB.prepare(
          'UPDATE pr_reviewers SET created_at = created_at + 5'
        ).run();
      return ((b ?? a) as () => Promise<unknown>)();
    },
    sleep: async () => {},
  } as unknown as StepRunner;
}

describe('审查代次隔离', () => {
  it('审查步骤启动前记录已更新代次时，不写入任何内容', async () => {
    const { t } = await failedReview(AGENT_MD());
    const { models, calls } = agentModels({ review: () => FINDING });
    await settle(t);
    const started = t.actions.resolutions.find(
      (s) => (s.params as { headReview?: unknown }).headReview
    )!;
    const { db } = await pullOne(t);
    await executeHeadReview(
      { env: t.env, db, step: renewingBefore(t, 'review:secagent'), models },
      (started.params as { headReview: { id: string } }).headReview.id
    );
    expect(calls.reviewed).toEqual([]);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'reviewing',
      error: null,
    });
    expect(await flags(t)).toEqual([]);
  });

  it('重试无法加载后记录又更新了代次时，不将新记录标记为失败', async () => {
    const { t, admin } = await failedReview(AGENT_MD());
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    const [failed] = await reviewers(t);
    expect((await retry(t, admin, failed.id)).status).toBe(200);
    const broken = new Proxy(t.env.ARTIFACTS as unknown as object, {
      get: () => async () => {
        throw new Error('Artifacts down');
      },
    });
    const { db } = await pullOne(t);
    await executeReviewerRetry(
      {
        env: { ...t.env, ARTIFACTS: broken } as unknown as typeof t.env,
        db,
        step: renewingBefore(t, 'fail'),
        models: agentModels().models,
      },
      failed.id
    );
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'reviewing',
      error: null,
    });
  });

  it('丢弃针对审查器记录较早尝试完成的审查', async () => {
    const { t } = await failedReview(AGENT_MD());
    const { models } = agentModels({
      review: async () => {
        // A Retry renewed the row while this answer was on its way: it belongs to the old attempt.
        await t.env.DB.prepare(
          'UPDATE pr_reviewers SET created_at = created_at + 5'
        ).run();
        return FINDING;
      },
    });
    await runReviews(t, models);
    expect((await reviewers(t))[0].status).toBe('reviewing');
    expect(await flags(t)).toEqual([]);
  });

  it('模型调用失败期间记录更新了代次时，不将新记录标记为失败', async () => {
    const { t } = await failedReview(AGENT_MD());
    const { models } = agentModels({
      review: async () => {
        await t.env.DB.prepare(
          'UPDATE pr_reviewers SET created_at = created_at + 5'
        ).run();
        throw new Error('model down');
      },
    });
    await runReviews(t, models);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'reviewing',
      error: null,
    });
  });
});
