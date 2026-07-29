import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 只为一件事而装：**UC-0.4 R12 V9 的响应式断言**（一致性复核 N-7）。
 *
 * UC-0.4 R8 承诺「本件以机器门控代替人类 sign-off，R12 的 V1–V10 全部为可执行断言，
 * 无一条依赖人工判断」。在此之前 **V9 是这个承诺唯一未兑现的一条**——
 * 三档无横向溢出只被人手动用浏览器验过一次。
 *
 * ⚠ 刻意不把已有的七态/身份/生产门控搬到 Playwright：
 *   那些用「对 SSR 出的 HTML 断言固定 testid」更稳、更快、不依赖浏览器下载。
 *   浏览器只用在**必须真实渲染才能测**的地方——布局溢出正是这一类。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3197" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 独立端口 + 独立 distDir，可与常驻 dev server 并存（同 verify-ui-states.sh 的做法）
    command: "NEXT_DIST_DIR=.next-e2e next dev -p 3197",
    url: "http://localhost:3197",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
