// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// Idempotent: with shared storage only the first test file applies them.
await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

// The test files of one worker share it and its storage (`isolate: false`; each worker has its own,
// worker/vitest.config.ts): empty every table before each test. Read from the schema so new tables
// are never missed; foreign keys are checked at commit.
const TABLES = (
  await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'"
  ).all<{ name: string }>()
).results.map((r) => r.name);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...TABLES.map((t) => env.DB.prepare(`DELETE FROM "${t}"`)),
  ]);
});

// Tests never reach the internet: a fetch to any host but this machine (GitHub for an action's action.yml,
// Cloudflare's APIs) fails at once, as an unreachable host would. A real attempt can hang on its TLS handshake on a
// CI runner and fail after its test file, while the worker shuts down (CNB: EnvironmentTeardownError). A test
// that needs a response stubs fetch itself (vi.spyOn), over this. Wrapped once per worker: this file runs per file.
const OFFLINE = Symbol.for('cloudforge.test.offline');
const g = globalThis as typeof globalThis & { [OFFLINE]?: true };
if (!g[OFFLINE]) {
  g[OFFLINE] = true;
  const online = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let host: string | null = null;
    try {
      host = new URL(input instanceof Request ? input.url : String(input))
        .hostname;
    } catch {
      // Not an absolute URL: let fetch say what is wrong with it.
    }
    if (host !== null && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host))
      return Promise.reject(
        new TypeError(`Tests are offline: fetch to ${host} refused`)
      );
    return online(input as RequestInfo, init);
  }) as typeof fetch;
}
