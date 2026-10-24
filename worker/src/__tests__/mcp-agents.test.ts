// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from './helpers/app';
import { agentRepo, newAgent } from './helpers/agents';
import { connect, rpc, tool } from './helpers/mcp';
import { MAX_AGENTS_PER_REPOSITORY } from '../review/reviewers';
import {
  agentModels,
  appRepo,
  invitedAgent,
  openPull,
  runReviews,
  startReview,
} from './helpers/reviews';
import type { AgentReview } from '../review/contract';

const NEEDS_PERSON: AgentReview = {
  verdict: 'findings',
  summary: 'One concern.',
  findings: [
    {
      kind: 'needs_person',
      title: 'Token',
      detail: 'Token changed.',
      changes: [],
      diagram: null,
      snippets: [],
      paths: ['src/auth.ts'],
    },
  ],
};

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', visibility: 'internal' },
  });
  await newAgent(t, admin, 'secagent', 'Security Agent');
  const member = await addMember(t, admin, 'mona');
  return {
    t,
    admin,
    member,
    adminToken: (await connect(t, admin)).access_token as string,
    memberToken: (await connect(t, member)).access_token as string,
  };
}

const textOf = (r: { content: { text: string }[] }) =>
  r.content.map((c) => c.text).join('\n');
const parsed = <T>(r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0].text) as T;
const invited = async (t: TestEnv, cookie: string) =>
  (
    (await (
      await call(t, '/api/repos/octocat/app/agents', { cookie })
    ).json()) as { username: string }[]
  ).map((a) => a.username);

describe('MCP 代理工具', () => {
  it('向每个连接列出工具', async () => {
    const { t, memberToken } = await setup();
    const res = await rpc(t, memberToken, 'tools/list');
    const names = (
      (await res.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'cloudforge_list_agents',
        'cloudforge_list_repository_agents',
        'cloudforge_invite_agent',
        'cloudforge_remove_agent',
        'cloudforge_create_agent',
      ])
    );
  });

  it('向任何成员列出代理及其仓库', async () => {
    const { t, memberToken } = await setup();
    const r = await tool(t, memberToken, 'cloudforge_list_agents');
    expect(r.isError).toBeFalsy();
    const [agent] =
      parsed<{ handle: string; name: string; repository: string | null }[]>(r);
    expect(agent).toMatchObject({
      handle: 'secagent',
      name: 'Security Agent',
      repository: 'secagent/secagent',
    });
  });

  it('允许仓库管理员邀请和移除代理，与网页路由一致', async () => {
    const { t, admin, adminToken } = await setup();
    const args = { repository: 'octocat/app', handle: 'SecAgent' };
    const first = await tool(t, adminToken, 'cloudforge_invite_agent', args);
    expect(first.isError).toBeFalsy();
    expect(textOf(first)).toContain('@secagent now reviews');
    // Inviting again does nothing.
    expect(
      (await tool(t, adminToken, 'cloudforge_invite_agent', args)).isError
    ).toBeFalsy();
    expect(await invited(t, admin)).toEqual(['secagent']);
    const listed = await tool(
      t,
      adminToken,
      'cloudforge_list_repository_agents',
      {
        repository: 'octocat/app',
      }
    );
    expect(parsed<{ handle: string }[]>(listed).map((a) => a.handle)).toEqual([
      'secagent',
    ]);

    const removed = await tool(t, adminToken, 'cloudforge_remove_agent', args);
    expect(removed.isError).toBeFalsy();
    expect(await invited(t, admin)).toEqual([]);
    expect(
      textOf(
        await tool(t, adminToken, 'cloudforge_list_repository_agents', {
          repository: 'octocat/app',
        })
      )
    ).toContain('has invited no agents');
  });

  it('拒绝非仓库管理员邀请或移除代理', async () => {
    const { t, admin, memberToken } = await setup();
    const args = { repository: 'octocat/app', handle: 'secagent' };
    const invite = await tool(t, memberToken, 'cloudforge_invite_agent', args);
    expect(invite.isError).toBe(true);
    expect(textOf(invite)).toContain('Only an admin of octocat/app');
    await call(t, '/api/repos/octocat/app/agents/secagent', {
      cookie: admin,
      method: 'PUT',
    });
    const remove = await tool(t, memberToken, 'cloudforge_remove_agent', args);
    expect(remove.isError).toBe(true);
    expect(await invited(t, admin)).toEqual(['secagent']);
  });

  it('代理或仓库缺失时返回错误且不泄露仓库是否存在', async () => {
    const { t, adminToken, memberToken } = await setup();
    const missing = await tool(t, adminToken, 'cloudforge_invite_agent', {
      repository: 'octocat/app',
      handle: 'nobody',
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('No agent named nobody');
    const hidden = await tool(
      t,
      memberToken,
      'cloudforge_list_repository_agents',
      {
        repository: 'octocat/secret',
      }
    );
    expect(hidden.isError).toBe(true);
    expect(textOf(hidden)).toContain('No repository named octocat/secret');
  });

  it('拒绝超过上限的邀请', async () => {
    const { t, admin, adminToken } = await setup();
    for (let i = 0; i < MAX_AGENTS_PER_REPOSITORY; i++) {
      await newAgent(t, admin, `agent${i}`, `Agent ${i}`);
      await call(t, `/api/repos/octocat/app/agents/agent${i}`, {
        cookie: admin,
        method: 'PUT',
      });
    }
    const over = await tool(t, adminToken, 'cloudforge_invite_agent', {
      repository: 'octocat/app',
      handle: 'secagent',
    });
    expect(over.isError).toBe(true);
    expect(textOf(over)).toContain(
      `at most ${MAX_AGENTS_PER_REPOSITORY} agents`
    );
  });

  it('仅允许站点管理员创建代理，并返回仓库与配置方法', async () => {
    const { t, admin, adminToken, memberToken } = await setup();
    const refused = await tool(t, memberToken, 'cloudforge_create_agent', {
      handle: 'dataagent',
      name: 'Data Agent',
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('Only a site admin');

    const created = await tool(t, adminToken, 'cloudforge_create_agent', {
      handle: 'dataagent',
      name: 'Data Agent',
    });
    expect(created.isError).toBeFalsy();
    expect(
      parsed<{ handle: string; repository: string }>(created)
    ).toMatchObject({ handle: 'dataagent', repository: 'dataagent/dataagent' });
    expect(textOf(created)).toContain(
      'git clone http://test.local/dataagent/dataagent.git'
    );
    expect(await agentRepo(t, 'dataagent')).toBeTruthy();
    const all = (await (
      await call(t, '/api/agents', { cookie: admin })
    ).json()) as {
      username: string;
    }[];
    expect(all.map((a) => a.username)).toContain('dataagent');

    const taken = await tool(t, adminToken, 'cloudforge_create_agent', {
      handle: 'dataagent',
      name: 'Again',
    });
    expect(taken.isError).toBe(true);
  });

  it('取消被移除代理正在执行的审查', async () => {
    const { t, admin, repo } = await appRepo();
    await invitedAgent(t, admin);
    await openPull(t, admin, repo, { 'src/auth.ts': 'export const x = 1;\n' });
    await startReview(t);
    // A finding keeps the pull request open; then the agent is put back mid-review.
    await runReviews(t, agentModels({ review: () => NEEDS_PERSON }).models);
    await t.env.DB.prepare(
      "UPDATE pr_reviewers SET status = 'reviewing', finished_at = NULL"
    ).run();
    const status = async () =>
      (
        await t.env.DB.prepare(
          "SELECT r.status FROM pr_reviewers r JOIN users u ON u.id = r.agent_id WHERE u.username = 'secagent'"
        ).first<{ status: string }>()
      )?.status;
    expect(await status()).toBe('reviewing');
    const token = (await connect(t, admin)).access_token as string;
    const removed = await tool(t, token, 'cloudforge_remove_agent', {
      repository: 'octocat/app',
      handle: 'secagent',
    });
    expect(removed.isError).toBeFalsy();
    await settle(t);
    expect(await status()).toBe('not_needed');
  });
});
