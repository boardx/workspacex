import { defineConfig } from "vitest/config";

/** HTTP-only provider/runtime compatibility lane: it owns loopback processes and no DB. */
export default defineConfig({
  test: {
    include: ["apps/api/tests/agent-runtime/deep-agent-self-hosted-runtime-contract.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
