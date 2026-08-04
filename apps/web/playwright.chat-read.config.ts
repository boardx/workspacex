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
        // The catalog schema override is intentionally test-only; production always resolves
        // the public Agent catalog. Authentication in this journey still uses a signed login.
        KERNEL_ALLOW_TEST_PRINCIPAL: "1",
        KERNEL_AGENT_CATALOG_SCHEMA: "chat_wave2_fixture",
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
