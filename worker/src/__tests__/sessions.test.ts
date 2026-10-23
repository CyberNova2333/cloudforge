// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { sessionId } from '../lib/sessions';
import { call, settle } from './helpers/app';
import { newAgent } from './helpers/agents';
import { collaborator, connect, crewRepo, tool } from './helpers/crew';

type Session = {
  id: string;
  client: string | null;
  label: string | null;
  author: {
    login: string;
    name: string | null;
    isAgent: boolean;
    color: string | null;
  };
  pulls: {
    number: number;
    title: string;
    state: 'open' | 'closed' | 'merged';
    pullState: { state: string; reasons: unknown[] } | null;
  }[];
  requests: { number: number; text: string }[];
  lastActivity: number;
};

const sessions = async (
  s: Awaited<ReturnType<typeof crewRepo>>,
  cookie = s.admin
) => {
  const res = await call(s.t, '/api/repos/octocat/app/sessions', { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Session[];
};

describe('sessionId 会话标识', () => {
  it('使用 s- 加 sha256(author NUL client NUL label) 的前 10 位十六进制值', async () => {
    // printf 'u1\0Claude Code\0s4' | shasum -a 256
    expect(await sessionId('u1', 'Claude Code', 's4')).toBe('s-a3e258a5a3');
    // A missing client and label are empty strings: printf 'u1\0\0' | shasum -a 256
    expect(await sessionId('u1', null, null)).toBe('s-b25f7500b4');
  });
});

describe('通过 MCP 创建的拉取请求来源', () => {
  it('存储应用名称、会话标签和用户需求', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin, 'Claude Code');
    await s.branch('feature');
    const n = await s.mcp(access_token, 'feature', {
      session: 's4',
      request: 'Make the signup button blue',
    });
    const row = await s.t.env.DB.prepare(
      'SELECT created_via, session_label, request FROM pull_requests WHERE number = ?'
    )
      .bind(n)
      .first();
    expect(row).toEqual({
      created_via: 'Claude Code',
      session_label: 's4',
      request: 'Make the signup button blue',
    });
    // The pull request API says so too.
    const got = (await (
      await call(s.t, `/api/repos/octocat/app/pulls/${n}`, { cookie: s.admin })
    ).json()) as { pull: Record<string, unknown> };
    expect(got.pull).toMatchObject({
      createdVia: 'Claude Code',
      sessionLabel: 's4',
      request: 'Make the signup button blue',
    });
  });

  it('未传入或仅传入空白 session 与 request 时保留为 null', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin, 'Cursor');
    await s.branch('one');
    await s.branch('two');
    const one = await s.mcp(access_token, 'one');
    const two = await s.mcp(access_token, 'two', {
      session: '   ',
      request: '',
    });
    for (const n of [one, two])
      expect(
        await s.t.env.DB.prepare(
          'SELECT created_via, session_label, request FROM pull_requests WHERE number = ?'
        )
          .bind(n)
          .first()
      ).toEqual({ created_via: 'Cursor', session_label: null, request: null });
  });

  it('去除会话标签两端空白，并拒绝超过 64 字符的会话或 4000 字符的需求', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin);
    await s.branch('feature');
    const long = await tool(
      s.t,
      access_token,
      'gitorange_create_pull_request',
      {
        repository: 'octocat/app',
        head: 'feature',
        title: 't',
        session: 'x'.repeat(65),
      }
    );
    expect(long.isError).toBe(true);
    expect(long.content[0].text).toBe('session must be at most 64 characters.');
    const wordy = await tool(
      s.t,
      access_token,
      'gitorange_create_pull_request',
      {
        repository: 'octocat/app',
        head: 'feature',
        title: 't',
        request: 'y'.repeat(4001),
      }
    );
    expect(wordy.isError).toBe(true);
    expect(wordy.content[0].text).toBe(
      'request must be at most 4000 characters.'
    );
    expect(
      (await s.t.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM pull_requests'
      ).first<{
        n: number;
      }>())!.n
    ).toBe(0);
    // At the limits it is fine, and the label is trimmed.
    const n = await s.mcp(access_token, 'feature', {
      session: `  ${'x'.repeat(64)}  `,
      request: 'y'.repeat(4000),
    });
    const row = await s.t.env.DB.prepare(
      'SELECT session_label, length(request) AS n FROM pull_requests WHERE number = ?'
    )
      .bind(n)
      .first();
    expect(row).toEqual({ session_label: 'x'.repeat(64), n: 4000 });
  });

  it('向编码代理说明 session 和 request 的用途', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin);
    const list = (await (
      await (await import('./helpers/mcp')).rpc(s.t, access_token, 'tools/list')
    ).json()) as {
      result: {
        tools: {
          name: string;
          description: string;
          inputSchema: { properties: Record<string, { description: string }> };
        }[];
      };
    };
    const create = list.result.tools.find(
      (x) => x.name === 'gitorange_create_pull_request'
    )!;
    expect(create.inputSchema.properties.session.description).toMatch(
      /short label/i
    );
    expect(create.inputSchema.properties.request.description).toMatch(
      /original request/i
    );
    expect(create.description).toMatch(/session/);
    expect(create.description).toMatch(/request/);
  });
});

describe('通过网页创建的拉取请求', () => {
  it('不记录客户端、会话或需求，视为手动创建', async () => {
    const s = await crewRepo();
    await s.branch('feature');
    const n = await s.web('feature');
    expect(
      await s.t.env.DB.prepare(
        'SELECT created_via, session_label, request FROM pull_requests WHERE number = ?'
      )
        .bind(n)
        .first()
    ).toEqual({ created_via: null, session_label: null, request: null });
    const [by] = await sessions(s);
    expect(by).toMatchObject({ client: null, label: null });
    expect(by.requests).toEqual([]);
  });
});

describe('读取会话列表：GET /api/repos/{o}/{r}/sessions', () => {
  it('按客户端、会话标签和作者分组拉取请求', async () => {
    const s = await crewRepo();
    const claude = (await connect(s.t, s.admin, 'Claude Code')).access_token;
    const cursor = (await connect(s.t, s.admin, 'Cursor')).access_token;
    for (const b of ['a', 'b', 'c', 'd', 'e']) await s.branch(b);
    const a = await s.mcp(claude, 'a', {
      session: 's4',
      request: 'Fix the login',
    });
    const b = await s.mcp(claude, 'b', {
      session: 's4',
      request: 'Also the logout',
    });
    const c = await s.mcp(claude, 'c', { session: 's5' });
    const d = await s.mcp(cursor, 'd', { session: 's4' });
    const e = await s.web('e');

    const list = await sessions(s);
    expect(list).toHaveLength(4);
    const find = (client: string | null, label: string | null) =>
      list.find((x) => x.client === client && x.label === label)!;

    const s4 = find('Claude Code', 's4');
    expect(s4.pulls.map((p) => p.number).sort()).toEqual([a, b]);
    expect(s4.requests).toEqual([
      { number: a, text: 'Fix the login' },
      { number: b, text: 'Also the logout' },
    ]);
    expect(find('Claude Code', 's5').pulls.map((p) => p.number)).toEqual([c]);
    // Same label, another app: another session.
    expect(find('Cursor', 's4').pulls.map((p) => p.number)).toEqual([d]);
    expect(find(null, null).pulls.map((p) => p.number)).toEqual([e]);
    expect(new Set(list.map((x) => x.id)).size).toBe(4);
  });

  it('将代理作者标记为代理并附带其颜色', async () => {
    const s = await crewRepo();
    const agent = await newAgent(s.t, s.admin, 'secagent', 'Security Agent');
    s.repo.refs.set('refs/heads/x', s.main);
    await s.mergedRow(1, 'x', Date.now() - 1000, { authorId: agent.id });
    const [only] = await sessions(s);
    expect(only.author).toEqual({
      login: 'secagent',
      name: 'Security Agent',
      isAgent: true,
      color: agent.color,
    });
  });

  it('相同应用和标签下，不同作者的会话相互独立', async () => {
    const s = await crewRepo();
    const ada = await collaborator(s, 'ada');
    const mine = (await connect(s.t, s.admin, 'Claude Code')).access_token;
    const hers = (await connect(s.t, ada, 'Claude Code')).access_token;
    await s.branch('one');
    await s.branch('two');
    const one = await s.mcp(mine, 'one', { session: 's1' });
    const two = await s.mcp(hers, 'two', { session: 's1' });
    const list = await sessions(s);
    expect(list).toHaveLength(2);
    const byLogin = Object.fromEntries(list.map((x) => [x.author.login, x]));
    expect(byLogin.octocat.pulls.map((p) => p.number)).toEqual([one]);
    expect(byLogin.ada.pulls.map((p) => p.number)).toEqual([two]);
    expect(byLogin.ada.author).toEqual({
      login: 'ada',
      name: 'ada',
      isAgent: false,
      color: null,
    });
  });

  it('按公式生成稳定的会话标识，并优先列出最近活动', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin, 'Claude Code');
    await s.branch('old');
    await s.branch('new');
    await s.mcp(access_token, 'old', { session: 'first' });
    await s.mcp(access_token, 'new', { session: 'second' });
    // The first session had the later activity.
    await s.t.env.DB.prepare(
      "UPDATE pull_requests SET updated_at = 2000000000 WHERE head_ref = 'old'"
    ).run();
    await s.t.env.DB.prepare(
      "UPDATE pull_requests SET updated_at = 1900000000 WHERE head_ref = 'new'"
    ).run();
    const author = (await s.t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!.id;

    const list = await sessions(s);
    expect(list.map((x) => x.label)).toEqual(['first', 'second']);
    expect(list[0].lastActivity).toBe(2_000_000_000_000);
    expect(list[1].lastActivity).toBe(1_900_000_000_000);
    expect(list[0].id).toBe(await sessionId(author, 'Claude Code', 'first'));
    // Stable across calls, and the same id the detail route answers to.
    expect((await sessions(s)).map((x) => x.id)).toEqual(list.map((x) => x.id));
  });

  it('展示各拉取请求状态，并说明打开的请求应由谁处理', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin, 'Claude Code');
    await s.branch('shipped');
    const shipped = await s.mcp(access_token, 'shipped', { session: 's1' });
    await s.merge(shipped);
    await s.branch('open-one');
    const open = await s.mcp(access_token, 'open-one', { session: 's1' });
    const [only] = await sessions(s);
    const byNumber = Object.fromEntries(only.pulls.map((p) => [p.number, p]));
    expect(byNumber[open]).toMatchObject({
      title: 'open-one',
      state: 'open',
      // No agent reviewed it and nobody approved: a person's move.
      pullState: { state: 'human_review' },
    });
    expect(byNumber[open].pullState!.reasons.length).toBeGreaterThan(0);
    expect(byNumber[shipped]).toMatchObject({
      state: 'merged',
      pullState: null,
    });
  });

  it('没有拉取请求的仓库返回空列表，并遵循仓库读取权限', async () => {
    const s = await crewRepo();
    expect(await sessions(s)).toEqual([]);
    // A private repository is invisible to a member who isn't on it.
    await call(s.t, '/api/repos', {
      cookie: s.admin,
      json: { name: 'secret', visibility: 'private' },
    });
    const { addMember } = await import('./helpers/app');
    const bob = await addMember(s.t, s.admin, 'bob');
    expect(
      (await call(s.t, '/api/repos/octocat/secret/sessions', { cookie: bob }))
        .status
    ).toBe(404);
    expect(
      (
        await call(s.t, '/api/repos/octocat/secret/sessions/s-0123456789', {
          cookie: bob,
        })
      ).status
    ).toBe(404);
    // Signed out, a repository that is not public does not exist (only public ones are readable).
    expect((await call(s.t, '/api/repos/octocat/app/sessions')).status).toBe(
      404
    );
    expect(
      (await call(s.t, '/api/repos/octocat/app/sessions', { cookie: bob }))
        .status
    ).toBe(200);
    await settle(s.t);
  });
});

describe('读取单个会话：GET /api/repos/{o}/{r}/sessions/{id}', () => {
  it('返回会话及其拉取请求和用户需求，未知标识返回 404', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin, 'Claude Code');
    for (const b of ['a', 'b']) await s.branch(b);
    const a = await s.mcp(access_token, 'a', {
      session: 's9',
      request: 'Do a',
    });
    await s.mcp(access_token, 'b', { session: 'other' });
    const target = (await sessions(s)).find((x) => x.label === 's9')!;
    const res = await call(
      s.t,
      `/api/repos/octocat/app/sessions/${target.id}`,
      {
        cookie: s.admin,
      }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(target);
    expect(target.pulls.map((p) => p.number)).toEqual([a]);
    expect(target.requests).toEqual([{ number: a, text: 'Do a' }]);

    expect(
      (
        await call(s.t, '/api/repos/octocat/app/sessions/s-0000000000', {
          cookie: s.admin,
        })
      ).status
    ).toBe(404);
  });
});

describe('拉取请求记录中的会话标识', () => {
  /** The session id GET /sessions gives each pull request number, the one id every other row must agree with. */
  async function idsByNumber(s: Awaited<ReturnType<typeof crewRepo>>) {
    const out = new Map<number, string>();
    for (const x of await sessions(s))
      for (const p of x.pulls) out.set(p.number, x.id);
    return out;
  }
  const getJson = async <T>(
    s: Awaited<ReturnType<typeof crewRepo>>,
    path: string
  ) => {
    const res = await call(s.t, `/api/repos/octocat/app${path}`, {
      cookie: s.admin,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };

  async function fixture() {
    const s = await crewRepo();
    const ada = await collaborator(s, 'ada');
    const claude = (await connect(s.t, s.admin, 'Claude Code')).access_token;
    const cursor = (await connect(s.t, ada, 'Cursor')).access_token;
    for (const b of ['a', 'b', 'c', 'd']) await s.branch(b);
    const a = await s.mcp(claude, 'a', { session: 's4' });
    const b = await s.mcp(cursor, 'b', { session: 's4' });
    const c = await s.web('c');
    const d = await s.web('d', { cookie: ada });
    return { s, ada, a, b, c, d };
  }

  it('队列项的会话标识与 GET /sessions 一致，包括手动创建的请求', async () => {
    const { s, a, b, c, d } = await fixture();
    const ids = await idsByNumber(s);
    // Four people/apps, four sessions: by hand is a per-person session of its own.
    expect(new Set(ids.values()).size).toBe(4);
    const [main] = await getJson<
      { entries: { number: number; sessionId: string }[] }[]
    >(s, '/queue');
    expect(main.entries.map((e) => e.number).sort()).toEqual(
      [a, b, c, d].sort()
    );
    for (const e of main.entries) {
      expect(e.sessionId).toMatch(/^s-[0-9a-f]{10}$/);
      expect(e.sessionId).toBe(ids.get(e.number));
    }
  });

  it('分支关联请求和分支图中的会话标识一致', async () => {
    const { s, a, b, c, d } = await fixture();
    const ids = await idsByNumber(s);
    const list = await getJson<
      { name: string; pull: { number: number; sessionId: string } | null }[]
    >(s, '/branches');
    const withPull = list.filter((x) => x.pull);
    expect(withPull.map((x) => x.pull!.number).sort()).toEqual(
      [a, b, c, d].sort()
    );
    for (const x of withPull)
      expect(x.pull!.sessionId).toBe(ids.get(x.pull!.number));
    // main has no pull request to carry one.
    expect(list.find((x) => x.name === 'main')!.pull).toBeNull();

    const map = await getJson<{
      open: { number: number; sessionId: string }[];
    }>(s, '/branches/map');
    expect(map.open).toHaveLength(4);
    for (const o of map.open) expect(o.sessionId).toBe(ids.get(o.number));
  });

  it('拉取请求列表和详情中的会话标识一致', async () => {
    const { s, a, b, c, d } = await fixture();
    const ids = await idsByNumber(s);
    const { pulls } = await getJson<{
      pulls: { number: number; sessionId: string }[];
    }>(s, '/pulls?state=open');
    expect(pulls.map((p) => p.number).sort()).toEqual([a, b, c, d].sort());
    for (const p of pulls) expect(p.sessionId).toBe(ids.get(p.number));
    for (const n of [a, c]) {
      const { pull } = await getJson<{ pull: { sessionId: string } }>(
        s,
        `/pulls/${n}`
      );
      expect(pull.sessionId).toBe(ids.get(n));
    }
  });

  it('手动创建的请求按空客户端和空标签代入公式', async () => {
    const { s, c } = await fixture();
    const author = (await s.t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!.id;
    const [main] = await getJson<
      { entries: { number: number; sessionId: string }[] }[]
    >(s, '/queue');
    expect(main.entries.find((e) => e.number === c)!.sessionId).toBe(
      await sessionId(author, null, null)
    );
  });
});
