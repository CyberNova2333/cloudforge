// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

/** Paths are relative to the repo root. */
const d1Migrations = await readD1Migrations('./migrations');

/**
 * Test files spread over this many workers: TEST_WORKERS (CNB sets 6 of its 8 cores), else half this machine's
 * cores, at most 8. Each worker is a workerd of its own with its own storage; the files in one share it in turn
 * (`isolate: false`, and worker/test/setup.ts empties every table before each test).
 */
const workers =
  Number(process.env.TEST_WORKERS) ||
  Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2)));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: {
        bindings: {
          TEST_D1_MIGRATIONS: d1Migrations,
          BETTER_AUTH_SECRET: 'test-secret-not-used-in-any-real-deployment',
          ACTIONS_SECRETS_KEY:
            'test-actions-secrets-key-not-used-in-any-real-deployment',
          // Fake R2 credentials: pre-signing is pure HMAC, so it works offline.
          R2_ACCESS_KEY_ID: 'test-access-key-id',
          R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
          // A stand-in so the AgentReviewer Durable Object can be constructed; no test calls a model through it.
          AI: {},
        },
      },
    }),
  ],
  test: {
    // Plus DOM-free SPA modules.
    include: ['worker/src/__tests__/**/*.test.ts', 'src/lib/**/*.test.ts'],
    setupFiles: ['./worker/test/setup.ts'],
    maxWorkers: workers,
    isolate: false,
    // CI containers (CloudForge Actions standard-2, GitHub runners, CNB; all set CI=true) run these
    // tests about ten times slower than a laptop, and parallel workers slow each test too, so the
    // heavier stacking tests pass 5 s only on a laptop running one worker.
    // Ten times is a budget, not a licence: a test that seeds hundreds of rows one write at a time
    // takes minutes there, so seed fixtures in one `db.batch` (see releases.test.ts's landedMany).
    ...(process.env.CI || workers > 1 ? { testTimeout: 30_000 } : {}),
    // On CI, console output only for failing tests: CNB keeps 100 KB of a stage's log, and every
    // request's log line would push the failures and the summary out of it.
    ...(process.env.CI ? { silent: 'passed-only' as const } : {}),
  },
});
