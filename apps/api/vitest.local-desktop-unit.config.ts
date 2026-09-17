import { defineConfig } from "vitest/config";

/**
 * Unit lane for the desktop/local build's adapters (issue #3716). No database, no Redis:
 * runnable on a bare machine, which is exactly the environment those adapters exist for.
 */
export default defineConfig({ test: {
  include: ["tests/auth/file-session-token-store.test.ts", "tests/recording/local-asr-gateway-compat.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
