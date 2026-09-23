import * as Y from 'yjs';
import { cloneDocument, objectMap, tombstones, validateDocument } from './document';

export const WHITEBOARD_UPDATE_LIMITS = {
  bytes: 65536, structsPerUpdate: 10000, logicalUnitsPerUpdate: 200000,
  documentStructs: 200000, documentBytes: 32 * 1024 * 1024,
} as const;
function sameItem(a: { id: { client: number; clock: number } } | null | undefined, b: { id: { client: number; clock: number } } | null | undefined): boolean {
  return Boolean(a && b && a.id.client === b.id.client && a.id.clock === b.id.clock);
}
/**
 * Pinned Yjs 13.6.32 adapter. Must run inside a resource-limited worker/process
 * for untrusted network input; size limits do not bound decoder CPU/memory.
 * Returns a vetted update, never mutates authority. Host persists this result
 * before applying/broadcasting it, serialized against the exact same base doc.
 * Missing causal dependencies are rejected: caller requests a complete diff.
 */
export function prepareWhiteboardUpdate(authority: Y.Doc, update: Uint8Array): Uint8Array {
  if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > WHITEBOARD_UPDATE_LIMITS.bytes) throw new Error('UPDATE_LIMIT_EXCEEDED');
  const decoded = Y.decodeUpdate(update);
  if (decoded.structs.length > WHITEBOARD_UPDATE_LIMITS.structsPerUpdate || decoded.structs.reduce((sum, item) => sum + item.length, 0) > WHITEBOARD_UPDATE_LIMITS.logicalUnitsPerUpdate) throw new Error('UPDATE_LIMIT_EXCEEDED');
  const candidate = cloneDocument(authority);
  try {
    Y.applyUpdate(candidate, update);
    // Internal store accesses are deliberately isolated here and pinned by tests.
    if (candidate.store.pendingStructs || candidate.store.pendingDs) throw new Error('MISSING_CAUSAL_DEPENDENCY');
    const structures = [...candidate.store.clients.values()].reduce((sum, entries) => sum + entries.length, 0);
    if (structures > WHITEBOARD_UPDATE_LIMITS.documentStructs) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
    for (const [id, item] of objectMap(authority)) {
      const next = objectMap(candidate).get(id);
      if (!next || !sameItem(item._item, next._item)) throw new Error('OBJECT_IDENTITY_REPLACED');
      for (const key of ['text', 'style']) {
        const beforeField = item.get(key), afterField = next.get(key);
        if (!(beforeField instanceof Y.AbstractType) || !(afterField instanceof Y.AbstractType) || !sameItem(beforeField._item, afterField._item)) throw new Error('FIELD_IDENTITY_REPLACED');
      }
      if (item.get('kind') !== next.get('kind') || item.get('schemaVersion') !== next.get('schemaVersion')) throw new Error('IMMUTABLE_FIELD_CHANGED');
    }
    for (const [id] of tombstones(authority)) {
      if (tombstones(candidate).get(id) !== true || !sameItem(tombstones(authority)._map.get(id), tombstones(candidate)._map.get(id))) throw new Error('TOMBSTONE_CHANGED');
    }
    validateDocument(candidate);
    if (Y.encodeStateAsUpdate(candidate).byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
    return Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(authority));
  } finally { candidate.destroy(); }
}
