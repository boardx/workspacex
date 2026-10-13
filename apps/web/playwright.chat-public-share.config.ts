import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'chat-public-share.spec.ts', workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3198', ...devices['Desktop Chrome'] },
  reporter: 'list',
});
