// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/** Harness check: migrations applied and the worker boots. */
describe('测试基础环境', () => {
  it('测试套件运行前应用 D1 迁移', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all<{ name: string }>();
    const tables = results.map((r) => r.name);
    expect(tables).toContain('d1_migrations');
    expect(tables.length).toBeGreaterThan(1);
  });

  it('通过 SELF.fetch 提供 Worker 服务', async () => {
    const res = await SELF.fetch('http://test.local/api/setup/status');
    expect(res.status).toBeLessThan(500);
  });
});
