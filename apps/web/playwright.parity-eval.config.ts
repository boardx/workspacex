import { defineConfig, devices } from "@playwright/test";

/**
 * 设计工作台 × Claude Design 对标评测（`e2e/parity-eval/`）。**不是 CI 门**——基线本来就大面积失败，
 * 它是一把尺子：跑一遍出 JSON，`node e2e/parity-eval/score.mjs` 把它折成十维得分与报告。
 *
 *   PW_EXECUTABLE=… npx playwright test -c playwright.parity-eval.config.ts
 *   node e2e/parity-eval/score.mjs --round R0
 *
 * 独立端口 + 独立 distDir（同 `playwright.design-loop.config.ts` 的做法），与其它车道并行不打架。
 */
export default defineConfig({
  testDir: "./e2e/parity-eval",
  testMatch: /\.eval\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["json", { outputFile: "test-results/parity-eval/results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3198",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "NEXT_DIST_DIR=.next-parity-eval next dev -p 3198",
    url: "http://localhost:3198",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
