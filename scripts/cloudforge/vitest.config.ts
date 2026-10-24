// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { defineConfig } from 'vitest/config';
import ChineseReporter from '../test-reporter.ts';

// 安装器 CLI 使用 Node.js 环境测试。
export default defineConfig({
  test: {
    reporters: [new ChineseReporter()],
    environment: 'node',
    include: [
      'scripts/cloudforge/__tests__/**/*.test.ts',
      'scripts/githooks/__tests__/**/*.test.ts',
      'scripts/__tests__/**/*.test.ts',
    ],
  },
});
