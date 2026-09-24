import * as Y from 'yjs';

export const WHITEBOARD_UPDATE_LIMITS = {
  bytes: 65536, structsPerUpdate: 10000, logicalUnitsPerUpdate: 200000,
  documentStructs: 200000, documentBytes: 32 * 1024 * 1024,
} as const;

/** Applies the same aggregate wire limits to trusted local deltas and network input. */
export function assertWhiteboardUpdateLimits(update: Uint8Array): void {
  if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > WHITEBOARD_UPDATE_LIMITS.bytes) throw new Error('UPDATE_LIMIT_EXCEEDED');
  const decoded = Y.decodeUpdate(update);
  if (decoded.structs.length > WHITEBOARD_UPDATE_LIMITS.structsPerUpdate
    || decoded.structs.reduce((sum, item) => sum + item.length, 0) > WHITEBOARD_UPDATE_LIMITS.logicalUnitsPerUpdate) throw new Error('UPDATE_LIMIT_EXCEEDED');
}
