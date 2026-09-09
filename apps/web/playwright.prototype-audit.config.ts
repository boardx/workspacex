import { defineConfig, devices } from "@playwright/test";

/**
 * 原型截图审计车道（2026-09-09）。
 *
 * ⚠ **自带 `webServer`**，与 `tplgallery` 那类「对已预热的 dev server 取证」的 config
 * 不同。理由：这条要进 CI，而「先手动起服务」在 CI 上没有人去做——本仓 issue #3138 已经
 * 有三个 playwright 车道**从来没在 CI 上跑过**，再加一条永远跑不起来的等于假门。
 * 服务由 playwright 自己起，本地与 CI 是同一条命令。
 *
 * 独立端口 + 独立 `distDir`：可与常驻 dev server 并存（同 `playwright.config.ts` 的做法）。
 * 不需要 postgres/docker——被审页面的数据全部由 `page.route` 夹具提供。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /prototype-audit\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3198",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "prototype-audit" }],
  webServer: {
    command: "NEXT_DIST_DIR=.next-audit next dev -p 3198",
    url: "http://localhost:3198",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
