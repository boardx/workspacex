import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import realModel from '../../playwright.real-model-smoke.config';
/** Root-only paid model lane; no fullstack loopback server/config inheritance. */
const webCwd = resolve(__dirname, '../..');
const servers = Array.isArray(realModel.webServer) ? realModel.webServer : realModel.webServer ? [realModel.webServer] : [];
export default defineConfig({
  ...realModel, testDir: '..', workers: 1, retries: 0, fullyParallel: false,
  globalSetup: '../board-real-model-global-setup.ts',
  projects: [{ name: 'real-chat-board-three-diagrams', testMatch: 'chat-board-real-model.spec.ts' }],
  webServer: servers.map(server => ({ ...server, cwd: server.cwd ?? webCwd })),
  outputDir: '../../test-results/chat-board-real-model',
  reporter: [['list'], ['json', { outputFile: resolve(webCwd, 'test-results/chat-board-real-model/report.json') }]],
  use: { ...realModel.use, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
});
