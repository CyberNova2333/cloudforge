// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { pullRequests } from '../../db/app.schema';
import type { DrizzleDB } from '../../db/middleware';
import { schema } from '../../db/schema';
import {
  decideFlag,
  undoFlag,
  type FlagDecision,
  type FlagDecisionOpts,
} from '../../review/flags';
import { addMember, settle, type TestEnv } from '../helpers/app';
import {
  collaborate,
  findingAudit,
  flagState,
  questionedPull,
  userId,
} from '../helpers/findings';

afterEach(() => vi.useRealTimers());

/** Keep genuine D1 reads/writes; schedule the competing decision immediately before the undo UPDATE. */
function beforeUndoWrite(
  db: DrizzleDB,
  compete: () => Promise<void>
): DrizzleDB {
  let scheduled = false;
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key !== 'update' || scheduled)
        return Reflect.get(target, key, receiver);
      return (table: Parameters<DrizzleDB['update']>[0]) => {
        scheduled = true;
        return {
          set: (values: unknown) => ({
            where: (where: unknown) => ({
              returning: async (fields: unknown) => {
                await compete();
                return target
                  .update(table)
                  .set(values as never)
                  .where(where as never)
                  .returning(fields as never);
              },
            }),
          }),
        };
      };
    },
  });
}

async function fixture() {
  const q = await questionedPull();
  await addMember(q.t, q.admin, 'bob');
  await addMember(q.t, q.admin, 'carol');
  await collaborate(q.t, q.admin, 'bob');
  await collaborate(q.t, q.admin, 'carol');
  const db = drizzle(q.t.env.DB, { schema });
  const pr = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  const bob = await userId(q.t, 'bob');
  const carol = await userId(q.t, 'carol');
  const now = Date.now();
  // Only Date is frozen: network/D1 and all scheduling remain real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const after = (work: Promise<unknown>) => void q.t.waits.push(work);
  const decide = (
    actor: string,
    decision: FlagDecision,
    opts?: FlagDecisionOpts
  ) => decideFlag(q.t.env, db, pr, q.person.id, actor, decision, after, opts);
  const undo = (actor = bob, handle: DrizzleDB = db) =>
    undoFlag(q.t.env, handle, pr, q.person.id, actor, after);
  return { ...q, db, pr, bob, carol, after, decide, undo };
}

const stale = {
  ok: false,
  status: 409,
  error: 'The decision changed since you looked',
};
const undoAudit = async (t: TestEnv) =>
  (await findingAudit(t)).filter((entry) => entry.action === 'finding.undone');

describe('撤销审查决策的写点快照围栏', () => {
  it('同秒他人替换修改要求，旧撤销不能清除新决策或写成功审计', async () => {
    const { t, db, person, bob, carol, decide, undo } = await fixture();
    expect(
      await decide(bob, { kind: 'request_changes', note: 'first' })
    ).toEqual({ ok: true });
    const original = (await flagState(t, person.id))!;
    let replacement;
    const result = await undo(
      bob,
      beforeUndoWrite(db, async () => {
        expect(
          await decide(carol, {
            kind: 'request_changes',
            note: 'replacement',
            teach: 'new teaching',
          })
        ).toEqual({ ok: true });
        replacement = await flagState(t, person.id);
        expect(replacement).toMatchObject({
          changes_requested_by_id: carol,
          changes_requested_at: original.changes_requested_at,
        });
      })
    );
    await settle(t);
    expect(result).toEqual(stale);
    expect(await flagState(t, person.id)).toEqual(replacement);
    expect(await undoAudit(t)).toEqual([]);
  });

  it('同秒撤销后他人重新批准，迟到的旧撤销不能清除他人的批准', async () => {
    const { t, db, person, bob, carol, decide, undo } = await fixture();
    expect(await decide(bob, { kind: 'approve', reason: 'first' })).toEqual({
      ok: true,
    });
    const original = (await flagState(t, person.id))!;
    let replacement;
    const result = await undo(
      bob,
      beforeUndoWrite(db, async () => {
        expect(await undo()).toEqual({ ok: true });
        expect(
          await decide(
            carol,
            { kind: 'approve', reason: 'replacement', teach: 'keep' },
            { via: 'Moderator' }
          )
        ).toEqual({ ok: true });
        replacement = await flagState(t, person.id);
        expect(replacement).toMatchObject({
          approved_by_id: carol,
          approved_at: original.approved_at,
        });
      })
    );
    await settle(t);
    expect(result).toEqual(stale);
    expect(await flagState(t, person.id)).toEqual(replacement);
    expect(await undoAudit(t)).toHaveLength(1);
  });

  it.each([
    ['note', { kind: 'request_changes', note: 'new note' }, undefined],
    [
      'teach',
      { kind: 'request_changes', note: 'first', teach: 'new teaching' },
      undefined,
    ],
    ['via', { kind: 'request_changes', note: 'first' }, { via: 'Moderator' }],
  ] as const)(
    '同决策者同秒更改 %s 也使旧撤销失效',
    async (_field, decision, opts) => {
      const { t, db, person, bob, decide, undo } = await fixture();
      expect(
        await decide(bob, { kind: 'request_changes', note: 'first' })
      ).toEqual({ ok: true });
      const original = (await flagState(t, person.id))!;
      let replacement;
      const result = await undo(
        bob,
        beforeUndoWrite(db, async () => {
          expect(await decide(bob, decision, opts)).toEqual({ ok: true });
          replacement = await flagState(t, person.id);
          expect(replacement).toMatchObject({
            changes_requested_by_id: bob,
            changes_requested_at: original.changes_requested_at,
          });
        })
      );
      await settle(t);
      expect(result).toEqual(stale);
      expect(await flagState(t, person.id)).toEqual(replacement);
      expect(await undoAudit(t)).toEqual([]);
    }
  );

  it('对立决策在旧读取后生效，不能被原修改要求撤销', async () => {
    const { t, db, person, bob, carol, decide, undo } = await fixture();
    expect(
      await decide(bob, { kind: 'request_changes', note: 'first' })
    ).toEqual({ ok: true });
    let replacement;
    const result = await undo(
      bob,
      beforeUndoWrite(db, async () => {
        expect(await decide(carol, { kind: 'approve' })).toEqual({ ok: true });
        replacement = await flagState(t, person.id);
        expect(replacement).toMatchObject({
          approved_by_id: carol,
          changes_requested_at: null,
        });
      })
    );
    await settle(t);
    expect(result).toEqual(stale);
    expect(await flagState(t, person.id)).toEqual(replacement);
    expect(await undoAudit(t)).toEqual([]);
  });

  it('控制组：下一秒的决策替换仍然拒绝旧撤销', async () => {
    const { t, db, person, bob, carol, decide, undo } = await fixture();
    expect(
      await decide(bob, { kind: 'request_changes', note: 'first' })
    ).toEqual({ ok: true });
    const original = (await flagState(t, person.id))!;
    const result = await undo(
      bob,
      beforeUndoWrite(db, async () => {
        vi.setSystemTime(Date.now() + 1000);
        expect(
          await decide(carol, { kind: 'request_changes', note: 'later' })
        ).toEqual({ ok: true });
        expect(
          (await flagState(t, person.id))!.changes_requested_at
        ).toBeGreaterThan(original.changes_requested_at!);
      })
    );
    await settle(t);
    expect(result).toEqual(stale);
    expect((await flagState(t, person.id))!.changes_requested_by_id).toBe(
      carol
    );
  });

  it('不加调度钩子的并发替换与撤销也保留他人的决策', async () => {
    const { t, person, bob, carol, decide, undo } = await fixture();
    expect(await decide(bob, { kind: 'request_changes' })).toEqual({
      ok: true,
    });
    const [replacement, result] = await Promise.all([
      decide(carol, { kind: 'request_changes', note: 'new' }),
      undo(),
    ]);
    await settle(t);
    expect(replacement).toEqual({ ok: true });
    expect(
      result.ok || (!result.ok && [403, 409].includes(result.status))
    ).toBe(true);
    expect(await flagState(t, person.id)).toMatchObject({
      changes_requested_by_id: carol,
      changes_requested_note: 'new',
    });
  });

  it('读取后PR关闭也拒绝旧撤销并保留决策', async () => {
    const { t, db, pr, person, bob, decide, undo } = await fixture();
    expect(await decide(bob, { kind: 'request_changes' })).toEqual({
      ok: true,
    });
    const original = await flagState(t, person.id);
    const result = await undo(
      bob,
      beforeUndoWrite(db, async () => {
        await db
          .update(pullRequests)
          .set({ state: 'closed' })
          .where(eq(pullRequests.id, pr.id));
      })
    );
    await settle(t);
    expect(result).toEqual(stale);
    expect(await flagState(t, person.id)).toEqual(original);
    expect(await undoAudit(t)).toEqual([]);
  });

  it.each(['approve', 'request_changes'] as const)(
    '正常自有 %s 决策仍可撤销，清除附属文字并仅审计一次',
    async (kind) => {
      const { t, person, bob, decide, undo } = await fixture();
      expect(
        await decide(
          bob,
          kind === 'approve'
            ? { kind, reason: 'reason', teach: 'teaching' }
            : { kind, note: 'note', teach: 'teaching' },
          { via: 'Moderator' }
        )
      ).toEqual({ ok: true });
      expect(await undo()).toEqual({ ok: true });
      await settle(t);
      expect(await flagState(t, person.id)).toMatchObject({
        approved_by_id: null,
        approved_at: null,
        approved_via: null,
        changes_requested_by_id: null,
        changes_requested_at: null,
        changes_requested_note: null,
        decision_reason: null,
        teach_note: null,
        teach_by_id: null,
      });
      expect(await undoAudit(t)).toHaveLength(1);
      expect(await undo()).toMatchObject({ ok: false, status: 409 });
      expect(await undoAudit(t)).toHaveLength(1);
    }
  );
});
