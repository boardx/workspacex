// 取证用 config：跑 `chat-main-shots.spec.ts`，抓「对话主屏」的产品侧截图。
//
// webServer / use 全部**沿用** `playwright.chat-read.config.ts`（同一个 docker 栈、同一份
// 种子、同一个登录）。不复制那份定义：复制出来的第二份栈定义就是「同一事实两处声明」，
// 本仓已五次因此漂移（见 AGENTS.md 硬约束）。这里只换 testMatch。
import { defineConfig } from "@playwright/test";
import chatReadConfig from "./playwright.chat-read.config";

export default defineConfig({
  ...chatReadConfig,
  testMatch: "chat-main-shots.spec.ts",
  reporter: "list",
});
