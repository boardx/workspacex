import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/** Whiteboard collaboration counterproofs that use only in-memory ports and loopback. */
export default defineConfig({ resolve:{alias:{
  '@repo/contracts/whiteboard-import':resolve(__dirname,'../../packages/contracts/src/whiteboard-import.ts'),
  '@repo/contracts/whiteboard-document':resolve(__dirname,'../../packages/contracts/src/whiteboard-document.ts'),
  '@repo/contracts/whiteboard-sync':resolve(__dirname,'../../packages/contracts/src/whiteboard-sync.ts'),
  '@repo/contracts/whiteboard-collaboration':resolve(__dirname,'../../packages/contracts/src/whiteboard-collaboration.ts'),
  '@repo/contracts/whiteboard-operation':resolve(__dirname,'../../packages/contracts/src/whiteboard-operation.ts'),
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
    'tests/whiteboard/operation-service.test.ts',
      'tests/whiteboard/operation-repository-guard.test.ts',
      'tests/whiteboard/operation-actor-parity.test.ts','tests/whiteboard/operation-idempotency-acl.test.ts','tests/whiteboard/operation-rate-limit.test.ts','tests/whiteboard/artifact-layout-binding.test.ts','tests/whiteboard/artifact-handoff-verifier.test.ts','tests/whiteboard/ai-proposal-provenance.test.ts','tests/whiteboard/ai-proposal-revision-conflict.test.ts','tests/whiteboard/meeting-room-viewport-revision.test.ts','tests/whiteboard/meeting-room-soak-gate.test.ts',
      'tests/whiteboard/proposal-presentation-repository-guard.test.ts',
  ],
  maxWorkers: 1, minWorkers: 1, testTimeout: 10_000,
} });
