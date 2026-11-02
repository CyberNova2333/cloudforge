import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { users } from '../../db/auth.schema';

describe('按邮箱查找成员', () => {
  it('不分大小写的邮箱查找使用 lower(email) 索引，而不是扫描整张表', async () => {
    // The query as emailClaimedByOther and the invitation routes build it.
    const query = drizzle(env.DB)
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, 'ada@example.com'))
      .toSQL();
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .bind(...query.params)
      .all<{ detail: string }>();
    const details = plan.results.map((r) => r.detail).join('\n');
    expect(details).toContain('users_email_lower_idx');
    expect(details).not.toMatch(/SCAN users\b/);
  });
});
