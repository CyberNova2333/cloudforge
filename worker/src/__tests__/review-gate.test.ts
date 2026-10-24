// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  approvalOverrides,
  listReview,
  reviewVerdict,
  type ReviewReason,
  type GateFlag,
  type GateInput,
  type GateReviewer,
} from '../review/gate';
import type { AgentReview } from '../review/contract';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { landPull } from '../merge/land';
import { findRepoById, gitFor } from '../lib/repos';
import { addMember, call, settle } from './helpers/app';
import { commitPaths } from './helpers/seed';
import {
  AGENT_MD,
  BASE,
  agentModels,
  appRepo,
  flags,
  invitedAgent,
  openPull,
  runReviews,
  startReview,
} from './helpers/reviews';

const input = (o: Partial<GateInput> = {}): GateInput => ({
  agentsInvited: true,
  aiReview: true,
  review: { status: 'done', errorMessage: null },
  reviewers: [],
  flags: [],
  approvedBy: [],
  ...o,
});
const sec = (
  status: GateReviewer['status'],
  o: Partial<GateReviewer> = {}
): GateReviewer => ({
  agentId: 'a1',
  handle: 'secagent',
  status,
  requested: true,
  error: null,
  ...o,
});
const flag = (o: Partial<GateFlag> = {}): GateFlag => ({
  id: 'f1',
  agentId: 'a1',
  kind: 'needs_person',
  title: 'Token',
  detail: 'Hard-codes a token.\n\n| | Before | After |',
  approved: false,
  changesRequested: false,
  ...o,
});

describe('reviewVerdict 审查门禁判定', () => {
  it('没有邀请代理、没有请求代理审查或 AI 关闭时需要人工处理', () => {
    const needs = { satisfied: false, reasons: [{ kind: 'needs_approval' }] };
    expect(
      reviewVerdict(input({ agentsInvited: false, review: null }))
    ).toEqual(needs);
    expect(
      reviewVerdict(
        input({ reviewers: [sec('not_needed', { requested: false })] })
      )
    ).toEqual(needs);
    expect(reviewVerdict(input({ aiReview: false, review: null }))).toEqual(
      needs
    );
  });

  it('人工批准可满足含人工待办意见或失败审查的门禁', () => {
    expect(
      reviewVerdict(
        input({
          reviewers: [
            sec('flagged'),
            sec('failed', { agentId: 'a2', handle: 'dataagent' }),
          ],
          flags: [flag(), flag({ id: 'f2', changesRequested: true })],
          approvedBy: ['u1'],
        })
      )
    ).toEqual({ satisfied: true, reasons: [] });
    expect(
      reviewVerdict(
        input({ agentsInvited: false, review: null, approvedBy: ['u1'] })
      )
    ).toEqual({ satisfied: true, reasons: [] });
  });

  it('人工批准不能覆盖代理尚未解决的修改请求', () => {
    const change = flag({
      kind: 'change_requested',
      title: 'Backfill',
      detail: 'Add a backfill.',
    });
    expect(
      reviewVerdict(
        input({
          reviewers: [sec('changes_requested')],
          flags: [change, flag({ id: 'f2' })],
          approvedBy: ['u1'],
        })
      )
    ).toEqual({
      satisfied: false,
      reasons: [
        {
          kind: 'agent_changes_requested',
          agent: 'secagent',
          changes: [{ id: 'f1', title: 'Backfill', detail: 'Add a backfill.' }],
        },
      ],
    });
    // Dismissed, the approval counts.
    expect(
      reviewVerdict(
        input({
          reviewers: [sec('changes_requested')],
          flags: [{ ...change, approved: true }, flag({ id: 'f2' })],
          approvedBy: ['u1'],
        })
      )
    ).toEqual({ satisfied: true, reasons: [] });
  });

  it('列出人工批准所覆盖的事项', () => {
    expect(
      approvalOverrides(
        input({
          reviewers: [
            sec('changes_requested'),
            sec('failed', {
              agentId: 'a2',
              handle: 'dataagent',
              error: 'down',
            }),
          ],
          flags: [
            flag(),
            flag({ id: 'f2', kind: 'change_requested', title: 'Backfill' }),
          ],
        })
      )
    ).toEqual([
      {
        kind: 'agent_flagged',
        agent: 'secagent',
        flags: [{ id: 'f1', title: 'Token' }],
      },
      { kind: 'agent_review_failed', agent: 'dataagent', error: 'down' },
    ]);
  });

  it('代理正在审查或审查尚未开始时等待', () => {
    expect(reviewVerdict(input({ review: null })).reasons).toEqual([
      { kind: 'agent_reviewing', agent: null },
    ]);
    expect(
      reviewVerdict(
        input({ review: { status: 'triggering', errorMessage: null } })
      ).reasons
    ).toEqual([{ kind: 'agent_reviewing', agent: null }]);
    expect(
      reviewVerdict(input({ reviewers: [sec('reviewing')] })).reasons
    ).toEqual([{ kind: 'agent_reviewing', agent: 'secagent' }]);
  });

  it('指出代理审查或整个提交审查的失败', () => {
    expect(
      reviewVerdict(
        input({ reviewers: [sec('failed', { error: 'AGENT.md: bad' })] })
      ).reasons
    ).toEqual([
      {
        kind: 'agent_review_failed',
        agent: 'secagent',
        error: 'AGENT.md: bad',
      },
    ]);
    expect(
      reviewVerdict(
        input({ review: { status: 'failed', errorMessage: 'down' } })
      ).reasons
    ).toEqual([{ kind: 'agent_review_failed', agent: null, error: 'down' }]);
  });

  it('所有请求的代理均批准，或人工批准各项意见后通过', () => {
    expect(reviewVerdict(input({ reviewers: [sec('approved')] }))).toEqual({
      satisfied: true,
      reasons: [],
    });
    expect(
      reviewVerdict(input({ reviewers: [sec('flagged')], flags: [flag()] }))
        .reasons
    ).toEqual([
      {
        kind: 'agent_flagged',
        agent: 'secagent',
        flags: [{ id: 'f1', title: 'Token' }],
      },
    ]);
    expect(
      reviewVerdict(
        input({
          reviewers: [sec('flagged')],
          flags: [flag({ approved: true })],
        })
      ).satisfied
    ).toBe(true);
  });

  it('代理的修改请求由拉取请求代理处理，直到人工驳回', () => {
    const change = flag({
      kind: 'change_requested',
      title: 'Backfill',
      detail: 'Add a backfill.',
    });
    expect(
      reviewVerdict(
        input({ reviewers: [sec('changes_requested')], flags: [change] })
      ).reasons
    ).toEqual([
      {
        kind: 'agent_changes_requested',
        agent: 'secagent',
        changes: [{ id: 'f1', title: 'Backfill', detail: 'Add a backfill.' }],
      },
    ]);
    expect(
      reviewVerdict(
        input({
          reviewers: [sec('changes_requested')],
          flags: [{ ...change, approved: true }],
        })
      ).satisfied
    ).toBe(true);
  });

  it('人工针对意见请求修改时转为 changes_requested', () => {
    expect(
      reviewVerdict(
        input({
          reviewers: [sec('flagged')],
          flags: [flag({ changesRequested: true })],
        })
      ).reasons
    ).toEqual([{ kind: 'changes_requested', flags: 1 }]);
  });
});

const CHANGE = { 'src/auth.ts': 'export const token = "x";\n' };
const NEEDS_PERSON: AgentReview = {
  verdict: 'findings',
  summary: 'Two concerns.',
  findings: ['Token', 'Logging'].map((title) => ({
    kind: 'needs_person' as const,
    title,
    detail: `${title} changed.`,
    changes: [],
    diagram: null,
    snippets: [],
    paths: ['src/auth.ts'],
  })),
};

async function prRow(t: Awaited<ReturnType<typeof appRepo>>['t']) {
  return t.env.DB.prepare(
    `SELECT p.state, p.merged_automatically FROM pull_requests p
       JOIN repositories r ON r.id = p.repository_id WHERE r.name = 'app' AND p.number = 1`
  ).first<{ state: string; merged_automatically: number }>();
}
const merge = (
  t: Awaited<ReturnType<typeof appRepo>>['t'],
  cookie: string,
  json: Record<string, unknown> = {}
) => call(t, '/api/repos/octocat/app/pulls/1/merge', { cookie, json });

describe('listReview 审查列表摘要', () => {
  const v = (...reasons: ReviewReason[]) => ({
    satisfied: !reasons.length,
    reasons,
  });
  const flagged = (agent: string, n: number): ReviewReason => ({
    kind: 'agent_flagged',
    agent,
    flags: Array.from({ length: n }, (_, i) => ({
      id: `${agent}-${i}`,
      title: 'F',
    })),
  });
  const failed: ReviewReason = {
    kind: 'agent_review_failed',
    agent: 'dataagent',
    error: 'down',
  };
  const agentChanges: ReviewReason = {
    kind: 'agent_changes_requested',
    agent: 'secagent',
    changes: [{ id: 'c', title: 'Rename', detail: null }],
  };
  const reviewing: ReviewReason = { kind: 'agent_reviewing', agent: null };

  it('已批准状态优先于其他状态', () => {
    expect(listReview(v())).toEqual({ state: 'approved', flags: 0 });
    // A satisfied verdict is approved whatever reasons ride along.
    expect(
      listReview({ satisfied: true, reasons: [failed, flagged('a', 2)] })
    ).toEqual({ state: 'approved', flags: 0 });
  });

  it('失败优先于修改请求，并保留意见计数', () => {
    expect(listReview(v(agentChanges, failed, flagged('a', 1)))).toEqual({
      state: 'failed',
      flags: 1,
    });
  });

  it('汇总代理或人工提出的修改请求', () => {
    expect(listReview(v(flagged('a', 1), agentChanges, reviewing))).toEqual({
      state: 'changes_requested',
      flags: 1,
    });
    expect(listReview(v({ kind: 'changes_requested', flags: 2 }))).toEqual({
      state: 'changes_requested',
      flags: 0,
    });
  });

  it('跨代理累加需要审查的意见数量', () => {
    expect(
      listReview(v(flagged('secagent', 2), flagged('dataagent', 1), reviewing))
    ).toEqual({ state: 'review_required', flags: 3 });
  });

  it('其后依次为审查中和待批准', () => {
    expect(
      listReview(v(reviewing, { kind: 'agent_reviewing', agent: 'a' }))
    ).toEqual({ state: 'reviewing', flags: 0 });
    expect(listReview(v({ kind: 'needs_approval' }))).toEqual({
      state: 'needs_approval',
      flags: 0,
    });
  });
});

describe('合入', () => {
  it('仓库没有代理审查时需要人工批准', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, CHANGE);
    const refused = await merge(t, admin);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('a person needs to approve it');
    const res = await merge(t, admin, { approve: true });
    expect(res.status).toBe(200);
    expect((await prRow(t))!.state).toBe('merged');
    const approval = await t.env.DB.prepare(
      `SELECT u.username FROM pr_approvals a JOIN users u ON u.id = a.user_id`
    ).first<{ username: string }>();
    expect(approval!.username).toBe('octocat');
  });

  it('无论是否已批准，检查失败或运行中均拒绝合入', async () => {
    const { t, admin, repo } = await appRepo();
    const { head } = await openPull(t, admin, repo, CHANGE);
    const repoId = (await t.env.DB.prepare(
      "SELECT id FROM repositories WHERE name = 'app'"
    ).first<{ id: string }>())!.id;
    await t.env.DB.prepare(
      `INSERT INTO workflow_runs (id, repository_id, run_number, workflow_path, name, event, ref, head_sha,
         display_title, status, conclusion, created_at)
       VALUES ('r1', ?, 7, '.github/workflows/ci.yml', 'CI', 'pull_request', 'refs/pull/1/head', ?, 'CI',
         'completed', 'failure', 0)`
    )
      .bind(repoId, head)
      .run();
    const failed = await merge(t, admin, { approve: true });
    expect(failed.status).toBe(409);
    expect(await failed.text()).toContain('Checks failed (run #7)');
    // The refused approve-and-merge keeps its approval (and its timeline entry).
    expect(
      await t.env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM pr_approvals) AS approvals, (SELECT COUNT(*) FROM pr_events WHERE kind = 'approved') AS events"
      ).first()
    ).toEqual({ approvals: 1, events: 1 });
    await t.env.DB.prepare(
      "UPDATE workflow_runs SET status = 'in_progress', conclusion = NULL"
    ).run();
    const running = await merge(t, admin);
    expect(running.status).toBe(409);
    expect(await running.text()).toContain('Checks are running');
  });

  it('将人工批准并合入记录为人工合入，而不是自动合入', async () => {
    const { t, admin, repo } = await appRepo();
    // Auto-merge is on here; approving inside the merge must not start it alongside.
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    const res = await merge(t, admin, { approve: true });
    expect(res.status).toBe(200);
    await settle(t);
    const row = await t.env.DB.prepare(
      `SELECT p.state, p.merged_automatically, u.username FROM pull_requests p
         JOIN repositories r ON r.id = p.repository_id JOIN users u ON u.id = p.merged_by_id
        WHERE r.name = 'app' AND p.number = 1`
    ).first();
    expect(row).toEqual({
      state: 'merged',
      merged_automatically: 0,
      username: 'octocat',
    });
  });

  it('拒绝没有合入权限的成员在合入时批准', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, CHANGE);
    const mona = await addMember(t, admin, 'mona');
    expect((await merge(t, mona, { approve: true })).status).toBe(403);
  });

  it('所请求代理批准后自动合入并删除分支', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    await startReview(t);
    await runReviews(t, agentModels().models);
    await settle(t);
    expect(await prRow(t)).toMatchObject({
      state: 'merged',
      merged_automatically: 1,
    });
    expect(repo.refs.has('refs/heads/feature')).toBe(false);
  });

  it('存在待人工处理的意见时等待，逐项批准后合入', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    await startReview(t);
    await runReviews(t, agentModels({ review: () => NEEDS_PERSON }).models);
    expect((await prRow(t))!.state).toBe('open');
    for (const f of await flags(t))
      expect(
        (
          await call(
            t,
            `/api/repos/octocat/app/pulls/1/review/flags/${f.id}/approve`,
            {
              cookie: admin,
              method: 'POST',
            }
          )
        ).status
      ).toBe(200);
    await settle(t);
    expect((await prRow(t))!.state).toBe('merged');
  });

  it('没有邀请代理时，即使已批准也不自动合入', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, CHANGE);
    await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    await settle(t);
    expect((await prRow(t))!.state).toBe('open');
  });

  it('被移除代理不再参与判定，全部移除后分支头需要人工批准', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    await startReview(t);
    await runReviews(t, agentModels({ review: () => NEEDS_PERSON }).models);
    const [first] = await flags(t);
    await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${first.id}/approve`,
      {
        cookie: admin,
        method: 'POST',
      }
    );
    await call(t, '/api/repos/octocat/app/agents/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    await settle(t);
    expect((await prRow(t))!.state).toBe('open');
    const refused = await merge(t, admin);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('a person needs to approve it');
  });

  it('删除分支失败时仍完成合入', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    const receive = repo.receivePack.bind(repo);
    repo.receivePack = async (body: Uint8Array) => {
      if (
        new TextDecoder()
          .decode(body)
          .includes(`${'0'.repeat(40)} refs/heads/feature`)
      )
        throw new Error('storage down');
      return receive(body);
    };
    await startReview(t);
    await runReviews(t, agentModels().models);
    await settle(t);
    expect(await prRow(t)).toMatchObject({
      state: 'merged',
      merged_automatically: 1,
    });
    expect(repo.refs.has('refs/heads/feature')).toBe(true);
  });

  it('新提交视为未经审查，不再计入旧批准', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, CHANGE);
    await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    await commitPaths(
      repo,
      'feature',
      { 'src/app.ts': 'export const a = 1;\n', ...CHANGE, 'b.txt': 'b\n' },
      'More'
    );
    expect((await merge(t, admin)).status).toBe(409);
  });

  it('即使人工批准也等待代理修改请求，记录批准所覆盖的事项，驳回请求后再合入', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await invitedAgent(t, admin, 'dataagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    await startReview(t);
    await runReviews(
      t,
      agentModels({
        failReview: ['dataagent'],
        review: () => ({
          ...NEEDS_PERSON,
          findings: [
            NEEDS_PERSON.findings[0],
            {
              ...NEEDS_PERSON.findings[0],
              kind: 'change_requested',
              title: 'Rotate it',
              detail: 'Read the token from a secret.',
            },
          ],
        }),
      }).models
    );
    expect(
      (
        await call(t, '/api/repos/octocat/app/pulls/1/approval', {
          cookie: admin,
          method: 'POST',
        })
      ).status
    ).toBe(200);
    await settle(t);
    expect((await prRow(t))!.state).toBe('open');
    const refused = await merge(t, admin);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('@secagent requested 1 change');
    // The approval is on the record, with what it was given over.
    const event = await t.env.DB.prepare(
      "SELECT data FROM pr_events WHERE kind = 'approved'"
    ).first<{ data: string }>();
    expect(
      (JSON.parse(event!.data).over as { kind: string; agent: string }[]).map(
        (r) => `${r.kind}:${r.agent}`
      )
    ).toEqual(['agent_review_failed:dataagent', 'agent_flagged:secagent']);
    // Dismissing the change request lets the approval count: it lands on its own.
    const change = (await flags(t)).find((f) => f.kind === 'change_requested')!;
    await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${change.id}/approve`,
      { cookie: admin, method: 'POST' }
    );
    await settle(t);
    expect((await prRow(t))!.state).toBe('merged');
  });
});

describe('批准', () => {
  const approve = (
    t: Awaited<ReturnType<typeof appRepo>>['t'],
    cookie: string,
    json?: Record<string, unknown>
  ) =>
    call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie,
      method: 'POST',
      json,
    });
  const counts = (t: Awaited<ReturnType<typeof appRepo>>['t']) =>
    t.env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM pr_approvals) AS approvals, (SELECT COUNT(*) FROM pr_events WHERE kind = 'approved') AS events"
    ).first();

  it('每人每提交仅记录一条批准及一条时间线事件', async () => {
    const { t, admin, repo } = await appRepo();
    const { head } = await openPull(t, admin, repo, CHANGE);
    expect((await approve(t, admin)).status).toBe(200);
    expect((await approve(t, admin, { headSha: head })).status).toBe(200);
    expect(await counts(t)).toEqual({ approvals: 1, events: 1 });
    const event = await t.env.DB.prepare(
      "SELECT data FROM pr_events WHERE kind = 'approved'"
    ).first<{ data: string }>();
    expect(JSON.parse(event!.data)).toEqual({ head_sha: head, over: [] });
  });

  it('文档中批准接口声明 409，撤销接口不声明', async () => {
    const { t, admin } = await appRepo();
    const doc = (await (
      await call(t, '/api/doc', { cookie: admin })
    ).json()) as {
      paths: Record<string, Record<string, { responses: object }>>;
    };
    const route =
      doc.paths['/api/repos/{owner}/{repo}/pulls/{number}/approval'];
    expect(Object.keys(route.post.responses)).toContain('409');
    expect(Object.keys(route.delete.responses)).not.toContain('409');
  });

  it('拒绝批准或批准并合入用户未查看的分支头', async () => {
    const { t, admin, repo } = await appRepo();
    await openPull(t, admin, repo, CHANGE);
    const stale = 'f'.repeat(40);
    const refused = await approve(t, admin, { headSha: stale });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('new commits');
    const merged = await merge(t, admin, { approve: true, headSha: stale });
    expect(merged.status).toBe(409);
    expect(await counts(t)).toEqual({ approvals: 0, events: 0 });
    expect((await prRow(t))!.state).toBe('open');
  });
});

describe('实际合入的提交', () => {
  it('检查已审查分支头后分支再次移动时拒绝合入', async () => {
    const { t, admin, repo } = await appRepo();
    const { head } = await openPull(t, admin, repo, CHANGE);
    const base = repo.refs.get('refs/heads/main');
    // A person approved this commit: the gate passes for it, and only for it.
    await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    const db = drizzle(t.env.DB, { schema });
    const pr = (await db.query.pullRequests.findFirst({
      where: (p, { eq }) => eq(p.number, 1),
    }))!;
    const found = (await findRepoById(db, pr.repositoryId))!;
    const git = gitFor(t.env, found.repo);
    // The branch moves right after landPull reads the head it gates (as a refs-cache refresh would show).
    const real = git.resolve.bind(git);
    let first = true;
    git.resolve = async (ref: string) => {
      if (ref !== 'feature') return real(ref);
      if (!first) return repo.refs.get('refs/heads/feature') ?? null;
      first = false;
      const gated = await real(ref);
      await commitPaths(
        repo,
        'feature',
        { ...BASE, ...CHANGE, 'late.txt': 'unreviewed\n' },
        'Late'
      );
      return gated;
    };
    const user = (await t.env.DB.prepare(
      "SELECT id, name, email FROM users WHERE username = 'octocat'"
    ).first<{ id: string; name: string; email: string }>())!;
    const result = await landPull({
      env: t.env,
      db,
      repo: found.repo,
      repoFullName: 'octocat/app',
      git,
      pr,
      by: user,
      after: () => {},
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(repo.refs.get('refs/heads/main')).toBe(base);
    expect(repo.refs.get('refs/heads/feature')).not.toBe(head);
    expect((await prRow(t))!.state).toBe('open');
  });

  it('拒绝直接合入用户未查看的分支头', async () => {
    const { t, admin, repo } = await appRepo();
    const { head } = await openPull(t, admin, repo, CHANGE);
    await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    const stale = await merge(t, admin, { headSha: 'f'.repeat(40) });
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain('new commits');
    expect((await prRow(t))!.state).toBe('open');
    expect((await merge(t, admin, { headSha: head })).status).toBe(200);
  });
});
