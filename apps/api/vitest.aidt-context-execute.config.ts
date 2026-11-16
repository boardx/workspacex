import { defineConfig } from "vitest/config";
/** In-memory/loopback execution tests only. No PostgreSQL global setup or vendor calls. */
export default defineConfig({ test: { include: [
  "tests/agent-runtime/reference-dispatch.test.ts",
  "tests/agent-runtime/aidt-context-*.test.ts",
  "tests/agent-runtime/execute-run-progress.test.ts",
  "tests/agent-runtime/deep-agent-model-provider.test.ts",
  "tests/agent-runtime/deep-agent-hitl.test.ts",
  "tests/agent-runtime/configured-model-provider-stream.test.ts",
  "tests/agent-runtime/configured-model-provider-thinking.test.ts",
], environment: "node", maxWorkers: 1, minWorkers: 1, testTimeout: 10000 } });
