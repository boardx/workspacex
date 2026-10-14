import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.CHAT_STICKY_BROWSER_PORT || '32797');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/fabric-sticky-browser',
  testMatch: 'containment.spec.ts',
  outputDir: './test-results/chat-sticky-browser',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL, viewport: { width: 1000, height: 480 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'real-chromium-sticky', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/fabric-sticky-browser/serve.cjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { CHAT_STICKY_BROWSER_PORT: String(port) },
  },
});
