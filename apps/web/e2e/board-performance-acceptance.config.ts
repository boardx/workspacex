import {resolve} from 'node:path';
import base from '../playwright.fullstack-smoke.config';
import {randomUUID} from 'node:crypto';
import {devices} from '@playwright/test';
// Inherited shell commands are authored relative to apps/web, not this e2e directory.
const webDirectory = resolve(__dirname, '..');

// Fresh server marker identifies this invocation; it is observed via /healthz.
const marker = process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER ?? randomUUID();
const startedAt = process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT ?? new Date().toISOString();
// This lane performs the same production build as fullstack smoke before it can
// measure 1k/5k/10k boards. GitHub run 36450597783 timed out at the inherited
// 240s startup budget before any performance test was discovered. Keep the
// lightweight loopback providers at their 30s fail-fast budget while allowing
// the API seed/build and hermetic Next build their measured CI startup window.
const heavyServerStartTimeoutMs = Number(process.env.BOARD_PERFORMANCE_SERVER_TIMEOUT_MS ?? 360_000);
process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER = marker;
process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT = startedAt;
export default {
  ...base, testDir: '.', testMatch: /board-performance-acceptance\.spec\.ts/,
  fullyParallel: false, workers: 1, retries: 0,
  use: {...base.use, trace: 'off' as const},
  outputDir: `../test-results/board-performance/${process.env.BOARD_PERFORMANCE_LANE ?? 'manual'}`,
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 900}}}],
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer]).map(server => ({
    ...server!, cwd: resolve(webDirectory, server?.cwd ?? '.'), reuseExistingServer: false,
    timeout: server?.timeout === 30_000 ? server.timeout : Math.max(server?.timeout ?? 0, heavyServerStartTimeoutMs),
    env: {...server?.env, WORKSPACEX_DEPLOYMENT_MARKER: marker},
  })),
};
