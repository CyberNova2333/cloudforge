// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { api, qk } from './uiApi';

/** What the page asked the server for. */
type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let reply: { status: number; json: unknown };

beforeEach(() => {
  calls = [];
  reply = { status: 200, json: {} };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

const sent = async (call: () => Promise<unknown>) => {
  await call();
  expect(calls).toHaveLength(1);
  return calls[0];
};

describe('团队界面读取接口', () => {
  const reads: [string, () => Promise<unknown>, string][] = [
    ['repoStats 仓库统计', () => api.repoStats(), '/api/repos?stats=1'],
    [
      'agentPresets 智能体预设',
      () => api.agentPresets(),
      '/api/agents/presets',
    ],
    [
      'agentsBuiltin 内置智能体',
      () => api.agentsBuiltin(),
      '/api/agents/builtin',
    ],
    [
      'agentStats 智能体统计',
      () => api.agentStats('data-agent'),
      '/api/agents/data-agent/stats',
    ],
    ['delegations 委托列表', () => api.delegations(), '/api/me/delegations'],
    [
      'approvalFlag 待审批意见',
      () => api.approvalFlag('f 1'),
      '/api/approvals/flags/f%201',
    ],
    [
      'sessions 会话列表',
      () => api.sessions('o', 'r'),
      '/api/repos/o/r/sessions',
    ],
    [
      'session 会话详情',
      () => api.session('o', 'r', 's-a3e258a5a3'),
      '/api/repos/o/r/sessions/s-a3e258a5a3',
    ],
    [
      'branches 分支列表',
      () => api.branches('o', 'r'),
      '/api/repos/o/r/branches',
    ],
    [
      'branchMap 使用服务器默认时间窗口',
      () => api.branchMap('o', 'r'),
      '/api/repos/o/r/branches/map',
    ],
    [
      'branchMap 使用 30 天时间窗口',
      () => api.branchMap('o', 'r', 30),
      '/api/repos/o/r/branches/map?days=30',
    ],
    ['queue 合并队列', () => api.queue('o', 'r'), '/api/repos/o/r/queue'],
    ['live 实时动态', () => api.live('o', 'r'), '/api/repos/o/r/live'],
    ['health 仓库健康度', () => api.health('o', 'r'), '/api/repos/o/r/health'],
    [
      'repoAudit 仓库审计首页',
      () => api.repoAudit('o', 'r'),
      '/api/repos/o/r/audit',
    ],
    [
      'repoAudit 仓库审计下一页并减少条数',
      () => api.repoAudit('o', 'r', 'abc', 5),
      '/api/repos/o/r/audit?cursor=abc&limit=5',
    ],
    ['adminAudit 管理审计首页', () => api.adminAudit(), '/api/admin/audit'],
    [
      'adminAudit 管理审计下一页',
      () => api.adminAudit('c1'),
      '/api/admin/audit?cursor=c1',
    ],
    ['search 搜索', () => api.search('auth'), '/api/search?q=auth'],
    [
      'search 在指定仓库内搜索',
      () => api.search('a b', 'o/r'),
      '/api/search?q=a+b&repo=o%2Fr',
    ],
    [
      'search 不指定仓库的搜索',
      () => api.search('#12', null),
      '/api/search?q=%2312',
    ],
  ];

  it.each(reads)('%s 使用 GET 请求正确的 URL', async (_n, call, url) => {
    expect(await sent(call)).toEqual({
      url,
      method: 'GET',
      body: undefined,
    });
  });

  it('编码所有者或仓库名称', async () => {
    expect((await sent(() => api.queue('a b', 'c/d'))).url).toBe(
      '/api/repos/a%20b/c%2Fd/queue'
    );
  });

  it('向搜索传递取消信号，以取消被替代的请求', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response('{}', {
        headers: { 'content-type': 'application/json' },
      });
    });
    const controller = new AbortController();
    await api.search('x', null, controller.signal);
    expect(seen[0]).toBe(controller.signal);
  });
});

describe('团队界面写入接口', () => {
  it('创建推荐团队，并从预设创建代理', async () => {
    expect(await sent(() => api.createAgentCrew())).toEqual({
      url: '/api/admin/agents/crew',
      method: 'POST',
      body: undefined,
    });
    calls = [];
    expect(await sent(() => api.createAgent({ preset: 'security' }))).toEqual({
      url: '/api/admin/agents',
      method: 'POST',
      body: { preset: 'security' },
    });
  });

  it('使用给定账号名替换委托代理集合', async () => {
    expect(await sent(() => api.setDelegations(['speed', 'data']))).toEqual({
      url: '/api/me/delegations',
      method: 'PUT',
      body: { agents: ['speed', 'data'] },
    });
  });

  it('批准问题时不传正文，或传入去除首尾空白的理由和教学内容', async () => {
    const url = '/api/repos/o/r/pulls/3/review/flags/f1/approve';
    expect(await sent(() => api.approveFlag('o', 'r', 3, 'f1'))).toEqual({
      url,
      method: 'POST',
      body: undefined,
    });
    calls = [];
    expect(
      (
        await sent(() =>
          api.approveFlag('o', 'r', 3, 'f1', {
            reason: '  Legal signed off  ',
            teach: 'Refunds over $500 need approval',
          })
        )
      ).body
    ).toEqual({
      reason: 'Legal signed off',
      teach: 'Refunds over $500 need approval',
    });
    calls = [];
    // Empty text is not sent: the server would count it as a reason that isn't there.
    expect(
      (
        await sent(() =>
          api.approveFlag('o', 'r', 3, 'f1', { reason: '  ', teach: null })
        )
      ).body
    ).toBeUndefined();
  });

  it('携带备注要求修改，仅在请求时附带教学内容', async () => {
    const url = '/api/repos/o/r/pulls/3/review/flags/f1/request-changes';
    expect(
      await sent(() => api.requestFlagChanges('o', 'r', 3, 'f1', ' Rotate it '))
    ).toEqual({ url, method: 'POST', body: { note: 'Rotate it' } });
    calls = [];
    expect(
      (
        await sent(() =>
          api.requestFlagChanges('o', 'r', 3, 'f1', '', 'Always')
        )
      ).body
    ).toEqual({ note: null, teach: 'Always' });
  });

  it('将问题分配给账号，或用 null 清除分配', async () => {
    const url = '/api/repos/o/r/pulls/3/review/flags/f1/assign';
    expect(
      await sent(() => api.assignFlag('o', 'r', 3, 'f1', 'amira'))
    ).toEqual({ url, method: 'POST', body: { login: 'amira' } });
    calls = [];
    expect(
      (await sent(() => api.assignFlag('o', 'r', 3, 'f1', null))).body
    ).toEqual({ login: null });
  });

  it('撤销决定和交由 CloudForge AI 决定时不传正文', async () => {
    expect(await sent(() => api.undoFlag('o', 'r', 3, 'f1'))).toEqual({
      url: '/api/repos/o/r/pulls/3/review/flags/f1/undo',
      method: 'POST',
      body: undefined,
    });
    calls = [];
    expect(await sent(() => api.delegateFlag('o', 'r', 3, 'f1'))).toEqual({
      url: '/api/repos/o/r/pulls/3/review/flags/f1/delegate',
      method: 'POST',
      body: undefined,
    });
  });

  it('清理分支、暂停和恢复合并，以及回退拉取请求', async () => {
    expect(await sent(() => api.cleanBranches('o', 'r'))).toEqual({
      url: '/api/repos/o/r/branches/clean',
      method: 'POST',
      body: undefined,
    });
    calls = [];
    expect(
      await sent(() => api.pauseMerging('o', 'r', ' Error spike '))
    ).toEqual({
      url: '/api/repos/o/r/merging/pause',
      method: 'POST',
      body: { reason: 'Error spike' },
    });
    calls = [];
    // The reason is optional: none is sent, not an empty one.
    expect((await sent(() => api.pauseMerging('o', 'r'))).body).toBeUndefined();
    calls = [];
    expect(await sent(() => api.resumeMerging('o', 'r'))).toEqual({
      url: '/api/repos/o/r/merging/pause',
      method: 'DELETE',
      body: undefined,
    });
    calls = [];
    expect(await sent(() => api.revertPull('o', 'r', 7))).toEqual({
      url: '/api/repos/o/r/pulls/7/revert',
      method: 'POST',
      body: undefined,
    });
  });

  it('修改合入后是否删除拉取请求分支', async () => {
    expect(
      await sent(() => api.updateRepo('o', 'r', { deleteMergedBranches: true }))
    ).toEqual({
      url: '/api/repos/o/r',
      method: 'PATCH',
      body: { deleteMergedBranches: true },
    });
  });

  it('从 409 响应读取拒绝回退的原因', async () => {
    reply = {
      status: 409,
      json: { message: 'It was never merged.', error: 'It was never merged.' },
    };
    const failure = await api.revertPull('o', 'r', 7).catch((e) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(failure.message).toBe('It was never merged.');
    expect(failure.body.message).toBe('It was never merged.');
  });
});

describe('拉取请求列表', () => {
  it('与原行为一致，不限制数量时请求完整列表', async () => {
    expect((await sent(() => api.pulls('o', 'r', 'open'))).url).toBe(
      '/api/repos/o/r/pulls?state=open'
    );
  });

  it('按限制数量请求一页', async () => {
    expect(
      (await sent(() => api.pulls('o', 'r', 'merged', { limit: 5 }))).url
    ).toBe('/api/repos/o/r/pulls?state=merged&limit=5');
    calls = [];
    expect(
      (await sent(() => api.pulls('o', 'r', 'closed', { limit: 25, page: 3 })))
        .url
    ).toBe('/api/repos/o/r/pulls?state=closed&limit=25&page=3');
  });

  it('发送去除首尾空白的搜索词，空白时不发送', async () => {
    expect(
      (
        await sent(() =>
          api.pulls('o', 'r', 'closed', { limit: 25, q: '  claude s4 ' })
        )
      ).url
    ).toBe('/api/repos/o/r/pulls?state=closed&limit=25&q=claude+s4');
    calls = [];
    expect(
      (await sent(() => api.pulls('o', 'r', 'closed', { limit: 25, q: '  ' })))
        .url
    ).toBe('/api/repos/o/r/pulls?state=closed&limit=25');
  });

  it('省略第一页参数，以及未设置数量限制时的页码', async () => {
    expect(
      (await sent(() => api.pulls('o', 'r', 'closed', { limit: 25, page: 1 })))
        .url
    ).toBe('/api/repos/o/r/pulls?state=closed&limit=25');
    calls = [];
    expect(
      (await sent(() => api.pulls('o', 'r', 'closed', { page: 4 }))).url
    ).toBe('/api/repos/o/r/pulls?state=closed');
  });

  it('所有分页键归入拉取请求列表，且相互区分', () => {
    for (const key of [
      qk.pulls('o', 'r', 'open'),
      qk.pulls('o', 'r', 'merged', 5),
      qk.pulls('o', 'r', 'closed', 25, 2),
    ])
      expect(key.slice(0, 4)).toEqual(['repo', 'o', 'r', 'pulls']);
    expect(qk.pulls('o', 'r', 'closed', 25, 1)).not.toEqual(
      qk.pulls('o', 'r', 'closed', 25, 2)
    );
    expect(qk.pulls('o', 'r', 'closed')).not.toEqual(
      qk.pulls('o', 'r', 'closed', 25)
    );
    expect(qk.pulls('o', 'r', 'closed', 25)).not.toEqual(
      qk.pulls('o', 'r', 'merged', 25)
    );
    expect(qk.pulls('o', 'r', 'closed', 25, 1, 'a')).not.toEqual(
      qk.pulls('o', 'r', 'closed', 25, 1, 'b')
    );
  });
});

describe('查询键', () => {
  it('所有仓库范围的键以仓库开头，使实时通知能刷新它们', () => {
    const keys = [
      qk.branches('o', 'r'),
      qk.branchMap('o', 'r'),
      qk.branchMap('o', 'r', 30),
      qk.sessions('o', 'r'),
      qk.session('o', 'r', 's-1'),
      qk.queue('o', 'r'),
      qk.live('o', 'r'),
      qk.health('o', 'r'),
      qk.repoAudit('o', 'r'),
      qk.repoAudit('o', 'r', 'c1'),
    ];
    for (const key of keys) expect(key.slice(0, 3)).toEqual(['repo', 'o', 'r']);
  });

  it('问题和委托键归入审批，使实时通知和决定能刷新它们', () => {
    expect(qk.approvalFlag('f1').slice(0, 1)).toEqual(qk.approvals);
    expect(qk.delegations.slice(0, 1)).toEqual(qk.approvals);
  });

  it('看板归入 repos，代理查询归入 agents', () => {
    expect(qk.repoStats.slice(0, 1)).toEqual(qk.repos);
    for (const key of [
      qk.agentPresets,
      qk.agentsBuiltin,
      qk.agentStats('security'),
    ])
      expect(key.slice(0, 1)).toEqual(qk.agents);
  });

  it('区分不同搜索、范围和页码', () => {
    expect(qk.search('a', null)).not.toEqual(qk.search('a', 'o/r'));
    expect(qk.search('a', null)).not.toEqual(qk.search('b', null));
    expect(qk.adminAudit()).not.toEqual(qk.adminAudit('c1'));
    expect(qk.repoAudit('o', 'r')).not.toEqual(qk.repoAudit('o', 'r', 'c1'));
    expect(qk.branchMap('o', 'r')).not.toEqual(qk.branchMap('o', 'r', 10));
  });
});

describe('发行版本和标签', () => {
  it.each<[string, () => Promise<unknown>, string]>([
    [
      'releases 发行版本列表',
      () => api.releases('o', 'r'),
      '/api/repos/o/r/releases',
    ],
    [
      'unreleased 尚未发布的变更',
      () => api.unreleased('o', 'r'),
      '/api/repos/o/r/releases/unreleased',
    ],
    [
      'release 发行版本详情',
      () => api.release('o', 'r', 'v1.2.0'),
      '/api/repos/o/r/releases/v1.2.0',
    ],
    [
      'release 对特殊标签名称进行转义',
      () => api.release('o', 'r', 'a/b'),
      '/api/repos/o/r/releases/a%2Fb',
    ],
    ['tags 标签列表', () => api.tags('o', 'r'), '/api/repos/o/r/tags'],
  ])('%s 使用 GET 请求正确的 URL', async (_n, call, url) => {
    expect(await sent(call)).toEqual({ url, method: 'GET', body: undefined });
  });

  it('使用已知头提交、去除首尾空白的版本号和说明创建发行版本', async () => {
    expect(
      await sent(() =>
        api.cutRelease('o', 'r', {
          headSha: 'abc123',
          version: ' v0.1.0 ',
          notes: 'First release.',
        })
      )
    ).toEqual({
      url: '/api/repos/o/r/releases',
      method: 'POST',
      body: { headSha: 'abc123', version: 'v0.1.0', notes: 'First release.' },
    });
  });

  it('省略空白版本号、标题或说明，交由服务端计算', async () => {
    expect(
      (
        await sent(() =>
          api.cutRelease('o', 'r', {
            headSha: 'abc123',
            version: '  ',
            title: '',
            notes: ' ',
          })
        )
      ).body
    ).toEqual({ headSha: 'abc123' });
  });

  it('默认分支移动时从 409 响应读取新头提交', async () => {
    reply = {
      status: 409,
      json: { error: 'The default branch moved', head: 'def456' },
    };
    const failure = await api
      .cutRelease('o', 'r', { headSha: 'abc123' })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(failure.message).toBe('The default branch moved');
    expect(failure.body.head).toBe('def456');
  });

  it('按标签编辑发行标题和说明', async () => {
    expect(
      await sent(() =>
        api.updateRelease('o', 'r', 'v1.2.0', {
          title: 'Spring',
          notes: '- a',
        })
      )
    ).toEqual({
      url: '/api/repos/o/r/releases/v1.2.0',
      method: 'PATCH',
      body: { title: 'Spring', notes: '- a' },
    });
  });

  it('创建拉取请求时可携带版本递增级别或不设置', async () => {
    const body = { title: 't', body: '', base: 'main', head: 'feat' };
    expect(
      await sent(() =>
        api.createPull('o', 'r', { ...body, versionBump: 'minor' })
      )
    ).toEqual({
      url: '/api/repos/o/r/pulls',
      method: 'POST',
      body: { ...body, versionBump: 'minor' },
    });
    calls = [];
    expect((await sent(() => api.createPull('o', 'r', body))).body).toEqual(
      body
    );
  });

  it('修改或清除拉取请求的版本递增级别', async () => {
    expect(
      await sent(() => api.updatePull('o', 'r', 4, { versionBump: 'major' }))
    ).toEqual({
      url: '/api/repos/o/r/pulls/4',
      method: 'PATCH',
      body: { versionBump: 'major' },
    });
    calls = [];
    expect(
      (await sent(() => api.updatePull('o', 'r', 4, { versionBump: null })))
        .body
    ).toEqual({ versionBump: null });
  });

  it('所有键归入仓库，使实时通知能刷新它们', () => {
    for (const key of [
      qk.releases('o', 'r'),
      qk.unreleased('o', 'r'),
      qk.release('o', 'r', 'v1.0.0'),
      qk.tags('o', 'r'),
    ])
      expect(key.slice(0, 3)).toEqual(['repo', 'o', 'r']);
    expect(qk.release('o', 'r', 'v1.0.0')).not.toEqual(
      qk.release('o', 'r', 'v1.0.1')
    );
  });
});
