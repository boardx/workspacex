import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { REAL_MODEL_SMOKE } from "./e2e/real-model-smoke-fixture";

/**
 * playwright.real-model-smoke.config.ts —— **真实模型** lane 的独立 config（issue #2802）。
 *
 * ## 与 `playwright.fullstack-smoke.config.ts` 的关系：并列，不替换
 *
 * 那份 config 里的确定性回环模型提供方（`loopback-model-provider.ts` + 三个替身上游）
 * 一个字都不动——86 条 spec 依赖它做**确定性回归门禁**，它们必须继续按原样绿。
 * 本文件是**另加的一条 lane**：上游换成真实模型，代价是不确定 + 要花钱，所以它
 * 永远只手动触发（devapp workflow_dispatch / 本地一条命令），不挂任何 push 钩子。
 *
 * ## 为什么单独一个 config 而不是往那份里加一个 project
 *
 * `webServer` 是 **config 级**的：那份 config 的 webServer 命令里写死了四个回环替身
 * 上游与 `KERNEL_MODEL_*` 的回环取值，一份 config 起不出两套互斥的模型上游。
 * 这与该文件自己头注里 `responsive.spec.ts` 那条豁免的推理逐字同源
 * （"两者不能共存于同一 config"）。
 *
 * ## 两条 lane 的差别只在这份 config 里，spec 一个字都不分叉
 *
 *   · devapp（`.github/workflows/real-model-chat-evidence.yml`）：`REAL_MODEL_E2E_BASE_URL`
 *     指真实部署的公网入口，**不起** webServer——被测对象就是那台机器上正在跑的东西。
 *   · 本地（`pnpm run e2e:real-model-smoke`）：`REAL_MODEL_E2E_START_WEB=1`，本文件起一份
 *     `next build && next start`，打 `e2e-up.sh` 起的本地 API（接真实 dashscope）。
 *
 * ⚠ 本文件必须在**缺任何环境变量时也能被 import**：`lint-spec-gate-coverage.mjs` 会对
 *   每个被 CI 调到的 config 跑 `playwright test --config … --list`，那一跳不带任何
 *   业务环境变量。所以这里一个 `required()` 都不能有（对照那份 fullstack config 顶部
 *   的 `required()`——它有隔离外壳兜底，本文件没有）。
 */
const startLocalWeb = process.env.REAL_MODEL_E2E_START_WEB === "1";
const webPort = process.env.WORKSPACEX_WEB_PORT ?? "3000";
const apiPort = process.env.WORKSPACEX_API_PORT ?? "3200";
const apiOrigin = `http://127.0.0.1:${apiPort}`;

const evidenceDir = path.isAbsolute(REAL_MODEL_SMOKE.evidenceDir)
  ? REAL_MODEL_SMOKE.evidenceDir
  : path.resolve(__dirname, REAL_MODEL_SMOKE.evidenceDir);

export default defineConfig({
  testDir: "./e2e",
  /**
   * 一条 run 就是数分钟真实模型时间，用例自己还会再 `test.setTimeout()` 往上加。
   * 这里给的是**兜底上限**：run 上限 + 5 分钟（登录/构建/收尾）。
   */
  timeout: REAL_MODEL_SMOKE.runTimeoutMs + 300_000,
  expect: { timeout: 30_000 },
  /**
   * ⚠ 不重试。真实模型的一次 run 要花钱，而且两次跑出来的证据不是同一份现场——
   * 自动重试会让"到底哪一次的控制台报错"变得不可辨认，正是这条 lane 要消灭的模糊。
   * 判红之后由人/协调员看证据决定要不要再跑一次。
   */
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: path.join(evidenceDir, "11-playwright-report.json") }]],
  /** trace/截图/录像直接落进证据包目录，`upload-artifact` 一次收走。 */
  outputDir: path.join(evidenceDir, "playwright-artifacts"),
  use: {
    baseURL: REAL_MODEL_SMOKE.baseUrl,
    ...devices["Desktop Chrome"],
    // 这条 lane 的产物就是证据，所以三件全开（而不是 only-on-failure）：
    // 绿的那次同样要能回答"当时到底长什么样"。
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
  },
  projects: [
    {
      name: "real-model-pdf",
      testMatch: ["real-model-pdf-smoke.spec.ts"],
    },
  ],
  ...(startLocalWeb
    ? {
        webServer: [
          {
            /**
             * 本地 lane 的前端。逐条对齐 `playwright.fullstack-smoke.config.ts` 的
             * web webServer（同一套 `FULLSTACK_E2E_API_ORIGIN` 同源代理 + 字体 mock），
             * 只有两处不同：dist 目录另起一个（不与那份的增量缓存互相污染），
             * 以及 API 打的是 `e2e-up.sh` 起的那份**接真实模型**的进程。
             *
             * ⚠ `rm -rf` 的理由见那份 config 同一处的头注（UC-17.8 B4 实测：复用
             *   `.next-*` 增量缓存会 serve 出与源码对不上的旧编译产物）。
             */
            command: `rm -rf .next-real-model-e2e && next build && next start -p ${webPort}`,
            url: `http://127.0.0.1:${webPort}/login`,
            timeout: 600_000,
            reuseExistingServer: false,
            env: {
              ...process.env,
              NEXT_PUBLIC_API_URL: `http://127.0.0.1:${webPort}`,
              NEXT_PUBLIC_API_PATH_PREFIX: "/__fullstack_api",
              // WS 不能走 Next 的 rewrite（那是 HTTP 代理，Upgrade 到那里就断）——
              // 与 fullstack config 同一条既有结论，不重新踩一遍。
              NEXT_PUBLIC_API_WS_URL: apiOrigin,
              FULLSTACK_E2E_API_ORIGIN: apiOrigin,
              NEXT_DIST_DIR: ".next-real-model-e2e",
              NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.resolve(
                __dirname,
                "e2e/support/google-fonts-mock.cjs",
              ),
            },
          },
        ],
      }
    : {}),
});
