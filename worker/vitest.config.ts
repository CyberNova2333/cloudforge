// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/** Paths are relative to the repo root. */
const d1Migrations = await readD1Migrations('./migrations');

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
    // CI containers (CloudForge Actions standard-2, GitHub runners; both set CI=true) run these
    // tests about ten times slower than a laptop, so the heavier stacking tests pass 5 s there.
    // Ten times is a budget, not a licence: a test that seeds hundreds of rows one write at a time
    // takes minutes there, so seed fixtures in one `db.batch` (see releases.test.ts's landedMany).
    ...(process.env.CI ? { testTimeout: 30_000 } : {}),
  },
});
