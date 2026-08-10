// 取证用 config：跑 `chat-behavior-shots.spec.ts`，为 CLR **track B**（行为体验，
// `.harness/instructions/chat-ux-acceptance-criteria.md` 十项）抓真实证据。
//
// 与 `playwright.chat-shots.config.ts` 同一个套路：webServer / use / 种子 / 登录全部
// **沿用** `playwright.chat-read.config.ts`，只换 testMatch。不复制栈定义——复制出来的
// 第二份就是「同一事实两处声明」，本仓已五次因此漂移（AGENTS.md 硬约束）。
//
// ## 为什么 track B 要有自己的取证脚本（2026-08-09）
//
// 判据文件写着「必须用真实浏览器在 **devapp 或本地预览环境** 实际操作一遍」。
// 此前评分员走的是 devapp，于是卡在登录：**agent 被安全规则禁止代替人类把密码输入表单**，
// 这条限制不因为是测试账号而改变。结果 track B 六小时零产出，而它是 CLR 四条 track 里
// 唯一完全空白的一条。
//
// 但判据允许「本地预览环境」，而本仓**早就有**一条零人工输入的真登录链路：
// `with-test-isolation` 起隔离栈 → playwright → `loginAs()` 用种子测试账号登录
// （`fullstack-smoke-fixture.ts`）。`shots:chat-main` 一直在用它。
//
// ⇒ **不需要任何人输密码，也不需要 agent 碰凭据**：测试账号是夹具里的种子数据，
//    登录是自动化代码的一部分，跑在一次性隔离栈上。这与「agent 在 UI 里替人输密码」
//    是两件不同的事。
import { defineConfig } from "@playwright/test";
import chatReadConfig from "./playwright.chat-read.config";

export default defineConfig({
  ...chatReadConfig,
  testMatch: "chat-behavior-shots.spec.ts",
  reporter: "list",
});
