import { defineConfig } from '@playwright/test';
import fullstack from './playwright.fullstack-smoke.config';
import { readSoakConfig } from './e2e/support/whiteboard-collaboration-soak';

const soak = readSoakConfig();

/**
 * Explicit long-running Board evidence lane. It reuses the isolated full-stack
 * topology but replaces the ordinary project list, output directory and budget.
 */
export default defineConfig({
  ...fullstack,
  outputDir: 'test-results/whiteboard-collaboration-soak',
  projects: [{ name: 'whiteboard-collaboration-soak', testMatch: ['whiteboard-collaboration-soak.spec.ts'] }],
  timeout: soak.durationMs + soak.offlineMs + 10 * 60_000,
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: 'test-results/whiteboard-collaboration-soak/playwright.json' }]]
    : 'list',
});
