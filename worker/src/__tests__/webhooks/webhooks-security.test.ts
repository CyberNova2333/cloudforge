import { afterEach, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/schema';
import {
  commitStatuses,
  webhookDeliveries,
  webhooks,
} from '../../db/app.schema';
import {
  combinedState,
  latestStatuses,
  statusesOf,
} from '../../repositories/commit-statuses';
import {
  deliverDueWebhooks,
  enqueueDeliveries,
  sendDelivery,
  webhookUrlError,
} from '../../webhooks/service';
import { setup } from '../helpers/actions';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const s = await setup();
  const db = drizzle(s.t.env.DB, { schema });
  const repo = (await db.query.repositories.findFirst())!;
  const hook = {
    id: crypto.randomUUID(),
    repositoryId: repo.id,
    url: 'https://hooks.example.com/event',
    secret: null,
    events: ['push'],
    active: true,
    createdById: null,
    lastStatus: null,
    lastDeliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(webhooks).values(hook);
  const delivery = {
    id: crypto.randomUUID(),
    webhookId: hook.id,
    repositoryId: repo.id,
    event: 'push',
    action: null,
    payload: '{}',
    status: 'pending' as const,
    attempts: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
  };
  await db.insert(webhookDeliveries).values(delivery);
  return { ...s, db, repo, hook, delivery };
}

it('records and delivers events to all 20 hooks within the real D1 bind limit', async () => {
  const s = await fixture();
  await s.db.delete(webhookDeliveries);
  const hooks = Array.from({ length: 20 }, (_, i) => ({
    ...s.hook,
    id: `hook-${i}`,
  }));
  for (let i = 0; i < hooks.length; i += 5)
    await s.db.insert(webhooks).values(hooks.slice(i, i + 5));
  const sent = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 204 }));
  const ids = await enqueueDeliveries(
    { env: s.t.env, db: s.db },
    hooks,
    'push',
    null,
    {},
    'event'
  );
  expect(ids).toHaveLength(20);
  expect(sent).toHaveBeenCalledTimes(20);
  expect(
    await enqueueDeliveries(
      { env: s.t.env, db: s.db },
      hooks,
      'push',
      null,
      {},
      'event'
    )
  ).toEqual([]);
});

it('stops reading the webhook response at the preview byte limit', async () => {
  const s = await fixture();
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      reads++;
      c.enqueue(new TextEncoder().encode('x'.repeat(4096)));
      if (reads === 10) c.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  await sendDelivery(
    s.t.env,
    s.db,
    s.delivery.id,
    vi.fn().mockResolvedValue(new Response(stream))
  );
  expect(reads).toBeLessThanOrEqual(2);
  expect(cancelled).toBe(true);
  expect(
    (await s.db.query.webhookDeliveries.findFirst())?.responseBody
  ).toHaveLength(2048);
});

it('does not downgrade to unsigned delivery when a configured secret cannot be decrypted', async () => {
  const s = await fixture();
  await s.db
    .update(webhooks)
    .set({ secret: 'v1.invalid.invalid' })
    .where(eq(webhooks.id, s.hook.id));
  const fetcher = vi.fn().mockResolvedValue(new Response('ok'));
  expect(await sendDelivery(s.t.env, s.db, s.delivery.id, fetcher)).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await s.db.query.webhookDeliveries.findFirst())?.error).toMatch(
    /secret.*decrypt/i
  );
});

it('does not let an expired sender overwrite the next claimant result', async () => {
  const s = await fixture();
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: (response: Response) => void;
  const pending = sendDelivery(
    s.t.env,
    s.db,
    s.delivery.id,
    vi.fn().mockImplementation(() => {
      started();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    })
  );
  await entered;
  await s.db
    .update(webhookDeliveries)
    .set({ claimedAt: new Date(Date.now() - 61_000) })
    .where(eq(webhookDeliveries.id, s.delivery.id));
  expect(
    await sendDelivery(
      s.t.env,
      s.db,
      s.delivery.id,
      vi.fn().mockResolvedValue(new Response('new winner'))
    )
  ).toBe(true);
  release(new Response('stale failure', { status: 500 }));
  await pending;
  expect(await s.db.query.webhookDeliveries.findFirst()).toMatchObject({
    status: 'delivered',
    attempts: 2,
    responseBody: 'new winner',
  });
  expect((await s.db.query.webhooks.findFirst())?.lastStatus).toBe(200);
});

it('closes exhausted abandoned claims instead of starving the due queue', async () => {
  const s = await fixture();
  await s.db
    .update(webhookDeliveries)
    .set({ attempts: 5, claimedAt: new Date(Date.now() - 61_000) });
  const sent = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('ok'));
  expect(await deliverDueWebhooks(s.t.env, s.db)).toBe(0);
  expect(sent).not.toHaveBeenCalled();
  expect(await s.db.query.webhookDeliveries.findFirst()).toMatchObject({
    status: 'failed',
    claimedAt: null,
    nextAttemptAt: null,
  });
});

it('rejects local and instance names with a trailing DNS dot', () => {
  for (const url of [
    'http://localhost.',
    'http://api.local.',
    'http://api.internal.',
  ])
    expect(webhookUrlError(url), url).not.toBeNull();
  expect(
    webhookUrlError(
      'https://git.example.com./events',
      'https://git.example.com'
    )
  ).not.toBeNull();
});

it('uses the later report when a success and failure share a timestamp', async () => {
  const s = await fixture();
  const sha = 'a'.repeat(40);
  const common = {
    repositoryId: s.repo.id,
    sha,
    context: 'ci',
    createdAt: new Date(1000),
  };
  await s.db
    .insert(commitStatuses)
    .values({ ...common, id: 'first', state: 'success' });
  await s.db
    .insert(commitStatuses)
    .values({ ...common, id: 'second', state: 'failure' });
  expect(
    combinedState((await latestStatuses(s.db, s.repo.id, [sha])).get(sha)!)
  ).toBe('failure');
  expect((await statusesOf(s.db, s.repo.id, sha)).map((r) => r.id)).toEqual([
    'second',
    'first',
  ]);
});
