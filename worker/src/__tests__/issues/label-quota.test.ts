// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { schema } from '../../db/schema';
import { labels } from '../../db/app.schema';
import { setup } from '../helpers/actions';
import { call, settle } from '../helpers/app';

it('concurrent label creation preserves the 200-label cap', async () => {
  const s = await setup();
  const db = drizzle(s.t.env.DB, { schema });
  const repo = (await db.query.repositories.findFirst())!;
  const inserts = Array.from({ length: 199 }, (_, i) =>
    db.insert(labels).values({
      id: `audit-label-${i}`,
      repositoryId: repo.id,
      name: `seed-${i}`,
      color: 'aabbcc',
      description: '',
      createdAt: new Date(),
    })
  );
  await db.batch([inserts[0], ...inserts.slice(1)]);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      call(s.t, '/api/repos/octocat/app/labels', {
        cookie: s.admin,
        json: { name: `concurrent-${i}`, color: 'aabbcc', description: '' },
      })
    )
  );
  await settle(s.t);
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(labels)
    .where(eq(labels.repositoryId, repo.id))
    .get();
  expect(
    count!.n,
    JSON.stringify({ statuses: results.map((r) => r.status), count: count?.n })
  ).toBe(200);
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  expect(results.filter((r) => r.status === 422)).toHaveLength(7);
});
