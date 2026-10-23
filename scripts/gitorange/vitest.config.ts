// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { defineConfig } from 'vitest/config';

// Plain Node tests for the installer CLI (not the Workers pool).
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'scripts/gitorange/__tests__/**/*.test.ts',
      'scripts/githooks/__tests__/**/*.test.ts',
    ],
  },
});
