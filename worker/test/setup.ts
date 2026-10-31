// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeEach } from 'vitest';
import { drainBackground } from '../src/__tests__/helpers/background';

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
  // Account deletion is forbidden while a repository still belongs to it, even with deferred FKs.
  // Tear down repositories first; do not disable the production deletion trigger in tests.
  const cleanupTables = [
    ...TABLES.filter((name) => name === 'repositories'),
    ...TABLES.filter((name) => name !== 'repositories'),
  ];
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...cleanupTables.map((t) => env.DB.prepare(`DELETE FROM "${t}"`)),
    // Most tests have one person open a pull request and approve it, so they run with authors allowed to decide
    // their own (`review.allow_self_approval`, off on a real instance). self-approval.test.ts removes this row to
    // test the default.
    env.DB.prepare(
      "INSERT INTO instance_settings (key, value, updated_at) VALUES ('review.allow_self_approval', 'true', 0)"
    ),
  ]);
});

// A test ends when the work it handed to ctx.waitUntil ends: otherwise that work runs into the next test, after its
// tables were emptied, or past the worker's last file into its shutdown (helpers/background.ts).
afterEach(() => drainBackground());

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
