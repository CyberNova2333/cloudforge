// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import {
  accessControlState,
  namespaceClaims,
  teams,
} from '../../db/app.schema';
import { users } from '../../db/auth.schema';
import { schema } from '../../db/schema';
import { getTeam } from '../../repositories/service';
import * as namespaces from '../../members/namespaces';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';
import { newAgent } from '../helpers/agents';

afterEach(() => vi.restoreAllMocks());
const createTeam = (t: TestEnv, admin: string, slug: string, name = slug) =>
  call(t, '/api/team', { cookie: admin, method: 'PUT', json: { slug, name } });
const createNativeUser = (t: TestEnv, admin: string, username: string) =>
  call(t, '/api/auth/admin/create-user', {
    cookie: admin,
    json: {
      name: 'Private profile marker',
      email: `${username}@example.com`,
      password: 'password123',
      data: { username },
    },
  });
async function world() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  return { t, admin, db: drizzle(t.env.DB, { schema }) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
/** Pause after the real D1 namespace pre-read, leaving the final SQL guard to decide the race. */
function holdNamespace(name: string) {
  const entered = deferred();
  const release = deferred();
  const original = namespaces.namespaceTaken;
  let held = false;
  const spy = vi
    .spyOn(namespaces, 'namespaceTaken')
    .mockImplementation(async (...args) => {
      const taken = await original(...args);
      if (!held && args[1].toLowerCase() === name && !taken) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return taken;
    });
  return {
    entered: entered.promise,
    release: release.resolve,
    restore: () => spy.mockRestore(),
  };
}
function holdTwoNamespaces(names: string[]) {
  const entered = deferred();
  const release = deferred();
  const original = namespaces.namespaceTaken;
  const seen = new Set<string>();
  const spy = vi
    .spyOn(namespaces, 'namespaceTaken')
    .mockImplementation(async (...args) => {
      const taken = await original(...args);
      if (names.includes(args[1]) && !taken && !seen.has(args[1])) {
        seen.add(args[1]);
        if (seen.size === 2) entered.resolve();
        await release.promise;
      }
      return taken;
    });
  return {
    entered: entered.promise,
    release: release.resolve,
    restore: () => spy.mockRestore(),
  };
}

async function enteredBeforeResponse(
  entered: Promise<void>,
  ...attempts: Promise<Response>[]
) {
  await Promise.race([
    entered,
    ...attempts.map(async (pending) => {
      const response = await pending;
      throw new Error(
        `Request ended before the namespace barrier: ${response.status}`
      );
    }),
  ]);
}

describe('兼容schema的稳定团队与命名空间入口', () => {
  it('没有共享团队时返回null；创建后使用稳定指针并保持旧DTO', async () => {
    const { t, admin, db } = await world();
    expect(await getTeam(db)).toBeNull();
    expect(
      await (await call(t, '/api/team', { cookie: admin })).json()
    ).toEqual({ team: null });
    const result = await createTeam(t, admin, 'shared');
    expect(result.status).toBe(200);
    const body = (await result.json()) as { team: { id: string } };
    expect(Object.keys(body.team).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'slug',
    ]);
    const state = (await db.select().from(accessControlState).get())!;
    expect(state.legacySharedTeamId).toBe(body.team.id);
    expect((await getTeam(db))?.id).toBe(body.team.id);
    const repeat = await createTeam(t, admin, 'renamed');
    expect(repeat.status).toBe(200);
    expect((await getTeam(db))?.id).toBe(body.team.id);
    expect(await db.select().from(teams).all()).toHaveLength(1);
  });

  it('首次并发创建不同共享团队时只能原子占用一个稳定id，败者409', async () => {
    const { t, admin, db } = await world();
    const hold = holdTwoNamespaces(['first-team', 'second-team']);
    const attempts = [
      createTeam(t, admin, 'first-team'),
      createTeam(t, admin, 'second-team'),
    ];
    try {
      await enteredBeforeResponse(hold.entered, ...attempts);
      hold.release();
      const responses = await Promise.all(attempts);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const rows = await db.select().from(teams).all();
      expect(rows).toHaveLength(1);
      expect(
        (await db.select().from(accessControlState).get())!.legacySharedTeamId
      ).toBe(rows[0].id);
      expect((await getTeam(db))?.id).toBe(rows[0].id);
    } finally {
      hold.release();
      hold.restore();
      await Promise.allSettled(attempts);
    }
  });

  it('两个旧revision的改名请求只提交一次，避免迟到覆盖并返回409', async () => {
    const { t, admin, db } = await world();
    expect((await createTeam(t, admin, 'initial')).status).toBe(200);
    const before = (await getTeam(db))!;
    const hold = holdTwoNamespaces(['first-name', 'second-name']);
    const attempts = [
      createTeam(t, admin, 'first-name'),
      createTeam(t, admin, 'second-name'),
    ];
    try {
      await enteredBeforeResponse(hold.entered, ...attempts);
      hold.release();
      const responses = await Promise.all(attempts);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const after = (await getTeam(db))!;
      expect(after.id).toBe(before.id);
      expect(after.revision).toBe(before.revision + 1);
      expect(
        (
          await db
            .select()
            .from(namespaceClaims)
            .where(eq(namespaceClaims.kind, 'team'))
            .all()
        ).map((claim) => claim.slug)
      ).toEqual([after.slug]);
      const revision = after.revision;
      expect((await createTeam(t, admin, after.slug, after.name)).status).toBe(
        200
      );
      expect((await getTeam(db))!.revision).toBe(revision);
    } finally {
      hold.release();
      hold.restore();
      await Promise.allSettled(attempts);
    }
  });

  it('拒绝原生管理员创建与团队同名的用户，不留下账号或秘密错误', async () => {
    const { t, admin, db } = await world();
    expect((await createTeam(t, admin, 'shared')).status).toBe(200);
    const response = await createNativeUser(t, admin, 'SHARED');
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).not.toMatch(
      /Private profile marker|password123|SQLITE|INSERT INTO/
    );
    expect(
      (await db.select().from(users).all()).map((person) => person.username)
    ).toEqual(['octocat']);
    expect(
      (
        await db
          .select()
          .from(namespaceClaims)
          .where(eq(namespaceClaims.slug, 'shared'))
          .get()
      )?.kind
    ).toBe('team');
  });

  it('用户创建预读后被团队抢占时，最终SQL拒绝且原生API映射409', async () => {
    const { t, admin, db } = await world();
    const hold = holdNamespace('claimed');
    const attempt = createNativeUser(t, admin, 'claimed');
    try {
      await enteredBeforeResponse(hold.entered, attempt);
      expect((await createTeam(t, admin, 'claimed')).status).toBe(200);
      hold.release();
      const response = await attempt;
      expect(response.status).toBe(409);
      expect(await response.text()).not.toMatch(
        /Private profile marker|password123|SQLITE|INSERT INTO/
      );
      expect(
        (await db.select().from(users).all()).map((person) => person.username)
      ).toEqual(['octocat']);
    } finally {
      hold.release();
      hold.restore();
      await Promise.allSettled([attempt]);
    }
  });

  it('用户改名预读后被团队抢占时，保留原用户名并返回409', async () => {
    const { t, admin, db } = await world();
    const bob = await addMember(t, admin, 'bob');
    const hold = holdNamespace('claimed');
    const attempt = call(t, '/api/auth/update-user', {
      cookie: bob,
      json: { username: 'claimed' },
    });
    try {
      await enteredBeforeResponse(hold.entered, attempt);
      expect((await createTeam(t, admin, 'claimed')).status).toBe(200);
      hold.release();
      expect((await attempt).status).toBe(409);
      expect(
        (await db.select().from(users).where(eq(users.username, 'bob')).get())
          ?.username
      ).toBe('bob');
      expect(
        (
          await db
            .select()
            .from(namespaceClaims)
            .where(eq(namespaceClaims.slug, 'bob'))
            .get()
        )?.kind
      ).toBe('user');
    } finally {
      hold.release();
      hold.restore();
      await Promise.allSettled([attempt]);
    }
  });

  it('团队创建预读后被用户抢占时返回409，稳定团队仍为null', async () => {
    const { t, admin, db } = await world();
    const hold = holdNamespace('claimed');
    const attempt = createTeam(t, admin, 'claimed');
    try {
      await enteredBeforeResponse(hold.entered, attempt);
      expect((await createNativeUser(t, admin, 'claimed')).status).toBe(200);
      hold.release();
      expect((await attempt).status).toBe(409);
      expect(await getTeam(db)).toBeNull();
      expect(
        (
          await db
            .select()
            .from(namespaceClaims)
            .where(eq(namespaceClaims.slug, 'claimed'))
            .get()
        )?.kind
      ).toBe('user');
    } finally {
      hold.release();
      hold.restore();
      await Promise.allSettled([attempt]);
    }
  });

  it('null用户名不占claim，真实底层改名/清空/删除保持派生claim一致', async () => {
    const { db } = await world();
    const id = crypto.randomUUID();
    await db.insert(users).values({
      id,
      name: 'Pending',
      email: 'pending@example.com',
      username: null,
    });
    const claims = () =>
      db
        .select()
        .from(namespaceClaims)
        .where(eq(namespaceClaims.subjectId, id))
        .all();
    expect(await claims()).toEqual([]);
    await db.update(users).set({ username: 'Pending' }).where(eq(users.id, id));
    expect((await claims()).map((claim) => claim.slug)).toEqual(['pending']);
    expect(await namespaces.namespaceTaken(db, 'PENDING', { userId: id })).toBe(
      false
    );
    expect(await namespaces.namespaceTaken(db, 'pending')).toBe(true);
    await db.update(users).set({ username: null }).where(eq(users.id, id));
    expect(await claims()).toEqual([]);
    await db.update(users).set({ username: 'again' }).where(eq(users.id, id));
    await db.delete(users).where(eq(users.id, id));
    expect(await claims()).toEqual([]);
  });

  it('正常Agent配置仓库和创建者write保持，软删除仍保留命名空间', async () => {
    const { t, admin, db } = await world();
    const reviewer = await newAgent(t, admin, 'reviewer');
    expect(
      (
        await db
          .select()
          .from(namespaceClaims)
          .where(eq(namespaceClaims.slug, 'reviewer'))
          .get()
      )?.subjectId
    ).toBe(reviewer.id);
    expect(
      (await call(t, '/api/repos/reviewer/reviewer', { cookie: admin })).status
    ).toBe(200);
    const response = await call(t, '/api/admin/agents/reviewer', {
      cookie: admin,
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    expect(await namespaces.namespaceTaken(db, 'REVIEWER')).toBe(true);
    expect(
      (await db.select().from(users).where(eq(users.id, reviewer.id)).get())?.id
    ).toBe(reviewer.id);
  });

  it('新增SQL错误映射不改变普通成员的管理员入口拒绝', async () => {
    const { t, admin } = await world();
    const bob = await addMember(t, admin, 'bob');
    expect((await createTeam(t, bob, 'forbidden')).status).toBe(403);
    expect((await createNativeUser(t, bob, 'forbidden')).status).toBe(403);
  });

  it('仅识别声明触发器的约束原因，不把SQL参数文本/缺state/普通故障当409', () => {
    expect(
      namespaces.isNamespaceConflict(
        new Error('D1_ERROR: CloudForge namespace conflict: SQLITE_CONSTRAINT')
      )
    ).toBe(true);
    expect(
      namespaces.isNamespaceConflict(
        new Error(
          'D1_ERROR: CloudForge namespace conflict: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)'
        )
      )
    ).toBe(true);
    expect(
      namespaces.isLegacyTeamConflict(
        new Error('outer', {
          cause: new Error(
            'D1_ERROR: CloudForge legacy team conflict: SQLITE_CONSTRAINT_TRIGGER'
          ),
        })
      )
    ).toBe(true);
    for (const message of [
      'CloudForge access state missing',
      'Failed query params: CloudForge namespace conflict',
      'D1_ERROR: database unavailable',
      'UNIQUE constraint failed: users.email',
    ]) {
      expect(namespaces.isNamespaceConflict(new Error(message))).toBe(false);
      expect(namespaces.isLegacyTeamConflict(new Error(message))).toBe(false);
    }
  });
});
