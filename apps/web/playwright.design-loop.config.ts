import { defineConfig, devices } from "@playwright/test";

/**
 * 设计工作台三条 spec 的**轻车道**（2026-09-22）。
 *
 * ## 为什么把它们从 `fullstack-smoke` 里搬出来
 *
 * 这三条（`design-loop-responsive` / `design-prototype-loop` / `design-share`）是这一轮
 * 才第一次真的接进 CI 的——此前它们虽然注册在 `playwright.fullstack-smoke.config.ts` 里，
 * 但那条 config 的 CI 调用只带 `--project=seeded-github-import`，于是**一条都没执行过**。
 * 接进去的办法当时是把它们加进 `verify:fullstack-smoke:raw` 的 `--project` 列表。
 *
 * 那个办法的代价随后在 CI 上兑现了：`fullstack-smoke` 这个 job 的预算是
 * `timeout-minutes: 20`，而它本来就要起 docker（postgres/redis/minio）+ API + 五个
 * 回环上游 + 一次 `next build`；再加 47 条用例之后，「Execute trusted full-stack smoke」
 * 这一步连续两次跑到 18.5 分钟被 job 超时**取消**（run 35784799329 的 attempt 1 与 2）。
 * 取消不是绿，那条车道因此从来没给出过一次完整结论。
 *
 * 而这三条**根本不需要那一整套**：它们的数据全部由 spec 内的 `page.route()` 夹具提供
 * （`scripts/lib/design-loop-fixtures.mjs`，与截图脚本同一份），不读 DB、不需要登录态——
 * 原 config 里给这三个 project 写的注释逐字就是这么说的，它们也因此被特意写成
 * 「不带 dependencies、只复用起好的 web 服务器」。
 *
 * 所以按本仓既有的成例（`playwright.prototype-audit.config.ts`：自带 webServer、
 * 独立端口 + 独立 distDir、不需要 postgres/docker、单独一个 CI job）把它们单独成道。
 * 重的那条车道回到它原来的长度，这三条也终于能在几分钟内给出真结论。
 *
 * ⚠ 两个 viewport 相关的取舍与 fullstack 那份保持一致：`design-loop-responsive` 自己
 *   `test.use({ viewport })` 逐档设，所以这里的默认视口只对另外两条生效。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /design-(loop-responsive|prototype-loop|share)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  // 与 fullstack 那份同口径：重试一次，挡住偶发的首屏抖动，但不掩盖确定性失败。
  retries: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3199",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "design-loop-responsive", testMatch: ["design-loop-responsive.spec.ts"] },
    { name: "design-prototype-loop", testMatch: ["design-prototype-loop.spec.ts"] },
    { name: "design-share", testMatch: ["design-share.spec.ts"] },
  ],
  webServer: {
    command: "NEXT_DIST_DIR=.next-design-loop next dev -p 3199",
    url: "http://localhost:3199",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
