// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as userLookup from '../../members/users';
import {
  RECENT_AUTHENTICATION_MS,
  needsRecentRestAuthentication,
} from '../../auth/recent';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';
import { newAgent } from '../helpers/agents';

afterEach(() => vi.restoreAllMocks());
const path = '/api/repos/octocat/app/collaborators/member';
const run = (
  t: TestEnv,
  query: string,
  ...params: (string | number | null)[]
) =>
  t.env.DB.prepare(query)
    .bind(...params)
    .run();
const grant = (t: TestEnv) =>
  t.env.DB.prepare(
    'SELECT repository_id, user_id, role, revision, created_at FROM repository_collaborators'
  )
    .all()
    .then((result) => result.results);
const audits = (t: TestEnv) =>
  t.env.DB.prepare(
    "SELECT action, actor_id, target FROM audit_events WHERE action IN ('collaborator.added', 'collaborator.removed') ORDER BY rowid"
  )
    .all()
    .then((result) => result.results);
const generation = (t: TestEnv) =>
  t.env.DB.prepare(
    'SELECT generation FROM access_control_state WHERE id = 1'
  ).first<number>('generation');

async function world() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const member = await addMember(t, admin, 'member');
  const created = await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', visibility: 'private' },
  });
  expect(created.status).toBe(201);
  const repo = (await created.json()) as { id: string };
  const session = await t.env.DB.prepare(
    "SELECT s.id, s.user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'octocat'"
  ).first<{ id: string; user_id: string }>();
  const memberId = (await t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'member'"
  ).first<string>('id'))!;
  return {
    t,
    admin,
    member,
    repoId: repo.id,
    sessionId: session!.id,
    adminId: session!.user_id,
    memberId,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The lookup remains real D1; pause only after capture and the target pre-read. */
function holdTarget(count = 1) {
  const entered = deferred();
  const release = deferred();
  const original = userLookup.userByUsername;
  let held = 0;
  vi.spyOn(userLookup, 'userByUsername').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === 'member' && held < count) {
      if (++held === count) entered.resolve();
      await release.promise;
    }
    return result;
  });
  return { entered: entered.promise, release: release.resolve };
}

async function enteredBeforeResponse(
  entered: Promise<void>,
  ...requests: Promise<Response>[]
) {
  await Promise.race([
    entered,
    ...requests.map(async (pending) => {
      const response = await pending;
      throw new Error(
        `Request ended before target barrier: ${response.status}`
      );
    }),
  ]);
}

describe('协作者写点权限和兼容行为（真实D1）', () => {
  it('近期认证仅覆盖协作者PUT/DELETE，读取与其他仓库操作保持原路径', () => {
    for (const method of ['PUT', 'DELETE']) {
      expect(needsRecentRestAuthentication(method, path)).toBe(true);
      expect(needsRecentRestAuthentication(method, `${path}/`)).toBe(true);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST'])
      expect(needsRecentRestAuthentication(method, path)).toBe(false);
    expect(
      needsRecentRestAuthentication('DELETE', '/api/repos/octocat/app/branches')
    ).toBe(false);
  });

  it('新增和移除只审计真实变动；重复PUT/不存在DELETE保留revision和ACL代数', async () => {
    const { t, admin, adminId, memberId, repoId } = await world();
    const added = await call(t, path, { cookie: admin, method: 'PUT' });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({ ok: true });
    expect(added.headers.get('cache-control')).toBe('no-store');
    await run(t, 'UPDATE repository_collaborators SET revision = revision + 1');
    const existing = await grant(t);
    expect(existing).toEqual([
      expect.objectContaining({
        repository_id: repoId,
        user_id: memberId,
        role: 'write',
        revision: 1,
      }),
    ]);
    expect(existing[0].created_at).toBeLessThan(Date.now() / 1000 + 1);
    const before = await generation(t);
    expect((await call(t, path, { cookie: admin, method: 'PUT' })).status).toBe(
      200
    );
    expect(await grant(t)).toEqual(existing);
    expect(await generation(t)).toBe(before);
    expect(await audits(t)).toEqual([
      { action: 'collaborator.added', actor_id: adminId, target: 'member' },
    ]);
    expect(
      (await call(t, path, { cookie: admin, method: 'DELETE' })).status
    ).toBe(200);
    expect(await grant(t)).toEqual([]);
    const removed = await generation(t);
    expect(removed).toBe(before! + 1);
    expect(
      (await call(t, path, { cookie: admin, method: 'DELETE' })).status
    ).toBe(200);
    expect(await generation(t)).toBe(removed);
    expect(await audits(t)).toEqual([
      { action: 'collaborator.added', actor_id: adminId, target: 'member' },
      { action: 'collaborator.removed', actor_id: adminId, target: 'member' },
    ]);
  });

  it.each(['PUT', 'DELETE'])(
    '过期密码证明的%s在执行前challenge，重验后原会话继续',
    async (method) => {
      const { t, admin, sessionId } = await world();
      await run(
        t,
        'UPDATE sessions SET auth_time = ? WHERE id = ?',
        Date.now() - RECENT_AUTHENTICATION_MS - 10000,
        sessionId
      );
      const response = await call(t, path, { cookie: admin, method });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
        sessionId,
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await grant(t)).toEqual([]);
      expect(await audits(t)).toEqual([]);
      expect(
        (
          await call(t, '/api/auth/reauthenticate', {
            cookie: admin,
            json: { sessionId, password: 'password123' },
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(t, path, {
            cookie: admin,
            method,
            headers: { 'X-CloudForge-Session': sessionId },
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(t, path, {
            cookie: admin,
            method,
            headers: { 'X-CloudForge-Session': 'other-session' },
          })
        ).status
      ).toBe(401);
    }
  );

  it('普通无权限返回404/403，个人owner和站点管理员仍可管理访问', async () => {
    const { t, admin, member } = await world();
    expect(
      (await call(t, path, { cookie: member, method: 'PUT' })).status
    ).toBe(404);
    expect((await call(t, path, { cookie: admin, method: 'PUT' })).status).toBe(
      200
    );
    expect(
      (await call(t, path, { cookie: member, method: 'DELETE' })).status
    ).toBe(403);
    expect(
      (
        await call(t, path.replace('member', 'missing'), {
          cookie: admin,
          method: 'PUT',
        })
      ).status
    ).toBe(404);
    expect(
      (
        await call(t, '/api/repos', {
          cookie: member,
          json: { name: 'personal', visibility: 'private' },
        })
      ).status
    ).toBe(201);
    const personal = '/api/repos/member/personal/collaborators/octocat';
    expect(
      (await call(t, personal, { cookie: member, method: 'PUT' })).status
    ).toBe(200);
    expect(
      (await call(t, personal, { cookie: admin, method: 'DELETE' })).status
    ).toBe(200);
  });

  it('新增拒绝agent，DELETE仍可清理历史异常agent协作者', async () => {
    const { t, admin, repoId } = await world();
    const agent = await newAgent(t, admin);
    const previous = await grant(t);
    const agentPath = '/api/repos/octocat/app/collaborators/secagent';
    expect(
      (await call(t, agentPath, { cookie: admin, method: 'PUT' })).status
    ).toBe(400);
    await run(
      t,
      'INSERT INTO repository_collaborators (repository_id, user_id, created_at) VALUES (?, ?, 0)',
      repoId,
      agent.id
    );
    expect(
      (await call(t, agentPath, { cookie: admin, method: 'DELETE' })).status
    ).toBe(200);
    expect(await grant(t)).toEqual(previous);
    expect(await audits(t)).toEqual([
      expect.objectContaining({
        action: 'collaborator.removed',
        target: 'secagent',
      }),
    ]);
  });

  it.each(['PUT', 'DELETE'])('PAT不能替代%s浏览器证明', async (method) => {
    const { t, admin } = await world();
    const issued = await call(t, '/api/tokens', {
      cookie: admin,
      json: { name: 'test', scope: 'write' },
    });
    expect(issued.status).toBe(201);
    const body = (await issued.json()) as { plaintext: string };
    expect(body.plaintext).toEqual(expect.any(String));
    const response = await call(t, path, {
      method,
      headers: { Authorization: `Bearer ${body.plaintext}` },
    });
    expect([401, 403]).toContain(response.status);
    expect(await grant(t)).toEqual([]);
    expect(await audits(t)).toEqual([]);
  });
});

describe('协作者的迟到请求不得以旧权限写入或冒充成功', () => {
  const mutations = [
    [
      '退出会话',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(w.t, 'DELETE FROM sessions WHERE id = ?', w.sessionId),
    ],
    [
      '封禁操作者',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(w.t, 'UPDATE users SET banned = 1 WHERE id = ?', w.adminId),
    ],
    [
      'credential generation改变',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(
          w.t,
          'UPDATE users SET auth_version = auth_version + 1 WHERE id = ?',
          w.adminId
        ),
    ],
    [
      '近期证明过期',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(
          w.t,
          'UPDATE sessions SET auth_time = ? WHERE id = ?',
          Date.now() - RECENT_AUTHENTICATION_MS - 10000,
          w.sessionId
        ),
    ],
    [
      '目标用户重命名',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(
          w.t,
          "UPDATE users SET username = 'renamed' WHERE id = ?",
          w.memberId
        ),
    ],
    [
      '仓库移交',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(
          w.t,
          'UPDATE repositories SET owner_id = ? WHERE id = ?',
          w.memberId,
          w.repoId
        ),
    ],
    [
      '仓库改名',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(
          w.t,
          "UPDATE repositories SET name = 'renamed' WHERE id = ?",
          w.repoId
        ),
    ],
    [
      '其他ACL变更',
      async (w: Awaited<ReturnType<typeof world>>) =>
        run(
          w.t,
          "UPDATE users SET username = 'renamed-owner' WHERE id = ?",
          w.adminId
        ),
    ],
  ] as const;

  for (const method of ['PUT', 'DELETE']) {
    it.each(mutations)(
      `${method}读目标后%s，拒绝且无成功审计`,
      async (_name, mutate) => {
        const w = await world();
        if (method === 'DELETE')
          await run(
            w.t,
            'INSERT INTO repository_collaborators (repository_id, user_id, created_at) VALUES (?, ?, 0)',
            w.repoId,
            w.memberId
          );
        const before = await grant(w.t);
        const hold = holdTarget();
        const pending = call(w.t, path, { cookie: w.admin, method });
        try {
          await enteredBeforeResponse(hold.entered, pending);
          await mutate(w);
        } finally {
          hold.release();
        }
        const response = await pending;
        expect(response.status).toBe(409);
        expect(await response.json()).not.toHaveProperty('code');
        expect(await grant(w.t)).toEqual(before);
        expect(await audits(w.t)).toEqual([]);
      }
    );
  }

  it.each(['PUT', 'DELETE'])(
    '无变化%s遇到会话撤销也不能返回200',
    async (method) => {
      const w = await world();
      if (method === 'PUT')
        await run(
          w.t,
          'INSERT INTO repository_collaborators (repository_id, user_id, created_at) VALUES (?, ?, 0)',
          w.repoId,
          w.memberId
        );
      const before = await grant(w.t);
      const hold = holdTarget();
      const pending = call(w.t, path, { cookie: w.admin, method });
      try {
        await enteredBeforeResponse(hold.entered, pending);
        await run(w.t, 'DELETE FROM sessions WHERE id = ?', w.sessionId);
      } finally {
        hold.release();
      }
      expect((await pending).status).toBe(409);
      expect(await grant(w.t)).toEqual(before);
      expect(await audits(w.t)).toEqual([]);
    }
  );

  it.each(['PUT', 'DELETE'])(
    '并发%s只允许同一ACL代数的一次变动，另一个返回409',
    async (method) => {
      const w = await world();
      if (method === 'DELETE')
        await run(
          w.t,
          'INSERT INTO repository_collaborators (repository_id, user_id, created_at) VALUES (?, ?, 0)',
          w.repoId,
          w.memberId
        );
      const before = await generation(w.t);
      const hold = holdTarget(2);
      const requests = [1, 2].map(() =>
        call(w.t, path, { cookie: w.admin, method })
      );
      try {
        await enteredBeforeResponse(hold.entered, ...requests);
      } finally {
        hold.release();
      }
      expect(
        (await Promise.all(requests)).map((response) => response.status).sort()
      ).toEqual([200, 409]);
      expect(await generation(w.t)).toBe(before! + 1);
      expect(await grant(w.t)).toHaveLength(method === 'PUT' ? 1 : 0);
      expect(await audits(w.t)).toHaveLength(1);
    }
  );
});
