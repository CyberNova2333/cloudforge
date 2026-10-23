// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { createAgent } from '../agents/accounts';
import { schema } from '../db/schema';
import { GitService } from '../git/service';
import type { SessionUser } from '../variables';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';
import {
  agentRepo,
  agentRow,
  newAgent,
  type AgentJson,
} from './helpers/agents';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

describe('创建智能体', () => {
  it('创建账户、含初始内容的内部仓库及缓存字段', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin, 'SecAgent', 'Security Agent');
    const repo = await agentRepo(t);
    const head = repo.refs.get('refs/heads/main')!;

    expect(agent).toMatchObject({
      username: 'secagent',
      name: 'Security Agent',
      engine: 'pass',
      trigger: { above: 0.5 },
      repository: 'secagent/secagent',
      configSha: head,
      configError: null,
      deletedAt: null,
      image: `/api/agents/secagent/avatar?v=${head}`,
    });
    const row = await agentRow(t);
    expect(row!.user_email).toBe(`${agent.id}@agents.invalid`);
    expect(row!.trigger_ask).toBe(agent.trigger.ask);

    // Seeded by the creator, internal, the creator a collaborator.
    expect(repo.parseCommit(head)).toMatchObject({
      message: 'Create agent @secagent',
      author: { name: 'Admin', email: 'octocat@example.com' },
    });
    const detail = await call(t, '/api/repos/secagent/secagent', {
      cookie: admin,
    });
    expect(await detail.json()).toMatchObject({ visibility: 'internal' });
    const collaborators = (await (
      await call(t, '/api/repos/secagent/secagent/collaborators', {
        cookie: admin,
      })
    ).json()) as { username: string }[];
    expect(collaborators.map((c) => c.username)).toEqual(['octocat']);
    const raw = (path: string) =>
      call(t, `/api/repos/secagent/secagent/raw?ref=main&path=${path}`, {
        cookie: admin,
      });
    expect(await (await raw('AGENT.md')).text()).toContain(
      'name: "Security Agent"'
    );
    expect(await (await raw('knowledge/README.md')).text()).toContain(
      '# Knowledge'
    );
    const avatar = new Uint8Array(
      await (await raw('avatar.png')).arrayBuffer()
    );
    expect([...avatar.subarray(0, 8)]).toEqual(PNG);
  });

  it('拒绝无效、保留或已被用户或团队占用的标识名，且不区分大小写', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/team', {
      cookie: admin,
      method: 'PUT',
      json: { name: 'XY Space', slug: 'xyspace' },
    });
    await newAgent(t, admin, 'secagent');
    const users = async () =>
      (await t.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{
        n: number;
      }>())!.n;
    const before = await users();
    for (const [handle, status] of [
      ['bad_name', 400],
      ['-agent', 400],
      ['admin', 400],
      ['OctoCat', 409],
      ['xyspace', 409],
      ['SECAGENT', 409],
    ] as const) {
      const res = await call(t, '/api/admin/agents', {
        cookie: admin,
        json: { handle, name: 'Agent' },
      });
      expect(res.status, handle).toBe(status);
    }
    expect(await users()).toBe(before);
    expect(t.fake.repos.size).toBe(1);
    // And the team can't take an agent's handle.
    const team = await call(t, '/api/team', {
      cookie: admin,
      method: 'PUT',
      json: { name: 'XY Space', slug: 'secagent' },
    });
    expect(team.status).toBe(409);
  });

  it('拒绝为空、过长或会破坏 AGENT.md 标题的显示名称', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    for (const name of [
      '   ',
      'x'.repeat(101),
      'Security\nAgent',
      'Security\r\n---',
      'Tab\tAgent',
      'Bell\u0007Agent',
      'Line Break',
    ]) {
      const res = await call(t, '/api/admin/agents', {
        cookie: admin,
        json: { handle: 'secagent', name },
      });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(
        ((await res.json()) as { error: string }).error,
        JSON.stringify(name)
      ).toMatch(/name/i);
    }
    expect(t.fake.repos.size).toBe(0);
    // Surrounding whitespace is trimmed, not refused.
    expect(
      (await newAgent(t, admin, 'secagent', '  Security Agent  ')).name
    ).toBe('Security Agent');
  });

  it('仅站点管理员可创建；所有成员均可列出智能体', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    const res = await call(t, '/api/admin/agents', {
      cookie: bob,
      json: { handle: 'secagent', name: 'Security Agent' },
    });
    expect(res.status).toBe(403);
    await newAgent(t, admin, 'secagent');
    await newAgent(t, admin, 'docsagent', 'Docs Agent');
    const list = (await (
      await call(t, '/api/agents', { cookie: bob })
    ).json()) as AgentJson[];
    expect(list.map((a) => a.username)).toEqual(['docsagent', 'secagent']);
  });
});

describe('删除智能体', () => {
  it('保留用户和仓库，撤销所有仓库邀请，并从列表中移除', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    const repoId = (await agentRow(t))!.repository_id!;
    await t.env.DB.prepare(
      'INSERT INTO repository_agents (repository_id, agent_id, created_at) VALUES (?, ?, 0)'
    )
      .bind(repoId, agent.id)
      .run();

    const res = await call(t, '/api/admin/agents/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const row = await agentRow(t);
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.user_name).toBe('Security Agent');
    expect(
      (await t.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM repository_agents'
      ).first<{ n: number }>())!.n
    ).toBe(0);
    expect(
      (await call(t, '/api/repos/secagent/secagent', { cookie: admin })).status
    ).toBe(200);
    expect(
      await (await call(t, '/api/agents', { cookie: admin })).json()
    ).toEqual([]);
    // Gone already.
    expect(
      (
        await call(t, '/api/admin/agents/secagent', {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(404);
  });
});

describe('重新创建已删除智能体', () => {
  const create = (t: TestEnv, admin: string, json: unknown) =>
    call(t, '/api/admin/agents', { cookie: admin, json });
  const remove = (t: TestEnv, admin: string, handle = 'secagent') =>
    call(t, `/api/admin/agents/${handle}`, { cookie: admin, method: 'DELETE' });

  it('恢复原智能体及其仓库、AGENT.md 和历史', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    const before = (await agentRow(t))!;
    const head = (await agentRepo(t)).refs.get('refs/heads/main');
    await remove(t, admin);

    const res = await create(t, admin, { handle: 'secagent', name: 'Again' });
    expect(res.status).toBe(201);
    const back = ((await res.json()) as { agent: AgentJson }).agent;
    expect(back.id).toBe(agent.id);
    const row = (await agentRow(t))!;
    expect(row.deleted_at).toBeNull();
    expect(row.repository_id).toBe(before.repository_id);
    // Its AGENT.md and name stay as they were: nothing new was committed.
    expect(row.name).toBe(before.name);
    expect((await agentRepo(t)).refs.get('refs/heads/main')).toBe(head);
    expect(
      (
        (await (
          await call(t, '/api/agents', { cookie: admin })
        ).json()) as AgentJson[]
      ).map((a) => a.username)
    ).toEqual(['secagent']);
    const audit = await t.env.DB.prepare(
      "SELECT target FROM audit_events WHERE action = 'agent.restored'"
    ).all<{ target: string }>();
    expect(audit.results).toEqual([{ target: 'secagent' }]);
  });

  it('原仓库已删除时创建新仓库', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    expect(
      (
        await call(t, '/api/repos/secagent/secagent', {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    await remove(t, admin);
    const res = await create(t, admin, {
      handle: 'secagent',
      name: 'Security',
      preset: 'security',
    });
    expect(res.status).toBe(201);
    const row = (await agentRow(t))!;
    expect(row.user_id).toBe(agent.id);
    expect(row.repository_id).not.toBeNull();
    expect(row.deleted_at).toBeNull();
    expect(row.facet).toBe('security');
    expect(
      (await call(t, '/api/repos/secagent/secagent', { cookie: admin })).status
    ).toBe(200);
  });

  it('允许推荐团队恢复已删除成员', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const crew = () =>
      call(t, '/api/admin/agents/crew', { cookie: admin, method: 'POST' });
    await crew();
    await remove(t, admin, 'securityagent');
    const presets = (await (
      await call(t, '/api/agents/presets', { cookie: admin })
    ).json()) as { handle: string; exists: boolean }[];
    expect(presets.find((p) => p.handle === 'securityagent')!.exists).toBe(
      false
    );
    const again = (await (await crew()).json()) as {
      created: AgentJson[];
      skipped: { handle: string }[];
    };
    expect(again.created.map((a) => a.username)).toEqual(['securityagent']);
    expect(again.skipped.map((s) => s.handle)).not.toContain('securityagent');
  });

  it('仍拒绝被普通用户或团队占用的标识名', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    expect(
      (await create(t, admin, { handle: 'bob', name: 'Bob Agent' })).status
    ).toBe(409);
  });
});

describe('智能体头像', () => {
  it('将智能体仓库中的 avatar.png 作为受沙箱限制的 PNG 提供', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    const res = await call(t, agent.image!, { cookie: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect([...new Uint8Array(await res.arrayBuffer()).subarray(0, 8)]).toEqual(
      PNG
    );
    expect(
      (await call(t, '/api/agents/nobody/avatar', { cookie: admin })).status
    ).toBe(404);
  });

  it('版本不是提交时返回 404', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await newAgent(t, admin);
    const repo = await agentRepo(t);
    const head = repo.refs.get('refs/heads/main')!;
    const tree = repo.parseCommit(head)!.treeHash;
    const blob = repo.parseTree(tree)!.find((e) => e.name === 'avatar.png')!;
    for (const v of [blob.hash, tree, 'a'.repeat(40)]) {
      const res = await call(t, `/api/agents/secagent/avatar?v=${v}`, {
        cookie: admin,
      });
      expect(res.status, v).toBe(404);
    }
  });

  it('仓库删除时保留智能体', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const agent = await newAgent(t, admin);
    const del = await call(t, '/api/repos/secagent/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const list = (await (
      await call(t, '/api/agents', { cookie: admin })
    ).json()) as AgentJson[];
    expect(list).toMatchObject([{ username: 'secagent', repository: null }]);
    expect((await call(t, agent.image!, { cookie: admin })).status).toBe(404);
  });
});

describe('创建过程中的智能体账户', () => {
  /** Runs `during` when the agent's repository is created in Artifacts. */
  function onArtifactsCreate(t: TestEnv, during: () => Promise<void>) {
    const binding = t.env.ARTIFACTS as unknown as {
      create: (...a: unknown[]) => Promise<unknown>;
    };
    const create = binding.create.bind(binding);
    binding.create = async (...a) => {
      await during();
      return create(...a);
    };
  }

  it('用户记录创建时即视为智能体', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    let seen: { username: string; agent: string | null } | null = null;
    onArtifactsCreate(t, async () => {
      seen = await t.env.DB.prepare(
        `SELECT u.username, a.user_id AS agent FROM users u
         LEFT JOIN agents a ON a.user_id = u.id WHERE u.username = 'secagent'`
      ).first();
    });
    await newAgent(t, admin);
    expect(seen).toMatchObject({ username: 'secagent' });
    expect(seen!.agent).not.toBeNull();
  });

  it('创建失败时不留残余数据', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    onArtifactsCreate(t, async () => {
      throw new Error('Artifacts is down');
    });
    const res = await call(t, '/api/admin/agents', {
      cookie: admin,
      json: { handle: 'secagent', name: 'Security Agent' },
    });
    expect(res.ok).toBe(false);
    const left = await t.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM users WHERE username = 'secagent') AS users,
              (SELECT COUNT(*) FROM agents) AS agents,
              (SELECT COUNT(*) FROM repositories) AS repos`
    ).first();
    expect(left).toEqual({ users: 0, agents: 0, repos: 0 });
  });

  /** createAgent called directly, as the site admin, against `db`. */
  async function create(t: TestEnv, db = drizzle(t.env.DB, { schema })) {
    const creator = (await t.env.DB.prepare(
      "SELECT id, name, email, username, role FROM users WHERE username = 'octocat'"
    ).first<SessionUser>())!;
    return createAgent(t.env, db, creator, {
      handle: 'secagent',
      name: 'Security Agent',
    });
  }

  async function leftovers(t: TestEnv) {
    return t.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM users WHERE username = 'secagent') AS users,
              (SELECT COUNT(*) FROM agents) AS agents,
              (SELECT COUNT(*) FROM repositories) AS repos`
    ).first();
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('首次提交失败时移除记录及 Artifacts 仓库', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    vi.spyOn(GitService.prototype, 'initialCommit').mockRejectedValueOnce(
      new Error('pack rejected')
    );
    await expect(create(t)).rejects.toThrow('pack rejected');
    expect(await leftovers(t)).toEqual({ users: 0, agents: 0, repos: 0 });
    expect(t.fake.repos.size).toBe(0);
  });

  it('即使清理失败，也呈现原始错误', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    vi.spyOn(GitService.prototype, 'initialCommit').mockRejectedValueOnce(
      new Error('pack rejected')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = drizzle(t.env.DB, { schema });
    const failingCleanup = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'delete')
          return () => {
            throw new Error('D1 is down');
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(create(t, failingCleanup)).rejects.toThrow('pack rejected');
    expect(t.fake.repos.size).toBe(0);
  });

  it('仅在用户名竞争失败时返回 409', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const db = drizzle(t.env.DB, { schema });
    // Someone takes the handle between the namespace check and the insert.
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'batch') return Reflect.get(target, prop, receiver);
        return async (stmts: Parameters<typeof db.batch>[0]) => {
          await t.env.DB.prepare(
            "INSERT INTO users (id, name, email, email_verified, username, display_username, role, created_at, updated_at) VALUES ('racer', 'Racer', 'racer@example.com', 0, 'secagent', 'secagent', 'user', 0, 0)"
          ).run();
          return target.batch(stmts);
        };
      },
    });
    expect(await create(t, racing)).toMatchObject({ ok: false, status: 409 });
  });

  it('首次插入的其他故障重新抛出，不归类为冲突', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const db = drizzle(t.env.DB, { schema });
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'batch') return Reflect.get(target, prop, receiver);
        return async () => {
          throw new Error('D1_ERROR: database is locked');
        };
      },
    });
    await expect(create(t, failing)).rejects.toThrow('database is locked');
  });
});

describe('智能体审查语言', () => {
  const set = (
    t: TestEnv,
    cookie: string,
    language: unknown,
    handle = 'secagent'
  ) =>
    call(t, `/api/admin/agents/${handle}/review-language`, {
      cookie,
      method: 'PUT',
      json: { language },
    });

  it('默认为英文，仅站点管理员可以将其改为中文', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    expect((await newAgent(t, admin)).reviewLanguage).toBe('en');
    expect((await set(t, bob, 'zh')).status).toBe(403);
    expect((await set(t, admin, 'fr')).status).toBe(400);
    expect((await set(t, admin, 'zh', 'nobody')).status).toBe(404);
    const res = await set(t, admin, 'zh');
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { agent: AgentJson }).agent.reviewLanguage
    ).toBe('zh');
    const list = (await (
      await call(t, '/api/agents', { cookie: bob })
    ).json()) as AgentJson[];
    expect(list[0].reviewLanguage).toBe('zh');
  });
});
