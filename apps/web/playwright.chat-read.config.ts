// #512：本 config 此前**不被任何 npm script 或 CI job 调用** —— 于是 chat-read.spec.ts
// 在 main 上红了很久无人发现。现在它由根 `verify:chat-read` 调用，并由 harness-verify.yml
// 的 `e2e-full` job 跑（不是新 job，是既有 job 里的一步：单自建 runner 是硬瓶颈）。
// 「不存在这种没人跑的 spec」本身也已成为机械门控：.harness/scripts/lint-spec-gate-coverage.mjs。
import { defineConfig, devices } from "@playwright/test";
import { CHAT_READ_E2E } from "./e2e/chat-read-fixture";

// 端口不再写死 3211/3198。写死的端口在 CI 上是 #468 那类偶发红（EADDRINUSE）的来源，
// 而 #74 的隔离外壳本来就按 worktree 分配了一组互不相撞的端口 —— 与
// playwright.fullstack-smoke.config.ts:11-12 同一套做法。缺变量即抛，不猜默认值：
// 猜出来的默认值会让「以为隔离了、其实没有」这类失效重新变得不可见。
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; run through the root #74 isolation wrapper (pnpm run verify:chat-read)`);
  return value;
}

const apiPort = required("WORKSPACEX_API_PORT");
const webPort = required("WORKSPACEX_WEB_PORT");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "chat-read.spec.ts",
  fullyParallel: false,
  retries: 0,
  /*
   * #733 —— test 1（"formal Chat writes ..."）在 main 上不稳定，`POST /messages`
   * 有时报 `Expected 202, Received 500`。
   *
   * 实测（本轮排查，4 次独立 `pnpm run verify:chat-read` + 2 次绕开浏览器的裸
   * curl 回归）：`chat.controller.ts` → `acceptHumanMessage` → `PgChatMessageCommandRepository`
   * 这条链路本身是好的 —— 直接对 API 打 curl、以及经由下面第二个 webServer（Next dev
   * 的 rewrite 代理）打 curl，两条路径**各自独立复现了两次**，全部 202，从未见过一次
   * 应用层的 500（应用层的每一条错误响应都必然带 `traceId`，见
   * `apps/api/src/interface/filters/all-exceptions.filter.ts` 的 `@Catch()` 兜底 —— 一个不带
   * `traceId` 的裸 `Internal Server Error` 纯文本响应，只可能来自 Next dev 的反向代理，不可能
   * 来自这个应用）。#651/#661 已经修过一次这条链路真实的根因（`chat_wave2_fixture` 夹具表
   * schema 漂移），那次修复至今没有被后续改动碰过。
   *
   * 4 次官方跑法里，1 一直是失败的那条（2、3 从未失败过），但**每次失败的具体表现都不一样**
   * ——一次卡在 `page.goto('/chat?...')` 30s 超时，两次卡在登录后 `toHaveURL(/\/projects$/)`
   * 5s 超时——这是「时序竞态」的指纹，不是「同一行代码每次都算出同一个错」的指纹。根因：
   * `apps/web/app/layout.tsx` 引入了 `next/font/google`，本机/沙箱缺公网出口时 Next dev
   * 对每个字体分片重试三次才放弃，把 `/login`、`/chat` 这两个路由的**首次**编译拖到 10–30s+
   * （`playwright.fullstack-smoke.config.ts:41-47` 已经记录过同一件事，实测冷构建 3m24s，
   * 结论是「CI 有公网、栈干净，落在默认窗口内，本地慢机器要显式覆盖」）。本 config 此前没抄那一份
   * 覆盖，默认的 5s expect 超时因此比"首次编译"这件事本身还紧。最坏情形下（本轮复现过一次）
   * API 进程在这个窗口内短暂不可达，Next dev 的 rewrite 代理会把连接失败渲染成一个**没有
   * `traceId`、纯文本**的 `500 Internal Server Error` 直接转发给浏览器——这与
   * `response.status()===500` 从 Playwright 侧看完全无法区分，但它不是这个应用抛出来的。
   *
   * 修法：给足首次编译 + 短暂不可达的窗口，而不是动 202 这个断言本身或删掉它——
   * 3 次开着这两个超时的复现，3 次全绿（此前 4 次全部 1 fail / 2 pass）。
   */
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: [
        "docker compose -f ../api/docker-compose.dev.yml -p \"$COMPOSE_PROJECT_NAME\" up -d --wait postgres redis",
        "docker compose -f ../api/docker-compose.dev.yml -p \"$COMPOSE_PROJECT_NAME\" exec -T postgres createdb -U postgres \"$WORKSPACEX_DB\"",
        "pnpm --filter @repo/api migrate",
        "pnpm --filter @repo/api exec tsx scripts/seed-chat-read-e2e.ts",
        "pnpm --filter @repo/api start",
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: apiPort,
        CHAT_E2E_FIXTURE: "1",
        CHAT_E2E_PASSWORD: CHAT_READ_E2E.password,
        CHAT_E2E_EMAIL: CHAT_READ_E2E.email,
        CHAT_E2E_ORG_ID: CHAT_READ_E2E.orgId,
        CHAT_E2E_USER_ID: CHAT_READ_E2E.userId,
        CHAT_E2E_PROJECT_ID: CHAT_READ_E2E.projectId,
        CHAT_E2E_THREAD_ID: CHAT_READ_E2E.threadId,
        CHAT_E2E_AGENT_ID: CHAT_READ_E2E.agentId,
        CHAT_E2E_CATALOG_ONLY_AGENT_ID: CHAT_READ_E2E.catalogOnlyAgentId,
        // The catalog schema override is intentionally test-only; production always resolves
        // the public Agent catalog. Authentication in this journey still uses a signed login.
        KERNEL_ALLOW_TEST_PRINCIPAL: "1",
        KERNEL_AGENT_CATALOG_SCHEMA: "chat_wave2_fixture",
        // #548：不供这一条，API 进程起不来（`credentialCipherFromEnv()` 抛错 ⇒
        // `NestFactory.create` 整个失败），与 chat 无关的这条链会以
        // 「webServer was not able to start」整体红掉。缺 key 是启动失败而不是静默降级，
        // 见 `aes-credential-cipher.ts` 文件头；每个起 API 进程的地方都得供一个。
        MODEL_CREDENTIAL_KEY: "chat-read-credential-key-not-a-secret",
      },
    },
    {
      command: `NEXT_PUBLIC_API_URL=http://127.0.0.1:${webPort} CHAT_READ_E2E_API_ORIGIN=http://127.0.0.1:${apiPort} NEXT_DIST_DIR=.next-chat-read-e2e next dev -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
