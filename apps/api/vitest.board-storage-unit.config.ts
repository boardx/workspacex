import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/whiteboard/board-blob-store.test.ts',
      'tests/whiteboard/board-content-manifest.test.ts',
      'tests/whiteboard/board-blob-codec.test.ts',
      'tests/whiteboard/board-content-heads-pglite.test.ts',
      'tests/whiteboard/board-content-migrations-pglite.test.ts',
      'tests/whiteboard/board-content-online-migration.test.ts',
      'tests/whiteboard/board-content-migration-pglite-runtime.test.ts',
      'tests/whiteboard/content-migration-repository-guard.test.ts',
      'tests/whiteboard/content-rollout-repository-guard.test.ts',
      'tests/whiteboard/board-content-migration-cli.test.ts',
      'tests/whiteboard/board-content-rollout.test.ts',
      'tests/whiteboard/board-storage-provider.test.ts',
      'tests/whiteboard/collaboration-transaction.test.ts',
      'tests/whiteboard/collaboration-repository-guard.test.ts',
    ],
    environment: 'node',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
