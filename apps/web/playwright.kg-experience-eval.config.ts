import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { KG_EVAL } from "./e2e/kg-experience-eval/fixture";

/**
 * phase-18 F15 记忆体验评测集（`e2e/kg-experience-eval/`，06-user-experience.md R4 的 E1–E10）。
 *
 * **不是 CI 门**（同 `playwright.parity-eval.config.ts`）：它是一把尺子——跑一遍出 JSON，
 * `node e2e/kg-experience-eval/score.mjs --round R<n>` 折成十维得分写到 `evidence/kg-experience-eval/`。
 * 门是 `tests/kg-experience/score-gate.test.ts`：读最新一轮的分数，并核对检查清单仍是 R0 冻结的那一份。
 *
 * ## 这条栈和 fullstack-smoke 的区别（为什么单独一份）
 * 那条栈从不设 `KG_EXTRACTION_ENABLED`，回环模型也回不出抽取 JSON——记忆根本形成不了。这里：
 *   - 模型：`apps/api/scripts/loopback-kg-eval-model-provider.ts`（抽取按语料逐字回 JSON；对话只照着【记忆】答）；
 *   - API：`KG_EXTRACTION_ENABLED=1`，抽取 / 投影 worker 就在 API 进程里（`KgExtractionWorker` / `KgProjectionWorker`）；
 *     流式开着（`KERNEL_MODEL_STREAM_ENABLED=1`），E10 量得到「首字」；
 *   - web：生产构建（`next build && next start`，独立 distDir），同源代理 `/__fullstack_api` 走真 API。
 *
 * 不起 docker：Postgres（带 AGE + pgvector）与 Redis 由调用方给（`PGHOST/PGPORT/PGDATABASE`、`REDIS_PORT`），
 * 端口全由环境变量给、缺了就抛，不猜默认值。跑法见 `evidence/kg-experience-eval/README.md`。
 *
 * 已经起好的栈可以复用（`KG_EVAL_REUSE=1`）：迭代评测用例时不必每次重建 web。
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see evidence/kg-experience-eval/README.md`);
  return value;
}

const apiPort = required("WORKSPACEX_API_PORT");
const webPort = required("WORKSPACEX_WEB_PORT");
const modelPort = required("WORKSPACEX_MODEL_PROVIDER_PORT");
required("PGDATABASE");
required("REDIS_PORT");
const reuse = process.env.KG_EVAL_REUSE === "1";
const startTimeoutMs = Number(process.env.KG_EVAL_SERVER_TIMEOUT_MS ?? 420_000);
const accounts = [KG_EVAL.owner, KG_EVAL.newbie, KG_EVAL.other, KG_EVAL.idle];
// 一次运行一个编号：各维旅程的观察按它缓存（见 e2e/kg-experience-eval/journey.ts），worker 重启后不重走旅程。
process.env.KG_EVAL_RUN_ID ??= String(Date.now());

export default defineConfig({
  testDir: "./e2e/kg-experience-eval",
  testMatch: /\.eval\.ts$/,
  outputDir: "test-results/kg-experience-eval/artifacts",
  // 十维各自开新对话、各自说各自的话；共用一个库、一个 API 进程，顺序跑（后台 worker 是共享的）。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/kg-experience-eval/results.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    ...(process.env.PW_EXECUTABLE ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE } } : {}),
  },
  webServer: [
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-kg-eval-model-provider.ts",
      url: `http://127.0.0.1:${modelPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: reuse,
      env: {
        ...process.env,
        LOOPBACK_KG_EVAL_PROVIDER_PORT: modelPort,
        LOOPBACK_KG_EVAL_CASES: path.resolve(__dirname, "e2e/kg-experience-eval/cases.json"),
      },
    },
    {
      command: [
        "pnpm --filter @repo/api exec tsx scripts/seed-kg-experience-eval.ts",
        "pnpm --filter @repo/api start",
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      timeout: startTimeoutMs,
      reuseExistingServer: reuse,
      env: {
        ...process.env,
        PORT: apiPort,
        KG_EVAL_FIXTURE: "1",
        KG_EVAL_ORG_ID: KG_EVAL.orgId,
        KG_EVAL_PROJECT_ID: KG_EVAL.projectId,
        KG_EVAL_ACCOUNTS: JSON.stringify(accounts),
        KG_EVAL_AGENT_ID: KG_EVAL.agentId,
        KG_EVAL_MODEL_PROVIDER: KG_EVAL.modelProvider,
        KG_EVAL_MODEL_ID: KG_EVAL.modelId,
        KERNEL_MODEL_PROVIDER: KG_EVAL.modelProvider,
        KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${modelPort}`,
        KERNEL_MODEL_API_KEY: "kg-eval-loopback-key-not-a-secret",
        KERNEL_KG_EXTRACTION_MODEL_ID: KG_EVAL.modelId,
        KERNEL_FOLLOWUP_SUGGESTIONS_MODEL_ID: KG_EVAL.modelId,
        KERNEL_MODEL_STREAM_ENABLED: "1",
        KG_EXTRACTION_ENABLED: "1",
        MODEL_CREDENTIAL_KEY: "kg-eval-credential-key-not-a-secret",
      },
    },
    {
      command: `rm -rf .next-kg-eval && next build && next start -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}/login`,
      timeout: startTimeoutMs,
      reuseExistingServer: reuse,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${webPort}`,
        NEXT_PUBLIC_API_PATH_PREFIX: "/__fullstack_api",
        NEXT_PUBLIC_API_WS_URL: `http://127.0.0.1:${apiPort}`,
        FULLSTACK_E2E_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
        NEXT_DIST_DIR: ".next-kg-eval",
        NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.resolve(__dirname, "e2e/support/google-fonts-mock.cjs"),
      },
    },
  ],
});
