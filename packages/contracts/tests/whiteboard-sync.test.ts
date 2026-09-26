import { expect, it } from 'vitest';
import { WHITEBOARD_SYNC, WhiteboardClientMessage, WhiteboardServerMessage } from '../src/whiteboard-sync';

it('separates bounded inbound updates and state vectors from whole-document sync frames', () => {
  const encodedLength = 4 * Math.ceil(WHITEBOARD_SYNC.documentBytes / 3);
  expect(WHITEBOARD_SYNC.documentBase64Characters).toBe(encodedLength);
  const emptyEnvelope = Buffer.byteLength(JSON.stringify({ type: 'sync', epoch: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER, update: '', role: 'owner', archived: false }));
  expect(encodedLength + emptyEnvelope).toBeLessThanOrEqual(WHITEBOARD_SYNC.maxPayloadBytes);
  expect(WhiteboardServerMessage.safeParse({ type: 'sync', epoch: 1, seq: 0, update: 'A'.repeat(encodedLength), role: 'owner', archived: false }).success).toBe(true);
  const beyondInbound = 'A'.repeat(WHITEBOARD_SYNC.inboundUpdateBase64Characters + 4), updateId = crypto.randomUUID();
  expect(WhiteboardServerMessage.safeParse({ type: 'sync', epoch: 1, seq: 0, update: beyondInbound, role: 'owner', archived: false }).success).toBe(true);
  expect(WhiteboardClientMessage.safeParse({ type: 'update', epoch: 1, updateId, update: 'A'.repeat(WHITEBOARD_SYNC.inboundUpdateBase64Characters) }).success).toBe(true);
  expect(WhiteboardClientMessage.safeParse({ type: 'update', epoch: 1, updateId, update: beyondInbound }).success).toBe(false);
  expect(WhiteboardClientMessage.safeParse({ type: 'hello', stateVector: 'A'.repeat(WHITEBOARD_SYNC.stateVectorBase64Characters + 4) }).success).toBe(false);
});
