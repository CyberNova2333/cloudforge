// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { schema } from '../../db/schema';
import { webhooks } from '../../db/app.schema';
import { setup } from '../helpers/actions';
import { call, settle } from '../helpers/app';

it('concurrent webhook creation preserves the 20-hook repository cap', async () => {
  const s = await setup();
  const db = drizzle(s.t.env.DB, { schema });
  const repo = (await db.query.repositories.findFirst())!;
  const hook = (i: number) => ({
    id: `audit-hook-${i}`,
    repositoryId: repo.id,
    url: 'https://example.com/hook',
    secret: null,
    events: ['push'],
    active: false,
    createdById: repo.ownerId,
    lastStatus: null,
    lastDeliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const inserts = Array.from({ length: 19 }, (_, i) =>
    db.insert(webhooks).values(hook(i))
  );
  await db.batch([inserts[0], ...inserts.slice(1)]);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      call(s.t, '/api/repos/octocat/app/hooks', {
        cookie: s.admin,
        json: {
          url: 'https://example.com/hook',
          secret: 'public-test-fixture',
          active: false,
        },
      })
    )
  );
  await settle(s.t);
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(webhooks)
    .where(eq(webhooks.repositoryId, repo.id))
    .get();
  expect(
    count!.n,
    JSON.stringify({ statuses: results.map((r) => r.status), count: count?.n })
  ).toBe(20);
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  expect(results.filter((r) => r.status === 422)).toHaveLength(7);
});
