import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'board-files-acceptance.spec.ts',
  workers: 1, fullyParallel: false, retries: 0, timeout: 120_000,
  use: {baseURL: process.env.BOARD_FILES_WEB_URL, trace: 'off', screenshot: 'only-on-failure'},
  projects: [{name: 'chromium-files-existing-runtime', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 900}}}],
  outputDir: '../test-results/board-files',
  // This lane connects only to an already-running, isolated stack.
});
