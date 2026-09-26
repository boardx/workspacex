import * as Y from 'yjs';
import { WhiteboardObject, WhiteboardCommandBatch, WHITEBOARD_LIMITS, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import { validateContentExtension } from './content-object-model';
import { validateSpatialExtension } from './spatial-model';
import { WhiteboardCommentThread } from '@repo/contracts/whiteboard-collaboration';

export function createWhiteboardDocument(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects'); doc.getMap('deletedObjects'); doc.getMap('commentThreads');
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
  const json = value.toJSON();
  return WhiteboardObject.parse(structuredClone({ ...json, id, locked: json.locked ?? false, zIndex: json.zIndex ?? 0 }));
}
export function readObjects(doc: Y.Doc): WhiteboardObject[] {
  const alive = [...objectMap(doc)].filter(([id]) => !tombstones(doc).has(id)).map(([id, value]) => decode(id, value));
  const ids = new Set(alive.map(value => value.id));
  return alive.filter(value => !value.connector || (ids.has(value.connector.from) && ids.has(value.connector.to)))
    .sort((a, b) => a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** Semantic validation is NOT a sandbox for hostile binary Yjs updates. Only host-validated commands are public. */
export function validateDocument(doc: Y.Doc): void {
  for (const key of doc.share.keys()) if (!['objects', 'deletedObjects', 'commentThreads'].includes(key)) throw new Error('UNKNOWN_ROOT');
  if (objectMap(doc).size > WHITEBOARD_LIMITS.objects || tombstones(doc).size > WHITEBOARD_LIMITS.tombstones) throw new Error('LIMIT_EXCEEDED');
  for (const [id, value] of tombstones(doc)) if (value !== true || !objectMap(doc).has(id)) throw new Error('INVALID_TOMBSTONE');
  const all = new Map([...objectMap(doc)].map(([id, value]) => [id, decode(id, value)]));
  const comments = doc.getMap<unknown>('commentThreads');
  if (comments.size > WHITEBOARD_LIMITS.objects) throw new Error('LIMIT_EXCEEDED');
  for (const [id, raw] of comments) {
    const thread = WhiteboardCommentThread.parse(raw);
    const commentIds = new Set(thread.comments.map(comment => comment.id));
    const priorCommentIds = new Set<string>();
    const invalidComment = thread.comments.some((comment, index) => {
      const invalid = comment.threadId !== thread.id || comment.boardId !== thread.boardId || comment.objectId !== thread.objectId
        || (index === 0 ? comment.parentCommentId !== null : !comment.parentCommentId || !priorCommentIds.has(comment.parentCommentId));
      priorCommentIds.add(comment.id); return invalid;
    });
    const bindingInvalid = !all.has(thread.objectId) || (thread.status === 'object-deleted' ? !tombstones(doc).has(thread.objectId) : tombstones(doc).has(thread.objectId));
    if (thread.id !== id || thread.comments.length === 0 || commentIds.size !== thread.comments.length || invalidComment || bindingInvalid) throw new Error('INVALID_COMMENT_THREAD');
  }
  for (const value of all.values()) {
    validateContentExtension(value);
    validateSpatialExtension(value);
    if (tombstones(doc).has(value.id)) continue;
    const visited = new Set([value.id]);
    let parent = value.parentId;
    while (parent) {
      if (visited.has(parent)) throw new Error('PARENT_CYCLE');
      visited.add(parent);
      const container = all.get(parent);
      if (!container || tombstones(doc).has(parent) || !['frame', 'group'].includes(container.kind)) throw new Error('INVALID_PARENT');
      parent = container.parentId;
    }
    if (value.connector && (!all.has(value.connector.from) || !all.has(value.connector.to)
      || tombstones(doc).has(value.connector.from) || tombstones(doc).has(value.connector.to))) throw new Error('INVALID_CONNECTOR');
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
    const current = decode(command.id, item);
    if (current.locked && !(command.type === 'state' && command.locked !== undefined && command.zIndex === undefined)) throw new Error('OBJECT_LOCKED');
    if (command.type === 'delete') {
      if ([...objects].some(([id, value]) => id !== command.id && !deleted.has(id) && decode(id, value).parentId === command.id)) throw new Error('CONTAINER_NOT_EMPTY');
      for (const [id, value] of objects) {
        if (deleted.has(id)) continue;
        const candidate = decode(id, value);
        if (candidate.connector && (candidate.connector.from === command.id || candidate.connector.to === command.id)) {
          if (candidate.locked) throw new Error('OBJECT_LOCKED');
          deleted.set(id, true);
        }
      }
      const commentThreads = doc.getMap<unknown>('commentThreads');
      for (const [threadId, raw] of commentThreads) {
        const thread = WhiteboardCommentThread.parse(raw);
        if (thread.objectId === command.id && thread.status !== 'object-deleted') commentThreads.set(threadId, { ...thread, status: 'object-deleted', archivedAt: new Date().toISOString(), revision: thread.revision + 1 });
      }
      deleted.set(command.id, true);
    }
    if (command.type === 'geometry') {
      if (current.kind !== 'connector') for (const [id, value] of objects) {
        if (deleted.has(id)) continue;
        const edge = decode(id, value);
        if (edge.connector && (edge.connector.from === command.id || edge.connector.to === command.id) && edge.locked) throw new Error('OBJECT_LOCKED');
      }
      item.set('geometry', structuredClone(command.geometry));
      if (current.kind !== 'connector') for (const [id, value] of objects) {
        if (deleted.has(id)) continue;
        const edge = decode(id, value);
        if (!edge.connector || (edge.connector.from !== command.id && edge.connector.to !== command.id)) continue;
        const from = decode(edge.connector.from, objects.get(edge.connector.from)!), to = decode(edge.connector.to, objects.get(edge.connector.to)!);
        const point = (target: WhiteboardObject, anchor = 'center') => {
          const { x, y, width, height } = target.geometry;
          if (anchor === 'top') return { x: x + width / 2, y };
          if (anchor === 'right') return { x: x + width, y: y + height / 2 };
          if (anchor === 'bottom') return { x: x + width / 2, y: y + height };
          if (anchor === 'left') return { x, y: y + height / 2 };
          return { x: x + width / 2, y: y + height / 2 };
        };
        const start = point(from, edge.connector.fromAnchor), end = point(to, edge.connector.toAnchor);
        value.set('geometry', { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(1, Math.abs(end.x - start.x)), height: Math.max(1, Math.abs(end.y - start.y)), rotation: 0 });
      }
    }
    if (command.type === 'style') {
      const style = item.get('style') as Y.Map<unknown>;
      for (const [key, value] of Object.entries(command.style)) style.set(key, value);
    }
    if (command.type === 'parent') { item.set('parentId', command.parentId); item.set('orderKey', command.orderKey); }
    if (command.type === 'state') {
      if (command.locked === undefined && command.zIndex === undefined) throw new Error('STATE_CHANGE_REQUIRED');
      if (command.locked !== undefined) item.set('locked', command.locked);
      if (command.zIndex !== undefined) item.set('zIndex', command.zIndex);
    }
    if (command.type === 'extension') {
      if (command.extensionData === null) item.delete('extensionData');
      else item.set('extensionData', structuredClone(command.extensionData));
    }
    if (command.type === 'connector') {
      if (current.kind !== 'connector') throw new Error('CONNECTOR_KIND_REQUIRED');
      item.set('connector', structuredClone(command.connector));
    }
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
  const mapping = new Map(chosen.map(object => [object.id, newId(object.id)]));
  if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_COPY_ID');
  return chosen.filter(object => !object.connector || (mapping.has(object.connector.from) && mapping.has(object.connector.to)))
    .map(object => WhiteboardObject.parse({ ...structuredClone(object), id: mapping.get(object.id),
      parentId: object.parentId ? mapping.get(object.parentId) ?? null : null,
      ...(object.connector ? { connector: { ...structuredClone(object.connector), from: mapping.get(object.connector.from), to: mapping.get(object.connector.to) } } : {}),
    }));
}
