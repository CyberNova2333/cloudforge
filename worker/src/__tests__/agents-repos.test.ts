// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';
import { newAgent } from './helpers/agents';

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', visibility: 'internal' },
  });
  await newAgent(t, admin, 'secagent', 'Security Agent');
  return { t, admin };
}

const invite = (
  t: TestEnv,
  cookie: string,
  handle: string,
  repo = 'octocat/app'
) => call(t, `/api/repos/${repo}/agents/${handle}`, { cookie, method: 'PUT' });
const list = async (t: TestEnv, cookie: string, repo = 'octocat/app') =>
  (await (await call(t, `/api/repos/${repo}/agents`, { cookie })).json()) as {
    username: string;
    name: string;
    invitedAt: string;
  }[];

describe('仓库智能体', () => {
  it('允许仓库管理员邀请智能体，且只邀请一次', async () => {
    const { t, admin } = await setup();
    expect((await invite(t, admin, 'secagent')).status).toBe(200);
    expect((await invite(t, admin, 'SecAgent')).status).toBe(200);
    const agents = await list(t, admin);
    expect(agents).toMatchObject([
      { username: 'secagent', name: 'Security Agent' },
    ]);
    expect(agents[0].invitedAt).toEqual(expect.any(String));
  });

  it('仅仓库管理员可邀请或移除，读取者可查看列表', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    const carol = await addMember(t, admin, 'carol');
    await call(t, '/api/repos/octocat/app/collaborators/bob', {
      cookie: admin,
      method: 'PUT',
    });
    expect((await invite(t, bob, 'secagent')).status).toBe(403);
    expect((await invite(t, carol, 'secagent')).status).toBe(403);
    await invite(t, admin, 'secagent');
    expect(
      (
        await call(t, '/api/repos/octocat/app/agents/secagent', {
          cookie: bob,
          method: 'DELETE',
        })
      ).status
    ).toBe(403);
    expect(await list(t, carol)).toMatchObject([{ username: 'secagent' }]);
  });

  it('向非协作者隐藏私有仓库的智能体', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'secret', visibility: 'private' },
    });
    expect(
      (await call(t, '/api/repos/octocat/secret/agents', { cookie: bob }))
        .status
    ).toBe(404);
  });

  it('向无读取权限者隐藏私有智能体仓库的名称和配置状态', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    await invite(t, admin, 'secagent');
    const patch = await call(t, '/api/repos/secagent/secagent', {
      cookie: admin,
      method: 'PATCH',
      json: { visibility: 'private' },
    });
    expect(patch.status).toBe(200);
    await t.env.DB.prepare(
      "UPDATE agents SET config_error = 'AGENT.md is missing.'"
    ).run();
    const hidden = { repository: null, configSha: null, configError: null };
    const everyone = async (cookie: string) =>
      (await (await call(t, '/api/agents', { cookie })).json()) as Record<
        string,
        unknown
      >[];
    expect(await everyone(bob)).toMatchObject([
      { username: 'secagent', ...hidden },
    ]);
    expect(await list(t, bob)).toMatchObject([
      { username: 'secagent', ...hidden },
    ]);
    // Site admins (and the agent repository’s collaborators) still see them.
    expect(await everyone(admin)).toMatchObject([
      {
        repository: 'secagent/secagent',
        configSha: expect.any(String),
        configError: 'AGENT.md is missing.',
      },
    ]);
    expect(await list(t, admin)).toMatchObject([
      { repository: 'secagent/secagent', configSha: expect.any(String) },
    ]);
  });

  it('拒绝未知或已删除智能体以及普通用户', async () => {
    const { t, admin } = await setup();
    await addMember(t, admin, 'bob');
    expect((await invite(t, admin, 'nobody')).status).toBe(404);
    expect((await invite(t, admin, 'bob')).status).toBe(404);
    await call(t, '/api/admin/agents/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect((await invite(t, admin, 'secagent')).status).toBe(404);
  });

  it('从仓库移除智能体', async () => {
    const { t, admin } = await setup();
    await invite(t, admin, 'secagent');
    const res = await call(t, '/api/repos/octocat/app/agents/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(await list(t, admin)).toEqual([]);
  });

  it('允许智能体自己的仓库邀请智能体，包括其自身', async () => {
    const { t, admin } = await setup();
    expect(
      (await invite(t, admin, 'secagent', 'secagent/secagent')).status
    ).toBe(200);
    expect(await list(t, admin, 'secagent/secagent')).toMatchObject([
      { username: 'secagent', repository: 'secagent/secagent' },
    ]);
  });

  it('删除仓库或智能体时一并删除邀请', async () => {
    const { t, admin } = await setup();
    await newAgent(t, admin, 'docsagent', 'Docs Agent');
    await invite(t, admin, 'secagent');
    await invite(t, admin, 'docsagent');
    await call(t, '/api/admin/agents/docsagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect(await list(t, admin)).toMatchObject([{ username: 'secagent' }]);
    await call(t, '/api/repos/octocat/app', {
      cookie: admin,
      method: 'DELETE',
    });
    const n = await t.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM repository_agents'
    ).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
