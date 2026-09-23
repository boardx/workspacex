import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'whiteboard-preview.spec.ts',
  outputDir: 'test-results/whiteboard', workers: 1, fullyParallel: false,
  timeout: 30_000, reporter: 'list',
  use: { baseURL: process.env.WHITEBOARD_BASE_URL || 'http://localhost:3317', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
});
