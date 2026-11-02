import { describe, expect, it } from 'vitest';
import {
  authenticateRepoRequest,
  handleGitRequest,
} from '../../git/http/handler';
import { handleLfsRequest } from '../../lfs/http/handler';
import { concat, sha256Hex } from '../../git/bytes';
import { buildPack } from '../../git/pack';
import { receiveCommandBytes } from '../../git/push-protection';
import {
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from '../helpers/app';
import { commitPaths } from '../helpers/seed';

const root = '/api/repos/octocat/app/deploy-tokens';
const zero = '0'.repeat(40);
const auth = (token: string) => ({
  Authorization: `Basic ${btoa(`deploy:${token}`)}`,
});

async function setup(scope: 'read' | 'write' = 'read', addReadme = true) {
  const t = makeEnv({ actions: true });
  const cookie = await bootstrapAdmin(t);
  expect(
    (
      await call(t, '/api/repos', {
        cookie,
        json: { name: 'app', addReadme, visibility: 'private' },
      })
    ).status
  ).toBe(201);
  const response = await call(t, root, {
    cookie,
    json: { name: 'deployment', scope, expiresInDays: 30 },
  });
  expect(response.status).toBe(201);
  const issued = (await response.json()) as {
    token: { id: string };
    plaintext: string;
  };
  const repo = [...t.fake.repos.values()][0];
  return {
    t,
    cookie,
    token: issued.plaintext,
    id: issued.token.id,
    repo,
    repoId: repo.name.slice(2),
  };
}

const git = (
  t: TestEnv,
  token: string,
  path = '/octocat/app.git/info/refs?service=git-upload-pack',
  body?: Uint8Array
) =>
  handleGitRequest(
    new Request(`http://test.local${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...auth(token),
        ...(body
          ? {
              'Content-Type': 'application/x-git-receive-pack-request',
              'Content-Length': String(body.length),
            }
          : {}),
      },
      body,
    }),
    t.env,
    t.ctx
  );

const lfs = (
  t: TestEnv,
  token: string,
  endpoint: string,
  json: unknown,
  repo = 'app'
) =>
  handleLfsRequest(
    new Request(`http://test.local/octocat/${repo}.git/info/lfs/${endpoint}`, {
      method: 'POST',
      headers: {
        ...auth(token),
        'Content-Type': 'application/vnd.git-lfs+json',
      },
      body: JSON.stringify(json),
    }),
    t.env,
    t.ctx
  );

async function push(
  s: Awaited<ReturnType<typeof setup>>,
  ref: string,
  old: string,
  next: string
) {
  const body = concat([
    receiveCommandBytes([{ ref, old, new: next }], ['report-status']),
    await buildPack([]),
  ]);
  return git(s.t, s.token, '/octocat/app.git/git-receive-pack', body);
}

describe('部署令牌的 Git/LFS 边界', () => {
  it('无效部署凭据不能用 401/404 差别枚举私有仓库', async () => {
    const s = await setup();
    const invalid = `cfd_${'0'.repeat(64)}`;
    const existing = await git(s.t, invalid);
    const missing = await git(
      s.t,
      invalid,
      '/octocat/missing.git/info/refs?service=git-upload-pack'
    );
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await existing.text()).toBe(await missing.text());
  });
  it('只读凭据读取 Git，身份不冒充管理员且记录使用时间', async () => {
    const s = await setup();
    const access = await authenticateRepoRequest(
      new Request('http://test.local/', { headers: auth(s.token) }),
      s.t.env,
      s.t.ctx,
      'octocat',
      'app'
    );
    expect(access).not.toBeInstanceOf(Response);
    if (access instanceof Response) return;
    expect(access.user).toBeNull();
    expect(access.deployToken?.id).toBe(s.id);
    expect(access.perms).toEqual({ read: true, write: false, admin: false });
    const response = await git(s.t, s.token);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('refs/heads/main');
    await settle(s.t);
    expect(
      await s.t.env.DB.prepare(
        'SELECT last_used_at FROM repository_deploy_tokens WHERE id = ?'
      )
        .bind(s.id)
        .first('last_used_at')
    ).toBeTypeOf('number');
  });

  it('只读凭据拒绝 receive-pack 公告/请求和 LFS 所有写入入口', async () => {
    const s = await setup();
    expect(
      (
        await git(
          s.t,
          s.token,
          '/octocat/app.git/info/refs?service=git-receive-pack'
        )
      ).status
    ).toBe(403);
    expect(
      (
        await push(
          s,
          'refs/heads/deploy',
          zero,
          s.repo.refs.get('refs/heads/main')!
        )
      ).status
    ).toBe(403);
    for (const [endpoint, body] of [
      ['objects/batch', { operation: 'upload', objects: [] }],
      ['objects/verify', { oid: 'a'.repeat(64), size: 1 }],
      ['locks/verify', {}],
    ] as const)
      expect((await lfs(s.t, s.token, endpoint, body)).status).toBe(403);
  });

  it('只读 LFS 下载获得限定对象和期限的链接，撤销后不能申请新链接', async () => {
    const s = await setup();
    const content = 'deployment artifact';
    const oid = await sha256Hex(content);
    await s.t.env.LFS.put(`lfs/${s.repoId}/${oid}`, content, { sha256: oid });
    const request = () =>
      lfs(s.t, s.token, 'objects/batch', {
        operation: 'download',
        objects: [{ oid, size: content.length }],
      });
    const response = await request();
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      objects: { actions: { download: { href: string } } }[];
    };
    const url = new URL(result.objects[0].actions.download.href);
    expect(url.pathname).toContain(`/lfs/${s.repoId}/${oid}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(
      (
        await call(s.t, `${root}/${s.id}`, {
          cookie: s.cookie,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    expect((await request()).status).toBe(401);
  });

  it('可写 LFS 凭据通过 upload/verify，不伪造 uploadedById', async () => {
    const s = await setup('write');
    const content = 'deploy upload';
    const oid = await sha256Hex(content);
    const response = await lfs(s.t, s.token, 'objects/batch', {
      operation: 'upload',
      objects: [{ oid, size: content.length }],
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      objects: {
        actions: {
          upload: { href: string };
          verify: { header: { Authorization: string } };
        };
      }[];
    };
    expect(new URL(result.objects[0].actions.upload.href).pathname).toContain(
      `/lfs/${s.repoId}/${oid}`
    );
    expect(result.objects[0].actions.verify.header.Authorization).toBe(
      auth(s.token).Authorization
    );
    await s.t.env.LFS.put(`lfs/${s.repoId}/${oid}`, content, { sha256: oid });
    expect(
      (await lfs(s.t, s.token, 'objects/verify', { oid, size: content.length }))
        .status
    ).toBe(200);
    expect(
      await s.t.env.DB.prepare(
        'SELECT uploaded_by_id FROM lfs_objects WHERE repository_id = ? AND oid = ?'
      )
        .bind(s.repoId, oid)
        .first('uploaded_by_id')
    ).toBeNull();
    expect((await lfs(s.t, s.token, 'locks/verify', {})).status).toBe(200);
  });

  it.each(['private', 'internal', 'public'] as const)(
    '拒绝访问另一个 %s 仓库，不降级成匿名读取',
    async (visibility) => {
      const s = await setup('write');
      await call(s.t, '/api/repos', {
        cookie: s.cookie,
        json: { name: 'other', addReadme: true, visibility },
      });
      expect(
        (
          await git(
            s.t,
            s.token,
            '/octocat/other.git/info/refs?service=git-upload-pack'
          )
        ).status
      ).toBe(401);
      expect(
        (
          await lfs(
            s.t,
            s.token,
            'objects/batch',
            { operation: 'download', objects: [] },
            'other'
          )
        ).status
      ).toBe(401);
    }
  );

  it('重命名后仍按仓库 id 访问，删除重建同名仓库不会复用凭据', async () => {
    const s = await setup();
    await s.t.env.DB.prepare(
      "UPDATE repositories SET name = 'renamed' WHERE id = ?"
    )
      .bind(s.repoId)
      .run();
    expect(
      (
        await git(
          s.t,
          s.token,
          '/OCTOCAT/renamed.git/info/refs?service=git-upload-pack'
        )
      ).status
    ).toBe(200);
    await settle(s.t);
    await s.t.env.DB.prepare('DELETE FROM repositories WHERE id = ?')
      .bind(s.repoId)
      .run();
    expect(
      await s.t.env.DB.prepare(
        'SELECT id FROM repository_deploy_tokens WHERE id = ?'
      )
        .bind(s.id)
        .first()
    ).toBeNull();
    await call(s.t, '/api/repos', {
      cookie: s.cookie,
      json: { name: 'app', addReadme: true },
    });
    expect((await git(s.t, s.token)).status).toBe(401);
  });

  it('可写凭据推送普通分支，审计可追溯且 Actions/Webhooks 不冒充创建者', async () => {
    const s = await setup('write');
    expect(
      (
        await call(s.t, '/api/repos/octocat/app/hooks', {
          cookie: s.cookie,
          json: {
            url: 'https://example.com/hook',
            events: ['push'],
            active: true,
          },
        })
      ).status
    ).toBe(201);
    const sha = await commitPaths(
      s.repo,
      'main',
      {
        '.github/workflows/ci.yml':
          'name: Deploy\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
      },
      'deployment workflow',
      { moveRef: false }
    );
    const response = await push(s, 'refs/heads/deployment', zero, sha);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ok refs/heads/deployment');
    await settle(s.t);
    expect(s.repo.refs.get('refs/heads/deployment')).toBe(sha);
    const event = await s.t.env.DB.prepare(
      'SELECT id, actor_id, completed_at FROM push_events WHERE repository_id = ?'
    )
      .bind(s.repoId)
      .first();
    expect(event).toMatchObject({ actor_id: null });
    expect(event?.completed_at).toBeTypeOf('number');
    const audit = await s.t.env.DB.prepare(
      "SELECT actor_id, actor_kind, via, data FROM audit_events WHERE action = 'deploy_token.pushed'"
    ).first();
    expect(audit).toMatchObject({
      actor_id: null,
      actor_kind: 'system',
      via: 'Deploy token: deployment',
    });
    expect(JSON.parse(audit!.data as string)).toMatchObject({
      token: s.id,
      pushEvent: event!.id,
      refs: 1,
    });
    expect(JSON.stringify(audit)).not.toContain(s.token);
    const run = await s.t.env.DB.prepare(
      'SELECT actor_id FROM workflow_runs WHERE repository_id = ?'
    )
      .bind(s.repoId)
      .first();
    expect(run).toEqual({ actor_id: null });
    const payload = await s.t.env.DB.prepare(
      "SELECT payload FROM webhook_deliveries WHERE event = 'push'"
    ).first('payload');
    expect(JSON.parse(payload as string).sender).toEqual({
      login: 'cloudforge',
      type: 'Bot',
    });
    await call(s.t, `${root}/${s.id}`, { cookie: s.cookie, method: 'DELETE' });
    expect(
      await s.t.env.DB.prepare(
        "SELECT id FROM audit_events WHERE action = 'deploy_token.pushed'"
      ).first()
    ).not.toBeNull();
    expect((await git(s.t, s.token)).status).toBe(401);
  });

  it('管理员签发的可写凭据也不能更新、删除、强推保护分支或内部 ref', async () => {
    const s = await setup('write');
    await s.t.env.DB.prepare(
      'UPDATE repositories SET protected_branches = \'["release/*"]\' WHERE id = ?'
    )
      .bind(s.repoId)
      .run();
    const main = s.repo.refs.get('refs/heads/main')!;
    const next = await commitPaths(s.repo, 'main', { a: 'next' }, 'next', {
      moveRef: false,
    });
    for (const [ref, old, sha] of [
      ['refs/heads/main', main, next],
      ['refs/heads/main', main, zero],
      ['refs/heads/main', main, 'f'.repeat(40)],
      ['refs/heads/release/v1', zero, next],
      ['refs/pull/1/head', zero, next],
    ]) {
      const response = await push(s, ref, old, sha);
      expect(await response.text()).toContain(`ng ${ref}`);
    }
    expect(s.repo.refs.get('refs/heads/main')).toBe(main);
    expect(
      await s.t.env.DB.prepare('SELECT id FROM push_events').first()
    ).toBeNull();
  });

  it('空仓库拒绝默认分支和普通首分支，避免后处理把普通分支提升为默认分支', async () => {
    const s = await setup('write', false);
    const sha = await commitPaths(s.repo, 'main', { a: 'first' }, 'first', {
      moveRef: false,
    });
    for (const ref of [
      'refs/heads/main',
      'refs/heads/deployment',
      'refs/tags/v1',
    ]) {
      expect(await (await push(s, ref, zero, sha)).text()).toContain(
        `ng ${ref}`
      );
    }
    expect(s.repo.refs.size).toBe(0);
    expect(
      await s.t.env.DB.prepare('SELECT id FROM push_events').first()
    ).toBeNull();
  });

  it('部署令牌不能作为 REST、管理会话或 MCP 身份', async () => {
    const s = await setup('write');
    for (const path of [
      root,
      `/api/repos/octocat/app/commits/${s.repo.refs.get('refs/heads/main')}/status`,
    ]) {
      expect(
        (
          await call(s.t, path, {
            headers: { Authorization: `Bearer ${s.token}` },
          })
        ).status
      ).toBe(404);
    }
    expect(
      (
        await call(
          s.t,
          `/api/repos/octocat/app/statuses/${s.repo.refs.get('refs/heads/main')}`,
          {
            headers: { Authorization: `Bearer ${s.token}` },
            json: { state: 'success', context: 'deploy' },
          }
        )
      ).status
    ).toBe(401);
    const mcp = await call(s.t, '/mcp', {
      headers: { Authorization: `Bearer ${s.token}` },
      json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status).toBe(401);
  });
});
