import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/whiteboard/board-blob-store.test.ts',
      'tests/whiteboard/board-content-manifest.test.ts',
      'tests/whiteboard/board-blob-codec.test.ts',
      'tests/whiteboard/board-content-heads-pglite.test.ts',
      'tests/whiteboard/checkpoint-retention-pglite.test.ts',
      'tests/whiteboard/board-content-migrations-pglite.test.ts',
      'tests/whiteboard/board-content-online-migration.test.ts',
      'tests/whiteboard/board-content-migration-pglite-runtime.test.ts',
      'tests/whiteboard/content-migration-repository-guard.test.ts',
      'tests/whiteboard/board-content-migration-cli.test.ts',
      'tests/whiteboard/board-storage-provider.test.ts',
      'tests/whiteboard/collaboration-transaction.test.ts',
      'tests/whiteboard/collaboration-repository-guard.test.ts',
      'tests/whiteboard/board-storage-selection.test.ts',
      'tests/whiteboard/hosted-board-blob-clients.test.ts',
      'tests/whiteboard/hosted-board-blob-store.test.ts',
      'tests/whiteboard/hosted-board-provider-factory.integration.test.ts',
      'tests/whiteboard/file-board-master-key-source.test.ts',
    ],
    environment: 'node',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
