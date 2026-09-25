import * as Y from 'yjs';
import { attribution, cloneDocument, DELETE_ATTRIBUTION_LIMIT, objectMap, tombstones, validateDocument, type DeleteAttributionRecord } from './document';

export const WHITEBOARD_UPDATE_LIMITS = {
  bytes: 65536, structsPerUpdate: 10000, logicalUnitsPerUpdate: 200000,
  documentStructs: 200000, documentBytes: 32 * 1024 * 1024,
  /** Self-undo window: how long after their own delete an actor may still resurrect it. */
  selfUndoWindowMs: 30_000,
} as const;
function sameItem(a: { id: { client: number; clock: number } } | null | undefined, b: { id: { client: number; clock: number } } | null | undefined): boolean {
  return Boolean(a && b && a.id.client === b.id.client && a.id.clock === b.id.clock);
}
function sameStructId(a: { id: { client: number; clock: number } } | null | undefined, record: DeleteAttributionRecord | undefined): boolean {
  return Boolean(a && record && a.id.client === record.tombstoneClient && a.id.clock === record.tombstoneClock);
}
/**
 * Pinned Yjs 13.6.32 adapter. Must run inside a resource-limited worker/process
 * for untrusted network input; size limits do not bound decoder CPU/memory.
 * Returns a vetted update, never mutates authority. Host persists this result
 * before applying/broadcasting it, serialized against the exact same base doc.
 * Missing causal dependencies are rejected: caller requests a complete diff.
 *
 * `actorId` is the authenticated principal that produced `update`, supplied by the
 * host (never trusted from the update bytes themselves). It unlocks exactly one
 * narrow exception to the tombstone-monotonicity rule below: an actor may resurrect
 * their OWN tombstoned object (self-undo of their own delete), within a short
 * window, and only if nothing else has touched that tombstone since. Every other
 * un-tombstone attempt is rejected exactly as before. Omitting `actorId` (e.g. for
 * host/import writers) disables the exception entirely, preserving prior behavior.
 */
export function prepareWhiteboardUpdate(authority: Y.Doc, update: Uint8Array, actorId?: string, now: number = Date.now()): Uint8Array {
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
    const attributionRoot = attribution(candidate);
    for (const struct of decoded.structs) {
      if (!(struct instanceof Y.Item)) continue;
      const integrated = Y.getItem(candidate.store, struct.id);
      if (!(integrated instanceof Y.Item)) continue;
      // The attribution ledger is server-written only; no client update may ever target it.
      if (integrated.parent === attributionRoot) throw new Error('ATTRIBUTION_TAMPERED');
      // A losing concurrent false value is hidden by the final map projection;
      // reject it as well instead of admitting non-monotonic tombstone history.
      if (integrated.parent === tombstones(candidate) && struct.content.getContent().some(value => value !== true)) throw new Error('TOMBSTONE_CHANGED');
    }
    for (const [id] of tombstones(authority)) {
      const before = tombstones(authority)._map.get(id), after = tombstones(candidate)._map.get(id);
      // Two peers can independently delete the same live object. Their true items
      // compete under Y.Map ordering; a changed winning struct is not resurrection.
      // A fresh concurrent set has no observed predecessor. Delete-then-recreate
      // after observing an existing tombstone retains that predecessor in origin.
      const concurrentTrue = after && after.origin === null && after.rightOrigin === null;
      if (tombstones(candidate).get(id) === true && (sameItem(before, after) || concurrentTrue)) continue;
      // Narrow self-undo exception: only the actor who owns this tombstone, only
      // within the window, and only if the tombstone struct we recorded for them
      // is still the one being reverted (nothing else has since changed it).
      const record = attribution(authority).get(id);
      const selfUndo = tombstones(candidate).get(id) !== true && actorId !== undefined && record !== undefined
        && record.actorId === actorId && now - record.deletedAt >= 0 && now - record.deletedAt <= WHITEBOARD_UPDATE_LIMITS.selfUndoWindowMs
        && sameStructId(before, record);
      if (!selfUndo) throw new Error('TOMBSTONE_CHANGED');
    }
    validateDocument(candidate);
    // Server-side bookkeeping, applied after all client-asserted content is vetted:
    // record newly-tombstoned ids under their actor, and consume attribution entries
    // for ids a self-undo just resurrected so they cannot be replayed a second time.
    candidate.transact(() => {
      for (const [id] of tombstones(authority)) {
        if (tombstones(candidate).get(id) !== true) attributionRoot.delete(id);
      }
      if (actorId !== undefined) {
        for (const [id] of tombstones(candidate)) {
          if (tombstones(authority).get(id) !== true) {
            const struct = tombstones(candidate)._map.get(id);
            if (struct) attributionRoot.set(id, { actorId, deletedAt: now, tombstoneClient: struct.id.client, tombstoneClock: struct.id.clock });
          }
        }
      }
      if (attributionRoot.size > DELETE_ATTRIBUTION_LIMIT) {
        const oldest = [...attributionRoot].sort(([, a], [, b]) => a.deletedAt - b.deletedAt).slice(0, attributionRoot.size - DELETE_ATTRIBUTION_LIMIT);
        for (const [id] of oldest) attributionRoot.delete(id);
      }
    });
    if (Y.encodeStateAsUpdate(candidate).byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes) throw new Error('DOCUMENT_LIMIT_EXCEEDED');
    return Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(authority));
  } finally { candidate.destroy(); }
}
