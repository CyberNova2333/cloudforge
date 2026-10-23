// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { pullRequests } from '../db/app.schema';
import { executeSweep } from '../merge/auto';
import type { StepRunner } from '../merge/resolution';
import { appRepo, openPull } from './helpers/reviews';
import { settle } from './helpers/app';

it('pages sweep identities below the durable-result limit and visits every PR once across matching branch chunks', async () => {
  const { t, admin, repo } = await appRepo();
  await openPull(t, admin, repo, { 'a.txt': 'change\n' });
  await settle(t);
  const db = drizzle(t.env.DB, { schema });
  const first = (await db.select().from(pullRequests).get())!;
  const body = '大'.repeat(20_000);
  for (let i = 2; i <= 105; i++)
    await db.insert(pullRequests).values({
      ...first,
      id: crypto.randomUUID(),
      number: i,
      body,
      headRef: `missing-${i}`,
    });
  const results: { name: string; bytes: number; value: unknown }[] = [];
  const step = {
    do: async (name: string, a: unknown, b?: unknown) => {
      const value = await ((b ?? a) as () => Promise<unknown>)();
      results.push({
        name,
        bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength,
        value,
      });
      return value;
    },
    sleep: async () => {},
  } as StepRunner;
  await executeSweep(
    { env: t.env, db, step },
    {
      repositoryId: first.repositoryId,
      branches: [
        'main',
        ...Array.from({ length: 20 }, (_, i) => `branch-${i}`),
        'feature',
        'main',
      ],
    }
  );
  const pages = results.filter((r) => r.name.startsWith('targets:'));
  expect(pages.length).toBeGreaterThan(2);
  expect(Math.max(...pages.map((p) => p.bytes))).toBeLessThan(20_000);
  expect(pages.every((p) => !JSON.stringify(p.value).includes('大'))).toBe(
    true
  );
  expect(results.filter((r) => r.name.startsWith('pr:'))).toHaveLength(105);
  expect(results.filter((r) => r.name.startsWith('rebase:'))).toHaveLength(105);
});
