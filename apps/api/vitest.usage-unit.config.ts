import { defineConfig } from "vitest/config";
/** Ledger boundary tests run without database setup, Docker or provider calls. */
export default defineConfig({ test: {
  include: ["tests/auth/ai-usage-scope.test.ts", "tests/auth/ai-budget-decision.test.ts", "tests/auth/token-usage-single-write-path.test.ts", "tests/auth/token-usage-receipt.test.ts", "tests/auth/platform-organization-authorization.test.ts", "tests/agent-runtime/configured-model-provider-stream.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
