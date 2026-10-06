import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "organization-create.spec.ts", workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:30494", ...devices["Desktop Chrome"] },
  webServer: {
    command: "NEXT_DIST_DIR=.next-org-create next dev -p 30494",
    url: "http://127.0.0.1:30494", reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
});
