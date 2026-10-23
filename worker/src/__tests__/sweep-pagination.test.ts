// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { pullRequests } from '../db/app.schema';
import { executeSweep } from '../merge/auto';
import type { StepRunner } from '../merge/resolution';
import { appRepo, openPull } from './helpers/reviews';
import { settle } from './helpers/app';

it('按页读取低于持久化结果限制的扫描标识，在匹配分支分块间每个拉取请求只访问一次', async () => {
  const { t, admin, repo } = await appRepo();
  await openPull(t, admin, repo, { 'a.txt': 'change\n' });
  await settle(t);
  const db = drizzle(t.env.DB, { schema });
  const first = (await db.select().from(pullRequests).get())!;
  // 10.5 KB each: a page of 100 full rows would pass Workflows' 1 MiB durable-result limit. Every step of the
  // sweep reads whole rows, so bigger bodies only slow it down (they made this test time out on a busy runner).
  const body = '大'.repeat(3_500);
  // One batch, not 104 round trips (docs/development.md: seed fixtures in bulk).
  const rows = Array.from({ length: 104 }, (_, k) => ({
    ...first,
    id: crypto.randomUUID(),
    number: k + 2,
    body,
    headRef: `missing-${k + 2}`,
  }));
  const [head, ...rest] = rows.map((r) => db.insert(pullRequests).values(r));
  await db.batch([head, ...rest]);
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
