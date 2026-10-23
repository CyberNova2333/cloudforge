// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import {
  prEvents,
  pullCloseIntents,
  pullRequests,
  workflowRuns,
} from '../db/app.schema';
import { dismissEdge } from '../stack/retarget';
import { GitService } from '../git/service';
import { appRepo, openPull } from './helpers/reviews';
import { call, settle } from './helpers/app';
import {
  finishPullClose,
  recoverPullCloses,
  updatePullWithCloseIntent,
} from '../pulls/close-recovery';
import { runScheduled, ACTIONS_RETENTION_CRON } from '../cron';

async function stacked() {
  const { t, admin, repo } = await appRepo();
  await openPull(t, admin, repo, { 'parent.txt': 'parent\n' });
  await openPull(
    t,
    admin,
    repo,
    { 'child.txt': 'child\n' },
    { branch: 'child' }
  );
  await settle(t);
  const db = drizzle(t.env.DB, { schema });
  const parent = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  const childRow = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 2))
    .get())!;
  const child = { ...childRow, baseRef: parent.headRef, landTarget: 'main' };
  await db
    .update(pullRequests)
    .set({ baseRef: child.baseRef, landTarget: child.landTarget })
    .where(eq(pullRequests.id, child.id));
  return {
    t,
    admin,
    db,
    parent,
    child,
    readParent: async () =>
      (await db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, parent.id))
        .get())!,
    read: () =>
      db.select().from(pullRequests).where(eq(pullRequests.id, child.id)).get(),
    events: () =>
      db
        .select()
        .from(prEvents)
        .where(
          and(
            eq(prEvents.pullRequestId, child.id),
            eq(prEvents.kind, 'unstacked')
          )
        )
        .all(),
    failEvents: () =>
      t.env.DB.exec(
        `CREATE TRIGGER fail_unstack_event BEFORE INSERT ON pr_events WHEN NEW.kind = 'unstacked' BEGIN SELECT RAISE(ABORT, 'injected unstack event failure'); END;`
      ),
    restoreEvents: () => t.env.DB.exec('DROP TRIGGER fail_unstack_event'),
  };
}

it('rolls back child retargeting when a close cannot record its event, then retries once', async () => {
  const f = await stacked();
  const closed = await updatePullWithCloseIntent(f.db, f.parent, {
    state: 'closed',
    closedAt: new Date(),
  });
  await f.failEvents();
  try {
    await finishPullClose(f.t.env, f.db, closed.closeId!);
    expect((await f.read())!.baseRef).toBe(f.parent.headRef);
    expect(await f.events()).toHaveLength(0);
  } finally {
    await f.restoreEvents();
  }
  await recoverPullCloses(f.t.env, f.db);
  await recoverPullCloses(f.t.env, f.db);
  expect((await f.read())!.baseRef).toBe('main');
  const events = await f.events();
  expect(events).toHaveLength(1);
  expect(events[0].data).toMatchObject({
    pr: f.parent.number,
    why: '#1 was closed without landing.',
  });
});

it('recovers a failed close through the scheduled entrypoint without repeating child events', async () => {
  const f = await stacked();
  await f.failEvents();
  try {
    const res = await call(f.t, '/api/repos/octocat/app/pulls/1', {
      cookie: f.admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect(res.status).toBe(200);
    await settle(f.t);
    expect((await f.read())!.baseRef).toBe(f.parent.headRef);
    const intent = (await f.db.select().from(pullCloseIntents).get())!;
    expect(intent.finishedAt).toBeNull();
    expect(intent.completed.unwind).toBeUndefined();
  } finally {
    await f.restoreEvents();
  }
  await runScheduled({ cron: ACTIONS_RETENTION_CRON }, f.t.env);
  await runScheduled({ cron: ACTIONS_RETENTION_CRON }, f.t.env);
  expect((await f.read())!.baseRef).toBe('main');
  expect(await f.events()).toHaveLength(1);
  expect(
    (await f.db.select().from(pullCloseIntents).get())!.finishedAt
  ).not.toBeNull();
  const dispatched = f.t.actions.resolutions.filter((r) =>
    r.id.includes('-close-')
  );
  expect(dispatched).toHaveLength(2);
});

it('recovers closed pulls even when unrelated log retention fails', async () => {
  const f = await stacked();
  const closed = await updatePullWithCloseIntent(f.db, f.parent, {
    state: 'closed',
    closedAt: new Date(),
  });
  const old = new Date(Date.now() - 100 * 86_400_000);
  await f.db.insert(workflowRuns).values({
    id: 'expired-run',
    repositoryId: f.parent.repositoryId,
    runNumber: 1,
    workflowPath: '.github/workflows/old.yml',
    name: 'Old run',
    event: 'push',
    ref: 'refs/heads/main',
    headSha: '0'.repeat(40),
    displayTitle: 'Old run',
    status: 'completed',
    conclusion: 'success',
    createdAt: old,
    completedAt: old,
  });
  const failedList = vi
    .spyOn(f.t.env.ACTIONS_LOGS, 'list')
    .mockRejectedValue(new Error('injected retention storage failure'));
  try {
    await expect(
      runScheduled({ cron: ACTIONS_RETENTION_CRON }, f.t.env)
    ).rejects.toThrow('injected retention storage failure');
    expect((await f.read())!.baseRef).toBe('main');
    expect(await f.events()).toHaveLength(1);
    expect(
      (await f.db
        .select()
        .from(pullCloseIntents)
        .where(eq(pullCloseIntents.id, closed.closeId!))
        .get())!.finishedAt
    ).not.toBeNull();
  } finally {
    failedList.mockRestore();
  }
});

it('rolls back closing when its durable outbox cannot be written', async () => {
  const f = await stacked();
  await f.t.env.DB.exec(
    `CREATE TRIGGER fail_close_intent BEFORE INSERT ON pull_close_intents BEGIN SELECT RAISE(ABORT, 'injected close outbox failure'); END;`
  );
  try {
    const res = await call(f.t, '/api/repos/octocat/app/pulls/1', {
      cookie: f.admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect(res.status).toBe(500);
    expect(
      (await f.db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, f.parent.id))
        .get())!.state
    ).toBe('open');
    expect(await f.db.select().from(pullCloseIntents).all()).toHaveLength(0);
  } finally {
    await f.t.env.DB.exec('DROP TRIGGER fail_close_intent');
  }
});

it('cancels a stale close generation on reopen, including when closed again in the same second', async () => {
  const f = await stacked();
  const now = new Date();
  const first = await updatePullWithCloseIntent(f.db, f.parent, {
    state: 'closed',
    closedAt: now,
  });
  await updatePullWithCloseIntent(f.db, await f.readParent(), {
    state: 'open',
    closedAt: null,
  });
  const second = await updatePullWithCloseIntent(f.db, await f.readParent(), {
    state: 'closed',
    closedAt: now,
  });
  expect(second.closeId).not.toBe(first.closeId);
  await finishPullClose(f.t.env, f.db, first.closeId!);
  expect((await f.read())!.baseRef).toBe(f.parent.headRef);
  expect(await f.events()).toHaveLength(0);
  await recoverPullCloses(f.t.env, f.db);
  expect((await f.read())!.baseRef).toBe('main');
  expect(await f.events()).toHaveLength(1);
});

it('refuses a stale close or reopen after a merge without writing an outbox', async () => {
  const f = await stacked();
  await f.db
    .update(pullRequests)
    .set({ state: 'merged', mergeCommitSha: 'a'.repeat(40) })
    .where(eq(pullRequests.id, f.parent.id));
  expect(
    (await updatePullWithCloseIntent(f.db, f.parent, { state: 'closed' }))
      .changed
  ).toBe(false);
  expect(
    (
      await updatePullWithCloseIntent(
        f.db,
        { ...f.parent, state: 'closed' },
        { state: 'open' }
      )
    ).changed
  ).toBe(false);
  expect(
    (await f.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, f.parent.id))
      .get())!.state
  ).toBe('merged');
  expect(await f.db.select().from(pullCloseIntents).all()).toHaveLength(0);
});

it('returns 409 when a merge finishes while the close API is reading Git', async () => {
  const f = await stacked();
  const resolve = GitService.prototype.resolve;
  let injected = false;
  const spy = vi
    .spyOn(GitService.prototype, 'resolve')
    .mockImplementation(async function (this: GitService, ref) {
      if (!injected && ref === f.parent.headRef) {
        injected = true;
        await f.db
          .update(pullRequests)
          .set({ state: 'merged', mergeCommitSha: 'a'.repeat(40) })
          .where(eq(pullRequests.id, f.parent.id));
      }
      return resolve.call(this, ref);
    });
  try {
    const res = await call(f.t, '/api/repos/octocat/app/pulls/1', {
      cookie: f.admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect(injected).toBe(true);
    expect(res.status).toBe(409);
    expect(
      (await f.db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, f.parent.id))
        .get())!.state
    ).toBe('merged');
    expect(await f.db.select().from(pullCloseIntents).all()).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

it('rejects a stale reopen after another request reopened and closed the same PR again', async () => {
  const f = await stacked();
  const now = new Date();
  const first = await updatePullWithCloseIntent(f.db, f.parent, {
    state: 'closed',
    closedAt: now,
  });
  let latestCloseId: string | undefined;
  const resolve = GitService.prototype.resolve;
  let injected = false;
  const spy = vi
    .spyOn(GitService.prototype, 'resolve')
    .mockImplementation(async function (this: GitService, ref) {
      if (!injected && ref === f.parent.headRef) {
        injected = true;
        const closed = await f.readParent();
        await updatePullWithCloseIntent(f.db, closed, {
          state: 'open',
          closedAt: null,
        });
        const reopened = await f.readParent();
        latestCloseId = (
          await updatePullWithCloseIntent(f.db, reopened, {
            state: 'closed',
            closedAt: now,
          })
        ).closeId;
      }
      return resolve.call(this, ref);
    });
  try {
    const res = await call(f.t, '/api/repos/octocat/app/pulls/1', {
      cookie: f.admin,
      method: 'PATCH',
      json: { state: 'open' },
    });
    expect(injected).toBe(true);
    expect(latestCloseId).not.toBe(first.closeId);
    expect(res.status).toBe(409);
    expect(
      (await f.db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.id, f.parent.id))
        .get())!.state
    ).toBe('closed');
    expect((await f.db.select().from(pullCloseIntents).get())!.id).toBe(
      latestCloseId
    );
    await finishPullClose(f.t.env, f.db, latestCloseId!);
    expect((await f.read())!.baseRef).toBe('main');
    expect(await f.events()).toHaveLength(1);
  } finally {
    spy.mockRestore();
    await settle(f.t);
  }
});

it('rejects a stale close after another request closed and reopened the same PR again', async () => {
  const f = await stacked();
  const resolve = GitService.prototype.resolve;
  let injected = false;
  const spy = vi
    .spyOn(GitService.prototype, 'resolve')
    .mockImplementation(async function (this: GitService, ref) {
      if (!injected && ref === f.parent.headRef) {
        injected = true;
        await updatePullWithCloseIntent(f.db, await f.readParent(), {
          state: 'closed',
          closedAt: new Date(),
        });
        await updatePullWithCloseIntent(f.db, await f.readParent(), {
          state: 'open',
          closedAt: null,
        });
      }
      return resolve.call(this, ref);
    });
  try {
    const res = await call(f.t, '/api/repos/octocat/app/pulls/1', {
      cookie: f.admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect(injected).toBe(true);
    expect(res.status).toBe(409);
    expect((await f.readParent()).state).toBe('open');
    expect(await f.db.select().from(pullCloseIntents).all()).toHaveLength(0);
    expect((await f.read())!.baseRef).toBe(f.parent.headRef);
    expect(await f.events()).toHaveLength(0);
    // The same old open snapshot must not edit the freshly reopened PR either.
    expect(
      (await updatePullWithCloseIntent(f.db, f.parent, { title: 'stale' }))
        .changed
    ).toBe(false);
    expect((await f.readParent()).title).toBe(f.parent.title);
  } finally {
    spy.mockRestore();
    await settle(f.t);
  }
});

it('retries a lost workflow dispatch response with the same close id after metadata already committed', async () => {
  const f = await stacked();
  const closed = await updatePullWithCloseIntent(f.db, f.parent, {
    state: 'closed',
    closedAt: new Date(),
  });
  const original = f.t.env.MERGE_RESOLUTION;
  const instances = new Set<string>();
  let failRead = true;
  let lost = true;
  f.t.env.MERGE_RESOLUTION = {
    create: async ({ id }: { id: string }) => {
      if (instances.has(id)) throw new Error('already exists');
      instances.add(id);
      if (lost) {
        lost = false;
        throw new Error('lost dispatch response');
      }
      return { id };
    },
    get: async (id: string) => {
      if (failRead || !instances.has(id)) throw new Error('read unavailable');
      return { status: async () => ({ status: 'running' }) };
    },
  } as unknown as typeof original;
  try {
    await finishPullClose(f.t.env, f.db, closed.closeId!);
    expect((await f.read())!.baseRef).toBe('main');
    expect(
      (await f.db.select().from(pullCloseIntents).get())!.finishedAt
    ).toBeNull();
    failRead = false;
    await recoverPullCloses(f.t.env, f.db);
    await recoverPullCloses(f.t.env, f.db);
    expect(instances.size).toBe(2);
    expect(await f.events()).toHaveLength(1);
    expect(
      (await f.db.select().from(pullCloseIntents).get())!.finishedAt
    ).not.toBeNull();
  } finally {
    f.t.env.MERGE_RESOLUTION = original;
  }
});

it('rolls back maintainer unstacking when its event fails and emits one event on retry', async () => {
  const f = await stacked();
  await f.failEvents();
  try {
    await expect(
      dismissEdge(f.t.env, f.db, f.child, f.parent.number, f.child.authorId)
    ).rejects.toThrow('injected unstack event failure');
    expect((await f.read())!.baseRef).toBe(f.parent.headRef);
    expect(await f.events()).toHaveLength(0);
  } finally {
    await f.restoreEvents();
  }
  expect(
    await dismissEdge(f.t.env, f.db, f.child, f.parent.number, f.child.authorId)
  ).toBe('dismissed');
  expect((await f.read())!.baseRef).toBe('main');
  expect(
    await dismissEdge(
      f.t.env,
      f.db,
      (await f.read())!,
      f.parent.number,
      f.child.authorId
    )
  ).toBe('not_found');
  const events = await f.events();
  expect(events).toHaveLength(1);
  expect(events[0].actorId).toBe(f.child.authorId);
});
