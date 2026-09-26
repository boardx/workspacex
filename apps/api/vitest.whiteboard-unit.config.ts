import { defineConfig } from 'vitest/config';

/** Whiteboard collaboration counterproofs that use only in-memory ports and loopback. */
export default defineConfig({ test: {
  include: [
    'tests/whiteboard/collaboration-budget.test.ts',
    'tests/whiteboard/collaboration-gateway-gap.test.ts',
    'tests/whiteboard/collaboration-transaction.test.ts',
  ],
  maxWorkers: 1, minWorkers: 1, testTimeout: 10_000,
} });
