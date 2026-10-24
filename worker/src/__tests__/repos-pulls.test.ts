// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';
import { commitFiles } from './helpers/seed';

async function withRepo() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const res = await call(t, '/api/repos', {
    cookie: admin,
    json: {
      name: 'app',
      description: 'demo',
      addReadme: true,
      visibility: 'internal',
    },
  });
  expect(res.status).toBe(201);
  const repo = [...t.fake.repos.values()][0];
  return { t, admin, repo };
}

describe('仓库', () => {
  it('创建以标识命名的 Artifacts 仓库，并提交初始 README', async () => {
    const { t, admin, repo } = await withRepo();
    expect(repo.name).toMatch(/^r_[0-9a-f-]{36}$/);
    const contents = await call(t, '/api/repos/octocat/app/contents?refPath=', {
      cookie: admin,
    });
    const body = (await contents.json()) as {
      kind: string;
      entries: { name: string }[];
      readme: { text: string };
    };
    expect(body.kind).toBe('tree');
    expect(body.entries.map((e) => e.name)).toEqual(['README.md']);
    expect(body.readme.text).toContain('# app');
  });

  it('拒绝同一所有者下重名的仓库', async () => {
    const { t, admin } = await withRepo();
    expect(
      (await call(t, '/api/repos', { cookie: admin, json: { name: 'app' } }))
        .status
    ).toBe(409);
  });

  it('允许所有成员读取，但仅管理员能更改设置', async () => {
    const { t, admin } = await withRepo();
    const bob = await addMember(t, admin, 'bob');
    const detail = (await (
      await call(t, '/api/repos/octocat/app', { cookie: bob })
    ).json()) as { permissions: object };
    expect(detail.permissions).toEqual({
      read: true,
      write: false,
      admin: false,
    });
    expect(
      (
        await call(t, '/api/repos/octocat/app', {
          cookie: bob,
          method: 'DELETE',
        })
      ).status
    ).toBe(403);
    // Signed out, a repository that is not public does not exist (only public ones are readable).
    expect(
      (await call(t, '/api/repos/octocat/app', { method: 'GET' })).status
    ).toBe(404);
  });

  it('在目录树路径中解析包含斜杠的分支名', async () => {
    const { t, admin, repo } = await withRepo();
    await commitFiles(repo, 'feature/x', { 'a.txt': 'a' }, 'feat');
    const res = await call(
      t,
      '/api/repos/octocat/app/contents?refPath=feature/x/a.txt',
      { cookie: admin }
    );
    const body = (await res.json()) as {
      ref: string;
      path: string;
      kind: string;
      file: { text: string };
    };
    expect(body).toMatchObject({
      ref: 'feature/x',
      path: 'a.txt',
      kind: 'blob',
    });
    expect(body.file.text).toBe('a');
  });
});

describe('拉取请求', () => {
  async function withBranch() {
    const ctx = await withRepo();
    const main = ctx.repo.refs.get('refs/heads/main')!;
    await commitFiles(
      ctx.repo,
      'feature',
      {
        'README.md': '# app\n\ndemo\n\nUsage: greet\n',
        'greet.py': 'print("hi")\n',
      },
      'Add greet',
      [main]
    );
    return ctx;
  }

  it('按仓库顺序分配拉取请求编号', async () => {
    const { t, admin, repo } = await withBranch();
    const a = await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'A', base: 'main', head: 'feature' },
    });
    expect(((await a.json()) as { number: number }).number).toBe(1);
    await commitFiles(repo, 'other', { 'x.txt': 'x' }, 'x', [
      repo.refs.get('refs/heads/main')!,
    ]);
    const b = await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'B', base: 'main', head: 'other' },
    });
    expect(((await b.json()) as { number: number }).number).toBe(2);
  });

  it('拒绝为相同分支对创建第二个打开的请求', async () => {
    const { t, admin } = await withBranch();
    await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'A', base: 'main', head: 'feature' },
    });
    const dup = await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'A', base: 'main', head: 'feature' },
    });
    expect(dup.status).toBe(409);
  });

  it('创建拉取请求需要推送权限', async () => {
    const { t, admin } = await withBranch();
    const bob = await addMember(t, admin, 'bob');
    const res = await call(t, '/api/repos/octocat/app/pulls', {
      cookie: bob,
      json: { title: 'A', base: 'main', head: 'feature' },
    });
    expect(res.status).toBe(403);
    // ...but any member may comment.
    await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'A', base: 'main', head: 'feature' },
    });
    expect(
      (
        await call(t, '/api/repos/octocat/app/pulls/1/comments', {
          cookie: bob,
          json: { body: 'nice' },
        })
      ).status
    ).toBe(201);
  });

  it('展示差异，为分叉分支变基并快进合入', async () => {
    const { t, admin, repo } = await withBranch();
    await commitFiles(
      repo,
      'main',
      { 'README.md': '# app\n\ndemo\n', LICENSE: 'MIT\n' },
      'Add license'
    );
    await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'Greet', base: 'main', head: 'feature' },
    });

    const files = (await (
      await call(t, '/api/repos/octocat/app/pulls/1/files', { cookie: admin })
    ).json()) as { path: string; status: string }[];
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['README.md', 'modified'],
      ['greet.py', 'added'],
    ]);

    const detail = (await (
      await call(t, '/api/repos/octocat/app/pulls/1', { cookie: admin })
    ).json()) as { mergeable: boolean };
    expect(detail.mergeable).toBe(true);

    const baseBefore = repo.refs.get('refs/heads/main')!;
    const headSha = repo.refs.get('refs/heads/feature')!;
    const merge = await call(t, '/api/repos/octocat/app/pulls/1/merge', {
      cookie: admin,
      json: { approve: true },
    });
    expect(merge.status).toBe(200);
    const { sha } = (await merge.json()) as { sha: string };

    // Rebased onto main, then main moved to it: the author's own commit, history linear.
    expect(sha).toBe(repo.refs.get('refs/heads/feature'));
    expect(repo.refs.get('refs/heads/main')).toBe(sha);
    expect(repo.refs.get('refs/pull/1/head')).toBe(sha);
    expect(repo.refs.get(`refs/pull/1/pre-rebase/${headSha.slice(0, 7)}`)).toBe(
      headSha
    );
    const commit = repo.parseCommit(sha)!;
    expect(commit.parents).toEqual([baseBefore]);
    expect(commit.message).toBe('Add greet');
    expect(repo.parseTree(commit.treeHash)!.map((e) => e.name)).toEqual([
      'LICENSE',
      'README.md',
      'greet.py',
    ]);

    const after = (await (
      await call(t, '/api/repos/octocat/app/pulls/1', { cookie: admin })
    ).json()) as { pull: { state: string } };
    expect(after.pull.state).toBe('merged');
    // Files remain viewable after the head branch is deleted.
    await call(t, '/api/repos/octocat/app/branches?name=feature', {
      cookie: admin,
      method: 'DELETE',
    });
    const still = (await (
      await call(t, '/api/repos/octocat/app/pulls/1/files', { cookie: admin })
    ).json()) as unknown[];
    expect(still).toHaveLength(2);
  });

  it('报告冲突并拒绝合入', async () => {
    const { t, admin, repo } = await withBranch();
    await commitFiles(
      repo,
      'main',
      { 'README.md': '# different\n' },
      'Change readme'
    );
    await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'Greet', base: 'main', head: 'feature' },
    });
    const detail = (await (
      await call(t, '/api/repos/octocat/app/pulls/1', { cookie: admin })
    ).json()) as {
      mergeable: boolean;
      rebase: { status: string; files: string[] };
    };
    expect(detail.mergeable).toBe(false);
    expect(detail.rebase).toMatchObject({
      status: 'conflict',
      files: ['README.md'],
    });
    const res = await call(t, '/api/repos/octocat/app/pulls/1/merge', {
      cookie: admin,
      json: { approve: true },
    });
    expect(res.status).toBe(409);
  });

  it('不允许非协作者成员合入', async () => {
    const { t, admin } = await withBranch();
    const bob = await addMember(t, admin, 'bob');
    await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'Greet', base: 'main', head: 'feature' },
    });
    expect(
      (
        await call(t, '/api/repos/octocat/app/pulls/1/merge', {
          cookie: bob,
          json: { approve: true },
        })
      ).status
    ).toBe(403);
  });
});

describe('安全加固', () => {
  it('拒绝以非分支引用作为基准或分支头的拉取请求', async () => {
    const { t, admin, repo } = await withRepo();
    const main = repo.refs.get('refs/heads/main')!;
    await commitFiles(repo, 'feature', { 'x.txt': 'x' }, 'x', [main]);
    const res = await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'A', base: main, head: 'feature' },
    });
    expect(res.status).toBe(400);
  });

  it('仅向站点管理员及成员本人展示成员邮箱', async () => {
    const { t, admin } = await withRepo();
    const bob = await addMember(t, admin, 'bob');
    await addMember(t, admin, 'carol');
    type M = { username: string; email: string | null }[];
    const asBob = (await (
      await call(t, '/api/users', { cookie: bob })
    ).json()) as M;
    expect(asBob.find((m) => m.username === 'carol')!.email).toBeNull();
    expect(asBob.find((m) => m.username === 'bob')!.email).toBe(
      'bob@example.com'
    );
    const asAdmin = (await (
      await call(t, '/api/users', { cookie: admin })
    ).json()) as M;
    expect(asAdmin.find((m) => m.username === 'carol')!.email).toBe(
      'carol@example.com'
    );
  });
});
