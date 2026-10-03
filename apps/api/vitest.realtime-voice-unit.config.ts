import { defineConfig } from "vitest/config";

// These tests use an isolated HTTP/WebSocket server and in-memory ports; no database.
export default defineConfig({
  test: {
    include: ["tests/chat/realtime-digital-human-gateway.test.ts", "tests/chat/realtime-voice-session.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fileParallelism: false,
  },
});
