import * as Y from 'yjs';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { cloneDocument, executeCommands, objectMap, readObjects, tombstones, validateDocument } from './document';
import { WhiteboardCommandOrigin } from './command-port';

const HISTORY = Symbol('whiteboard-history');
const COMPENSATION: { receiptGestureId?: string; restoreDeletion?:{deleteGestureId:string;objectIds:string[]} } = {};
type HistorySnapshot = { deleteGestureId?:string;deletedIds?:string[];ids: string[]; before: Record<string, string>; after: Record<string, string> };
type StructuralHistory = {
  action: 'create' | 'delete';
  deleteGestureId?:string;
  objects: ReturnType<typeof readObjects>;
};
type HistoryEntry = {type:'compound';snapshot:HistorySnapshot;undoSource?:string;redoSource?:string} | { type: 'manager'; item: StackItem } | { type: 'structural'; value: StructuralHistory };
type StackItem = Y.UndoManager['undoStack'][number];
function copyDeleteSet(source: StackItem['deletions']): StackItem['deletions'] {
  const copy = Y.createDeleteSet();
  for (const [client, ranges] of source.clients) copy.clients.set(client, ranges.map(range => ({ clock: range.clock, len: range.len })));
  return copy;
}
/** Every local command batch is one history item. Undo/redo first verifies that every
 * touched object still matches the state produced by that item, then validates the
 * operation against a clone. Remote changes are therefore never silently overwritten. */
export class WhiteboardUndo {
  private readonly manager: Y.UndoManager;
  private undoHistory: HistoryEntry[] = [];
  private redoHistory: HistoryEntry[] = [];
  private executing = false;
  private externalBefore: ReturnType<typeof readObjects> | null = null;
  private readonly beforeTransaction = (transaction: Y.Transaction): void => {
    if (!this.executing && transaction.origin instanceof WhiteboardCommandOrigin) this.externalBefore = readObjects(this.doc);
  };
  private readonly afterTransaction = (transaction: Y.Transaction): void => {
    if (this.executing || !(transaction.origin instanceof WhiteboardCommandOrigin) || !this.externalBefore) return;
    const beforeObjects = this.externalBefore; this.externalBefore = null;
    const afterObjects = readObjects(this.doc);
    const beforeById = new Map(beforeObjects.map(object => [object.id, object]));
    const afterById = new Map(afterObjects.map(object => [object.id, object]));
    const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].filter(id => JSON.stringify(beforeById.get(id) ?? null) !== JSON.stringify(afterById.get(id) ?? null));
    if (!ids.length) return;
    const before = Object.fromEntries(ids.map(id => [id, JSON.stringify(beforeById.get(id) ?? null)]));
    const after = Object.fromEntries(ids.map(id => [id, JSON.stringify(afterById.get(id) ?? null)]));
    const item = this.manager.undoStack.at(-1);
    if (!item) return;
    item.meta.set(HISTORY, { ids, before, after,deleteGestureId:transaction.origin.gestureId,deletedIds:ids.filter(id=>beforeById.has(id)&&!afterById.has(id)) } satisfies HistorySnapshot);
    const pureCreate = ids.every(id => !beforeById.has(id) && afterById.has(id));
    const pureDelete = ids.every(id => beforeById.has(id) && !afterById.has(id));
    if (pureCreate || pureDelete) {
      this.manager.undoStack.pop();
      this.undoHistory.push({ type: 'structural', value: { action: pureCreate ? 'create' : 'delete', deleteGestureId:transaction.origin.gestureId, objects: ids.map(id => (pureCreate ? afterById : beforeById).get(id)!).filter(Boolean) } });
    } else if(ids.some(id=>!beforeById.has(id)||!afterById.has(id))){
      this.manager.undoStack.pop();this.undoHistory.push({type:'compound',snapshot:item.meta.get(HISTORY) as HistorySnapshot,undoSource:transaction.origin.gestureId});
    } else this.undoHistory.push({ type: 'manager', item });
    this.redoHistory = [];
  };
  constructor(private readonly doc: Y.Doc, readonly origin: object = {}, private readonly newId: (oldId: string) => string = () => crypto.randomUUID()) {
    this.manager = new Y.UndoManager([objectMap(doc), tombstones(doc)], { trackedOrigins: new Set([origin, WhiteboardCommandOrigin]), captureTimeout: 0 });
    doc.on('beforeTransaction', this.beforeTransaction);
    doc.on('afterTransaction', this.afterTransaction);
  }
  private snapshot(ids: readonly string[]): Record<string, string> {
    const objects = new Map(readObjects(this.doc).map(object => [object.id, object]));
    return Object.fromEntries(ids.map(id => [id, JSON.stringify(objects.get(id) ?? null)]));
  }
  execute(input: unknown, transactionOrigin: unknown = this.origin): void {
    const commands = WhiteboardCommandBatch.parse(input);
    const beforeObjects = readObjects(this.doc);
    const requestedIds = commands.map(command => command.type === 'create' ? command.object.id : command.id);
    const ids = [...new Set([...requestedIds, ...beforeObjects.map(object => object.id)])];
    const before = this.snapshot(ids);
    this.executing = true;
    try { executeCommands(this.doc, commands, transactionOrigin); }
    finally { this.executing = false; }
    const after = this.snapshot(ids);
    // Cascading connector deletions belong to the same reversible gesture.
    const changedIds = ids.filter(id => before[id] !== after[id]);
    const item = this.manager.undoStack.at(-1);
    if (!item) throw new Error('HISTORY_NOT_CAPTURED');
    item.meta.set(HISTORY, { ids: changedIds, before, after,deleteGestureId:typeof transactionOrigin==='object'&&transactionOrigin!==null&&'gestureId' in transactionOrigin?String(transactionOrigin.gestureId):undefined,deletedIds:changedIds.filter(id=>before[id]!=='null'&&after[id]==='null') } satisfies HistorySnapshot);
    const pureCreate = commands.every(command => command.type === 'create');
    const pureDelete = commands.every(command => command.type === 'delete');
    if (pureCreate || pureDelete) {
      this.manager.undoStack.pop();
      const source = pureCreate ? after : before;
      const objects = changedIds.map(id => JSON.parse(source[id] ?? 'null')).filter(Boolean);
      this.undoHistory.push({ type: 'structural', value: { action: pureCreate ? 'create' : 'delete', deleteGestureId:typeof transactionOrigin==='object'&&transactionOrigin!==null&&'gestureId' in transactionOrigin?String(transactionOrigin.gestureId):undefined, objects } });
    } else if(changedIds.some(id=>before[id]==='null'||after[id]==='null')){
      this.manager.undoStack.pop();const snapshot=item.meta.get(HISTORY) as HistorySnapshot;
      this.undoHistory.push({type:'compound',snapshot,undoSource:snapshot.deleteGestureId});
    } else this.undoHistory.push({ type: 'manager', item });
    this.redoHistory = [];
  }

  private applyCompound(entry:Extract<HistoryEntry,{type:'compound'}>,direction:'undo'|'redo',gestureId?:string):void{
    const expected=direction==='undo'?entry.snapshot.after:entry.snapshot.before;
    const desired=direction==='undo'?entry.snapshot.before:entry.snapshot.after;
    const current=this.snapshot(entry.snapshot.ids);
    if(entry.snapshot.ids.some(id=>current[id]!==expected[id]))throw new Error('COMPOUND_HISTORY_CONFLICT');
    const restored=entry.snapshot.ids.filter(id=>current[id]==='null'&&desired[id]!=='null');
    const source=direction==='undo'?entry.undoSource:entry.redoSource;
    if(restored.length&&!source)throw new Error('COMPOUND_RECEIPT_REQUIRED');
    const apply=(doc:Y.Doc,origin:unknown)=>doc.transact(()=>{
      for(const id of entry.snapshot.ids){
        const object=JSON.parse(desired[id]??'null') as ReturnType<typeof readObjects>[number]|null;
        if(!object){tombstones(doc).set(id,true);continue;}
        const value=objectMap(doc).get(id);if(!value)throw new Error('COMPOUND_OBJECT_MISSING');
        tombstones(doc).delete(id);
        for(const key of [...value.keys()])if(!['text','style'].includes(key)&&!(key in object))value.delete(key);
        for(const [key,field] of Object.entries(object))if(!['id','text','style'].includes(key))value.set(key,structuredClone(field));
        const text=value.get('text') as Y.Text;
        if(text.toString()!==object.text){text.delete(0,text.length);text.insert(0,object.text);}
        const style=value.get('style') as Y.Map<unknown>;for(const key of [...style.keys()])if(!(key in object.style))style.delete(key);
        for(const [key,field] of Object.entries(object.style))style.set(key,structuredClone(field));
      }
    },origin);
    const trial=cloneDocument(this.doc);
    try{apply(trial,{});validateDocument(trial);}finally{trial.destroy();}
    const origin={receiptGestureId:gestureId,...(restored.length?{restoreDeletion:{deleteGestureId:source!,objectIds:restored,includeInverse:true}}:{})};
    apply(this.doc,origin);
    if(direction==='undo')entry.redoSource=gestureId;else entry.undoSource=gestureId;
  }

  private recreate(objects: ReturnType<typeof readObjects>): ReturnType<typeof readObjects> {
    const mapping = new Map(objects.map(object => [object.id, this.newId(object.id)]));
    if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_RESTORE_ID');
    const recreated = objects.map(object => ({
      ...structuredClone(object), id: mapping.get(object.id)!, restoredFrom: object.id,
      parentId: object.parentId ? mapping.get(object.parentId) ?? object.parentId : null,
      ...(object.connector ? { connector: {
        ...object.connector,
        ...(object.connector.from ? { from: mapping.get(object.connector.from) ?? object.connector.from } : {}),
        ...(object.connector.to ? { to: mapping.get(object.connector.to) ?? object.connector.to } : {}),
      } } : {}),
    }));
    executeCommands(this.doc, recreated.map(object => ({ type: 'create' as const, object })), COMPENSATION);
    return recreated;
  }

  private undoStructural(entry: StructuralHistory): StructuralHistory {
    if (entry.action === 'create') {
      const live = new Map(readObjects(this.doc).map(object => [object.id, object]));
      if (!entry.objects.every(object => JSON.stringify(live.get(object.id) ?? null) === JSON.stringify(object))) throw new Error('STRUCTURAL_HISTORY_CONFLICT');
      const ids = new Set(entry.objects.map(object => object.id));
      const depth = (object: (typeof entry.objects)[number]): number => {
        let value = 0, parentId = object.parentId;
        while (parentId && ids.has(parentId)) { value += 1; parentId = live.get(parentId)?.parentId ?? null; }
        return value;
      };
      // Remove relations and deepest descendants before their copied parents.
      // This keeps structural validation valid for an atomic subgraph undo.
      const deletionOrder = [...entry.objects].sort((left, right) =>
        Number(right.kind === 'connector') - Number(left.kind === 'connector') || depth(right) - depth(left));
      executeCommands(this.doc, deletionOrder.map(object => ({ type: 'delete' as const, id: object.id })), COMPENSATION);
      return entry;
    }
    if(entry.deleteGestureId)COMPENSATION.restoreDeletion={deleteGestureId:entry.deleteGestureId,objectIds:entry.objects.map(object=>object.id)};
    try{executeCommands(this.doc, entry.objects.map(object => ({type: 'restore' as const, id: object.id})), COMPENSATION);}finally{delete COMPENSATION.restoreDeletion;}
    return entry;
  }

  private redoStructural(entry: StructuralHistory): StructuralHistory {
    if (entry.action === 'create') return { ...entry, objects: this.recreate(entry.objects) };
    const live = new Map(readObjects(this.doc).map(object => [object.id, object]));
    if (!entry.objects.every(object => JSON.stringify(live.get(object.id) ?? null) === JSON.stringify(object))) throw new Error('STRUCTURAL_HISTORY_CONFLICT');
    // Delete relations before endpoints, and descendants before parents.
    const byId=new Map(entry.objects.map(object=>[object.id,object]));
    const depth=(id:string):number=>{let count=0,parent=byId.get(id)?.parentId;while(parent&&byId.has(parent)){count++;parent=byId.get(parent)?.parentId;}return count;};
    const ordered=[...entry.objects].sort((a,b)=>Number(b.kind==='connector')-Number(a.kind==='connector')||depth(b.id)-depth(a.id));
    executeCommands(this.doc, ordered.map(object => ({ type: 'delete' as const, id: object.id })), COMPENSATION);
    return {...entry,deleteGestureId:COMPENSATION.receiptGestureId};
  }
  /** Pinned Yjs adapter: redone links and stack ranges are local metadata, absent from encoded updates. */
  private canApply(item: StackItem, direction: 'undo' | 'redo'): boolean {
    const candidate = new Y.Doc({ gc: false });
    candidate.getMap('objects'); candidate.getMap('deletedObjects');
    let trial: Y.UndoManager | undefined;
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.doc));
      candidate.clientID = this.doc.clientID;
      candidate.transact(transaction => {
        for (const structs of this.doc.store.clients.values()) for (const struct of structs) {
          if (!(struct instanceof Y.Item) || !struct.redone) continue;
          // Clone encoding can merge adjacent structs; reproduce their boundaries.
          const counterpart = Y.getItemCleanStart(transaction, struct.id);
          Y.getItemCleanEnd(transaction, candidate.store, Y.createID(struct.id.client, struct.id.clock + struct.length - 1));
          counterpart.redone = Y.createID(struct.redone.client, struct.redone.clock);
        }
      });
      trial = new Y.UndoManager([objectMap(candidate), tombstones(candidate)], { trackedOrigins: new Set(), captureTimeout: 0 });
      const copy = { insertions: copyDeleteSet(item.insertions), deletions: copyDeleteSet(item.deletions), meta: new Map(item.meta) };
      trial[direction === 'undo' ? 'undoStack' : 'redoStack'] = [copy];
      const result = direction === 'undo' ? trial.undo() : trial.redo();
      if (!result) return false;
      validateDocument(candidate);
      const history=item.meta.get(HISTORY) as HistorySnapshot|undefined;
      for (const [id, deleted] of tombstones(this.doc)) {
        if (deleted && tombstones(candidate).get(id) !== true && !(direction==='undo'&&history?.deleteGestureId&&history.deletedIds?.includes(id))) return false;
      }
      return true;
    } catch { return false; }
    finally { trial?.destroy(); candidate.destroy(); }
  }
  private matchesSnapshot(item: StackItem, direction: 'undo' | 'redo'): boolean {
    const history = item.meta.get(HISTORY) as HistorySnapshot | undefined;
    if (!history) return false;
    const expected = direction === 'undo' ? history.after : history.before;
    const current = this.snapshot(history.ids);
    const withoutText = (value: string | undefined) => { const object = JSON.parse(value ?? 'null'); if (object) delete object.text; return JSON.stringify(object); };
    const textOnly = history.ids.every(id => withoutText(history.before[id]) === withoutText(history.after[id]));
    return history.ids.every(id => current[id] === expected[id] || (textOnly && withoutText(current[id]) === withoutText(expected[id])));
  }
  private applyOne(direction: 'undo' | 'redo', receiptGestureId?: string): void {
    // Yjs normally skips no-op entries. Never let it silently cross a separately
    // validated history entry in the same operation.
    const key = direction === 'undo' ? 'undoStack' : 'redoStack';
    const stack = this.manager[key], item = stack.at(-1)!;
    const history = item.meta.get(HISTORY) as HistorySnapshot|undefined;
    this.manager[key] = [item];
    const receiptOrigin = this.manager as Y.UndoManager & {receiptGestureId?: string;restoreDeletion?:{deleteGestureId:string;objectIds:string[];includeInverse:true}};
    receiptOrigin.receiptGestureId = receiptGestureId;
    if(direction==='undo'&&history?.deleteGestureId&&history.deletedIds?.length)receiptOrigin.restoreDeletion={deleteGestureId:history.deleteGestureId,objectIds:history.deletedIds,includeInverse:true};
    try {
      if (direction === 'undo') this.manager.undo(); else this.manager.redo();
      if(direction==='redo'&&history?.deletedIds?.length)history.deleteGestureId=receiptGestureId;
      const opposite = direction === 'undo' ? this.manager.redoStack.at(-1) : this.manager.undoStack.at(-1);
      if (opposite && history) opposite.meta.set(HISTORY, history);
    }
    finally { delete receiptOrigin.restoreDeletion;delete receiptOrigin.receiptGestureId; this.manager[key] = [...stack.slice(0, -1), ...this.manager[key]]; }
  }
  undo(receiptGestureId: string = crypto.randomUUID()): 'undone' | 'empty' | 'conflict' {
    const entry = this.undoHistory.at(-1);
    if (!entry) return 'empty';
    if(entry.type==='compound'){try{this.applyCompound(entry,'undo',receiptGestureId);}catch{return 'conflict';}}
    else if (entry.type === 'manager') {
      const item = this.manager.undoStack.at(-1);
      if (item !== entry.item || !this.matchesSnapshot(item, 'undo') || !this.canApply(item, 'undo')) return 'conflict';
      this.applyOne('undo', receiptGestureId);
      entry.item = this.manager.redoStack.at(-1)!;
    } else {
      try { COMPENSATION.receiptGestureId = receiptGestureId; entry.value = this.undoStructural(entry.value); }
      catch { return 'conflict'; }
      finally { delete COMPENSATION.receiptGestureId; }
    }
    this.undoHistory.pop(); this.redoHistory.push(entry); return 'undone';
  }
  redo(receiptGestureId: string = crypto.randomUUID()): boolean {
    const entry = this.redoHistory.at(-1);
    if (!entry) return false;
    if(entry.type==='compound'){try{this.applyCompound(entry,'redo',receiptGestureId);}catch{return false;}}
    else if (entry.type === 'manager') {
      const item = this.manager.redoStack.at(-1);
      if (item !== entry.item || !this.matchesSnapshot(item, 'redo') || !this.canApply(item, 'redo')) return false;
      this.applyOne('redo', receiptGestureId);
      entry.item = this.manager.undoStack.at(-1)!;
    } else {
      try { COMPENSATION.receiptGestureId = receiptGestureId; entry.value = this.redoStructural(entry.value); }
      catch { return false; }
      finally { delete COMPENSATION.receiptGestureId; }
    }
    this.redoHistory.pop(); this.undoHistory.push(entry); return true;
  }
  destroy(): void { this.doc.off('beforeTransaction', this.beforeTransaction); this.doc.off('afterTransaction', this.afterTransaction); this.manager.destroy(); }
}
