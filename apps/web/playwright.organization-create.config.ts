// Public entry locale acceptance reuses this existing CI-reachable Web server.
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  // The dev server compiles the projects route after the browser opens it.
  timeout: 120_000,
  testDir: "./e2e", testMatch: ["organization-create.spec.ts", "i18n-entry.spec.ts"], workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:30494", ...devices["Desktop Chrome"] },
  webServer: {
    command: "NEXT_DIST_DIR=.next-org-create next dev -p 30494",
    url: "http://127.0.0.1:30494", reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
});
