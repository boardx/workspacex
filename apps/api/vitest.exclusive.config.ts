import { defineConfig } from "vitest/config";

/**
 * 独占段：设计上不能与其他测试文件并行的转录 DDL、全局原生费率与完整迁移重放用例（
 * 见 vitest.config.ts 的真实 exclude）。本地 package test 与 CI required gates-runtime 均串行执行——
 * 「独占」是它的语义，不是性能取舍。新增独占用例 = 两处同步登记。
 * ⚠ 不用 mergeConfig 继承基础配置：include/exclude 是数组，mergeConfig 会
 *   并集而不是覆盖（实测把整套文件都拉进来了）。需要的基础项手抄如下，
 *   与 vitest.config.ts 同源（env 翻译 / 加密钥匙 / 超时预算）。
 */
export default defineConfig({
  test: {
    include: ["tests/recording/personal-transcription-persistence.test.ts", "tests/billing/native-credit-tariff-pg.test.ts", "tests/billing/global-native-force-replay-pg.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/support/db-global-setup.ts"],
    env: {
      PGDATABASE: process.env.WORKSPACEX_DB ?? "workspacex",
      MODEL_CREDENTIAL_KEY: "vitest-key-548-not-a-production-secret",
    },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
