import * as Y from 'yjs';
import { WhiteboardObject, WhiteboardCommandBatch, WHITEBOARD_LIMITS, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';

export function createWhiteboardDocument(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects'); doc.getMap('deletedObjects');
  return doc;
}
export function cloneDocument(source: Y.Doc): Y.Doc {
  const result = createWhiteboardDocument();
  Y.applyUpdate(result, Y.encodeStateAsUpdate(source));
  return result;
}
export function objectMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> { return doc.getMap('objects'); }
export function tombstones(doc: Y.Doc): Y.Map<boolean> { return doc.getMap('deletedObjects'); }
function decode(id: string, value: Y.Map<unknown>): WhiteboardObject {
  if (!(value instanceof Y.Map) || !(value.get('text') instanceof Y.Text) || !(value.get('style') instanceof Y.Map) || value.has('id')) throw new Error('INVALID_SHARED_TYPE');
  for (const [key, field] of value) if (!['text', 'style'].includes(key) && field instanceof Y.AbstractType) throw new Error('NON_ATOMIC_FIELD');
  for (const delta of (value.get('text') as Y.Text).toDelta()) {
    if (typeof delta.insert !== 'string' || delta.attributes) throw new Error('UNSUPPORTED_TEXT_FORMAT');
  }
  return WhiteboardObject.parse(structuredClone({ ...value.toJSON(), id }));
}
export function readObjects(doc: Y.Doc): WhiteboardObject[] {
  const alive = [...objectMap(doc)].filter(([id]) => !tombstones(doc).has(id)).map(([id, value]) => decode(id, value)).filter(value => value.containerState !== 'ungrouped');
  const ids = new Set(alive.map(value => value.id));
  return alive.filter(value => !value.connector || (ids.has(value.connector.from) && ids.has(value.connector.to)))
    .sort((a, b) => a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** Semantic validation is NOT a sandbox for hostile binary Yjs updates. Only host-validated commands are public. */
export function validateDocument(doc: Y.Doc): void {
  for (const key of doc.share.keys()) if (!['objects', 'deletedObjects'].includes(key)) throw new Error('UNKNOWN_ROOT');
  if (objectMap(doc).size > WHITEBOARD_LIMITS.objects || tombstones(doc).size > WHITEBOARD_LIMITS.tombstones) throw new Error('LIMIT_EXCEEDED');
  for (const [id, value] of tombstones(doc)) if (value !== true || !objectMap(doc).has(id)) throw new Error('INVALID_TOMBSTONE');
  const all = new Map([...objectMap(doc)].map(([id, value]) => [id, decode(id, value)]));
  const visible = new Set([...all.values()].filter(value => !tombstones(doc).has(value.id) && value.containerState !== 'ungrouped').map(value => value.id));
  for (const value of all.values()) {
    if (tombstones(doc).has(value.id)) continue;
    const visited = new Set([value.id]);
    let parent = value.parentId;
    while (parent) {
      if (visited.has(parent)) throw new Error('PARENT_CYCLE');
      visited.add(parent);
      const container = all.get(parent);
      if (!container || tombstones(doc).has(parent) || container.containerState === 'ungrouped' || !['frame', 'group'].includes(container.kind)) throw new Error('INVALID_PARENT');
      parent = container.parentId;
    }
    if (value.connector && (!visible.has(value.connector.from) || !visible.has(value.connector.to))) throw new Error('INVALID_CONNECTOR');
  }
}
function apply(doc: Y.Doc, commands: WhiteboardCommand[]): void {
  const objects = objectMap(doc), deleted = tombstones(doc);
  const value = (id: string): WhiteboardObject => {
    const item = objects.get(id);
    if (!item || deleted.has(id)) throw new Error('OBJECT_NOT_FOUND');
    return decode(id, item);
  };
  const descendants = (id: string): string[] => {
    const children = new Map<string, string[]>();
    for (const [candidateId, candidate] of objects) {
      if (deleted.has(candidateId)) continue;
      const decoded = decode(candidateId, candidate);
      if (decoded.containerState === 'ungrouped' || !decoded.parentId) continue;
      children.set(decoded.parentId, [...(children.get(decoded.parentId) ?? []), candidateId]);
    }
    const result: string[] = [], pending = [id], seen = new Set([id]);
    while (pending.length) {
      const parent = pending.shift()!;
      for (const candidateId of children.get(parent) ?? []) if (!seen.has(candidateId)) { seen.add(candidateId); result.push(candidateId); pending.push(candidateId); }
    }
    return result;
  };
  const create = (object: WhiteboardObject): void => {
    const { id, text, style, ...rest } = object;
    if (objects.has(id) || deleted.has(id)) throw new Error('ID_ALREADY_USED');
    const item = new Y.Map<unknown>();
    for (const [key, field] of Object.entries(rest)) item.set(key, structuredClone(field));
    item.set('text', new Y.Text(text));
    item.set('style', new Y.Map<unknown>(Object.entries(style)));
    objects.set(id, item);
  };
  for (const command of commands) {
    if (command.type === 'create') {
      if (command.object.containerState === 'ungrouped') throw new Error('INVALID_CONTAINER_STATE');
      create(command.object);
      continue;
    }
    if (command.type === 'group' || command.type === 'frame') {
      const kind = command.type;
      if (command.object.kind !== kind || command.object.containerState === 'ungrouped' || command.memberIds.includes(command.object.id)) throw new Error('INVALID_CONTAINER');
      const existing = objects.get(command.object.id);
      if (existing) {
        if (deleted.has(command.object.id) || decode(command.object.id, existing).kind !== kind) throw new Error('ID_ALREADY_USED');
        existing.set('containerState', 'active');
      } else create(command.object);
      for (const id of [...new Set(command.memberIds)]) {
        value(id);
        objects.get(id)!.set('parentId', command.object.id);
      }
      continue;
    }
    const item = objects.get(command.id);
    if (!item || deleted.has(command.id)) throw new Error('OBJECT_NOT_FOUND');
    const currentState = decode(command.id, item).containerState;
    if (currentState === 'ungrouped') {
      if (command.type === 'ungroup') continue;
      throw new Error('OBJECT_NOT_FOUND');
    }
    if (command.type === 'delete') {
      const current = value(command.id);
      if (['frame', 'group'].includes(current.kind)) {
        for (const childId of descendants(command.id).filter(id => objects.get(id)?.get('parentId') === command.id)) objects.get(childId)!.set('parentId', current.parentId);
      }
      deleted.set(command.id, true);
      for (const [candidateId, candidate] of objects) {
        if (deleted.has(candidateId)) continue;
        const connector = decode(candidateId, candidate).connector;
        if (connector && (connector.from === command.id || connector.to === command.id)) deleted.set(candidateId, true);
      }
    }
    if (command.type === 'geometry') item.set('geometry', structuredClone(command.geometry));
    if (command.type === 'style') {
      const style = item.get('style') as Y.Map<unknown>;
      for (const [key, value] of Object.entries(command.style)) style.set(key, value);
    }
    if (command.type === 'parent') { item.set('parentId', command.parentId); item.set('orderKey', command.orderKey); }
    if (command.type === 'translate') {
      const current = value(command.id);
      const ids = ['frame', 'group'].includes(current.kind) ? [command.id, ...descendants(command.id)] : [command.id];
      for (const id of ids) {
        const target = objects.get(id)!;
        const geometry = decode(id, target).geometry;
        target.set('geometry', { ...geometry, x: geometry.x + command.delta.x, y: geometry.y + command.delta.y });
      }
    }
    if (command.type === 'ungroup') {
      const current = value(command.id);
      if (!['frame', 'group'].includes(current.kind)) throw new Error('NOT_A_CONTAINER');
      for (const childId of descendants(command.id).filter(id => objects.get(id)?.get('parentId') === command.id)) objects.get(childId)!.set('parentId', current.parentId);
      item.set('containerState', 'ungrouped');
    }
    if (command.type === 'text') {
      const text = item.get('text') as Y.Text;
      if (command.index > text.length || command.index + command.deleteCount > text.length) throw new Error('TEXT_RANGE');
      if (command.deleteCount) text.delete(command.index, command.deleteCount);
      if (command.insert) text.insert(command.index, command.insert);
    }
  }
}

/** Expand selected semantic containers and remove selected descendants whose ancestor already moves. */
export function expandSelection(doc: Y.Doc, ids: string[]): string[] {
  const visible = readObjects(doc), byId = new Map(visible.map(object => [object.id, object]));
  const selected = new Set(ids.filter(id => byId.has(id)));
  const roots = selectionRoots(doc, [...selected]);
  const result = new Set<string>();
  const visit = (id: string): void => { if (result.has(id)) return; result.add(id); for (const item of visible) if (item.parentId === id) visit(item.id); };
  roots.forEach(visit);
  return [...result];
}

export function selectionRoots(doc: Y.Doc, ids: string[]): string[] {
  const byId = new Map(readObjects(doc).map(object => [object.id, object]));
  const selected = new Set(ids.filter(id => byId.has(id)));
  return [...selected].filter(id => {
    let parent = byId.get(id)?.parentId;
    while (parent) { if (selected.has(parent)) return false; parent = byId.get(parent)?.parentId; }
    return true;
  });
}
/** Synchronous preflight means a failing batch never mutates the caller's document. Origin is not authentication. */
export function executeCommands(doc: Y.Doc, input: unknown, origin: unknown): void {
  const commands = WhiteboardCommandBatch.parse(input);
  const candidate = cloneDocument(doc);
  try { candidate.transact(() => apply(candidate, commands)); validateDocument(candidate); }
  finally { candidate.destroy(); }
  doc.transact(() => apply(doc, commands), origin);
}
export function copyObjects(doc: Y.Doc, ids: string[], newId: (oldId: string) => string): WhiteboardObject[] {
  const chosen = readObjects(doc).filter(object => ids.includes(object.id));
  const mapping = new Map(chosen.map(object => [object.id, newId(object.id)]));
  if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_COPY_ID');
  return chosen.filter(object => !object.connector || (mapping.has(object.connector.from) && mapping.has(object.connector.to)))
    .map(object => WhiteboardObject.parse({ ...structuredClone(object), id: mapping.get(object.id),
      parentId: object.parentId ? mapping.get(object.parentId) ?? null : null,
      ...(object.connector ? { connector: { from: mapping.get(object.connector.from), to: mapping.get(object.connector.to) } } : {}),
    }));
}
