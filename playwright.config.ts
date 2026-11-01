// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixels: 0,
      caret: 'hide',
    },
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://cloudforge:8080',
    viewport: { width: 1280, height: 900 },
    contextOptions: {
      reducedMotion: 'reduce',
    },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        colorScheme: 'light',
      },
    },
    {
      name: 'chromium-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        colorScheme: 'dark',
      },
    },
  ],
});
