import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "official-role-status.browser.ts", workers: 1, retries: 0, timeout: 180000,
  use: { baseURL: "http://localhost:3199", ...devices["Desktop Chrome"] },
  webServer: { command: "NEXT_DIST_DIR=.next-official-role-6436 next dev -p 3199", url: "http://localhost:3199/avatars/digital-humans/dh-03-product-manager.webp", reuseExistingServer: false, timeout: 240000 },
  reporter: "list",
});
