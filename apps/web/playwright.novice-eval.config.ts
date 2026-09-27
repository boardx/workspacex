import { defineConfig, devices } from "@playwright/test";

/**
 * 设计工作台 · 普通用户评测集（`e2e/novice-eval/`）。评分规则见 `e2e/novice-eval/score.mjs`。
 *
 * 是**尺子不是门**（同 `parity-eval`）：检查不过只扣分，用例本身不红；基线远不到 9 分，进 CI 当门会
 * 永远红。等某一维度稳定满分，再把它抄成 `.spec.ts` 回归门——那时候才进 CI。
 *
 * 稳定性：全走夹具路由、单 worker、串行；生成结果是真实模型录下的原样输出，不连网、不调模型。
 */
export default defineConfig({
  testDir: "./e2e/novice-eval",
  testMatch: /\.eval\.ts$/,
  globalSetup: "./e2e/novice-eval/global-setup.ts",
  globalTeardown: "./e2e/novice-eval/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3196",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "NEXT_DIST_DIR=.next-novice-eval next dev -p 3196",
    url: "http://localhost:3196",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
