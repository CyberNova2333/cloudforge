import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../db/schema';
import { agents, repositories, repositoryDeployTokens } from '../db/app.schema';
import { users } from '../db/auth.schema';
import {
  authenticateDeployToken,
  canManageDeployTokens,
  createDeployToken,
  MAX_DEPLOY_TOKENS_PER_REPO,
} from '../lib/deploy-tokens';
import { hashToken } from '../lib/tokens';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';

const base = '/api/repos/octocat/app/deploy-tokens';
type TokenOut = {
  id: string;
  name: string;
  scope: 'read' | 'write';
  createdById: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};
type Created = { token: TokenOut; plaintext: string };

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const created = await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', visibility: 'private' },
  });
  expect(created.status).toBe(201);
  const db = drizzle(t.env.DB, { schema });
  const repo = (await db
    .select()
    .from(repositories)
    .where(eq(repositories.name, 'app'))
    .get())!;
  return { t, admin, db, repo };
}

async function issue(
  t: TestEnv,
  cookie: string,
  path = base,
  json: unknown = { name: 'deploy' }
): Promise<Created> {
  const res = await call(t, path, { cookie, json });
  expect(res.status).toBe(201);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  return res.json() as Promise<Created>;
}

afterEach(() => vi.useRealTimers());

describe('仓库部署令牌管理', () => {
  it('默认只读和 30 天、只存哈希，明文仅创建返回且创建与撤销均记审计', async () => {
    const { t, admin, db, repo } = await setup();
    const made = await issue(t, admin, base, { name: '  mirror  ' });
    expect(made.plaintext).toMatch(/^cfd_[0-9a-f]{64}$/);
    expect(made.token).toMatchObject({
      name: 'mirror',
      scope: 'read',
      lastUsedAt: null,
      createdById: repo.ownerId,
    });
    expect(
      Date.parse(made.token.expiresAt) - Date.parse(made.token.createdAt)
    ).toBe(30 * 86_400_000);
    const stored = (await db.select().from(repositoryDeployTokens).get())!;
    expect(stored.tokenHash).toBe(await hashToken(made.plaintext));
    expect(JSON.stringify(stored)).not.toContain(made.plaintext);
    const list = await call(t, base, { cookie: admin });
    expect(list.headers.get('Cache-Control')).toBe('no-store');
    const listed = await list.json();
    expect(listed).toEqual([made.token]);
    expect(JSON.stringify(listed)).not.toContain(stored.tokenHash);
    expect(JSON.stringify(made)).not.toContain(stored.tokenHash);
    const second = await issue(t, admin, base, {
      name: 'mirror',
      scope: 'write',
      expiresInDays: 366,
    });
    expect(second.plaintext).not.toBe(made.plaintext);
    expect(second.token.scope).toBe('write');
    const revoked = await call(t, `${base}/${made.token.id}`, {
      cookie: admin,
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get('Cache-Control')).toBe('no-store');
    expect(await authenticateDeployToken(db, repo, made.plaintext)).toBeNull();
    const audit = await t.env.DB.prepare(
      "SELECT action, target, data FROM audit_events WHERE action LIKE 'deploy_token.%' ORDER BY rowid"
    ).all();
    expect(audit.results.map((r) => r.action)).toEqual([
      'deploy_token.created',
      'deploy_token.created',
      'deploy_token.deleted',
    ]);
    const auditJson = JSON.stringify(audit.results);
    expect(auditJson).toContain(made.token.id);
    expect(auditJson).not.toContain(made.plaintext);
    expect(auditJson).not.toContain(stored.tokenHash);
  });

  it('普通成员、写协作者与匿名者不能列出、创建或撤销，包括公开仓库', async () => {
    const { t, admin, db, repo } = await setup();
    const bob = await addMember(t, admin, 'bob');
    const made = await issue(t, admin);
    await call(t, '/api/repos/octocat/app/collaborators/bob', {
      cookie: admin,
      method: 'PUT',
    });
    for (const opts of [{}, { json: { name: 'bad' } }, { method: 'DELETE' }]) {
      const path = opts.method === 'DELETE' ? `${base}/${made.token.id}` : base;
      expect((await call(t, path, { ...opts, cookie: bob })).status).toBe(403);
    }
    await db
      .update(repositories)
      .set({ visibility: 'public' })
      .where(eq(repositories.id, repo.id));
    expect((await call(t, base)).status).toBe(403);
    expect((await call(t, base, { json: { name: 'bad' } })).status).toBe(401);
    expect(await db.select().from(repositoryDeployTokens).all()).toHaveLength(
      1
    );
  });

  it('部署令牌与个人令牌都不能替代管理接口的网页登录会话', async () => {
    const { t, admin } = await setup();
    const made = await issue(t, admin);
    const pat = (await (
      await call(t, '/api/tokens', {
        cookie: admin,
        json: { name: 'personal' },
      })
    ).json()) as { plaintext: string };
    for (const token of [made.plaintext, pat.plaintext]) {
      expect(
        (
          await call(t, base, {
            headers: { Authorization: `Bearer ${token}` },
            json: { name: 'bad' },
          })
        ).status
      ).toBe(401);
      expect(
        (
          await call(t, `${base}/${made.token.id}`, {
            headers: { Authorization: `Bearer ${token}` },
            method: 'DELETE',
          })
        ).status
      ).toBe(401);
    }
  });

  it('即使同时管理两个仓库，也不能用另一个仓库路径撤销令牌', async () => {
    const { t, admin, db, repo } = await setup();
    const made = await issue(t, admin);
    await call(t, '/api/repos', { cookie: admin, json: { name: 'other' } });
    const otherPath = '/api/repos/octocat/other/deploy-tokens';
    expect(
      (
        await call(t, `${otherPath}/${made.token.id}`, {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(404);
    expect(await (await call(t, otherPath, { cookie: admin })).json()).toEqual(
      []
    );
    expect(
      await authenticateDeployToken(db, repo, made.plaintext)
    ).not.toBeNull();
    expect(
      (await call(t, `${base}/missing`, { cookie: admin, method: 'DELETE' }))
        .status
    ).toBe(404);
  });

  it('拒绝空白名称、未知范围、永久有效以及越界或非整数期限', async () => {
    const { t, admin, db } = await setup();
    for (const input of [
      { name: ' ' },
      { name: 'x'.repeat(101) },
      { name: 'x', scope: 'admin' },
      ...[null, 0, -1, 367, 1.5, '30'].map((expiresInDays) => ({
        name: 'x',
        expiresInDays,
      })),
    ]) {
      const res = await call(t, base, { cookie: admin, json: input });
      expect(res.status, JSON.stringify(input)).toBe(400);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(await db.select().from(repositoryDeployTokens).all()).toEqual([]);
  });

  it('并发创建原子约束每仓库 50 条，过期令牌也计数，撤销后可创建', async () => {
    const { t, admin, db, repo } = await setup();
    const rows = Array.from(
      { length: MAX_DEPLOY_TOKENS_PER_REPO - 1 },
      (_, i) => ({
        id: `seed-${i}`,
        repositoryId: repo.id,
        createdById: repo.ownerId,
        name: `old-${i}`,
        tokenHash: `unused-${i}`,
        scope: 'read' as const,
        createdAt: new Date(0),
        expiresAt: new Date(1),
        lastUsedAt: null,
      })
    );
    const batches = [];
    for (let i = 0; i < rows.length; i += 8)
      batches.push(
        db.insert(repositoryDeployTokens).values(rows.slice(i, i + 8))
      );
    await db.batch(batches as [(typeof batches)[number], ...typeof batches]);
    const attempts = await Promise.all(
      ['first', 'second'].map((name) =>
        call(t, base, { cookie: admin, json: { name } })
      )
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(repositoryDeployTokens).all()).toHaveLength(
      MAX_DEPLOY_TOKENS_PER_REPO
    );
    expect(
      (await call(t, base, { cookie: admin, json: { name: 'full' } })).status
    ).toBe(409);
    expect(
      (await call(t, `${base}/seed-0`, { cookie: admin, method: 'DELETE' }))
        .status
    ).toBe(200);
    await issue(t, admin);
    await call(t, '/api/repos', { cookie: admin, json: { name: 'other' } });
    await issue(t, admin, '/api/repos/octocat/other/deploy-tokens');
  });
});

describe('部署令牌当前授权', () => {
  it('只认证绑定仓库、严格令牌格式，精确到期边界拒绝且查询不更新使用时间', async () => {
    const { t, admin, db, repo } = await setup();
    const made = await issue(t, admin);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'other', visibility: 'public' },
    });
    const other = (await db
      .select()
      .from(repositories)
      .where(eq(repositories.name, 'other'))
      .get())!;
    expect(await authenticateDeployToken(db, other, made.plaintext)).toBeNull();
    for (const token of [
      ` ${made.plaintext}`,
      made.plaintext.toUpperCase(),
      'cfd_bad',
      `${made.plaintext}x`,
    ])
      expect(await authenticateDeployToken(db, repo, token)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(made.token.expiresAt) - 1);
    expect(
      await authenticateDeployToken(db, repo, made.plaintext)
    ).not.toBeNull();
    vi.setSystemTime(Date.parse(made.token.expiresAt));
    expect(await authenticateDeployToken(db, repo, made.plaintext)).toBeNull();
    expect(
      (await db.select().from(repositoryDeployTokens).get())!.lastUsedAt
    ).toBeNull();
  });

  it('创建者封禁、失去仓库管理权或成为代理时立即失效，旧仓库快照不能绕过', async () => {
    const { t, admin, db, repo } = await setup();
    await addMember(t, admin, 'bob');
    const bob = (await db
      .select()
      .from(users)
      .where(eq(users.username, 'bob'))
      .get())!;
    const made = await issue(t, admin);
    await db
      .update(users)
      .set({ banned: true })
      .where(eq(users.id, repo.ownerId));
    expect(await authenticateDeployToken(db, repo, made.plaintext)).toBeNull();
    await db
      .update(users)
      .set({ banned: false, role: 'user' })
      .where(eq(users.id, repo.ownerId));
    expect(
      await authenticateDeployToken(db, repo, made.plaintext)
    ).not.toBeNull();
    await db
      .update(repositories)
      .set({ ownerId: bob.id })
      .where(eq(repositories.id, repo.id));
    expect(await authenticateDeployToken(db, repo, made.plaintext)).toBeNull();
    expect(await canManageDeployTokens(db, repo.id, repo.ownerId)).toBe(false);
    expect(
      await createDeployToken(db, repo.id, repo.ownerId, {
        name: 'stale',
        scope: 'write',
        expiresInDays: 30,
      })
    ).toBeNull();
    await db
      .update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, repo.ownerId));
    expect(
      await authenticateDeployToken(db, repo, made.plaintext)
    ).not.toBeNull();
    await db.insert(agents).values({
      userId: repo.ownerId,
      name: 'Agent',
      triggerAsk: 'Review?',
      triggerAbove: 0.5,
      createdAt: new Date(),
    });
    expect(await authenticateDeployToken(db, repo, made.plaintext)).toBeNull();
    expect(await canManageDeployTokens(db, repo.id, repo.ownerId)).toBe(false);
    expect(
      (
        await call(t, '/api/repos/bob/app/deploy-tokens', {
          cookie: admin,
          json: { name: 'agent' },
        })
      ).status
    ).toBe(403);
  });

  it('其他当前管理员可以撤销创建者的令牌，创建者删除也级联撤销', async () => {
    const { t, admin, db } = await setup();
    const bobCookie = await addMember(t, admin, 'bob');
    const bob = (await db
      .select()
      .from(users)
      .where(eq(users.username, 'bob'))
      .get())!;
    await call(t, '/api/repos', { cookie: bobCookie, json: { name: 'owned' } });
    const path = '/api/repos/bob/owned/deploy-tokens';
    const made = await issue(t, admin, path);
    expect(
      (
        await call(t, `${path}/${made.token.id}`, {
          cookie: bobCookie,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, bob.id));
    const second = await issue(t, bobCookie);
    await db.delete(users).where(eq(users.id, bob.id));
    expect(
      await db
        .select()
        .from(repositoryDeployTokens)
        .where(eq(repositoryDeployTokens.id, second.token.id))
        .get()
    ).toBeUndefined();
  });

  it('删除仓库级联删除全部部署令牌', async () => {
    const { t, admin, db, repo } = await setup();
    await issue(t, admin);
    await db.delete(repositories).where(eq(repositories.id, repo.id));
    expect(await db.select().from(repositoryDeployTokens).all()).toEqual([]);
  });
});
