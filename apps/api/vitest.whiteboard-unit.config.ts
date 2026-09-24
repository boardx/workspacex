import { defineConfig } from 'vitest/config';

/** Pure Board lane: guard tests plus capacity/telemetry. No PostgreSQL, Redis, sockets or Docker;
 * PostgreSQL behavior is verified separately in the owned isolated stack. */
export default defineConfig({ test: {
  include: [
    'tests/whiteboard/discussion-{guards,permissions}.test.ts',
    'tests/whiteboard/scale-policy.test.ts',
    'tests/whiteboard/observability.test.ts',
    'tests/whiteboard/operations-controller.test.ts',
    'tests/whiteboard/validator-queue.test.ts',
    'tests/whiteboard/portable-board.test.ts',
    'tests/whiteboard/transfer-repository-guard.test.ts',
  ],
  environment: 'node',
  maxWorkers: 1,
  minWorkers: 1,
} });
