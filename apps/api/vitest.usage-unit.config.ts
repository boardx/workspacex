import { defineConfig } from "vitest/config";
/** Ledger boundary tests run without database setup, Docker or provider calls. */
export default defineConfig({ test: {
  include: ["tests/auth/token-usage-single-write-path.test.ts", "tests/auth/token-usage-receipt.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
