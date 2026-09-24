import { defineConfig } from 'vitest/config';

/**
 * Pure Board unit lane: application commands plus guard tests plus capacity/telemetry checks.
 * No PostgreSQL, Redis, sockets or Docker; persistence and HTTP stay in the isolated DB lane.
 */
export default defineConfig({
  test: {
    include: [
      'tests/whiteboard/public-commands.test.ts',
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
  },
});
