import { defineConfig } from "vitest/config";

/**
 * E3 第一个价值时刻 + D9 上报的无库单测（埋点先写者胜 / 失败不冒泡 / 同意门 / personal-local 排除 /
 * 静态门）。真库断言（RLS、上报函数）在主套件 tests/first-value/first-value-facts-db.test.ts。
 */
export default defineConfig({
  test: {
    include: [
      "tests/first-value/first-value-recorder.test.ts",
      "tests/first-value/first-value-repo-guard.test.ts",
      "tests/first-value/persist-assistant-citations.test.ts",
      "tests/agent-run/standard-cite.test.ts",
      "tests/chat/get-thread-citations.test.ts",
      "tests/telemetry/run-telemetry-cycle.test.ts",
      "tests/telemetry/telemetry-no-content-tables.test.ts",
      "tests/telemetry/telemetry-benchmark-facts.test.ts",
      "tests/telemetry/telemetry-queue-depth-facts.test.ts",
      "tests/telemetry/telemetry-usage-facts.test.ts",
    ],
  },
});
