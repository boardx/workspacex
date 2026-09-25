import { defineConfig } from '@playwright/test';
import fullstack from './playwright.fullstack-smoke.config';

const minutes = Number(process.env.BOARD_ROOM_SOAK_MINUTES ?? '30');

/**
 * Explicit long-running meeting-room evidence lane. The full-stack topology is
 * shared with the ordinary smoke config, while this config exposes only the
 * room soak project so the spec gate can prove which controlled lane owns it.
 */
export default defineConfig({
  ...fullstack,
  outputDir: 'test-results/whiteboard-room-soak',
  projects: [{ name: 'whiteboard-room-soak', testMatch: ['whiteboard-room-soak.spec.ts'] }],
  timeout: (minutes * 60 + 180) * 1_000,
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: 'test-results/whiteboard-room-soak/playwright.json' }]]
    : 'list',
});
