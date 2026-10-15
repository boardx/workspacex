import { defineConfig, devices } from '@playwright/test';
import fullstack from './playwright.fullstack-smoke.config';
export default defineConfig({
  ...fullstack,
  testMatch: ['board-library-thumbnail.spec.ts'],
  projects: [{ name: 'board-library-thumbnail', use: { ...devices['Desktop Chrome'] }, testMatch: ['board-library-thumbnail.spec.ts'] }],
  workers: 1,
  retries: 0,
  outputDir: 'test-results/board-library-thumbnail',
});
