import { defineConfig } from 'vitest/config';

/** W10 adapter tests do not touch PostgreSQL; the real lane still launches official MCP + Chromium. */
export default defineConfig({
  test: {
    include: [
      'tests/agent-runtime/playwright-mcp-browser-adapter.test.ts',
      'tests/agent-runtime/playwright-mcp-upstream-contract.test.ts',
      'tests/agent-runtime/playwright-mcp-browser-real.test.ts',
    ],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
