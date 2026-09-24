import { whiteboardHistory as H } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;

export function historyObjects(objects: readonly WhiteboardObject[]): H.HistoryObject[] {
  const ids = new Set(objects.map(object => object.id));
  return objects.map(object => H.HistoryObject.parse({ id: object.id, kind: object.kind, geometry: object.geometry,
    text: object.text.slice(0, 500), style: object.style, parentId: object.parentId, parentMissing: Boolean(object.parentId && !ids.has(object.parentId)),
    connector: object.connector ? { ...object.connector, fromMissing: !ids.has(object.connector.from), toMissing: !ids.has(object.connector.to) } : null }));
}
export function compareHistoryObjects(beforeObjects: readonly WhiteboardObject[], afterObjects: readonly WhiteboardObject[]): ReturnType<typeof H.HistoryChange.parse>[] {
  const before = new Map(historyObjects(beforeObjects).map(object => [object.id, object]));
  const after = new Map(historyObjects(afterObjects).map(object => [object.id, object]));
  const changes: ReturnType<typeof H.HistoryChange.parse>[] = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldObject = before.get(id) ?? null, newObject = after.get(id) ?? null;
    if (!oldObject && newObject) changes.push(H.HistoryChange.parse({ id, change: 'added', before: null, after: newObject }));
    else if (oldObject && !newObject) changes.push(H.HistoryChange.parse({ id, change: 'deleted', before: oldObject, after: null }));
    else if (JSON.stringify(canonical(oldObject)) !== JSON.stringify(canonical(newObject))) changes.push(H.HistoryChange.parse({ id, change: 'modified', before: oldObject, after: newObject }));
  }
  return changes;
}
