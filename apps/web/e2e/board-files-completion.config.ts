import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['board-files-boundaries.spec.ts', 'board-files-filenames.spec.ts', 'board-files-placement.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: {baseURL: process.env.BOARD_CONNECTOR_WEB_URL},
  reporter: [['json', {outputFile: process.env.BOARD_FILES_REPORT_PATH ?? 'test-results/files-boundaries-report.json'}]],
});
