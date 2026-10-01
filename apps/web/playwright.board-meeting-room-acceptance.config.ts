import base from './playwright.fullstack-smoke.config';
import {randomUUID} from 'node:crypto';
import {devices} from '@playwright/test';
const marker = process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER ?? randomUUID();
process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER = marker;
process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT ??= new Date().toISOString();
export default {
  ...base, testDir: './e2e', testMatch: /board-meeting-room-acceptance\.spec\.ts/,
  timeout: 45 * 60_000, fullyParallel: false, workers: 1, retries: 0,
  outputDir: './test-results/board-meeting-room',
  projects: [{name: 'chromium-meeting-room', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 900}, trace: 'off' as const, video: 'off' as const}}],
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer]).map(server => ({...server!, reuseExistingServer: false, env: {...server?.env, WORKSPACEX_DEPLOYMENT_MARKER: marker}})),
};
