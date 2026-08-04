import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // SQLite DO 与 isolatedStorage 不兼容。scripts/run-tests.mjs 为每个测试文件
        // 启动独立 workerd 进程；singleWorker 只约束该进程内的单个文件（#403）。
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
            COORD_API_TOKEN: "test-api-token",
            COORD_ADMIN_TOKEN: "test-admin-token",
          },
        },
      },
    },
  },
});
