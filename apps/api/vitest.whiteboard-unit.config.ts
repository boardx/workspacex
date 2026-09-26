import { defineConfig } from 'vitest/config';

/** Whiteboard collaboration counterproofs that use only in-memory ports and loopback. */
export default defineConfig({ test: {
  include: [
    'tests/whiteboard/collaboration-budget.test.ts',
    'tests/whiteboard/collaboration-gateway-gap.test.ts',
    'tests/whiteboard/collaboration-transaction.test.ts',
    'tests/whiteboard/board-content-copy-guard.test.ts',
    'tests/whiteboard/board-duplicate.test.ts',
    'tests/whiteboard/library-cursor.test.ts',
    'tests/whiteboard/library-management-static.test.ts',
    'tests/whiteboard/resource-repository-guard.test.ts',
    'tests/whiteboard/tag-repository-guard.test.ts',
  ],
  maxWorkers: 1, minWorkers: 1, testTimeout: 10_000,
} });
