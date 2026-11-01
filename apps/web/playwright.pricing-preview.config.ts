import { defineConfig } from "@playwright/test";

/** UI-only review lane; uses a dedicated local Next instance, never production. */
export default defineConfig({
  testDir: "./e2e", testMatch: "pricing-preview.browser.ts", workers: 1,
  timeout: 120_000, use: { baseURL: "http://localhost:3526", screenshot: "only-on-failure" },
  webServer: {
    command: "NEXT_DIST_DIR=.next-pricing-ui next dev -p 3526",
    url: "http://localhost:3526/preview/pricing", reuseExistingServer: !process.env.CI, timeout: 180_000,
  },
});
