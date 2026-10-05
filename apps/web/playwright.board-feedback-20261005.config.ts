import { defineConfig, devices } from '@playwright/test';
import base from './playwright.fullstack-smoke.config';

/** One isolated full-stack runtime and no unrelated project dependency chain. */
export default defineConfig({
  ...base,
  testDir: './e2e',
  testMatch: ['board-feedback-20261005.spec.ts', 'board-drawing-live-preview.spec.ts', 'board-compact-chrome-acceptance.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: 'test-results/board-feedback-20261005',
  projects: [{ name: 'board-feedback-20261005', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
});
