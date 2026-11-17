import { defineConfig } from "vitest/config";

/** Acceptance protocol tests have no service, database setup, or model transport. */
export default defineConfig({ test: {
  include: ["tests/chat/aidt-message-acceptance.test.ts", "tests/chat/agent-default-skill-loading.test.ts", "tests/chat/thread-mount-run-snapshot-union.test.ts"],
  fileParallelism: false, maxWorkers: 1, minWorkers: 1,
} });
