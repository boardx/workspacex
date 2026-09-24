import { whiteboardHistory as H } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: unknown): string => createHash('sha256').update(value === undefined ? 'undefined' : JSON.stringify(canonical(value))).digest('hex');

export function historyObjects(objects: readonly WhiteboardObject[]): H.HistoryObject[] {
  return historyRecords(objects.map(object=>({object,deleted:false}))).map(item=>item.summary);
}
export type HistoryRecord={object:WhiteboardObject;deleted:boolean};
export function historyRecords(records:readonly HistoryRecord[]):Array<{preview:ReturnType<typeof H.HistoryPreviewObject.parse>;summary:H.HistoryObject}>{
  const byId=new Map(records.map(record=>[record.object.id,record]));
  return records.map(record=>{const {object,deleted}=record,parent=object.parentId?byId.get(object.parentId):undefined,from=object.connector?byId.get(object.connector.from):undefined,to=object.connector?byId.get(object.connector.to):undefined;
    const context={parentMissing:Boolean(object.parentId&&!parent),parentDeleted:Boolean(parent?.deleted),connector:object.connector?{fromMissing:!from,toMissing:!to,fromDeleted:Boolean(from?.deleted),toDeleted:Boolean(to?.deleted)}:null};
    return{preview:H.HistoryPreviewObject.parse({object,deleted,...context}),summary:H.HistoryObject.parse({id:object.id,objectDigest:digest({object,deleted}),kind:object.kind,geometry:object.geometry,text:object.text.slice(0,500),style:object.style,parentId:object.parentId,deleted,...context,connector:object.connector?{...object.connector,...context.connector!}:null})};});
}
export function compareHistoryRecords(beforeRecords:readonly HistoryRecord[],afterRecords:readonly HistoryRecord[]): ReturnType<typeof H.HistoryChange.parse>[] {
  const beforeProjected=historyRecords(beforeRecords),afterProjected=historyRecords(afterRecords);
  const beforeFull = new Map(beforeRecords.map(record => [record.object.id, record])), afterFull = new Map(afterRecords.map(record => [record.object.id, record]));
  const before = new Map(beforeProjected.map(value => [value.summary.id, value.summary])), after = new Map(afterProjected.map(value => [value.summary.id, value.summary]));
  const changes: ReturnType<typeof H.HistoryChange.parse>[] = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldObject = before.get(id) ?? null, newObject = after.get(id) ?? null;
    if (!oldObject && newObject) changes.push(H.HistoryChange.parse({ id, change: 'added', before: null, after: newObject, changedFields: [] }));
    else if (oldObject && !newObject) changes.push(H.HistoryChange.parse({ id, change: 'deleted', before: oldObject, after: null, changedFields: [] }));
    else if (oldObject && newObject && oldObject.objectDigest !== newObject.objectDigest) {
      const oldRecord=beforeFull.get(id)!,newRecord=afterFull.get(id)!,oldFull={...oldRecord.object,deleted:oldRecord.deleted},newFull={...newRecord.object,deleted:newRecord.deleted};
      const fields = [...new Set([...Object.keys(oldFull), ...Object.keys(newFull)])].filter(key => digest((oldFull as unknown as Record<string, unknown>)[key]) !== digest((newFull as unknown as Record<string, unknown>)[key])).sort();
      changes.push(H.HistoryChange.parse({ id, change: 'modified', before: oldObject, after: newObject, changedFields: fields }));
    }
  }
  return changes;
}
export function compareHistoryObjects(beforeObjects: readonly WhiteboardObject[], afterObjects: readonly WhiteboardObject[]): ReturnType<typeof H.HistoryChange.parse>[] {return compareHistoryRecords(beforeObjects.map(object=>({object,deleted:false})),afterObjects.map(object=>({object,deleted:false})));}
import { createHash } from 'node:crypto';
