import { WHITEBOARD_LIMITS } from '@repo/contracts/whiteboard-document';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';

/**
 * Process-level Board admission policy. Content limits remain owned by the public
 * document contract and Yjs adapter; this object is the single source for host
 * transport, queue and durability envelopes.
 */
export const WHITEBOARD_SCALE_POLICY = {
  document: {
    objects: WHITEBOARD_LIMITS.objects,
    tombstones: WHITEBOARD_LIMITS.tombstones,
    commandsPerBatch: WHITEBOARD_LIMITS.batch,
    encodedBytes: WHITEBOARD_UPDATE_LIMITS.documentBytes,
    structs: WHITEBOARD_UPDATE_LIMITS.documentStructs,
  },
  update: {
    encodedBytes: WHITEBOARD_UPDATE_LIMITS.bytes,
    acceptedBytes: 1024 * 1024,
    commandsEncodedBytes: 256 * 1024,
    stateVectorBytes: 8 * 1024,
  },
  websocket: {
    frameBytes: 96 * 1024,
    connectionsPerBoard: 50,
    pendingMessagesPerConnection: 32,
    outgoingBufferedBytes: 2 * 1024 * 1024,
    handshakeMs: 10_000,
    awarenessIntervalMs: 50,
  },
  validator: {
    workers: 4,
    queuedJobs: 64,
    queuedBytes: 64 * 1024 * 1024,
    queueWaitMs: 10_000,
    workerTimeoutMs: 5_000,
    workerHeapMb: 128,
  },
} as const;

