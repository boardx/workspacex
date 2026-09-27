import base from './playwright.fullstack-smoke.config';
import {randomUUID} from 'node:crypto';
import {devices} from '@playwright/test';

// Importing this config only defines the run. The main session owns starting and
// tearing down its isolated stack, and must supply the private ledger HMAC key.
const marker = process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER ?? randomUUID();
const startedAt = process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT ?? new Date().toISOString();
process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER = marker;
process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT = startedAt;
export default {
  ...base, testDir: './e2e', testMatch: /board-collaboration-soak\.spec\.ts/,
  timeout: 45 * 60_000, fullyParallel: false, workers: 1, retries: 0,
  outputDir: './test-results/board-soak',
  projects: [{name: 'chromium-soak', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 800}, trace: 'off' as const, video: 'off' as const}}],
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer]).map(server => ({
    ...server!, reuseExistingServer: false, env: {...server?.env, WORKSPACEX_DEPLOYMENT_MARKER: marker},
  })),
};
