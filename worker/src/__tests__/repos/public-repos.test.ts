import { describe, expect, it } from 'vitest';
import { isPublicRepoRead } from '../../auth/guards';
import { handleGitRequest } from '../../git/http/handler';
import { handleLfsRequest } from '../../lfs/http/handler';
import { sha256Hex } from '../../git/bytes';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';
import { commitPaths } from '../helpers/seed';

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

type Repo = {
  fullName: string;
  visibility: string;
  permissions?: { read: boolean; write: boolean; admin: boolean };
};

async function pat(t: TestEnv, cookie: string) {
  const res = await call(t, '/api/tokens', {
    cookie,
    json: { name: 'cli', expiresInDays: 30 },
  });
  return ((await res.json()) as { plaintext: string }).plaintext;
}

function git(t: TestEnv, path: string, opts: { token?: string } = {}) {
  const headers = new Headers();
  if (opts.token)
    headers.set('Authorization', `Basic ${btoa(`user:${opts.token}`)}`);
  return handleGitRequest(
    new Request(`http://test.local${path}`, { headers }),
    t.env,
    ctx
  );
}

function lfs(t: TestEnv, path: string, json: unknown, token?: string) {
  const headers = new Headers({
    Accept: 'application/vnd.git-lfs+json',
    'Content-Type': 'application/vnd.git-lfs+json',
  });
  if (token) headers.set('Authorization', `Basic ${btoa(`user:${token}`)}`);
  return handleLfsRequest(
    new Request(`http://test.local${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(json),
    }),
    t.env,
    ctx
  );
}

/** octocat/open (public) and octocat/inside (internal), both with a README. */
async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  for (const [name, visibility] of [
    ['open', 'public'],
    ['inside', 'internal'],
  ])
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name, visibility, addReadme: true },
    });
  return { t, admin };
}

describe('未登录时访问公开仓库', () => {
  it('仅列出公开仓库', async () => {
    const { t } = await setup();
    const res = await call(t, '/api/repos');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Repo[];
    expect(list.map((r) => r.fullName)).toEqual(['octocat/open']);
  });

  it('以只读方式访问公开仓库及其页面', async () => {
    const { t } = await setup();
    const repo = await call(t, '/api/repos/octocat/open');
    expect(repo.status).toBe(200);
    expect(((await repo.json()) as Repo).permissions).toEqual({
      read: true,
      write: false,
      admin: false,
    });
    for (const page of [
      'contents',
      'commits?ref=main',
      'pulls',
      'actions/runs',
      'branches',
      'releases',
      'tags',
      'agents',
    ]) {
      const res = await call(t, `/api/repos/octocat/open/${page}`);
      expect([page, res.status]).toEqual([page, 200]);
    }
  });

  it('无法查看内部或私有仓库', async () => {
    const { t, admin } = await setup();
    await call(t, '/api/repos', { cookie: admin, json: { name: 'diary' } });
    expect((await call(t, '/api/repos/octocat/inside')).status).toBe(404);
    expect((await call(t, '/api/repos/octocat/diary')).status).toBe(404);
    expect((await call(t, '/api/repos/octocat/inside/contents')).status).toBe(
      404
    );
  });

  it('Live 与会话页面不向未登录访客展示审计日志和原始需求', async () => {
    const { t, admin } = await setup();
    // An audit event and a pull request that carries what its author asked their agent for.
    await call(t, '/api/repos/octocat/open', {
      cookie: admin,
      method: 'PATCH',
      json: { description: 'Now with a description' },
    });
    const repo = [...t.fake.repos.values()][0];
    const main = repo.refs.get('refs/heads/main')!;
    repo.refs.set('refs/heads/feature', main);
    await commitPaths(repo, 'feature', { 'b.txt': 'b\n' }, 'B');
    await call(t, '/api/repos/octocat/open/pulls', {
      cookie: admin,
      json: { title: 'B', body: '', base: 'main', head: 'feature' },
    });
    await t.env.DB.prepare(
      "UPDATE pull_requests SET request = 'my private plan'"
    ).run();
    type Live = {
      events: unknown[];
      floor: { requests: unknown[] }[];
    };
    const live = async (cookie?: string) =>
      (await (
        await call(t, '/api/repos/octocat/open/live', { cookie })
      ).json()) as Live;
    const visitor = await live();
    expect(visitor.events).toEqual([]);
    expect(visitor.floor.flatMap((s) => s.requests)).toEqual([]);
    const member = await live(admin);
    expect(member.events.length).toBeGreaterThan(0);
    expect(member.floor.flatMap((s) => s.requests)).toHaveLength(1);
    const sessions = async (cookie?: string) =>
      (await (
        await call(t, '/api/repos/octocat/open/sessions', { cookie })
      ).json()) as { requests: unknown[] }[];
    expect((await sessions()).flatMap((s) => s.requests)).toEqual([]);
    expect((await sessions(admin)).flatMap((s) => s.requests)).toHaveLength(1);
  });

  it('比较分支时不为访客试运行变基，成员仍能看到冲突', async () => {
    const { t, admin } = await setup();
    const repo = [...t.fake.repos.values()][0];
    const main = repo.refs.get('refs/heads/main')!;
    repo.refs.set('refs/heads/feature', main);
    await commitPaths(repo, 'main', { 'README.md': 'main\n' }, 'main side');
    await commitPaths(repo, 'feature', { 'README.md': 'feature\n' }, 'other');
    const compare = (cookie?: string) =>
      call(t, '/api/repos/octocat/open/compare?base=main&head=feature', {
        cookie,
      }).then(
        async (r) =>
          (await r.json()) as {
            status: string;
            mergeable: boolean;
            conflicts: string[];
            files: unknown[];
          }
      );
    const visitor = await compare();
    expect(visitor).toMatchObject({
      status: 'diverged',
      mergeable: false,
      conflicts: [],
    });
    expect(visitor.files).toHaveLength(1);
    expect((await compare(admin)).conflicts).toEqual(['README.md']);
  });

  it('API 参考文档只对登录成员开放', async () => {
    const { t, admin } = await setup();
    for (const path of [
      '/api/doc',
      '/api/swagger-ui',
      '/api/auth/reference',
      '/api/auth/open-api/generate-schema',
    ]) {
      expect((await call(t, path)).status, path).toBe(401);
      expect((await call(t, path, { cookie: admin })).status, path).toBe(200);
    }
  });

  it('写操作和成员专属页面仍要求登录', async () => {
    const { t } = await setup();
    expect(
      (
        await call(t, '/api/repos/octocat/open', {
          method: 'PATCH',
          json: { description: 'defaced' },
        })
      ).status
    ).toBe(401);
    expect(
      (await call(t, '/api/repos', { json: { name: 'mine' } })).status
    ).toBe(401);
    expect((await call(t, '/api/repos/octocat/open/audit')).status).toBe(401);
    expect(
      (await call(t, '/api/repos/octocat/open/collaborators')).status
    ).toBe(401);
    expect((await call(t, '/api/users')).status).toBe(401);
  });

  it('无需令牌即可克隆公开仓库，但不能推送', async () => {
    const { t } = await setup();
    const clone = await git(
      t,
      '/octocat/open.git/info/refs?service=git-upload-pack'
    );
    expect(clone.status).toBe(200);
    expect(await clone.text()).toContain('refs/heads/main');

    const push = await git(
      t,
      '/octocat/open.git/info/refs?service=git-receive-pack'
    );
    expect(push.status).toBe(401);
    expect(push.headers.get('WWW-Authenticate')).toContain('Basic');

    // Anything not public still asks for credentials, so git prompts for a token.
    const inside = await git(
      t,
      '/octocat/inside.git/info/refs?service=git-upload-pack'
    );
    expect(inside.status).toBe(401);
  });

  it('无需令牌即可下载公开仓库的 LFS 对象，但不能上传', async () => {
    const { t } = await setup();
    const content = 'public asset';
    const oid = await sha256Hex(content);
    const size = new TextEncoder().encode(content).length;
    // In R2 under every repository (`lfs/<repository id>/<oid>`); D1 learns of it on the first batch.
    for (const r of t.fake.repos.values())
      await t.env.LFS.put(`lfs/${r.name.slice(2)}/${oid}`, content, {
        sha256: oid,
      });

    const down = await lfs(t, '/octocat/open.git/info/lfs/objects/batch', {
      operation: 'download',
      objects: [{ oid, size }],
    });
    expect(down.status).toBe(200);
    const body = (await down.json()) as {
      objects: { actions?: { download?: unknown } }[];
    };
    expect(body.objects[0].actions?.download).toBeDefined();

    const up = await lfs(t, '/octocat/open.git/info/lfs/objects/batch', {
      operation: 'upload',
      objects: [{ oid, size }],
    });
    expect(up.status).toBe(401);
    expect(up.headers.get('WWW-Authenticate')).toContain('Basic');

    const verify = await lfs(t, '/octocat/open.git/info/lfs/objects/verify', {
      oid,
      size,
    });
    expect(verify.status).toBe(401);

    const inside = await lfs(t, '/octocat/inside.git/info/lfs/objects/batch', {
      operation: 'download',
      objects: [{ oid, size }],
    });
    expect(inside.status).toBe(401);
  });
});

describe('已登录时访问公开仓库', () => {
  it('所有成员均可读取，只有协作者可以写入', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    const list = (await (
      await call(t, '/api/repos', { cookie: bob })
    ).json()) as Repo[];
    expect(list.map((r) => r.fullName).sort()).toEqual([
      'octocat/inside',
      'octocat/open',
    ]);
    const repo = (await (
      await call(t, '/api/repos/octocat/open', { cookie: bob })
    ).json()) as Repo;
    expect(repo.permissions).toEqual({
      read: true,
      write: false,
      admin: false,
    });
    const push = await git(
      t,
      '/octocat/open.git/info/refs?service=git-receive-pack',
      { token: await pat(t, bob) }
    );
    expect(push.status).toBe(403);
  });

  it('允许所有者将仓库公开后再改回私有', async () => {
    const { t, admin } = await setup();
    const open = await call(t, '/api/repos/octocat/inside', {
      cookie: admin,
      method: 'PATCH',
      json: { visibility: 'public' },
    });
    expect(((await open.json()) as Repo).visibility).toBe('public');
    expect((await call(t, '/api/repos/octocat/inside')).status).toBe(200);

    await call(t, '/api/repos/octocat/inside', {
      cookie: admin,
      method: 'PATCH',
      json: { visibility: 'private' },
    });
    expect((await call(t, '/api/repos/octocat/inside')).status).toBe(404);

    const audit = (await (
      await call(t, '/api/repos/octocat/inside/audit', { cookie: admin })
    ).json()) as { events: { action: string; data: unknown }[] };
    const changes = audit.events
      .filter((e) => e.action === 'visibility.changed')
      .map((e) => e.data);
    // Both may land in the same second, so their order is not asserted.
    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        { from: 'internal', to: 'public' },
        { from: 'public', to: 'private' },
      ])
    );
  });

  it('允许团队仓库公开，但不允许设为私有', async () => {
    const { t, admin } = await setup();
    await call(t, '/api/team', {
      cookie: admin,
      method: 'PUT',
      json: { name: 'XY Space', slug: 'xyspace' },
    });
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'site', owner: 'team', addReadme: true },
    });
    const open = await call(t, '/api/repos/xyspace/site', {
      cookie: admin,
      method: 'PATCH',
      json: { visibility: 'public' },
    });
    expect(open.status).toBe(200);
    expect((await call(t, '/api/repos/xyspace/site')).status).toBe(200);
    const closed = await call(t, '/api/repos/xyspace/site', {
      cookie: admin,
      method: 'PATCH',
      json: { visibility: 'private' },
    });
    expect(closed.status).toBe(400);
  });
});

describe('isPublicRepoRead 公开仓库读取判定', () => {
  it('允许读取列表及仓库页面，但排除成员专属页面', () => {
    expect(isPublicRepoRead('/api/repos')).toBe(true);
    expect(isPublicRepoRead('/api/repos/o/r')).toBe(true);
    expect(isPublicRepoRead('/api/repos/o/r/pulls/3/files')).toBe(true);
    expect(isPublicRepoRead('/api/repos/o/r/audit')).toBe(false);
    expect(isPublicRepoRead('/api/repos/o/r/collaborators/bob')).toBe(false);
    expect(isPublicRepoRead('/api/repos/o')).toBe(false);
    expect(isPublicRepoRead('/api/users')).toBe(false);
  });
});
