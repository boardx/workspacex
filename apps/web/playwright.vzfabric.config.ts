import { defineConfig, devices } from "@playwright/test";

// 一次性取证 config：跑 vz-fabric-shots.spec 对着**已预热**的 dev server（3198）。
// 不自带 webServer（避免每次重编译 38s + 离线 google 字体拉取阻塞）。
export default defineConfig({
  testDir: "./e2e",
  testMatch: /vz-fabric-(shots|debug)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3198",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium" }],
});
