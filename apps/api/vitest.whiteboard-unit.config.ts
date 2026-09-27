import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/** Whiteboard collaboration counterproofs that use only in-memory ports and loopback. */
export default defineConfig({ resolve:{alias:{
  '@repo/contracts/whiteboard-import':resolve(__dirname,'../../packages/contracts/src/whiteboard-import.ts'),
  '@repo/contracts/whiteboard-document':resolve(__dirname,'../../packages/contracts/src/whiteboard-document.ts'),
  '@repo/contracts/whiteboard-sync':resolve(__dirname,'../../packages/contracts/src/whiteboard-sync.ts'),
  '@repo/contracts/whiteboard-collaboration':resolve(__dirname,'../../packages/contracts/src/whiteboard-collaboration.ts'),
  '@repo/contracts':resolve(__dirname,'../../packages/contracts/src/index.ts'),
  '@repo/whiteboard-core':resolve(__dirname,'../../packages/whiteboard-core/src/index.ts'),
}},test: {
  include: [
    'tests/whiteboard/collaboration-budget.test.ts',
    'tests/whiteboard/collaboration-gateway-gap.test.ts',
    'tests/whiteboard/collaboration-transaction.test.ts',
    'tests/whiteboard/recovery-service.test.ts',
    'tests/whiteboard/object-manifest-store.test.ts',
    'tests/whiteboard/import-parser.test.ts',
    'tests/whiteboard/import-service.test.ts',
    'tests/whiteboard/recovery-metadata.test.ts',
    'tests/whiteboard/import-repository-guard.test.ts',
    'tests/whiteboard/recovery-repository-guard.test.ts',
    'tests/whiteboard/blob-pointer-atomicity.test.ts',
    'tests/whiteboard/blob-retention-gc.test.ts',
    'tests/whiteboard/blob-backup-restore.test.ts',
    'tests/whiteboard/miro-mural-import-conformance.test.ts',
    'tests/whiteboard/import-security-boundary.test.ts',
  ],
  maxWorkers: 1, minWorkers: 1, testTimeout: 10_000,
} });
