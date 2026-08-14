import { defineConfig, devices } from "@playwright/test";

// 一次性取证 config：对**已预热**的 dev server（默认 3221）截图，不自带 webServer。
export default defineConfig({
  testDir: "./e2e",
  testMatch: /canvas-tpl-shots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3221",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium" }],
});
