// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import type { AgentReview } from '../review/contract';
import { addMember, call, type TestEnv } from './helpers/app';
import { connect, tool } from './helpers/mcp';
import { commitPaths } from './helpers/seed';
import {
  AGENT_MD,
  agentModels,
  APPROVE,
  appRepo,
  BASE,
  invitedAgent,
  openPull,
  runReviews,
  startReview,
} from './helpers/reviews';

const CHANGE = { 'migrations/0001.sql': 'ALTER TABLE users ADD plan text;\n' };

const FINDINGS: AgentReview = {
  verdict: 'findings',
  summary: 'One concern.',
  findings: [
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

type Earlier = {
  id: string;
  headSha: string;
  agent: { username: string };
  status: string;
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
  flags: { title: string; kind: string; approvedAt: string | null }[];
};
type View = {
  review: {
    headSha: string;
    reviewers: { agent: { username: string }; status: string }[];
    earlier: Earlier[];
  };
};
const view = async (t: TestEnv, cookie: string) =>
  (await (
    await call(t, '/api/repos/octocat/app/pulls/1', { cookie })
  ).json()) as View;

/** #1 reviewed by secagent with a finding, then a second push it approves. */
async function twoHeads() {
  const { t, admin, repo } = await appRepo();
  await invitedAgent(t, admin, 'secagent', AGENT_MD());
  const first = await openPull(t, admin, repo, CHANGE);
  await startReview(t);
  await runReviews(t, agentModels({ review: () => FINDINGS }).models);
  const second = await commitPaths(
    repo,
    'feature',
    {
      ...BASE,
      ...CHANGE,
      'migrations/0002.sql': 'UPDATE users SET plan = 1;\n',
    },
    'Second push'
  );
  await startReview(t);
  await runReviews(t, agentModels({ review: () => APPROVE }).models);
  return { t, admin, repo, first: first.head, second };
}

describe('拉取请求页面中较早提交的审查', () => {
  it('列出审查及其提交和意见，且不包含头提交', async () => {
    const { t, admin, first, second } = await twoHeads();
    const { review } = await view(t, admin);
    expect(review.headSha).toBe(second);
    expect(review.reviewers).toMatchObject([
      { agent: { username: 'secagent' }, status: 'approved' },
    ]);
    expect(review.earlier).toHaveLength(1);
    expect(review.earlier[0]).toMatchObject({
      headSha: first,
      agent: { username: 'secagent' },
      status: 'changes_requested',
      summary: 'One concern.',
      flags: [
        { kind: 'change_requested', title: 'Backfill', approvedAt: null },
      ],
    });
    expect(review.earlier[0].finishedAt).not.toBeNull();
  });

  it('仅有一个已审查提交的拉取请求返回空列表', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin, 'secagent', AGENT_MD());
    await openPull(t, admin, repo, CHANGE);
    await startReview(t);
    await runReviews(t, agentModels({ review: () => FINDINGS }).models);
    expect((await view(t, admin)).review.earlier).toEqual([]);
  });

  it('保留最近 50 条，最新的排在最前', async () => {
    const { t, admin, second } = await twoHeads();
    const pr = (await t.env.DB.prepare('SELECT id FROM pull_requests').first<{
      id: string;
    }>())!.id;
    const agent = (await t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'secagent'"
    ).first<{ id: string }>())!.id;
    await t.env.DB.batch(
      Array.from({ length: 60 }, (_, i) =>
        t.env.DB.prepare(
          `INSERT INTO pr_reviewers (id, pull_request_id, head_sha, agent_id, requested, status, created_at)
           VALUES (?, ?, ?, ?, 1, 'approved', ?)`
        ).bind(`old-${i}`, pr, `old${i}`.padStart(40, '0'), agent, i + 1)
      )
    );
    const { earlier } = (await view(t, admin)).review;
    expect(earlier).toHaveLength(50);
    // The real first commit's review is the newest earlier one; the seeded ones follow, newest first.
    expect(earlier[0].status).toBe('changes_requested');
    expect(earlier[1].id).toBe('old-59');
    expect(earlier.at(-1)!.id).toBe('old-11');
    expect(earlier.some((e) => e.headSha === second)).toBe(false);
  });

  it('不将较早审查包含在 cloudforge_get_pull_request 中', async () => {
    const { t, admin } = await twoHeads();
    const { access_token } = await connect(t, admin);
    const res = await tool(t, access_token, 'cloudforge_get_pull_request', {
      repository: 'octocat/app',
      number: 1,
    });
    const out = JSON.parse(res.content[0].text) as Record<string, unknown> & {
      reviewers: { status: string; findings: unknown[] }[];
    };
    expect(res.content[0].text).not.toContain('earlier');
    expect(res.content[0].text).not.toContain('Backfill');
    expect(out.reviewers).toMatchObject([{ status: 'approved', findings: [] }]);
  });

  it('无权读取仓库的用户收到未找到响应', async () => {
    const { t, admin } = await twoHeads();
    const outsider = await addMember(t, admin, 'outsider');
    await t.env.DB.prepare(
      `UPDATE repositories SET visibility = 'private'`
    ).run();
    const res = await call(t, '/api/repos/octocat/app/pulls/1', {
      cookie: outsider,
    });
    expect(res.status).toBe(404);
  });
});
