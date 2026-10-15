import { defineConfig } from "@playwright/test";

/** Isolated UI contract lane. API fixtures never intercept production hosts. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "billing-entry.browser.ts",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: "http://localhost:3514", screenshot: "only-on-failure" },
  webServer: {
    command: "NEXT_DIST_DIR=.next-billing-entry-5714 NEXT_PUBLIC_API_URL=http://localhost:3514/api next dev -p 3514",
    url: "http://localhost:3514",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
