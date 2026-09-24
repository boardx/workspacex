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
  ],
  maxWorkers: 1,
  minWorkers: 1,
} });
