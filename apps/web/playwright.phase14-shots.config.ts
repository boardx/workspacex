import { defineConfig, devices } from "@playwright/test";

// 一次性取证 config：对**已预热**的 dev server（默认 3242）截图，不自带 webServer。
// 纯前端 mock 预览页（不接后端），产出落到 phase-14 的 ui-preview/。
export default defineConfig({
  testDir: "./e2e",
  testMatch: /phase14-cost-trace-shots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3242",
    ...devices["Desktop Chrome"],
    viewport: { width: 1100, height: 900 },
    // 环境内 playwright 浏览器下载走不通（代理），改用系统已装的 chromium-1194。
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM
        ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
  projects: [{ name: "chromium" }],
});
