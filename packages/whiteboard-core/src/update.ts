import * as Y from 'yjs';
import { cloneDocument, objectMap, tombstones, validateDocument } from './document';

export const WHITEBOARD_UPDATE_LIMITS = {
  bytes: 65536, structsPerUpdate: 10000, logicalUnitsPerUpdate: 200000,
  documentStructs: 200000, documentBytes: 32 * 1024 * 1024,
} as const;
function sameItem(a: { id: { client: number; clock: number } } | null | undefined, b: { id: { client: number; clock: number } } | null | undefined): boolean {
  return Boolean(a && b && a.id.client === b.id.client && a.id.clock === b.id.clock);
}
function hasStructRange(doc: Y.Doc, id: { client: number; clock: number }, length: number): boolean {
  const structs = doc.store.clients.get(id.client);
  if (!structs) return false;
  return structs.some(struct => struct.id.clock <= id.clock && struct.id.clock + struct.length >= id.clock + length);
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
    for (const struct of decoded.structs) {
      if (!(struct instanceof Y.Item) || hasStructRange(authority, struct.id, struct.length)) continue;
      const integrated = Y.getItem(candidate.store, struct.id);
      // Application object IDs are single-use. A concurrent Y.Map assignment can
      // lose CRDT arbitration and disappear from the projection while its shared
      // structs remain in history, so inspect every newly admitted root item.
      if (integrated instanceof Y.Item && integrated.parent === objectMap(candidate)
        && typeof integrated.parentSub === 'string' && objectMap(authority).has(integrated.parentSub)) throw new Error('ID_ALREADY_USED');
    }
    for (const [id, item] of objectMap(authority)) {
      const next = objectMap(candidate).get(id);
      if (!next || !sameItem(item._item, next._item)) throw new Error('OBJECT_IDENTITY_REPLACED');
      for (const key of ['text', 'style']) {
        const beforeField = item.get(key), afterField = next.get(key);
        if (!(beforeField instanceof Y.AbstractType) || !(afterField instanceof Y.AbstractType) || !sameItem(beforeField._item, afterField._item)) throw new Error('FIELD_IDENTITY_REPLACED');
      }
      if (item.get('kind') !== next.get('kind') || item.get('schemaVersion') !== next.get('schemaVersion')) throw new Error('IMMUTABLE_FIELD_CHANGED');
    }
    for (const struct of decoded.structs) {
      if (!(struct instanceof Y.Item)) continue;
      const integrated = Y.getItem(candidate.store, struct.id);
      // A losing concurrent false value is hidden by the final map projection;
      // reject it as well instead of admitting non-monotonic tombstone history.
      if (integrated instanceof Y.Item && integrated.parent === tombstones(candidate) && struct.content.getContent().some(value => value !== true)) throw new Error('TOMBSTONE_CHANGED');
    }
    for (const [id] of tombstones(authority)) {
      const before = tombstones(authority)._map.get(id), after = tombstones(candidate)._map.get(id);
      // Two peers can independently delete the same live object. Their true items
      // compete under Y.Map ordering; a changed winning struct is not resurrection.
      // A fresh concurrent set has no observed predecessor. Delete-then-recreate
      // after observing an existing tombstone retains that predecessor in origin.
      const concurrentTrue = after && after.origin === null && after.rightOrigin === null;
      if (tombstones(candidate).get(id) !== true || (!sameItem(before, after) && !concurrentTrue)) throw new Error('TOMBSTONE_CHANGED');
    }
    validateDocument(candidate);
    if (Y.encodeStateAsUpdate(candidate).byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
    return Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(authority));
  } finally { candidate.destroy(); }
}
