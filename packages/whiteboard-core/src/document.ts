import * as Y from 'yjs';
import { WhiteboardObject, WhiteboardCommandBatch, WHITEBOARD_LIMITS, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import { validateContentExtension } from './content-object-model';

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
  const alive = [...objectMap(doc)].filter(([id]) => !tombstones(doc).has(id)).map(([id, value]) => decode(id, value));
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
  for (const value of all.values()) {
    validateContentExtension(value);
    if (tombstones(doc).has(value.id)) continue;
    const visited = new Set([value.id]);
    let parent = value.parentId;
    while (parent) {
      if (visited.has(parent)) throw new Error('PARENT_CYCLE');
      visited.add(parent);
      const container = all.get(parent);
      if (!container || !['frame', 'group'].includes(container.kind)) throw new Error('INVALID_PARENT');
      parent = container.parentId;
    }
    if (value.connector && (!all.has(value.connector.from) || !all.has(value.connector.to))) throw new Error('INVALID_CONNECTOR');
  }
}
function apply(doc: Y.Doc, commands: WhiteboardCommand[]): void {
  const objects = objectMap(doc), deleted = tombstones(doc);
  for (const command of commands) {
    if (command.type === 'create') {
      const { id, text, style, ...rest } = command.object;
      if (objects.has(id) || deleted.has(id)) throw new Error('ID_ALREADY_USED');
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(rest)) item.set(key, structuredClone(value));
      item.set('text', new Y.Text(text));
      item.set('style', new Y.Map<unknown>(Object.entries(style)));
      objects.set(id, item);
      continue;
    }
    const item = objects.get(command.id);
    if (!item || deleted.has(command.id)) throw new Error('OBJECT_NOT_FOUND');
    if (command.type === 'delete') deleted.set(command.id, true);
    if (command.type === 'geometry') item.set('geometry', structuredClone(command.geometry));
    if (command.type === 'style') {
      const style = item.get('style') as Y.Map<unknown>;
      for (const [key, value] of Object.entries(command.style)) style.set(key, value);
    }
    if (command.type === 'extension') {
      const extensionData = structuredClone((item.get('extensionData') as Record<string, unknown> | undefined) ?? {});
      extensionData[command.key] = structuredClone(command.value);
      item.set('extensionData', extensionData);
    }
    if (command.type === 'parent') { item.set('parentId', command.parentId); item.set('orderKey', command.orderKey); }
    if (command.type === 'text') {
      const text = item.get('text') as Y.Text;
      if (command.index > text.length || command.index + command.deleteCount > text.length) throw new Error('TEXT_RANGE');
      if (command.deleteCount) text.delete(command.index, command.deleteCount);
      if (command.insert) text.insert(command.index, command.insert);
    }
  }
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
  for (const object of chosen) validateContentExtension(object);
  const mapping = new Map(chosen.map(object => [object.id, newId(object.id)]));
  if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_COPY_ID');
  return chosen.filter(object => !object.connector || (mapping.has(object.connector.from) && mapping.has(object.connector.to)))
    .map(object => WhiteboardObject.parse({ ...structuredClone(object), id: mapping.get(object.id),
      parentId: object.parentId ? mapping.get(object.parentId) ?? null : null,
      ...(object.connector ? { connector: { from: mapping.get(object.connector.from), to: mapping.get(object.connector.to) } } : {}),
    }));
}
