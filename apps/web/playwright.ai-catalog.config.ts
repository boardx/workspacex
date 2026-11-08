import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ai-catalog-admin.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 300000,
  use: { baseURL: "http://localhost:3199", ...devices["Desktop Chrome"] },
  webServer: {
    command: "NEXT_DIST_DIR=.next-ai-catalog-6418 next dev -p 3199",
    url: "http://localhost:3199/avatars/digital-humans/dh-03-product-manager.webp",
    reuseExistingServer: false,
    timeout: 240000,
  },
  reporter: "list",
});
