import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["tests/chat/share-chat.test.ts", "tests/diagnostics/debug-request-recorder.test.ts"], maxWorkers: 1, minWorkers: 1,
} });
