import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { agents, aiDelegations } from '../../db/app.schema';
import { users } from '../../db/auth.schema';
import { schema } from '../../db/schema';
import { addMember, bootstrapAdmin, call, makeEnv } from '../helpers/app';

async function fixture() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const bob = await addMember(t, admin, 'bob');
  const db = drizzle(t.env.DB, { schema });
  const handles = Array.from({ length: 120 }, (_, i) => `delegate-agent-${i}`);
  const now = new Date();
  const userInserts = handles.map((handle) =>
    db.insert(users).values({
      id: handle,
      username: handle,
      name: handle,
      email: `${handle}@agents.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  );
  await db.batch([userInserts[0], ...userInserts.slice(1)]);
  const agentInserts = handles.map((handle) =>
    db.insert(agents).values({
      userId: handle,
      name: handle,
      triggerAsk: 'Review this change?',
      triggerAbove: 0.5,
      createdAt: now,
    })
  );
  await db.batch([agentInserts[0], ...agentInserts.slice(1)]);
  const set = (cookie: string, selected: string[]) =>
    call(t, '/api/me/delegations', {
      cookie,
      method: 'PUT',
      json: { agents: selected },
    });
  const saved = async (cookie: string) => {
    const response = await call(t, '/api/me/delegations', { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      agents: { handle: string; delegated: boolean }[];
    };
    return body.agents
      .filter((a) => a.delegated)
      .map((a) => a.handle)
      .sort();
  };
  return { t, db, admin, bob, handles, set, saved };
}

describe('D1 参数边界上的委托集合', () => {
  it.each([100, 120])(
    '替换 %i 个有效智能体，并在缩减或清空时保留其他用户的数据',
    async (count) => {
      const { admin, bob, handles, set, saved } = await fixture();
      const other = [handles[0], handles[119]];
      expect((await set(bob, other)).status).toBe(200);
      const selected = handles.slice(0, count);
      const response = await set(admin, selected);
      expect(response.status, await response.text()).toBe(200);
      expect(await saved(admin)).toEqual([...selected].sort());
      // Keeping 100 agents also exercises the user ID in the DELETE predicate.
      const retained = selected.slice(0, 100);
      expect((await set(admin, retained)).status).toBe(200);
      expect(await saved(admin)).toEqual([...retained].sort());
      expect(await saved(bob)).toEqual([...other].sort());
      expect((await set(admin, [])).status).toBe(200);
      expect(await saved(admin)).toEqual([]);
      expect(await saved(bob)).toEqual([...other].sort());
    }
  );

  it('拒绝缺失、已删除或受保护智能体，且不更改现有委托', async () => {
    const { db, admin, handles, set, saved } = await fixture();
    const original = [handles[0], handles[1]];
    expect((await set(admin, original)).status).toBe(200);
    expect(
      (await set(admin, [...handles.slice(0, 119), 'missing-agent'])).status
    ).toBe(400);
    expect(await saved(admin)).toEqual(original);
    await db
      .update(agents)
      .set({ deletedAt: new Date() })
      .where(eq(agents.userId, handles[119]));
    expect((await set(admin, handles)).status).toBe(400);
    expect(await saved(admin)).toEqual(original);
    await db
      .update(agents)
      .set({ deletedAt: null, guarded: true })
      .where(eq(agents.userId, handles[119]));
    expect((await set(admin, handles)).status).toBe(422);
    expect(await saved(admin)).toEqual(original);
  });

  it('后续 INSERT 失败时回滚替换操作中的 DELETE', async () => {
    const { t, db, admin, bob, handles, set, saved } = await fixture();
    const original = [handles[119]];
    expect((await set(admin, original)).status).toBe(200);
    expect((await set(bob, original)).status).toBe(200);
    const before = await db.select().from(aiDelegations);
    await t.env.DB.prepare(
      `CREATE TRIGGER reject_delegation_insert BEFORE INSERT ON ai_delegations
      WHEN NEW.agent_id = 'delegate-agent-99' BEGIN SELECT RAISE(ABORT, 'injected delegation insert failure'); END`
    ).run();
    try {
      expect((await set(admin, handles.slice(0, 100))).status).toBe(500);
      expect(await db.select().from(aiDelegations)).toEqual(before);
      expect(await saved(admin)).toEqual(original);
      expect(await saved(bob)).toEqual(original);
    } finally {
      await t.env.DB.prepare('DROP TRIGGER reject_delegation_insert').run();
    }
    // The same replacement succeeds after removing only the injected failure.
    expect((await set(admin, handles.slice(0, 100))).status).toBe(200);
    expect(await saved(admin)).toEqual(handles.slice(0, 100).sort());
    expect(await saved(bob)).toEqual(original);
  });
});
