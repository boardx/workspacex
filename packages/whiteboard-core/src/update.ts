import * as Y from 'yjs';
import { assertLockedObjectsUnchanged, cloneDocument, objectMap, tombstones, validateDocument } from './document';
import { assertWhiteboardUpdateLimits, WHITEBOARD_UPDATE_LIMITS } from './update-limits';

export { WHITEBOARD_UPDATE_LIMITS } from './update-limits';
function sameItem(a: { id: { client: number; clock: number } } | null | undefined, b: { id: { client: number; clock: number } } | null | undefined): boolean {
  return Boolean(a && b && a.id.client === b.id.client && a.id.clock === b.id.clock);
}
/**
 * Pinned Yjs 13.6.32 adapter. Must run inside a resource-limited worker/process
 * for untrusted network input; size limits do not bound decoder CPU/memory.
 * Returns the exact vetted input bytes, never mutates authority. Host persists
 * this result before applying/broadcasting it against the exact same base doc.
 * Missing causal dependencies are rejected: caller requests a complete diff.
 */
export function prepareWhiteboardUpdate(authority: Y.Doc, update: Uint8Array): Uint8Array {
  assertWhiteboardUpdateLimits(update);
  const decoded = Y.decodeUpdate(update);
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
    assertLockedObjectsUnchanged(authority, candidate);
    if (Y.encodeStateAsUpdate(candidate).byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
    // Re-encoding candidate against authority would attach candidate's complete
    // historical delete set. That can turn a tiny valid transaction into an
    // oversized update and permanently lock editing of a healthy long-lived doc.
    return new Uint8Array(update);
  } finally { candidate.destroy(); }
}
