// 取证用 config：跑 `chat-main-shots.spec.ts`，抓「对话主屏」的产品侧截图。
//
// webServer / use 全部**沿用** `playwright.chat-read.config.ts`（同一个 docker 栈、同一份
// 种子、同一个登录）。不复制那份定义：复制出来的第二份栈定义就是「同一事实两处声明」，
// 本仓已五次因此漂移（见 AGENTS.md 硬约束）。这里只换 testMatch。
import { defineConfig } from "@playwright/test";
import chatReadConfig from "./playwright.chat-read.config";

export default defineConfig({
  ...chatReadConfig,
  // issue #2173 —— `chatReadConfig` 自 #2131 起带了 `projects`（每个 project 自带
  // 自己的 `testMatch` 正则）。Playwright 存在 `projects` 时按 project 级
  // `testMatch` 发现用例，顶层 `testMatch` 会被静默忽略——只覆盖顶层这一行曾经
  // 让本 config 实际跑出 `chat-read`/`chat-task-workbench` 两个 project 的全部
  // 108 个不相关用例，目标 spec 一次都没被选中。这里必须显式覆盖整个
  // `projects` 数组为单一 project，不能只设顶层 `testMatch`。
  projects: [{ name: "chat-shots", testMatch: /chat-main-shots\.spec\.ts$/ }],
  reporter: "list",
});
