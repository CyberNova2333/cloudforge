// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import ChineseReporter from '../scripts/test-reporter';

/** 路径相对于仓库根目录。 */
const d1Migrations = await readD1Migrations('./migrations');

/**
 * 测试文件分摊到这么多个 worker：取 TEST_WORKERS（CNB 在 8 核中用 6 个），否则取本机核数的一半、最多 8 个。
 * 每个 worker 是独立的 workerd，有自己的存储；同一 worker 内的文件依次共用它（`isolate: false`，
 * worker/test/setup.ts 会在每个用例前清空所有表）。
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
          // 使用测试 R2 凭据：预签名只需 HMAC，可离线执行。
          R2_ACCESS_KEY_ID: 'test-access-key-id',
          R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
          // 仅供构造 AgentReviewer Durable Object；测试不会通过此对象调用模型。
          AI: {},
        },
      },
    }),
  ],
  test: {
    reporters: [new ChineseReporter()],
    // 同时覆盖不依赖 DOM 的前端模块。
    include: ['worker/src/__tests__/**/*.test.ts', 'src/lib/**/*.test.ts'],
    setupFiles: ['./worker/test/setup.ts'],
    maxWorkers: workers,
    isolate: false,
    // CI 容器（CloudForge Actions standard-2、GitHub runner、CNB，都会设置 CI=true）比笔记本慢约十倍，
    // 较重的 PR 堆叠测试只有在笔记本单 worker 时才能在 5 秒内跑完：CI 上或多 worker 并行时放宽到 30 秒。
    // CI 容器上并行时个别文件会慢得多（CNB 6 个 worker：多数用例约 2 倍，少数达 14 倍），所以放宽到 60 秒。
    // 十倍是预算而不是许可：逐条写入几百行种子数据的测试在 CI 上要跑好几分钟，种子数据请用一次
    // `db.batch` 写入（参见 releases.test.ts 的 landedMany）。
    ...(process.env.CI || workers > 1
      ? { testTimeout: process.env.CI && workers > 1 ? 60_000 : 30_000 }
      : {}),
    // CI 上只打印失败用例的控制台输出：CNB 每个阶段只保留 100 KB 日志，每个请求的日志行会把
    // 失败信息和最后的汇总挤掉。
    ...(process.env.CI ? { silent: 'passed-only' as const } : {}),
  },
});
