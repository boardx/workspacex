import { defineConfig, devices } from "@playwright/test";

// 一次性取证 config：对**已预热**的 dev server（默认 3242）截图，不自带 webServer。
// 纯前端 mock 预览页（不接后端），产出落到 phase-10 的 ui-preview/。
export default defineConfig({
  testDir: "./e2e",
  testMatch: /live-collab-orchestration-shots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3242",
    ...devices["Desktop Chrome"],
    viewport: { width: 1320, height: 1000 },
  },
  projects: [{ name: "chromium" }],
});
