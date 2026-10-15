import { defineConfig } from "vitest/config";

// Real HTTP/WebSocket transports with in-memory ports; this selection does not use PostgreSQL.
export default defineConfig({
  test: {
    include: [
      "tests/recording/configured-realtime-asr-provider.test.ts",
      "tests/recording/configured-realtime-asr-events.test.ts",
      "tests/recording/personal-realtime-asr-gateway.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 25_000,
    hookTimeout: 15_000,
  },
});
