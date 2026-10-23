// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { prEvents, pullRequests } from '../db/app.schema';
import { dismissEdge, onPullClosed } from '../stack/retarget';
import { appRepo, openPull } from './helpers/reviews';
import { settle } from './helpers/app';

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
    db,
    parent,
    child,
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
  await f.db
    .update(pullRequests)
    .set({ state: 'closed' })
    .where(eq(pullRequests.id, f.parent.id));
  await f.failEvents();
  try {
    // onPullClosed deliberately logs failures; the child must still be eligible for the next call.
    await onPullClosed(f.t.env, f.db, f.parent, 'closed');
    expect((await f.read())!.baseRef).toBe(f.parent.headRef);
    expect(await f.events()).toHaveLength(0);
  } finally {
    await f.restoreEvents();
  }
  await onPullClosed(f.t.env, f.db, f.parent, 'closed');
  await onPullClosed(f.t.env, f.db, f.parent, 'closed');
  expect((await f.read())!.baseRef).toBe('main');
  const events = await f.events();
  expect(events).toHaveLength(1);
  expect(events[0].data).toMatchObject({
    pr: f.parent.number,
    why: '#1 was closed without landing.',
  });
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
