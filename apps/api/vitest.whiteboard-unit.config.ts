import { defineConfig } from 'vitest/config';

/** Pure Board unit lane: no PostgreSQL, Redis, sockets or Docker. */
export default defineConfig({ test: {
  include: [
    'tests/whiteboard/scale-policy.test.ts',
    'tests/whiteboard/observability.test.ts',
    'tests/whiteboard/operations-controller.test.ts',
    'tests/whiteboard/validator-queue.test.ts',
    'tests/whiteboard/portable-board.test.ts',
    'tests/whiteboard/transfer-repository-guard.test.ts',
    'tests/whiteboard/miro-api-client.test.ts',
    'tests/whiteboard/miro-direct-import.test.ts',
    'tests/whiteboard/miro-repository-guard.test.ts',
    'tests/whiteboard/miro-controller.test.ts',
  ],
  environment: 'node',
  maxWorkers: 1,
  minWorkers: 1,
} });
