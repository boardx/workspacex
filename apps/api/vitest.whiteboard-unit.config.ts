import { defineConfig } from 'vitest/config';

/** Pure Board application tests; persistence and HTTP stay in the isolated DB lane. */
export default defineConfig({
  test: {
    include: ['tests/whiteboard/public-commands.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
