// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it, vi } from 'vitest';
import { addMember, bootstrapAdmin, call, makeEnv } from '../helpers/app';
import { app } from '../../index';

async function setup() {
  const t = makeEnv({ actions: true });
  const admin = await bootstrapAdmin(t);
  const member = await addMember(t, admin, 'member');
  const actor = (await (
    await call(t, '/api/auth/get-session', { cookie: admin })
  ).json()) as { session: { id: string } };
  expect(
    (
      await call(t, '/api/auth/reauthenticate', {
        cookie: admin,
        json: { sessionId: actor.session.id, password: 'password123' },
      })
    ).status
  ).toBe(200);
  const target = (await (
    await call(t, '/api/auth/get-session', { cookie: member })
  ).json()) as { user: { id: string } };
  return {
    t,
    admin,
    member,
    memberId: target.user.id,
    sessionId: actor.session.id,
  };
}

const principalRows = (s: Awaited<ReturnType<typeof setup>>) =>
  s.t.env.DB.prepare(
    'SELECT (SELECT count(*) FROM users WHERE id=?1) AS member, (SELECT count(*) FROM accounts WHERE user_id=?1) AS accounts, (SELECT count(*) FROM sessions WHERE user_id=?1) AS sessions'
  )
    .bind(s.memberId)
    .first();

async function insertOwnedRepository(
  s: Awaited<ReturnType<typeof setup>>,
  repoId: string,
  prepare = s.t.env.DB.prepare.bind(s.t.env.DB)
) {
  await prepare(
    "INSERT INTO repositories(id,owner_id,name,artifacts_name,visibility,created_at,updated_at) VALUES (?,?,'raced',?,'internal',?,?)"
  )
    .bind(repoId, s.memberId, 'r_' + repoId, Date.now(), Date.now())
    .run();
}

describe('用户删除的仓库生命周期保护', () => {
  it.each(['personal', 'team'])(
    '原生删除不能级联抹去%s仓库和未停止Actions容量',
    async (kind) => {
      const s = await setup();
      if (kind === 'team')
        expect(
          (
            await call(s.t, '/api/team', {
              method: 'PUT',
              cookie: s.admin,
              json: { name: 'Team', slug: 'group' },
            })
          ).status
        ).toBe(200);
      const created = await call(s.t, '/api/repos', {
        cookie: s.member,
        json: {
          name: 'owned',
          visibility: 'internal',
          ...(kind === 'team' ? { owner: 'team' } : {}),
        },
      });
      expect(created.status).toBe(201);
      const repo = (await created.json()) as { id: string };
      const runId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      await s.t.env.DB.batch([
        s.t.env.DB.prepare(
          "INSERT INTO workflow_runs (id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,status,created_at) VALUES (?,?,1,'.github/workflows/test.yml','test','push','refs/heads/main',?,'test','in_progress',?)"
        ).bind(runId, repo.id, 'a'.repeat(40), Date.now()),
        s.t.env.DB.prepare(
          "INSERT INTO workflow_jobs (id,run_id,job_key,name,runs_on,needs,status) VALUES (?,?,'test','test','ubuntu-latest','[]','in_progress')"
        ).bind(jobId, runId),
      ]);
      const removed = await call(s.t, '/api/auth/admin/remove-user', {
        cookie: s.admin,
        json: { userId: s.memberId },
        headers: { 'X-CloudForge-Session': s.sessionId },
      });
      const remaining = await s.t.env.DB.prepare(
        "SELECT (SELECT count(*) FROM users WHERE id=?1) AS member, (SELECT count(*) FROM repositories WHERE id=?2) AS repo, (SELECT count(*) FROM workflow_jobs WHERE id=?3 AND status='in_progress') AS capacity, (SELECT count(*) FROM repository_deletions WHERE id=?2) AS outbox, (SELECT count(*) FROM accounts WHERE user_id=?1) AS accounts, (SELECT count(*) FROM sessions WHERE user_id=?1) AS sessions"
      )
        .bind(s.memberId, repo.id, jobId)
        .first();
      console.log('native removal lifecycle result', {
        status: removed.status,
        remaining,
        terminated: s.t.actions.terminated.length,
        destroyed: s.t.actions.destroyed.length,
      });
      expect(removed.status).toBe(403);
      expect(await removed.json()).toMatchObject({
        code: 'USER_OWNS_REPOSITORIES',
      });
      expect(remaining).toEqual({
        member: 1,
        repo: 1,
        capacity: 1,
        outbox: 0,
        accounts: 1,
        sessions: 1,
      });
      expect(s.t.actions.terminated).toEqual([]);
      expect(s.t.actions.destroyed).toEqual([]);
    }
  );

  it('无仓库成员仍能原子删除，凭据随用户删除且只记录成功审计', async () => {
    const s = await setup();
    const removed = await call(s.t, '/api/auth/admin/remove-user', {
      cookie: s.admin,
      json: { userId: s.memberId },
      headers: { 'X-CloudForge-Session': s.sessionId },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ success: true });
    expect(await principalRows(s)).toEqual({
      member: 0,
      accounts: 0,
      sessions: 0,
    });
    const audit = await s.t.env.DB.prepare(
      "SELECT target,data FROM audit_events WHERE action='user.deleted'"
    ).first();
    expect(audit).toEqual({ target: s.memberId, data: '{}' });
  });

  it('原生删除保留非管理员、自删和跨Origin拒绝，失败不损坏目标凭据', async () => {
    const s = await setup();
    const memberSession = (await (
      await call(s.t, '/api/auth/get-session', { cookie: s.member })
    ).json()) as { session: { id: string } };
    expect(
      (
        await call(s.t, '/api/auth/admin/remove-user', {
          cookie: s.member,
          json: { userId: s.memberId },
          headers: { 'X-CloudForge-Session': memberSession.session.id },
        })
      ).status
    ).toBe(403);
    const actor = await s.t.env.DB.prepare(
      'SELECT user_id FROM sessions WHERE id=?'
    )
      .bind(s.sessionId)
      .first<{ user_id: string }>();
    expect(
      (
        await call(s.t, '/api/auth/admin/remove-user', {
          cookie: s.admin,
          json: { userId: actor!.user_id },
          headers: { 'X-CloudForge-Session': s.sessionId },
        })
      ).status
    ).toBe(400);
    const crossOrigin = await app.fetch(
      new Request('http://test.local/api/auth/admin/remove-user', {
        method: 'POST',
        headers: {
          cookie: s.admin,
          origin: 'https://other.example',
          'Content-Type': 'application/json',
          'X-CloudForge-Session': s.sessionId,
        },
        body: JSON.stringify({ userId: s.memberId }),
      }),
      s.t.env,
      s.t.ctx
    );
    expect(crossOrigin.status).toBe(403);
    expect(await principalRows(s)).toEqual({
      member: 1,
      accounts: 1,
      sessions: 1,
    });
    expect(
      await s.t.env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='user.deleted'"
      ).first()
    ).toEqual({ n: 0 });
  });

  it('真实D1阻止直接删除仍有仓库的用户且回滚全部凭据级联', async () => {
    const s = await setup();
    const repoId = crypto.randomUUID();
    await insertOwnedRepository(s, repoId);
    await expect(
      s.t.env.DB.prepare('DELETE FROM users WHERE id=?').bind(s.memberId).run()
    ).rejects.toThrow('User still owns repositories');
    expect(await principalRows(s)).toEqual({
      member: 1,
      accounts: 1,
      sessions: 1,
    });
    expect(
      await s.t.env.DB.prepare('SELECT id FROM repositories WHERE id=?')
        .bind(repoId)
        .first()
    ).toEqual({ id: repoId });
  });

  it.each(['repository', 'actor', 'session', 'actor-aba'])(
    '最终写点在预读后%s变化时拒绝，成员账户和会话保持完整',
    async (change) => {
      const s = await setup(),
        repoId = crypto.randomUUID();
      const original = s.t.env.DB.prepare.bind(s.t.env.DB);
      let entered = false;
      // Transparent scheduling barrier: every statement and result still executes against real D1.
      const barrier = vi
        .spyOn(s.t.env.DB, 'prepare')
        .mockImplementation((query) => {
          const stmt = original(query);
          if (query !== 'SELECT 1 FROM repositories WHERE owner_id=? LIMIT 1')
            return stmt;
          return new Proxy(stmt, {
            get(target, key) {
              if (key !== 'bind') {
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return (...values: unknown[]) => {
                const bound = target.bind(...values);
                return new Proxy(bound, {
                  get(actual, name) {
                    if (name === 'first')
                      return async (
                        ...args: Parameters<D1PreparedStatement['first']>
                      ) => {
                        const result = await actual.first(...args);
                        if (!entered) {
                          entered = true;
                          if (change === 'repository')
                            await insertOwnedRepository(s, repoId, original);
                          else if (change === 'actor')
                            await original(
                              "UPDATE users SET role='user' WHERE id=(SELECT user_id FROM sessions WHERE id=?)"
                            )
                              .bind(s.sessionId)
                              .run();
                          else if (change === 'actor-aba') {
                            await original(
                              "UPDATE users SET role='user' WHERE id=(SELECT user_id FROM sessions WHERE id=?)"
                            )
                              .bind(s.sessionId)
                              .run();
                            await original(
                              "UPDATE users SET role='admin' WHERE id=(SELECT user_id FROM sessions WHERE id=?)"
                            )
                              .bind(s.sessionId)
                              .run();
                          } else
                            await original('DELETE FROM sessions WHERE id=?')
                              .bind(s.sessionId)
                              .run();
                        }
                        return result;
                      };
                    const value = Reflect.get(actual, name);
                    return typeof value === 'function'
                      ? value.bind(actual)
                      : value;
                  },
                });
              };
            },
          });
        });
      try {
        const response = await call(s.t, '/api/auth/admin/remove-user', {
          cookie: s.admin,
          json: { userId: s.memberId },
          headers: { 'X-CloudForge-Session': s.sessionId },
        });
        expect(entered).toBe(true);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          code: 'USER_DELETION_CHANGED',
        });
      } finally {
        barrier.mockRestore();
      }
      expect(await principalRows(s)).toEqual({
        member: 1,
        accounts: 1,
        sessions: 1,
      });
      expect(
        await original(
          "SELECT count(*) AS n FROM audit_events WHERE action='user.deleted'"
        ).first()
      ).toEqual({ n: 0 });
      if (change === 'repository')
        expect(
          await original('SELECT id FROM repositories WHERE id=?')
            .bind(repoId)
            .first()
        ).toEqual({ id: repoId });
    }
  );
});
