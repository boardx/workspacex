import { expect, it } from 'vitest';
import { WHITEBOARD_SYNC, WhiteboardServerMessage } from '../src/whiteboard-sync';

it('fits every allowed document in one bounded WebSocket sync frame after base64 expansion', () => {
  const encodedLength = 4 * Math.ceil(WHITEBOARD_SYNC.documentBytes / 3);
  expect(WHITEBOARD_SYNC.documentBase64Characters).toBe(encodedLength);
  const frame = JSON.stringify({
    type: 'sync', epoch: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER,
    update: 'A'.repeat(encodedLength), role: 'owner', archived: false,
  });
  expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(WHITEBOARD_SYNC.maxPayloadBytes);
  expect(WhiteboardServerMessage.safeParse(JSON.parse(frame)).success).toBe(true);
  expect(WhiteboardServerMessage.safeParse({
    type: 'sync', epoch: 1, seq: 0, update: 'A'.repeat(encodedLength + 4), role: 'owner', archived: false,
  }).success).toBe(false);
});
