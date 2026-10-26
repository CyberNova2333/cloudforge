// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { handleGitRequest } from '../git-http';
import { hashToken } from '../lib/tokens';
import { MAX_ACTIVE_TOKENS } from '../routers/tokens-router';
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
      'cfp_nope'
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

  it('新令牌以 cfp_ 开头；改名前发出的 gop_ 令牌仍然有效', async () => {
    const { t, admin } = await setup();
    expect(await pat(t, admin)).toMatch(/^cfp_[0-9a-f]{40}$/);
    // Issued before the rename: only the hash is stored, so the prefix never mattered.
    const legacy = `gop_${'ab'.repeat(20)}`;
    await t.env.DB.prepare(
      "INSERT INTO personal_access_tokens (id, user_id, name, token_hash, created_at) SELECT 'legacy', id, 'old', ?, ? FROM users WHERE username = 'octocat'"
    )
      .bind(await hashToken(legacy), Date.now())
      .run();
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-upload-pack',
          legacy
        )
      ).status
    ).toBe(200);
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

  it('只读令牌可以克隆，但即使是管理员也不能推送', async () => {
    const { t, admin } = await setup();
    const res = await call(t, '/api/tokens', {
      cookie: admin,
      json: { name: 'ci', expiresInDays: 30, scope: 'read' },
    });
    const { token: row, plaintext } = (await res.json()) as {
      token: { scope: string };
      plaintext: string;
    };
    expect(row.scope).toBe('read');
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-upload-pack',
          plaintext
        )
      ).status
    ).toBe(200);
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-receive-pack',
          plaintext
        )
      ).status
    ).toBe(403);
    expect(
      (await git(t, '/octocat/app.git/git-receive-pack', plaintext, 'POST'))
        .status
    ).toBe(403);
    // Tokens default to read and write, as every token made before scopes.
    const list = (await (
      await call(t, '/api/tokens', { cookie: admin })
    ).json()) as { scope: string }[];
    expect(list.map((r) => r.scope)).toEqual(['read']);
    expect(
      (
        await git(
          t,
          '/octocat/app.git/info/refs?service=git-receive-pack',
          await pat(t, admin)
        )
      ).status
    ).toBe(200);
  });

  it(`每人最多 ${MAX_ACTIVE_TOKENS} 个有效令牌，过期的不计入`, async () => {
    const { t, admin } = await setup();
    const userId = (await t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!.id;
    const now = Date.now();
    const insert = (i: number, expiresAt: number | null) =>
      t.env.DB.prepare(
        'INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(`t${i}`, userId, `t${i}`, `h${i}`, 'write', expiresAt, now);
    await t.env.DB.batch([
      ...Array.from({ length: MAX_ACTIVE_TOKENS - 1 }, (_, i) =>
        insert(i, null)
      ),
      insert(999, 1),
    ]);
    const create = () =>
      call(t, '/api/tokens', {
        cookie: admin,
        json: { name: 'one more', expiresInDays: 30 },
      });
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });

  it('个人令牌并发创建只能占用最后一个有效配额，失败不返回凭据或写审计', async () => {
    const { t, admin } = await setup();
    const userId = (await t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!.id;
    const now = Math.floor(Date.now() / 1000);
    const insert = (i: number, expiresAt: number | null) =>
      t.env.DB.prepare(
        'INSERT INTO personal_access_tokens (id, user_id, name, token_hash, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        `seed-${i}`,
        userId,
        `seed-${i}`,
        `unused-${i}`,
        'read',
        expiresAt,
        now
      );
    await t.env.DB.batch([
      ...Array.from({ length: MAX_ACTIVE_TOKENS - 1 }, (_, i) =>
        insert(i, i % 2 ? null : now + 3600)
      ),
      insert(999, now - 1),
    ]);
    const inputs = Array.from({ length: 6 }, (_, i) => ({
      name: `concurrent-${i}`,
      scope: i % 2 ? 'write' : 'read',
      expiresInDays: i % 2 ? null : 30,
    }));
    const responses = await Promise.all(
      inputs.map((json) => call(t, '/api/tokens', { cookie: admin, json }))
    );
    expect(responses.map((res) => res.status).sort()).toEqual([
      201, 409, 409, 409, 409, 409,
    ]);
    let createdId = '';
    for (const [i, response] of responses.entries()) {
      const body = (await response.json()) as {
        token?: {
          id: string;
          name: string;
          scope: string;
          expiresAt: string | null;
        };
        plaintext?: string;
      };
      if (response.status === 409) {
        expect(body.token).toBeUndefined();
        expect(body.plaintext).toBeUndefined();
        continue;
      }
      expect(body.token).toMatchObject({
        name: inputs[i].name,
        scope: inputs[i].scope,
      });
      expect(body.plaintext).toMatch(/^cfp_[0-9a-f]{40}$/);
      expect(body.token!.expiresAt === null).toBe(
        inputs[i].expiresInDays === null
      );
      const stored = (await t.env.DB.prepare(
        'SELECT token_hash, expires_at FROM personal_access_tokens WHERE id = ?'
      )
        .bind(body.token!.id)
        .first<{ token_hash: string; expires_at: number | null }>())!;
      expect(stored.token_hash).toBe(await hashToken(body.plaintext!));
      expect(stored.expires_at).toBe(
        body.token!.expiresAt === null
          ? null
          : Math.floor(Date.parse(body.token!.expiresAt) / 1000)
      );
      createdId = body.token!.id;
    }
    const active = await t.env.DB.prepare(
      'SELECT count(*) AS n FROM personal_access_tokens WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)'
    )
      .bind(userId, now)
      .first<{ n: number }>();
    expect(active?.n).toBe(MAX_ACTIVE_TOKENS);
    const audits = await t.env.DB.prepare(
      "SELECT data FROM audit_events WHERE actor_id = ? AND action = 'token.created'"
    )
      .bind(userId)
      .all<{ data: string }>();
    expect(audits.results).toHaveLength(1);
    expect(JSON.parse(audits.results[0].data).token).toBe(createdId);
    expect(
      (
        await call(t, `/api/tokens/${createdId}`, {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    const permanent = await call(t, '/api/tokens', {
      cookie: admin,
      json: { name: 'after-revoke', expiresInDays: null },
    });
    expect(permanent.status).toBe(201);
    const body = (await permanent.json()) as {
      token: { id: string; scope: string; expiresAt: string | null };
    };
    expect(body.token.scope).toBe('write');
    expect(body.token.expiresAt).toBeNull();
    expect(
      await t.env.DB.prepare(
        'SELECT expires_at FROM personal_access_tokens WHERE id = ?'
      )
        .bind(body.token.id)
        .first('expires_at')
    ).toBeNull();
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
