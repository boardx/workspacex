import { defineConfig } from "@playwright/test";
/** Local HTTP fixtures exercise the production page, never a merchant endpoint. */
export default defineConfig({
  testDir: "./e2e", testMatch: "billing-cashier.browser.ts", workers: 1, timeout: 120_000,
  use: { baseURL: "http://localhost:3526", screenshot: "only-on-failure" },
  webServer: { command: "NEXT_DIST_DIR=.next-billing-cashier NEXT_PUBLIC_API_URL=http://localhost:3526/api next dev -p 3526", url: "http://localhost:3526", reuseExistingServer: false, timeout: 120_000 },
});
