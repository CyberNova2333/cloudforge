import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { decideDelegated, decideFinding } from '../review/delegate';
import { addMember, call, settle } from './helpers/app';
import {
  collaborate,
  fakeDecider,
  findingAudit,
  flagState,
  questionedPull,
  userId,
} from './helpers/findings';

describe('授权变更后的 AI 决策', () => {
  it.each(['owner', 'collaborator', 'admin'])(
    '保留当前 %s 的明确决定，无需自动委托',
    async (kind) => {
      const { t, admin, person } = await questionedPull();
      let actor = await userId(t);
      if (kind === 'owner') {
        await t.env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?")
          .bind(actor)
          .run();
      } else {
        await addMember(t, admin, 'bob');
        actor = await userId(t, 'bob');
        if (kind === 'collaborator') await collaborate(t, admin, 'bob');
        else
          await t.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?")
            .bind(actor)
            .run();
      }
      expect(
        await decideFinding(
          t.env,
          drizzle(t.env.DB, { schema }),
          person.id,
          actor,
          {
            model: fakeDecider().model,
            after: (work) => t.ctx.waitUntil(work),
          }
        )
      ).toMatchObject({ ok: true, applied: true });
      await settle(t);
      expect((await flagState(t, person.id))!.approved_by_id).toBe(actor);
    }
  );

  it.each([
    'ban',
    'uninvite',
    'delete-agent',
    'close',
    'remove-collaborator',
    'guard',
  ])('模型运行期间发生 %s 时，不应用其答复', async (change) => {
    const { t, admin, person } = await questionedPull();
    let actor = await userId(t);
    if (change === 'remove-collaborator') {
      await addMember(t, admin, 'bob');
      await collaborate(t, admin, 'bob');
      actor = await userId(t, 'bob');
    }
    const model = fakeDecider(async () => {
      const statements: Record<string, string> = {
        ban: 'UPDATE users SET banned = 1 WHERE id = ?',
        uninvite: 'DELETE FROM repository_agents WHERE agent_id = ?',
        'delete-agent': 'UPDATE agents SET deleted_at = 1 WHERE user_id = ?',
        close:
          "UPDATE pull_requests SET state = 'closed', state_revision = state_revision + 1 WHERE author_id = ?",
        'remove-collaborator':
          'DELETE FROM repository_collaborators WHERE user_id = ?',
        guard: 'UPDATE agents SET guarded = 1 WHERE user_id = ?',
      };
      const target = ['uninvite', 'delete-agent', 'guard'].includes(change)
        ? await userId(t, 'dataagent')
        : actor;
      await t.env.DB.prepare(statements[change]).bind(target).run();
      return {
        decision: 'approve',
        reason: 'A response from before the change.',
      };
    });
    const result = await decideFinding(
      t.env,
      drizzle(t.env.DB, { schema }),
      person.id,
      actor,
      {
        model: model.model,
        after: (work) => t.ctx.waitUntil(work),
      }
    );
    await settle(t);
    expect(result.ok).toBe(false);
    expect((await flagState(t, person.id))!.approved_at).toBeNull();
    expect(await findingAudit(t)).toEqual([]);
  });

  it.each(['approve', 'request_changes'])(
    '模型运行期间撤销自动委托时，阻止 %s',
    async (decision) => {
      const { t, admin, person } = await questionedPull();
      expect(
        (
          await call(t, '/api/me/delegations', {
            cookie: admin,
            method: 'PUT',
            json: { agents: ['dataagent'] },
          })
        ).status
      ).toBe(200);
      const review = await t.env.DB.prepare(
        'SELECT classification_id AS id FROM pr_review_flags WHERE id = ?'
      )
        .bind(person.id)
        .first<{ id: string }>();
      const model = fakeDecider(async () => {
        expect(
          (
            await call(t, '/api/me/delegations', {
              cookie: admin,
              method: 'PUT',
              json: { agents: [] },
            })
          ).status
        ).toBe(200);
        return {
          decision,
          reason: 'A response from before delegation was revoked.',
        };
      });
      const done = await decideDelegated(
        t.env,
        drizzle(t.env.DB, { schema }),
        review!.id,
        { model: model.model }
      );
      await settle(t);
      expect(done).toEqual({ approved: 0, changes: 0, left: 0 });
      expect(await flagState(t, person.id)).toMatchObject({
        approved_at: null,
        changes_requested_at: null,
      });
      expect(await findingAudit(t)).toEqual([]);
    }
  );
});
