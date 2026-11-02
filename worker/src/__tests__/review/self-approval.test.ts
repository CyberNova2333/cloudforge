import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import { decideFinding } from '../../review/delegate';
import { autoMergeStatus } from '../../review/auto-merge';
import { findRepo, gitFor } from '../../repositories/service';
import { pullRequests } from '../../db/app.schema';
import { eq } from 'drizzle-orm';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from '../helpers/app';
import { commitPaths } from '../helpers/seed';
import {
  collaborate,
  fakeDecider,
  flagCall,
  flagState,
  questionedPull,
  userId,
} from '../helpers/findings';
import { invitedAgent } from '../helpers/reviews';

/** worker/test/setup.ts lets authors decide for most tests; these test the instance default (off). */
const byDefault = async (t: TestEnv) => {
  await t.env.DB.prepare(
    "DELETE FROM instance_settings WHERE key = 'review.allow_self_approval'"
  ).run();
};

const db = (t: TestEnv) => drizzle(t.env.DB, { schema });

/** octocat/app with alice as a collaborator, and alice's pull request #1 from `feature`. */
async function alicesPull() {
  const t = makeEnv();
  await byDefault(t);
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', visibility: 'internal' },
  });
  const alice = await addMember(t, admin, 'alice');
  await collaborate(t, admin, 'alice');
  const repo = [...t.fake.repos.values()][0];
  const main = await commitPaths(repo, 'main', { 'a.txt': 'one\n' }, 'base');
  repo.refs.set('refs/heads/feature', main);
  await commitPaths(repo, 'feature', { 'a.txt': 'two\n' }, 'Two');
  const res = await call(t, '/api/repos/octocat/app/pulls', {
    cookie: alice,
    json: { title: 'Two', body: '', base: 'main', head: 'feature' },
  });
  expect(res.status).toBe(201);
  await settle(t);
  return { t, admin, alice, repo };
}

const approve = (t: TestEnv, cookie: string) =>
  call(t, '/api/repos/octocat/app/pulls/1/approval', {
    cookie,
    method: 'POST',
  });
const detail = async (t: TestEnv, cookie: string) =>
  (await (
    await call(t, '/api/repos/octocat/app/pulls/1', { cookie })
  ).json()) as {
    canApprove: boolean;
  };

describe('作者不能批准自己的拉取请求（默认）', () => {
  it('作者批准自己的 PR 被拒绝，另一位有推送权限的人批准后可以合并', async () => {
    const { t, admin, alice } = await alicesPull();
    expect((await detail(t, alice)).canApprove).toBe(false);
    expect((await detail(t, admin)).canApprove).toBe(true);
    expect((await approve(t, alice)).status).toBe(403);
    const before = await call(t, '/api/repos/octocat/app/pulls/1/merge', {
      cookie: alice,
      json: {},
    });
    expect(before.status).toBe(409);
    expect((await approve(t, admin)).status).toBe(200);
    const merged = await call(t, '/api/repos/octocat/app/pulls/1/merge', {
      cookie: alice,
      json: {},
    });
    expect(merged.status).toBe(200);
  });

  it('站点设置允许后，作者可以批准自己的 PR', async () => {
    const { t, admin, alice } = await alicesPull();
    const set = await call(
      t,
      '/api/admin/settings/review.allow_self_approval',
      { cookie: admin, method: 'PUT', json: { value: true } }
    );
    expect(set.status).toBe(200);
    expect((await detail(t, alice)).canApprove).toBe(true);
    expect((await approve(t, alice)).status).toBe(200);
  });

  it('作者不能批准或驳回自己 PR 上的意见，但可以请求修改；其他人可以批准', async () => {
    const { t, admin, person, change } = await questionedPull({
      beforeReview: ({ t }) => byDefault(t),
    });
    // octocat opened the pull request.
    expect((await flagCall(t, admin, person.id, 'approve', {})).status).toBe(
      403
    );
    expect((await flagCall(t, admin, change.id, 'approve', {})).status).toBe(
      403
    );
    expect(
      (
        await flagCall(t, admin, person.id, 'request-changes', {
          note: 'Please check the currency.',
        })
      ).status
    ).toBe(200);
    const bob = await addMember(t, admin, 'bob');
    await collaborate(t, admin, 'bob');
    expect((await flagCall(t, bob, person.id, 'approve', {})).status).toBe(200);
    expect((await flagState(t, person.id))!.approved_by_id).toBe(
      await userId(t, 'bob')
    );
  });

  it('CloudForge AI 不会替作者决定其自己 PR 上的意见，也不调用模型', async () => {
    const { t, person } = await questionedPull({
      beforeReview: ({ t }) => byDefault(t),
    });
    const decider = fakeDecider();
    const result = await decideFinding(
      t.env,
      db(t),
      person.id,
      await userId(t),
      { model: decider.model, after: (w) => t.ctx.waitUntil(w) }
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(decider.calls).toHaveLength(0);
    expect((await flagState(t, person.id))!.approved_at).toBeNull();
  });
});

describe('失去推送权限后不能再推进自己的拉取请求', () => {
  it('被移除的协作者仍可修改标题，但不能关闭或重新打开', async () => {
    const { t, admin, alice } = await alicesPull();
    await call(t, '/api/repos/octocat/app/collaborators/alice', {
      cookie: admin,
      method: 'DELETE',
    });
    const patch = (json: unknown) =>
      call(t, '/api/repos/octocat/app/pulls/1', {
        cookie: alice,
        method: 'PATCH',
        json,
      });
    expect((await patch({ title: 'Better title' })).status).toBe(200);
    expect((await patch({ state: 'closed' })).status).toBe(403);
    expect((await patch({ versionBump: 'minor' })).status).toBe(403);
    await call(t, '/api/repos/octocat/app/pulls/1', {
      cookie: admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect((await patch({ state: 'open' })).status).toBe(403);
  });

  it('作者不再有推送权限时，自动合并会停下', async () => {
    const { t, admin } = await alicesPull();
    await invitedAgent(t, admin);
    const status = async () => {
      const found = (await findRepo(db(t), 'octocat', 'app'))!;
      const pr = (await db(t)
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.number, 1))
        .get())!;
      return autoMergeStatus(t.env, db(t), gitFor(t.env, found.repo), pr);
    };
    const reason = 'Its author can no longer push to this repository';
    const before = await status();
    expect('reasons' in before && before.reasons).not.toContain(reason);
    await call(t, '/api/repos/octocat/app/collaborators/alice', {
      cookie: admin,
      method: 'DELETE',
    });
    const after = await status();
    expect(after).toMatchObject({ state: 'blocked' });
    expect('reasons' in after && after.reasons).toContain(reason);
  });
});
