import { defineConfig } from 'vitest/config';

/** Pure Board capacity/telemetry lane: no PostgreSQL, Redis, sockets or Docker. */
export default defineConfig({ test: {
  include: [
    'tests/whiteboard/scale-policy.test.ts',
    'tests/whiteboard/observability.test.ts',
    'tests/whiteboard/operations-controller.test.ts',
    'tests/whiteboard/validator-queue.test.ts',
  ],
  maxWorkers: 1,
  minWorkers: 1,
} });
