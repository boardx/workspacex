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
/**
 * #728 P6/P7 —— 确定性模型提供方的端口。同一条推理见
 * `playwright.fullstack-smoke.config.ts` 的 `modelProviderPort`：`webPort` 落在
 * #74 隔离外壳分配的一段且每个隔离唯一，`+5000` 是单射，不会撞上 pg/redis/api/web
 * 任何一段。这个 config 此前没有第三个 webServer，这里是新增，不是复制。
 */
const modelProviderPort = String(Number(webPort) + 5_000);
/**
 * #728 P6/P7 —— 第二个确定性替身的端口（`loopback-deep-agent-provider.ts`）。
 * `+6000` 与上面 `modelProviderPort` 的 `+5000` 同一套单射逻辑，继续往后挪一段，
 * 不会撞上 pg/redis/api/web/上一个 provider 任何一段。
 */
const deepAgentProviderPort = String(Number(webPort) + 6_000);
/**
 * #728 P8 —— 确定性 ASR 替身的端口（`loopback-asr-provider.ts`，与
 * `playwright.fullstack-smoke.config.ts` 同一支脚本，不是新写的第二份实现）。
 * `+10000` 抄那份 config 自己的偏移量，同一套单射逻辑。
 */
const asrProviderPort = String(Number(webPort) + 10_000);

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
    /**
     * #728 P8 —— 麦克风权限 + 假音频源，逐字抄
     * `playwright.fullstack-smoke.config.ts` 同一段（`--use-fake-device-for-media-stream`
     * 给真实浏览器采音代码喂一段 Chrome 合成音频，`--use-fake-ui-for-media-stream`
     * 让权限提示自动允许，`permissions: ["microphone"]` 是同一件事的 Playwright 侧
     * 表达）。这个 config 此前没有这两行，取证脚本点麦克风会卡在浏览器权限弹层上。
     */
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    /**
     * #728 P8 —— 确定性 ASR 上游，排在 API 之前：与模型提供方同理，只要在 API
     * 之前 ready 即可。与 `playwright.fullstack-smoke.config.ts` 同一支脚本
     * （`scripts/loopback-asr-provider.ts`），不是新写的第二份实现。
     */
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-asr-provider.ts",
      url: `http://127.0.0.1:${asrProviderPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_ASR_PROVIDER_PORT: asrProviderPort,
        LOOPBACK_ASR_TRANSCRIPT_PREFIX: CHAT_READ_E2E.asrTranscriptPrefix,
      },
    },
    /**
     * #728 P6/P7 —— 确定性模型提供方，排在 API 之前：API 启动时就把 provider 配置
     * 读死了（`readModelProviderConfig` 组装期读一次），真正的连接发生在 run 执行时，
     * 顺序上只要它先 ready 即可。与 `playwright.fullstack-smoke.config.ts` 同一支脚本
     * （`scripts/loopback-model-provider.ts`），不是新写的第二份实现。
     */
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-model-provider.ts",
      url: `http://127.0.0.1:${modelProviderPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_MODEL_PROVIDER_PORT: modelProviderPort,
        LOOPBACK_MODEL_REPLY_PREFIX: CHAT_READ_E2E.agentReplyPrefix,
      },
    },
    /**
     * #728 P6/P7 —— `apps/deep-agent-service` 的确定性替身，见
     * `scripts/loopback-deep-agent-provider.ts` 自己的头注：不是起真的 Python/
     * LangGraph 服务，是在真实 `DeepAgentModelProvider` 代码路径上换一个可预测的
     * HTTP 上游，走同一套「不是 mock fallback」纪律。
     */
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-deep-agent-provider.ts",
      url: `http://127.0.0.1:${deepAgentProviderPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_DEEP_AGENT_PROVIDER_PORT: deepAgentProviderPort,
        LOOPBACK_DEEP_AGENT_FAILURE_TRIGGER: CHAT_READ_E2E.deepAgentFailureTrigger,
      },
    },
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
        // #728 P6/P7 —— 三处对齐里的第二处（第一处是种子脚本的
        // CHAT_E2E_AGENT_MODEL_PROVIDER/_ID，第三处是下面这两行）。不配它，run 会以
        // MODEL_PROVIDER_NOT_CONFIGURED 诚实失败——这正是 #435 记录过的设计，
        // 不是本次改动引入的新行为，这里只是让 chat-read 这条链路也接上它。
        CHAT_E2E_AGENT_MODEL_PROVIDER: CHAT_READ_E2E.agentModelProvider,
        CHAT_E2E_AGENT_MODEL_ID: CHAT_READ_E2E.agentModelId,
        KERNEL_MODEL_PROVIDER: CHAT_READ_E2E.agentModelProvider,
        KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${modelProviderPort}`,
        // 仅供本地回环进程校验存在性；`ConfiguredModelProvider` 要求 apiKey 非空才认为「已配置」。
        KERNEL_MODEL_API_KEY: "chat-read-loopback-key-not-a-secret",
        // #728 P6 —— 打开 `ConfiguredModelProvider.completeStream`（默认关闭，见该文件
        // 自己的头注）。`execute-run.ts` 用它的**存在性**决定走流式分支，`loopback-model-
        // provider.ts` 现在会照实读请求体里的 `stream` 字段回 SSE（见那支脚本自己的
        // #728 P6 头注）——这条链路此前从未真实产生过流式证据，只有 fixture 里的
        // `completeStream`（P7 用的 `DeepAgentModelProvider.completeWithProgress`）分支
        // 走过。`fullstack-smoke` 的 API 进程不设这个变量，行为不变。
        KERNEL_MODEL_STREAM_ENABLED: "1",
        // #728 P6/P7 —— 第二个 agent 的种子参数 + `RoutingModelCallPort` 里
        // `DeepAgentModelProvider` 那一路的上游地址。不供 `KERNEL_DEEP_AGENT_BASE_URL`
        // 时 `DeepAgentModelProvider` 会以 `MODEL_PROVIDER_NOT_CONFIGURED` 诚实失败
        // （见该 provider 自己的 config 头注），这里让 chat-read 这条链路接上它。
        CHAT_E2E_DEEP_AGENT_ID: CHAT_READ_E2E.deepAgentId,
        CHAT_E2E_DEEP_AGENT_MODEL_PROVIDER: CHAT_READ_E2E.deepAgentModelProvider,
        CHAT_E2E_DEEP_AGENT_MODEL_ID: CHAT_READ_E2E.deepAgentModelId,
        CHAT_E2E_DEEP_AGENT_DISPLAY_NAME: CHAT_READ_E2E.deepAgentDisplayName,
        KERNEL_DEEP_AGENT_BASE_URL: `http://127.0.0.1:${deepAgentProviderPort}`,
        // #728 P8 —— 确定性 ASR 上游。不配它，WS 面以 `ASR_NOT_CONFIGURED` 诚实失败
        // （`chat-live-recording-error` 显示「本组织尚未配置转写服务」），不会冒出
        // 一段编造的转录。逐字抄 `playwright.fullstack-smoke.config.ts` 的
        // `asrProviderEnv`，同一套变量名（取自 `configured-realtime-asr-provider.ts`
        // / `env-transcription-policy.ts`，不是猜的）。
        KERNEL_ASR_PROVIDER: "chat-read-loopback-asr",
        KERNEL_ASR_BASE_URL: `ws://127.0.0.1:${asrProviderPort}`,
        KERNEL_ASR_API_KEY: "chat-read-loopback-asr-key-not-a-secret",
        KERNEL_ASR_MODEL: "loopback-transcribe",
        KERNEL_ASR_FINISH_GRACE_MS: "5000",
        RECORDING_LOW_CONFIDENCE_THRESHOLD: "0.5",
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
