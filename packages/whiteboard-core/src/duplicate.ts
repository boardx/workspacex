import * as Y from 'yjs';
import { WhiteboardObject, WhiteboardObjectId, WHITEBOARD_LIMITS, type WhiteboardObject as WhiteboardObjectValue } from '@repo/contracts/whiteboard-document';
import { createWhiteboardDocument, executeCommands, objectMap, tombstones, validateDocument } from './document';

export interface DuplicatedWhiteboardSnapshot {
  snapshot: Uint8Array;
  objectCount: number;
  connectorCount: number;
  assetCount: number;
}

function decode(id: string, value: Y.Map<unknown>): WhiteboardObjectValue {
  if (!(value instanceof Y.Map) || !(value.get('text') instanceof Y.Text) || !(value.get('style') instanceof Y.Map) || value.has('id')) throw new Error('INVALID_DUPLICATE_SOURCE');
  for (const [key, field] of value) if (!['text', 'style'].includes(key) && field instanceof Y.AbstractType) throw new Error('INVALID_DUPLICATE_SOURCE');
  for (const delta of (value.get('text') as Y.Text).toDelta()) {
    if (typeof delta.insert !== 'string' || delta.attributes) throw new Error('INVALID_DUPLICATE_SOURCE');
  }
  const parsed = WhiteboardObject.safeParse(structuredClone({ ...value.toJSON(), id }));
  if (!parsed.success) throw new Error('INVALID_DUPLICATE_SOURCE');
  return parsed.data;
}

const referenceKey = /(?:object|node|parent|child|source|target|from|to|ref|reference|relation|related)(?:id|ids)?$/i;
function assertNoOpaqueReference(value: unknown, sourceIds: ReadonlySet<string>, key = ''): void {
  if (referenceKey.test(key)) throw new Error('UNSUPPORTED_EXTENSION_REFERENCE');
  if (typeof value === 'string') {
    if (sourceIds.has(value)) throw new Error('UNSUPPORTED_EXTENSION_REFERENCE');
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertNoOpaqueReference(item, sourceIds, key); return; }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) assertNoOpaqueReference(child, sourceIds, childKey);
  }
}

function dependencyOrder(objects: WhiteboardObjectValue[]): WhiteboardObjectValue[] {
  const remaining = new Map(objects.filter(item => item.kind !== 'connector').map(item => [item.id, item]));
  const ordered: WhiteboardObjectValue[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter(item => item.parentId === null || !remaining.has(item.parentId));
    if (!ready.length) throw new Error('INVALID_DUPLICATE_REFERENCE');
    ready.sort((a, b) => a.id.localeCompare(b.id));
    for (const item of ready) { ordered.push(item); remaining.delete(item.id); }
  }
  return ordered.concat(objects.filter(item => item.kind === 'connector').sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * Parses a captured source snapshot through the canonical schema and creates a
 * fresh document. Opaque extension references fail closed because silently
 * preserving or heuristically rewriting them would corrupt extension semantics.
 */
export function duplicateWhiteboardSnapshot(sourceSnapshot: Uint8Array, newId: (sourceId: string) => string): DuplicatedWhiteboardSnapshot {
  if (!(sourceSnapshot instanceof Uint8Array)) throw new Error('INVALID_DUPLICATE_SOURCE');
  const source = createWhiteboardDocument();
  const target = createWhiteboardDocument();
  try {
    try { Y.applyUpdate(source, sourceSnapshot); validateDocument(source); }
    catch { throw new Error('INVALID_DUPLICATE_SOURCE'); }
    const objects = [...objectMap(source)]
      .filter(([id]) => !tombstones(source).has(id))
      .map(([id, value]) => decode(id, value));
    if (objects.length > WHITEBOARD_LIMITS.objects) throw new Error('INVALID_DUPLICATE_SOURCE');
    const sourceIds = new Set(objects.map(item => item.id));
    const mapping = new Map<string, string>();
    const targetIds = new Set<string>();
    for (const item of objects) {
      const id = newId(item.id);
      if (!WhiteboardObjectId.safeParse(id).success) throw new Error('INVALID_DUPLICATE_ID');
      if (id === item.id || sourceIds.has(id)) throw new Error('DUPLICATE_ID_NOT_FRESH');
      if (targetIds.has(id)) throw new Error('DUPLICATE_ID_COLLISION');
      mapping.set(item.id, id);
      targetIds.add(id);
      if (item.extensionData !== undefined) assertNoOpaqueReference(item.extensionData, sourceIds);
    }
    const copies = dependencyOrder(objects).map(item => {
      if (item.parentId !== null && !mapping.has(item.parentId)) throw new Error('INVALID_DUPLICATE_REFERENCE');
      if (item.connector && (!mapping.has(item.connector.from) || !mapping.has(item.connector.to))) throw new Error('INVALID_DUPLICATE_REFERENCE');
      return WhiteboardObject.parse({
        ...structuredClone(item), id: mapping.get(item.id),
        parentId: item.parentId === null ? null : mapping.get(item.parentId),
        ...(item.connector ? { connector: { from: mapping.get(item.connector.from), to: mapping.get(item.connector.to) } } : {}),
        // restoredFrom is immutable historical provenance, not a live relation;
        // preserving it records lineage without coupling target edits to source.
      });
    });
    for (let offset = 0; offset < copies.length; offset += WHITEBOARD_LIMITS.batch) {
      executeCommands(target, copies.slice(offset, offset + WHITEBOARD_LIMITS.batch).map(object => ({ type: 'create' as const, object })), 'duplicate-board');
    }
    validateDocument(target);
    return {
      snapshot: Y.encodeStateAsUpdate(target), objectCount: copies.length,
      connectorCount: copies.filter(item => item.kind === 'connector').length,
      assetCount: copies.filter(item => item.kind === 'image').length,
    };
  } finally { source.destroy(); target.destroy(); }
}
