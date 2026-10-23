// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { handleGitRequest } from '../git-http';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

async function git(t: TestEnv, path: string, token?: string, method = 'GET') {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Basic ${btoa(`user:${token}`)}`);
  return handleGitRequest(
    new Request(`http://test.local${path}`, {
      method,
      headers,
      body: method === 'POST' ? '0000' : undefined,
    }),
    t.env,
    ctx
  );
}

async function pat(t: TestEnv, cookie: string) {
  const res = await call(t, '/api/tokens', {
    cookie,
    json: { name: 'cli', expiresInDays: 30 },
  });
  return ((await res.json()) as { plaintext: string }).plaintext;
}

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', addReadme: true, visibility: 'internal' },
  });
  return { t, admin };
}

describe('Git smart-HTTP 代理', () => {
  it('未提供凭据时发起认证质询', async () => {
    const { t } = await setup();
    const res = await git(
      t,
      '/octocat/app.git/info/refs?service=git-upload-pack'
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('拒绝未知令牌', async () => {
    const { t } = await setup();
    const res = await git(
      t,
      '/octocat/app.git/info/refs?service=git-upload-pack',
      'gop_nope'
    );
    expect(res.status).toBe(401);
  });

  it('向所有持有效令牌的成员提供引用公告', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    const res = await git(
      t,
      '/octocat/app.git/info/refs?service=git-upload-pack',
      await pat(t, bob)
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('refs/heads/main');
  });

  it('仓库不存在时返回 404', async () => {
    const { t, admin } = await setup();
    const res = await git(
      t,
      '/octocat/missing.git/info/refs?service=git-upload-pack',
      await pat(t, admin)
    );
    expect(res.status).toBe(404);
  });

  it('拒绝非协作者成员推送', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    const token = await pat(t, bob);
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-receive-pack',
          token
        )
      ).status
    ).toBe(403);
    expect(
      (await git(t, '/octocat/app.git/git-receive-pack', token, 'POST')).status
    ).toBe(403);

    await call(t, '/api/repos/octocat/app/collaborators/bob', {
      cookie: admin,
      method: 'PUT',
    });
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-receive-pack',
          token
        )
      ).status
    ).toBe(200);
  });

  it('拒绝过期令牌', async () => {
    const { t, admin } = await setup();
    const token = await pat(t, admin);
    await t.env.DB.prepare(
      'UPDATE personal_access_tokens SET expires_at = 1'
    ).run();
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-upload-pack',
          token
        )
      ).status
    ).toBe(401);
  });

  it('引用公告仅允许 GET，pack 交换仅允许 POST', async () => {
    const { t, admin } = await setup();
    const token = await pat(t, admin);
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-upload-pack',
          token,
          'POST'
        )
      ).status
    ).toBe(405);
    expect(
      (await git(t, '/octocat/app.git/git-upload-pack', token, 'GET')).status
    ).toBe(405);
  });
});
