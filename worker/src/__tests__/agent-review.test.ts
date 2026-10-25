// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { PI_CANCELLED, PI_CLOSED, PI_SUPERSEDED } from '../review/pi';
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { prClassifications } from '../db/app.schema';
import type { StepRunner } from '../merge/resolution';
import { executeSweep } from '../merge/auto';
import {
  executeHeadReview,
  loadHead,
  MAX_REVIEW_FILES,
  runAgentReview,
  TOO_MANY_FILES,
  type HeadContext,
} from '../review/head';
import { decisionFor } from '../agent-runs/record';
import { stepDisplayName } from '../agent-runs/names';
import type { AgentReview } from '../review/contract';
import { addMember, call, settle, type TestEnv } from './helpers/app';
import { commitPaths } from './helpers/seed';
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
  step,
} from './helpers/reviews';

const SCHEMA_CHANGE = {
  'migrations/0001.sql': 'ALTER TABLE users ADD plan text;\n',
};

const FINDINGS: AgentReview = {
  verdict: 'findings',
  summary: 'Two concerns.',
  findings: [
    {
      kind: 'needs_person',
      title: 'New column',
      detail: 'Adds users.plan with no default.',
      changes: [{ what: 'users.plan', before: 'none', after: 'text' }],
      diagram: 'erDiagram\n  users {\n    text plan "NEW"\n  }',
      snippets: [
        { path: 'migrations/0001.sql', start: 1, end: 1, why: 'the column' },
      ],
      paths: ['migrations/0001.sql'],
    },
    {
      kind: 'change_requested',
      title: 'Backfill',
      detail: 'Add a backfill for existing users.',
      changes: [],
      diagram: null,
      snippets: [],
      paths: ['migrations/0001.sql'],
    },
  ],
};

/** octocat/app with the given agents invited and pull request #1 adding `changes`, its review started. */
async function reviewed(
  agents: [string, string][],
  changes: Record<string, string> = SCHEMA_CHANGE
) {
  const { t, admin, repo } = await appRepo();
  const shas: Record<string, string> = {};
  for (const [handle, md] of agents)
    shas[handle] = (await invitedAgent(t, admin, handle, md)).sha;
  const pull = await openPull(t, admin, repo, changes);
  await startReview(t);
  return { t, admin, repo, shas, ...pull };
}

describe('拉取请求提交的审查者选择', () => {
  it('仓库未邀请智能体时不执行审查', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    expect(await startReview(t)).toBeNull();
    expect(
      t.actions.resolutions.filter(
        (r) => (r.params as { headReview?: unknown }).headReview
      )
    ).toEqual([]);
  });

  it('结合所有智能体的问题仅询问 Clef 一次，提供单行摘要而非差异', async () => {
    const { t } = await reviewed([
      ['secagent', AGENT_MD({ ask: 'Auth?' })],
      ['dataagent', AGENT_MD({ ask: 'Data?' })],
    ]);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.triggered).toHaveLength(1);
    expect(calls.triggered[0].questions).toEqual({
      dataagent: 'Data?',
      secagent: 'Auth?',
    });
    const state = JSON.stringify(calls.triggered[0].state);
    expect(state).toContain('Changes migrations/0001.sql.');
    expect(state).not.toContain('ALTER TABLE');
  });

  it('向 Clef 提供单行标题和截断至 8 KB 的描述，与审查提示词一致', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    await t.env.DB.prepare('UPDATE pull_requests SET title = ?, body = ?')
      .bind('Two\nlines', 'x'.repeat(20 * 1024))
      .run();
    const { models, calls } = agentModels();
    await runReviews(t, models);
    const { pull_request } = calls.triggered[0].state as {
      pull_request: { title: string; description: string };
    };
    expect(pull_request.title).toBe('Two lines');
    expect(pull_request.description).toBe(
      `${'x'.repeat(8 * 1024)}\n(description truncated at 8 KB)`
    );
  });

  it('达到或超过阈值时请求智能体审查，将其他智能体记录为无需参与', async () => {
    const { t } = await reviewed([
      ['secagent', AGENT_MD({ above: 0.5 })],
      ['dataagent', AGENT_MD({ above: 0.5 })],
    ]);
    const { models, calls } = agentModels({
      probabilities: { secagent: 0.5, dataagent: 0.49 },
    });
    await runReviews(t, models);
    expect(await reviewers(t)).toMatchObject([
      {
        agent: 'dataagent',
        status: 'not_needed',
        requested: 0,
        probability: 0.49,
      },
      { agent: 'secagent', status: 'approved', requested: 1, probability: 0.5 },
    ]);
    expect(calls.reviewed.map((r) => r.handle)).toEqual(['secagent']);
  });

  it('Clef 失败时请求所有智能体审查', async () => {
    const { t } = await reviewed([
      ['secagent', AGENT_MD({ above: 0.9 })],
      ['dataagent', AGENT_MD({ above: 0.9 })],
    ]);
    const { models, calls } = agentModels({ failTrigger: true });
    await runReviews(t, models);
    expect(calls.reviewed.map((r) => r.handle).sort()).toEqual([
      'dataagent',
      'secagent',
    ]);
    for (const r of await reviewers(t))
      expect(r).toMatchObject({ requested: 1, probability: null });
  });

  it('Clef 未给出答复的智能体仍需审查', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD({ above: 0.9 })]]);
    const { models, calls } = agentModels({ omit: ['secagent'] });
    await runReviews(t, models);
    expect(calls.reviewed).toHaveLength(1);
    expect((await reviewers(t))[0]).toMatchObject({
      requested: 1,
      probability: null,
    });
  });

  it('受保护的智能体总是审查，不询问 Clef', async () => {
    const { t } = await reviewed([
      ['secagent', AGENT_MD({ above: 0.5, guarded: true })],
      ['dataagent', AGENT_MD({ above: 0.5 })],
    ]);
    const { models, calls } = agentModels({
      probabilities: { secagent: 0, dataagent: 0 },
    });
    await runReviews(t, models);
    expect(Object.keys(calls.triggered[0].questions)).toEqual(['dataagent']);
    expect(calls.reviewed.map((r) => r.handle)).toEqual(['secagent']);
    expect(await reviewers(t)).toMatchObject([
      { agent: 'dataagent', status: 'not_needed', requested: 0 },
      {
        agent: 'secagent',
        status: 'approved',
        requested: 1,
        probability: null,
      },
    ]);
  });

  it('只有受保护的智能体时不调用 Clef', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD({ guarded: true })]]);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.triggered).toHaveLength(0);
    expect(calls.reviewed.map((r) => r.handle)).toEqual(['secagent']);
  });

  it('AGENT.md 无效时以解析错误标记智能体失败，且不就该智能体询问 Clef', async () => {
    const { t } = await reviewed([
      ['secagent', AGENT_MD({ above: 1 })],
      ['dataagent', AGENT_MD()],
    ]);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(Object.keys(calls.triggered[0].questions)).toEqual(['dataagent']);
    expect(calls.reviewed.map((r) => r.handle)).toEqual(['dataagent']);
    const sec = (await reviewers(t)).find((r) => r.agent === 'secagent')!;
    expect(sec).toMatchObject({ status: 'failed', requested: 1 });
    expect(sec.error).toContain('trigger.above');
  });

  it('最多汇总 300 个文件，且仍触发审查', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 301; i++)
      many[`f/${String(i).padStart(3, '0')}.txt`] = `${i}\n`;
    const { t } = await reviewed([['secagent', AGENT_MD()]], many);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.summarized).toHaveLength(300);
    expect(calls.triggered).toHaveLength(1);
    const row = await t.env.DB.prepare(
      'SELECT files FROM pr_classifications'
    ).first<{ files: string }>();
    const files = JSON.parse(row!.files) as { path: string; summary: string }[];
    expect(files).toHaveLength(301);
    expect(files[300]).toMatchObject({
      path: 'f/300.txt',
      summary: 'Not summarized: more than 300 files changed.',
    });
  });

  it('分支回到已审查提交时复用审查结果', async () => {
    const { t, repo, head } = await reviewed([['secagent', AGENT_MD()]]);
    // Keep it open: an approving review would otherwise auto-merge it.
    await t.env.DB.prepare(
      'UPDATE pull_requests SET auto_merge_disabled_at = 1'
    ).run();
    const { models } = agentModels();
    await runReviews(t, models);
    await commitPaths(repo, 'feature', { ...BASE, 'b.txt': 'b\n' }, 'More');
    await startReview(t);
    await runReviews(t, models);
    repo.refs.set('refs/heads/feature', head);
    const again = await startReview(t);
    expect(again).toMatchObject({ headSha: head, status: 'done' });
    expect(
      t.actions.resolutions.filter(
        (r) => (r.params as { headReview?: unknown }).headReview
      )
    ).toHaveLength(2);
  });
});

describe('智能体审查', () => {
  it('批准时将审查器标记为已批准，且不产生标记', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(t, agentModels().models);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'approved',
      summary: 'Nothing for me here.',
    });
    expect(await flags(t)).toEqual([]);
    const review = await t.env.DB.prepare(
      'SELECT status FROM pr_classifications'
    ).first<{ status: string }>();
    expect(review!.status).toBe('done');
  });

  it('将审查意见记录为智能体所有的标记，包含类型、agent_sha 和真实差异片段', async () => {
    const { t, shas } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(t, agentModels({ review: () => FINDINGS }).models);
    expect((await reviewers(t))[0].status).toBe('changes_requested');
    const [person, change] = await flags(t);
    expect(person).toMatchObject({
      agent: 'secagent',
      kind: 'needs_person',
      agent_sha: shas.secagent,
    });
    expect(JSON.parse(person.value!)).toEqual({ title: 'New column' });
    expect(JSON.parse(person.paths)).toEqual(['migrations/0001.sql']);
    expect(person.detail).toContain('Adds users.plan with no default.');
    expect(person.detail).toContain('| **users.plan** | none | text |');
    expect(person.detail).toContain('```mermaid');
    expect(person.detail).toContain('+ALTER TABLE users ADD plan text;');
    expect(change).toMatchObject({
      kind: 'change_requested',
      agent: 'secagent',
    });
  });

  it('所有审查意见均需要人工处理时标记为待处理', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(
      t,
      agentModels({
        review: () => ({ ...FINDINGS, findings: [FINDINGS.findings[0]] }),
      }).models
    );
    expect((await reviewers(t))[0].status).toBe('flagged');
  });

  it('审查器在审查中被取消时不写入审查意见', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(
      t,
      agentModels({
        review: async () => {
          await t.env.DB.prepare(
            `UPDATE pr_reviewers SET status = 'not_needed', summary = 'Removed from the repository.'`
          ).run();
          return FINDINGS;
        },
      }).models
    );
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'not_needed',
      summary: 'Removed from the repository.',
    });
    expect(await flags(t)).toEqual([]);
  });

  it('读取智能体指定提交中的 AGENT.md 正文和知识，以及单行摘要和差异', async () => {
    const { t, admin, repo } = await appRepo();
    const { sha } = await invitedAgent(
      t,
      admin,
      'dataagent',
      AGENT_MD({ body: 'Check data.' }),
      { 'knowledge/db.md': 'users.plan is billing.' }
    );
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    await startReview(t);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.reviewed[0]).toMatchObject({
      handle: 'dataagent',
      agentSha: sha,
      instructions: 'Check data.',
      knowledge: {
        files: [{ path: 'knowledge/db.md', text: 'users.plan is billing.' }],
        unread: [],
      },
      title: 'Change things',
    });
    expect(calls.reviewed[0].summaries).toContain(
      '- migrations/0001.sql (added): Changes migrations/0001.sql.'
    );
    expect(calls.reviewed[0].diffs).toContain(
      'ALTER TABLE users ADD plan text;'
    );
    // Nobody chose a language: English, as before.
    expect(calls.reviewed[0].language).toBeUndefined();
  });

  it('使用站点管理员为智能体选择的语言撰写', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(
      t,
      admin,
      'dataagent',
      AGENT_MD({ body: 'Check data.' })
    );
    const set = await call(t, '/api/admin/agents/dataagent/review-language', {
      cookie: admin,
      method: 'PUT',
      json: { language: 'zh' },
    });
    expect(set.status).toBe(200);
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    await startReview(t);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.reviewed[0]).toMatchObject({
      handle: 'dataagent',
      language: 'zh',
    });
  });

  it('即使智能体在审查中更新，也使用触发时固定的智能体提交', async () => {
    const { t, shas } = await reviewed([['secagent', AGENT_MD()]]);
    const agent = t.fake.repos.get(
      (await t.env.DB.prepare(
        `SELECT r.artifacts_name AS n FROM repositories r WHERE r.name = 'secagent'`
      ).first<{ n: string }>())!.n
    )!;
    const { models, calls } = agentModels({
      onTrigger: () =>
        commitPaths(
          agent,
          'main',
          { 'AGENT.md': AGENT_MD({ body: 'New rules.' }) },
          'Change rules'
        ),
    });
    await runReviews(t, models);
    expect(calls.reviewed[0]).toMatchObject({
      agentSha: shas.secagent,
      instructions: 'Look for leaked secrets.',
    });
    expect((await reviewers(t))[0].agent_sha).toBe(shas.secagent);
  });

  it('使用默认分支指令审查智能体自身仓库的拉取请求', async () => {
    const { t, admin } = await appRepo();
    const { repo: own, sha } = await invitedAgent(
      t,
      admin,
      'secagent',
      AGENT_MD({ body: 'Be strict.' }),
      {},
      'secagent/secagent'
    );
    own.refs.set('refs/heads/loosen', sha);
    await commitPaths(
      own,
      'loosen',
      { 'AGENT.md': AGENT_MD({ body: 'Approve everything.' }) },
      'Loosen'
    );
    const res = await call(t, '/api/repos/secagent/secagent/pulls', {
      cookie: admin,
      json: { title: 'Loosen', body: '', base: 'main', head: 'loosen' },
    });
    expect(res.status).toBe(201);
    await settle(t);
    await startReview(t, 1, 'secagent');
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.reviewed[0]).toMatchObject({
      instructions: 'Be strict.',
      agentSha: sha,
    });
  });

  it('审查模型持续失败时，保持审查器失败状态', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: 'The review model failed: model down',
    });
  });
});

describe('智能体运行显示智能体名称', () => {
  it('以智能体命名审查步骤，并汇总其决定', () => {
    const none = new Map<string, number>();
    expect(stepDisplayName('review:secagent', none)).toBe(
      'Review by @secagent'
    );
    expect(stepDisplayName('review-failed:secagent', none)).toBe(
      'Record failed review by @secagent'
    );
    expect(stepDisplayName('trigger', none)).toBe(
      'Ask which agents this concerns'
    );
    expect(
      decisionFor('review', {
        verdict: 'approve',
        needsPerson: 0,
        changeRequested: 0,
        engine: 'pass',
      })
    ).toBe('Approved');
    expect(
      decisionFor('review', {
        verdict: 'findings',
        needsPerson: 1,
        changeRequested: 1,
        engine: 'pi',
        fallback: true,
      })
    ).toBe(
      "2 findings: 1 needs a person, 1 change requested (engine: pi isn't set up here, so it ran as a single pass)"
    );
    expect(
      decisionFor('review', {
        verdict: 'started',
        needsPerson: 0,
        changeRequested: 0,
        engine: 'pi',
      })
    ).toBe('Started a Pi review');
    expect(stepDisplayName('pi:secagent:3', none)).toBe(
      'Pi review by @secagent'
    );
    expect(
      decisionFor('pi', {
        state: 'running',
        turns: 4,
        toolCalls: 9,
        durationMs: 180_000,
      })
    ).toBe('Running: 4 turns, 9 tool calls, 3 min');
    expect(
      decisionFor('pi', {
        state: 'finished',
        outcome: {
          verdict: 'approve',
          needsPerson: 0,
          changeRequested: 0,
          engine: 'pi',
          pi: { turns: 14, toolCalls: 38, durationMs: 372_000 },
        },
      })
    ).toBe('Approved (Pi: 14 turns, 38 tool calls, 6 min)');
    expect(
      decisionFor('pi', {
        state: 'finished',
        outcome: {
          verdict: 'failed',
          needsPerson: 0,
          changeRequested: 0,
          engine: 'pi',
          error: 'The Pi review ran out of time (30 minutes).',
        },
      })
    ).toBe('The Pi review ran out of time (30 minutes).');
    const skipped = {
      verdict: 'skipped',
      needsPerson: 0,
      changeRequested: 0,
      engine: 'pi',
    };
    expect(
      decisionFor('pi', {
        state: 'finished',
        outcome: { ...skipped, stopped: PI_SUPERSEDED },
      })
    ).toBe(PI_SUPERSEDED);
    expect(
      decisionFor('pi', {
        state: 'finished',
        outcome: { ...skipped, stopped: PI_CANCELLED },
      })
    ).toBe(PI_CANCELLED);
    expect(decisionFor('pi', { state: 'finished', outcome: skipped })).toBe(
      'Stopped: the pull request closed, a newer commit replaced this one, or the review was cancelled'
    );
    expect(
      decisionFor('pi', {
        state: 'finished',
        outcome: { ...skipped, verdict: 'failed', error: PI_CLOSED },
      })
    ).toBe(PI_CLOSED);
    expect(
      decisionFor('pi', {
        state: 'finished',
        outcome: {
          ...skipped,
          verdict: 'failed',
          error: 'The Pi review ran out of time (30 minutes).',
          pi: { turns: 9, toolCalls: 20, durationMs: 1_800_000 },
        },
      })
    ).toBe(
      'The Pi review ran out of time (30 minutes). (Pi: 9 turns, 20 tool calls, 30 min)'
    );
    expect(decisionFor('trigger', { secagent: 0.82, docsagent: 0.05 })).toBe(
      '@secagent 0.82, @docsagent 0.05'
    );
  });
});

describe('无法完成的审查', () => {
  const reviewRow = (t: TestEnv) =>
    t.env.DB.prepare(
      'SELECT status, error_message AS error FROM pr_classifications'
    ).first<{ status: string; error: string | null }>();
  /** Whether a stack run was started for `head` (stack instance ids carry the head). */
  const stackStartedFor = (t: TestEnv, head: string) =>
    t.actions.resolutions.some(
      (r) =>
        (r.params as { stack?: unknown }).stack &&
        r.id.includes(`-${head.slice(0, 12)}-`)
    );

  it('读取变更失败时仍启动堆叠分析', async () => {
    const { t, repo, head } = await reviewed([['secagent', AGENT_MD()]]);
    repo.parseTree = () => {
      throw new Error('tree unreadable');
    };
    await runReviews(t, agentModels().models);
    expect(await reviewRow(t)).toMatchObject({
      status: 'failed',
      error: 'The pull request could not be read: tree unreadable',
    });
    expect(stackStartedFor(t, head)).toBe(true);
  });

  it('无法创建审查 Workflow 时仍启动堆叠分析', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    const binding = (
      t.env as unknown as {
        MERGE_RESOLUTION: {
          create: (o: { params: unknown }) => Promise<unknown>;
        };
      }
    ).MERGE_RESOLUTION;
    const create = binding.create.bind(binding);
    binding.create = async (o) => {
      if ((o.params as { headReview?: unknown }).headReview)
        throw new Error('Workflows down');
      return create(o);
    };
    const next = await commitPaths(
      repo,
      'feature',
      { ...BASE, ...SCHEMA_CHANGE, 'b.txt': 'b\n' },
      'More'
    );
    expect((await startReview(t))!.status).toBe('failed');
    expect(stackStartedFor(t, next)).toBe(true);
  });

  it('无法读取拉取请求时报告失败', async () => {
    const { t, repo } = await reviewed([['secagent', AGENT_MD()]]);
    t.fake.repos.delete(repo.name);
    await runReviews(t, agentModels().models);
    expect(await reviewRow(t)).toMatchObject({
      status: 'failed',
      error: 'The pull request could not be read: NOT_FOUND',
    });
  });

  it('后续步骤抛出异常时标记失败，避免停留在进行中', async () => {
    const { t, head } = await reviewed([['secagent', AGENT_MD()]]);
    const review = await startReview(t);
    const db = drizzle(t.env.DB, { schema });
    const throwing = {
      do: async (name: string, a: unknown, b?: unknown) => {
        if (name === 'save-files') throw new Error('D1 down');
        return ((b ?? a) as () => Promise<unknown>)();
      },
      sleep: async () => {},
    } as unknown as StepRunner;
    await executeHeadReview(
      { env: t.env, db, step: throwing, models: agentModels().models },
      review!.id
    );
    expect(await reviewRow(t)).toMatchObject({
      status: 'failed',
      error: 'The review stopped unexpectedly. Try again.',
    });
    expect(stackStartedFor(t, head)).toBe(true);
  });

  it('变更文件过多时报告明确的失败信息', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_REVIEW_FILES; i++) many[`f/${i}.txt`] = `${i}\n`;
    const { t, head } = await reviewed([['secagent', AGENT_MD()]], many);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.summarized).toEqual([]);
    expect(await reviewRow(t)).toMatchObject({
      status: 'failed',
      error: 'Too many files to review automatically — a person must approve.',
    });
    // Stacking doesn't wait on a review that will never finish.
    expect(stackStartedFor(t, head)).toBe(true);
  }, 60_000);

  it('加载步骤本身失败时报告失败，且仍启动堆叠分析', async () => {
    const { t, head } = await reviewed([['secagent', AGENT_MD()]]);
    const review = await startReview(t);
    const db = drizzle(t.env.DB, { schema });
    const throwing = {
      do: async (name: string, a: unknown, b?: unknown) => {
        if (name === 'load') throw new Error('D1 down');
        return ((b ?? a) as () => Promise<unknown>)();
      },
      sleep: async () => {},
    } as unknown as StepRunner;
    await executeHeadReview(
      { env: t.env, db, step: throwing, models: agentModels().models },
      review!.id
    );
    expect(await reviewRow(t)).toMatchObject({
      status: 'failed',
      error: 'The review stopped unexpectedly. Try again.',
    });
    expect(stackStartedFor(t, head)).toBe(true);
  });

  it('未汇总路径过长而无法携带时，报告明确的失败信息', async () => {
    // 830 files, each path ~1 KB: under MAX_REVIEW_FILES, but the 530 beyond the first 300 are > 512 KB of paths.
    const dir = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(200)).join('/');
    const many: Record<string, string> = {};
    for (let i = 0; i < 830; i++) many[`${dir}/${i}.txt`] = `${i}\n`;
    const { t, head } = await reviewed([['secagent', AGENT_MD()]], many);
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.summarized).toEqual([]);
    expect(await reviewRow(t)).toMatchObject({
      status: 'failed',
      error: TOO_MANY_FILES,
    });
    expect(stackStartedFor(t, head)).toBe(true);
  }, 60_000);

  it('非模型原因导致智能体审查失败时，记录具体原因', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    const { models } = agentModels({
      onTrigger: async () => {
        const n = (await t.env.DB.prepare(
          `SELECT artifacts_name AS n FROM repositories WHERE name = 'secagent'`
        ).first<{ n: string }>())!.n;
        t.fake.repos.delete(n);
      },
    });
    await runReviews(t, models);
    expect((await reviewers(t))[0]).toMatchObject({
      status: 'failed',
      error: 'The review failed: NOT_FOUND',
    });
  });

  it('审查步骤重放时返回已记录的结果', async () => {
    const { t } = await reviewed([['secagent', AGENT_MD()]]);
    const { models } = agentModels({ review: () => FINDINGS });
    await runReviews(t, models);
    const db = drizzle(t.env.DB, { schema });
    const review = (await db.select().from(prClassifications).get())!;
    const loaded = await loadHead(
      t.env,
      db,
      review.pullRequestId,
      review.headSha
    );
    const [r] = await reviewers(t);
    const outcome = await runAgentReview(
      { env: t.env, db, models },
      {
        ...(loaded as { ok: true; value: HeadContext }).value,
        reviewId: review.id,
        summaries: '',
        reviewer: { reviewerId: r.id, handle: 'secagent' },
      }
    );
    expect(outcome).toEqual({
      verdict: 'findings',
      needsPerson: 1,
      changeRequested: 1,
      engine: 'pass',
    });
  });
});

type View = {
  review: {
    agentsInvited: boolean;
    status: string | null;
    reviewers: {
      agent: { username: string };
      agentRepository: string | null;
      status: string;
      requested: boolean;
      probability: number | null;
      agentSha: string | null;
      flags: {
        id: string;
        kind: string;
        title: string;
        approvedAt: string | null;
      }[];
    }[];
    verdict: { satisfied: boolean; reasons: { kind: string }[] } | null;
    autoMerge: { state: string };
  };
};
const view = async (
  t: Awaited<ReturnType<typeof appRepo>>['t'],
  cookie: string
) =>
  (await (
    await call(t, '/api/repos/octocat/app/pulls/1', { cookie })
  ).json()) as View;

describe('拉取请求页面', () => {
  it('显示每个智能体的状态、概率、提交和审查意见，以及最终结论', async () => {
    const { t, admin, shas } = await reviewed([
      ['secagent', AGENT_MD()],
      ['docsagent', AGENT_MD()],
    ]);
    await runReviews(
      t,
      agentModels({
        probabilities: { docsagent: 0.1 },
        review: () => FINDINGS,
      }).models
    );
    const { review } = await view(t, admin);
    expect(review.agentsInvited).toBe(true);
    expect(review.status).toBe('done');
    expect(review.reviewers).toMatchObject([
      {
        agent: { username: 'docsagent' },
        status: 'not_needed',
        requested: false,
        probability: 0.1,
      },
      {
        agent: { username: 'secagent' },
        agentRepository: 'secagent/secagent',
        agentSha: shas.secagent,
        status: 'changes_requested',
        flags: [
          { kind: 'needs_person', title: 'New column' },
          { kind: 'change_requested', title: 'Backfill' },
        ],
      },
    ]);
    expect(review.verdict!.reasons.map((r) => r.kind)).toEqual([
      'agent_changes_requested',
      'agent_flagged',
    ]);
    expect(review.autoMerge.state).toBe('waiting');
  });

  it('批准审查意见或要求修改时需要合并权限', async () => {
    const { t, admin } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(t, agentModels({ review: () => FINDINGS }).models);
    const [person, change] = (await view(t, admin)).review.reviewers[0].flags;
    const reader = await addMember(t, admin, 'reader');
    const url = (id: string, action: string) =>
      `/api/repos/octocat/app/pulls/1/review/flags/${id}/${action}`;
    for (const id of [person.id, change.id])
      expect(
        (await call(t, url(id, 'approve'), { cookie: reader, method: 'POST' }))
          .status
      ).toBe(403);
    expect(
      (
        await call(t, url(person.id, 'request-changes'), {
          cookie: reader,
          json: { note: 'no' },
        })
      ).status
    ).toBe(403);
    // Nothing changed.
    const { review } = await view(t, admin);
    for (const f of review.reviewers[0].flags) expect(f.approvedAt).toBeNull();
  });

  it('驳回修改请求，且不允许对该请求再次要求修改', async () => {
    const { t, admin } = await reviewed([['secagent', AGENT_MD()]]);
    await runReviews(t, agentModels({ review: () => FINDINGS }).models);
    const change = (await view(t, admin)).review.reviewers[0].flags[1];
    const refused = await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${change.id}/request-changes`,
      { cookie: admin, json: { note: 'no' } }
    );
    expect(refused.status).toBe(400);
    const dismissed = await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${change.id}/approve`,
      { cookie: admin, method: 'POST' }
    );
    expect(dismissed.status).toBe(200);
    const { review } = await view(t, admin);
    expect(review.reviewers[0].flags[1].approvedAt).not.toBeNull();
    expect(review.verdict!.reasons.map((r) => r.kind)).toEqual([
      'agent_flagged',
    ]);
  });

  it('查看页面时，为尚未审查的头提交启动审查', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await view(t, admin);
    await settle(t);
    expect(
      t.actions.resolutions.filter(
        (r) => (r.params as { headReview?: unknown }).headReview
      )
    ).toHaveLength(1);
  });
});

describe('访客查看页面', () => {
  it('公开仓库的匿名访客查看页面不会启动审查，成员查看时才补启动', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    const made = await call(t, '/api/repos/octocat/app', {
      cookie: admin,
      method: 'PATCH',
      json: { visibility: 'public' },
    });
    expect(made.status).toBe(200);
    const started = () =>
      t.actions.resolutions.filter(
        (r) => (r.params as { headReview?: unknown }).headReview
      ).length;
    const anonymous = await call(t, '/api/repos/octocat/app/pulls/1');
    expect(anonymous.status).toBe(200);
    await settle(t);
    expect(started()).toBe(0);
    await view(t, admin);
    await settle(t);
    expect(started()).toBe(1);
  });
});

describe('审查启动时机', () => {
  it('拉取请求创建时及每次推送带来新头提交时启动', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    const started = () =>
      t.actions.resolutions.filter(
        (r) => (r.params as { headReview?: unknown }).headReview
      ).length;
    expect(started()).toBe(1);
    await commitPaths(
      repo,
      'feature',
      { ...BASE, ...SCHEMA_CHANGE, 'b.txt': 'b\n' },
      'More'
    );
    const repositoryId = (await t.env.DB.prepare(
      "SELECT id FROM repositories WHERE name = 'app'"
    ).first<{ id: string }>())!.id;
    await executeSweep(
      { env: t.env, db: drizzle(t.env.DB, { schema }), step },
      { repositoryId, branches: ['feature'] }
    );
    expect(started()).toBe(2);
  });

  it('启动审查失败时，扫描仍启动关系发现', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, SCHEMA_CHANGE);
    const next = await commitPaths(
      repo,
      'feature',
      { ...BASE, ...SCHEMA_CHANGE, 'b.txt': 'b\n' },
      'More'
    );
    const repositoryId = (await t.env.DB.prepare(
      "SELECT id FROM repositories WHERE name = 'app'"
    ).first<{ id: string }>())!.id;
    // Reviews can't be read; discovery (no agents here, so it waits on none) doesn't need them.
    const DB = t.env.DB;
    const failing = new Proxy(DB, {
      get(target, prop) {
        if (prop === 'prepare')
          return (sql: string) => {
            if (/pr_classifications/.test(sql)) throw new Error('D1 down');
            return target.prepare(sql);
          };
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    await executeSweep(
      { env: t.env, db: drizzle(failing, { schema }), step },
      { repositoryId, branches: ['feature'] }
    );
    expect(
      t.actions.resolutions.some(
        (r) =>
          (r.params as { stack?: unknown }).stack &&
          r.id.includes(`-${next.slice(0, 12)}-`)
      )
    ).toBe(true);
  });

  it('从摘要和智能体差异中排除锁文件与 .orangeignore 匹配项', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(
      t,
      admin,
      repo,
      { 'yarn.lock': 'lock\n', 'gen/out.js': 'x\n', 'src/b.ts': 'b\n' },
      { base: { ...BASE, '.orangeignore': 'gen/\n' } }
    );
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.summarized).toEqual(['src/b.ts']);
    expect(calls.reviewed[0].diffs).toContain('--- src/b.ts (added)');
    expect(calls.reviewed[0].diffs).toContain(
      'Ignored (lockfiles and .orangeignore), not shown: gen/out.js, yarn.lock'
    );
  });

  it('从合并目标读取 .orangeignore，避免拉取请求隐藏自身文件', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(
      t,
      admin,
      repo,
      {
        'src/gen.d.ts': 'export type X = 1;\n',
        'src/vendor.js': 'var v;\n',
        // The branch's own .orangeignore doesn't count.
        '.orangeignore': 'src/gen.d.ts\nsrc/vendor.js\n',
      },
      { base: { ...BASE, '.orangeignore': 'src/gen.d.ts\n' } }
    );
    const { models, calls } = agentModels();
    await runReviews(t, models);
    expect(calls.summarized).not.toContain('src/gen.d.ts');
    expect(calls.summarized).toContain('src/vendor.js');
    const row = (await t.env.DB.prepare(
      'SELECT files FROM pr_classifications'
    ).first<{ files: string }>())!;
    const files = JSON.parse(row.files) as { path: string; summary: string }[];
    expect(files.find((f) => f.path === 'src/gen.d.ts')?.summary).toBe(
      'Changed; ignored by .orangeignore.'
    );
  });
});
