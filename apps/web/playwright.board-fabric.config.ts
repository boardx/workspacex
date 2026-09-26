import { defineConfig, devices } from "@playwright/test";

const port = 3199;
const baseURL = process.env.BOARD_FABRIC_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "board-fabric-surface.spec.ts",
  outputDir: "test-results/board-fabric",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: process.env.BOARD_FABRIC_BASE_URL
    ? undefined
    : {
        command: `NEXT_DIST_DIR=.next-board-fabric-e2e next dev -H 127.0.0.1 -p ${port}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
