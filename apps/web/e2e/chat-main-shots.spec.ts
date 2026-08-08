import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * 抓「对话主屏」的**产品侧截图**，与 `ui-preview/chat-main-ref/`（原型参照图，由
 * `scripts/shot-chat-prototype-ref.mjs` 从权威原型抓出）逐张比对，供 chat 主屏
 * 原型保真迭代使用。
 *
 * ## 为什么必须跑真栈而不是 mock
 * `/chat` 走 `AppShell` 的真实 `SessionProvider`，未登录直接 `router.replace("/login")`。
 * 拿 mock 抓出来的图和用户在 devapp 上看到的不是同一个东西 —— 本仓已经因为
 * 「评审签的和用户用的不是同一个产品」返工过一次（见 ui-preview/README.md 2026-07-30）。
 * 所以这里复用 `playwright.chat-read.config.ts` 的整栈（postgres + redis + API + web）。
 *
 * ## 这不是门控
 * 本 spec 只产出证据、不做断言判定，因此**不接** `verify:*`，由
 * `pnpm run shots:chat-main` 显式调用。它落在 `lint-spec-gate-coverage` 的
 * 豁免名单里（理由同上：它不是规格，是取证工具）。
 */

/**
 * ⚠ **不要**把它放回 `test-results/` 下面。那是 Playwright 自己的 scratch 目录，
 *   它在每次 run 开始时整个清空 —— 于是「上一轮抓的图」会在下一次跑任何 e2e 时
 *   静默消失，而评分员那边只会看到一个不存在的路径。实测踩过一次：
 *   verify:chat-read 跑完后 chat-main-live/ 三张图连目录一起没了。
 */
const OUT = resolve(process.env.CHAT_SHOTS_OUT ?? ".chat-shots");
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

test("capture chat main screen against the real stack", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  /** 抓一张，并先确认屏上真有内容 —— 空图会让「已比对」变成假的。 */
  const shoot = async (file: string, testId: string) => {
    await page.getByTestId(testId).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${file}` });
  };

  // ⚠ 锚点用 `chat-read-thread-list`（两条路径都渲染它）。两个屏组件都**没有**根 testid，
  //   写 `chat-read-screen` / `personal-chat-screen` 会永远等不到 —— 这两个名字在源码里
  //   一次都不存在，是我第一版凭组件名猜的。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await shoot("chat-main-default.png", "chat-read-thread-list");

  await page.goto("/chat");
  await shoot("chat-main-personal.png", "chat-read-thread-list");

  // 375 档锚点换成 `chat-thread-detail`：AppShell 的左栏是 `hidden md:block`
  // （app-shell.tsx:158），窄屏下线程列表**按设计不渲染**。原来锚在它上面，于是
  // 这一张永远超时 —— 那是锚错了对象，不是响应式坏了。
  await page.setViewportSize(MOBILE);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await shoot("chat-main-mobile.png", "chat-thread-detail");
});
