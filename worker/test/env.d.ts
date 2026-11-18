// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Modifications by CyberNova are licensed under AGPL-3.0-only with Additional Terms (see ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_D1_MIGRATIONS: D1Migration[];
      TEST_LEGACY_D1_MIGRATIONS: D1Migration[];
      ACCESS_LEGACY_DB: D1Database;
      ACCESS_MIGRATION_DB: D1Database;
      ACCESS_DEFINITION_DB: D1Database;
      ACCESS_RUNTIME_DB: D1Database;
      ACCESS_RUNTIME_HTTP_DB: D1Database;
      ACCESS_ACTIONS_RUNTIME_DB: D1Database;
      BETTER_AUTH_SECRET: string;
      R2_ACCESS_KEY_ID: string;
      R2_SECRET_ACCESS_KEY: string;
    }
  }
}
