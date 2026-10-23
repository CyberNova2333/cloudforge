// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import {
  auditEvents,
  landingIntents,
  pullRequests,
  repositories,
} from '../db/app.schema';
import { landPull } from '../merge/land';
import {
  landingReceipt,
  recordLanding,
  recoverLandings,
} from '../merge/landing-recovery';
import { GitPushError } from '../git/remote';
import { findRepoById, gitFor } from '../lib/repos';
import { call, settle } from './helpers/app';
import { appRepo, BASE, openPull } from './helpers/reviews';
import { commitPaths } from './helpers/seed';

async function ready() {
  const { t, admin, repo } = await appRepo();
  const { head } = await openPull(t, admin, repo, { 'change.txt': 'hello\n' });
  const approve = () =>
    call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
  expect((await approve()).status).toBe(200);
  await settle(t);
  const db = drizzle(t.env.DB, { schema });
  const pr = (await db.select().from(pullRequests).get())!;
  const found = (await findRepoById(db, pr.repositoryId))!;
  const tail: Promise<unknown>[] = [];
  const opts = {
    env: t.env,
    db,
    repo: found.repo,
    repoFullName: 'octocat/app',
    git: gitFor(t.env, found.repo),
    pr,
    by: null,
    after: (p: Promise<unknown>) => {
      tail.push(p);
    },
  };
  return {
    t,
    repo,
    db,
    pr,
    head,
    opts,
    approve,
    tail,
    read: () =>
      db.select().from(pullRequests).where(eq(pullRequests.id, pr.id)).get(),
  };
}

it('D1 中止后恢复已确认的 Git 合并，仅产生一条审计和一次后续投递', async () => {
  const f = await ready();
  await f.t.env.DB.exec(
    `CREATE TRIGGER fail_landing BEFORE UPDATE OF state ON pull_requests WHEN NEW.state = 'merged' BEGIN SELECT RAISE(ABORT, 'injected D1 failure'); END;`
  );
  try {
    await expect(landPull(f.opts)).rejects.toThrow('injected D1 failure');
    expect(f.repo.refs.get('refs/heads/main')).toBe(f.head);
    expect((await f.read())!.state).toBe('open');
    const intent = (await f.db.select().from(landingIntents).get())!;
    expect(intent.recordedAt).toBeNull();
    expect(f.repo.refs.get(landingReceipt(1, intent.id))).toBe(f.head);
    expect(
      await f.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'pull.merged'))
    ).toHaveLength(0);
  } finally {
    await f.t.env.DB.exec('DROP TRIGGER fail_landing');
  }
  // Another push may already have advanced the target; recovery must not rewind it or count its commits.
  const advanced = await commitPaths(
    f.repo,
    'main',
    { ...BASE, 'change.txt': 'hello\n', 'later.txt': 'later\n' },
    'Later push'
  );
  const result = await landPull({
    ...f.opts,
    git: gitFor(f.t.env, f.opts.repo),
  });
  expect(result).toEqual({ ok: true, sha: f.head, headSha: f.head });
  await Promise.all(f.tail);
  expect((await f.read())!.state).toBe('merged');
  expect((await f.read())!.landedCommits).toBe(1);
  expect(f.repo.refs.get('refs/heads/main')).toBe(advanced);
  const deliveries = f.t.actions.resolutions.length;
  await recoverLandings(f.t.env, f.db);
  await landPull({
    ...f.opts,
    git: gitFor(f.t.env, f.opts.repo),
    pr: (await f.read())!,
  });
  expect(f.t.actions.resolutions).toHaveLength(deliveries);
  expect(
    await f.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'pull.merged'))
  ).toHaveLength(1);
  expect(
    (await f.db.select().from(landingIntents).get())!.finishedAt
  ).not.toBeNull();
});

it('没有合并意图时，不因目标包含普通头提交而推断已合并', async () => {
  const f = await ready();
  f.repo.refs.set('refs/heads/main', f.head);
  expect(
    await landPull({ ...f.opts, git: gitFor(f.t.env, f.opts.repo) })
  ).toMatchObject({ ok: false, error: 'Nothing to merge' });
  expect((await f.read())!.state).toBe('open');
  expect(await f.db.select().from(landingIntents)).toHaveLength(0);
});

/** A coherently recorded earlier merge, without adding wall-clock sleeps to the regression. */
async function earlierLanding() {
  const f = await ready();
  expect(await landPull(f.opts)).toMatchObject({ ok: true });
  await Promise.all(f.tail);
  const intent = (await f.db.select().from(landingIntents).get())!;
  const first = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  await f.db.batch([
    f.db
      .update(landingIntents)
      .set({ recordedAt: first })
      .where(eq(landingIntents.id, intent.id)),
    f.db
      .update(pullRequests)
      .set({ mergedAt: first, closedAt: first, updatedAt: first })
      .where(eq(pullRequests.id, f.pr.id)),
    f.db
      .update(repositories)
      .set({ updatedAt: first })
      .where(eq(repositories.id, f.pr.repositoryId)),
    f.db
      .update(auditEvents)
      .set({ createdAt: first })
      .where(eq(auditEvents.id, `landing:${intent.id}`)),
  ]);
  return { ...f, intent, first };
}

it('再次记录同一合并时保留首次记录时间', async () => {
  const f = await earlierLanding();
  const revision = (await f.read())!.stateRevision;
  expect(revision).toBe(f.pr.stateRevision + 1);
  expect(await recordLanding(f.db, f.pr, f.intent)).toBe(true);
  expect(await recordLanding(f.db, f.pr, f.intent)).toBe(true);
  const pr = (await f.read())!;
  expect(pr.stateRevision).toBe(revision);
  expect(pr.mergedAt).toEqual(f.first);
  expect(pr.closedAt).toEqual(f.first);
  expect(pr.updatedAt).toEqual(f.first);
  expect(
    (await f.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, f.pr.repositoryId))
      .get())!.updatedAt
  ).toEqual(f.first);
  const audits = await f.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, 'pull.merged'));
  expect(audits).toHaveLength(1);
  expect(audits[0].createdAt).toEqual(f.first);
});

it('重新记录旧合并时，保留较新的 PR 和仓库活动时间', async () => {
  const f = await earlierLanding();
  const newer = new Date(f.first.getTime() + 3_600_000);
  await f.db.batch([
    f.db
      .update(pullRequests)
      .set({ updatedAt: newer })
      .where(eq(pullRequests.id, f.pr.id)),
    f.db
      .update(repositories)
      .set({ updatedAt: newer })
      .where(eq(repositories.id, f.pr.repositoryId)),
  ]);
  expect(await recordLanding(f.db, f.pr, f.intent)).toBe(true);
  const pr = (await f.read())!;
  expect(pr.mergedAt).toEqual(f.first);
  expect(pr.closedAt).toEqual(f.first);
  expect(pr.updatedAt).toEqual(newer);
  expect(
    (await f.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, f.pr.repositoryId))
      .get())!.updatedAt
  ).toEqual(newer);
});

it('同一秒内将批准排在合并前，重放时保留首次审计的毫秒时间', async () => {
  const f = await ready();
  const second = Math.floor(Date.now() / 1000) * 1000;
  await f.db
    .update(auditEvents)
    .set({ createdAt: new Date(second + 123) })
    .where(eq(auditEvents.action, 'pull.approved'));
  const [intent] = await f.db
    .insert(landingIntents)
    .values({
      id: crypto.randomUUID(),
      pullRequestId: f.pr.id,
      repositoryId: f.pr.repositoryId,
      target: 'main',
      baseSha: f.repo.refs.get('refs/heads/main')!,
      headSha: f.head,
      landHeadSha: f.head,
      pullRefBefore: f.repo.refs.get('refs/pull/1/head') ?? '0'.repeat(40),
      landedCommits: 1,
      actorId: f.pr.authorId,
      automatic: false,
      createdAt: new Date(second),
    })
    .returning();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(second + 789);
  try {
    expect(await recordLanding(f.db, f.pr, intent)).toBe(true);
    clock.mockReturnValue(second + 5_000);
    expect(await recordLanding(f.db, f.pr, intent)).toBe(true);
  } finally {
    clock.mockRestore();
  }
  const rows = (
    await f.db.select().from(auditEvents).orderBy(asc(auditEvents.createdAt))
  ).filter(
    (row) => row.action === 'pull.approved' || row.action === 'pull.merged'
  );
  expect(rows.map((row) => row.action)).toEqual([
    'pull.approved',
    'pull.merged',
  ]);
  expect(rows[1].createdAt.getTime()).toBe(second + 789);
});

it('移动目标前完成所有可能失败的提交计数读取', async () => {
  const f = await ready();
  const before = f.repo.refs.get('refs/heads/main');
  f.opts.git.log = async () => {
    throw new Error('Artifacts read failed');
  };
  await expect(landPull(f.opts)).rejects.toThrow('Artifacts read failed');
  expect(f.repo.refs.get('refs/heads/main')).toBe(before);
  expect((await f.read())!.state).toBe('open');
});

it('推送前的传输失败不阻止合并更新的已审查顶端', async () => {
  const f = await ready();
  f.opts.git.client.push = async () => {
    throw new Error('offline before push');
  };
  expect(await landPull(f.opts)).toMatchObject({ ok: false });
  const next = await commitPaths(
    f.repo,
    'feature',
    { ...BASE, 'change.txt': 'new version\n' },
    'New version'
  );
  expect((await f.approve()).status).toBe(200);
  await settle(f.t);
  expect(
    await landPull({ ...f.opts, git: gitFor(f.t.env, f.opts.repo) })
  ).toMatchObject({ ok: true, sha: next });
  await Promise.all(f.tail);
  expect((await f.read())!.mergeCommitSha).toBe(next);
  expect(await f.db.select().from(landingIntents)).toHaveLength(2);
});

it('仅有回执的部分准备保持未合并，并允许重试同一意图', async () => {
  const f = await ready();
  const before = f.repo.refs.get('refs/heads/main');
  const push = f.opts.git.client.push.bind(f.opts.git.client);
  f.opts.git.client.push = async (updates, objects) => {
    await push(
      updates.filter((u) => u.ref.includes('/landings/')),
      objects
    );
    throw new GitPushError('pin rejected after receipt');
  };
  expect(await landPull(f.opts)).toMatchObject({ ok: false, status: 409 });
  await recoverLandings(f.t.env, f.db);
  expect(f.repo.refs.get('refs/heads/main')).toBe(before);
  expect((await f.read())!.state).toBe('open');
  expect(
    await landPull({ ...f.opts, git: gitFor(f.t.env, f.opts.repo) })
  ).toMatchObject({ ok: true });
  await Promise.all(f.tail);
  expect(await f.db.select().from(landingIntents)).toHaveLength(1);
});

it('比较并交换前目标已被移走时关闭该尝试，之后的合并与恢复不再反复检查', async () => {
  const f = await ready();
  const push = f.opts.git.client.push.bind(f.opts.git.client);
  let moved = '';
  f.opts.git.client.push = async (updates, objects) => {
    await push(updates, objects);
    // Someone else lands into main between this attempt's prepare and its target push.
    if (updates.some((u) => u.ref.includes('/landings/')))
      moved = await commitPaths(
        f.repo,
        'main',
        { ...BASE, 'other.txt': 'other\n' },
        'Moved on'
      );
  };
  expect(await landPull(f.opts)).toMatchObject({ ok: false, status: 409 });
  expect(f.repo.refs.get('refs/heads/main')).toBe(moved);
  const intent = (await f.db.select().from(landingIntents).get())!;
  expect(intent.recordedAt).toBeNull();
  expect(intent.finishedAt).not.toBeNull();
  await recoverLandings(f.t.env, f.db);
  expect(
    (await f.db.select().from(landingIntents).get())!.attemptedAt
  ).toBeNull();
  expect((await f.read())!.state).toBe('open');
});

it('目标已移走且不含其结果时，恢复任务关闭待定的尝试', async () => {
  const f = await ready();
  f.opts.git.client.push = async () => {
    throw new Error('offline before push');
  };
  expect(await landPull(f.opts)).toMatchObject({ ok: false });
  // Still landable while main sits at the attempt's base: recovery keeps it.
  await recoverLandings(f.t.env, f.db);
  expect(
    (await f.db.select().from(landingIntents).get())!.finishedAt
  ).toBeNull();
  await commitPaths(
    f.repo,
    'main',
    { ...BASE, 'other.txt': 'other\n' },
    'Moved on'
  );
  await recoverLandings(f.t.env, f.db);
  const intent = (await f.db.select().from(landingIntents).get())!;
  expect(intent.finishedAt).not.toBeNull();
  expect(intent.recordedAt).toBeNull();
  expect((await f.read())!.state).toBe('open');
});

it('目标比较并交换前 PR 已关闭时，放弃准备好的尝试', async () => {
  const f = await ready();
  const before = f.repo.refs.get('refs/heads/main');
  const push = f.opts.git.client.push.bind(f.opts.git.client);
  f.opts.git.client.push = async (updates, objects) => {
    await push(updates, objects);
    if (updates.some((u) => u.ref.includes('/landings/')))
      await f.db
        .update(pullRequests)
        .set({ state: 'closed' })
        .where(eq(pullRequests.id, f.pr.id));
  };
  expect(await landPull(f.opts)).toMatchObject({ ok: false, status: 409 });
  expect(f.repo.refs.get('refs/heads/main')).toBe(before);
  expect(
    (await f.db.select().from(landingIntents).get())!.finishedAt
  ).not.toBeNull();
  f.repo.refs.set('refs/heads/main', f.head);
  await recoverLandings(f.t.env, f.db);
  expect((await f.read())!.state).toBe('closed');
});

it('恢复丢失的目标推送响应，并重试失败的后续任务，不重复投递已完成任务', async () => {
  const f = await ready();
  const push = f.opts.git.client.push.bind(f.opts.git.client);
  f.opts.git.client.push = async (updates, objects) => {
    await push(updates, objects);
    if (updates.some((u) => u.ref === 'refs/heads/main'))
      throw new Error('lost target response');
  };
  const create = f.t.env.MERGE_RESOLUTION.create.bind(f.t.env.MERGE_RESOLUTION);
  f.t.env.MERGE_RESOLUTION.create = async (opts) => {
    if (opts?.id?.startsWith('sweep-landing-'))
      throw new Error('Workflow unavailable');
    return create(opts);
  };
  expect(await landPull(f.opts)).toMatchObject({ ok: true });
  await Promise.all(f.tail);
  expect(
    (await f.db.select().from(landingIntents).get())!.finishedAt
  ).toBeNull();
  const reconcileCount = f.t.actions.resolutions.filter((r) =>
    r.id.startsWith('reconcile-landing-')
  ).length;
  f.t.env.MERGE_RESOLUTION.create = create;
  await recoverLandings(f.t.env, f.db);
  expect(
    (await f.db.select().from(landingIntents).get())!.finishedAt
  ).not.toBeNull();
  expect(
    f.t.actions.resolutions.filter((r) => r.id.startsWith('reconcile-landing-'))
  ).toHaveLength(reconcileCount);
  expect(
    f.t.actions.resolutions.filter((r) => r.id.startsWith('sweep-landing-'))
  ).toHaveLength(1);
});
