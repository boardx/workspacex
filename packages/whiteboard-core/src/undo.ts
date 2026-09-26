import * as Y from 'yjs';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { executeCommands, objectMap, readObjects, tombstones, validateDocument } from './document';
import { WhiteboardCommandOrigin } from './command-port';

const HISTORY = Symbol('whiteboard-history');
const COMPENSATION = Symbol('whiteboard-history-compensation');
type HistorySnapshot = { ids: string[]; before: Record<string, string>; after: Record<string, string> };
type StructuralHistory = {
  action: 'create' | 'delete';
  objects: ReturnType<typeof readObjects>;
};
type HistoryEntry = { type: 'manager'; item: StackItem } | { type: 'structural'; value: StructuralHistory };
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
    item.meta.set(HISTORY, { ids, before, after } satisfies HistorySnapshot);
    const pureCreate = ids.every(id => !beforeById.has(id) && afterById.has(id));
    const pureDelete = ids.every(id => beforeById.has(id) && !afterById.has(id));
    if (pureCreate || pureDelete) {
      this.manager.undoStack.pop();
      this.undoHistory.push({ type: 'structural', value: { action: pureCreate ? 'create' : 'delete', objects: ids.map(id => (pureCreate ? afterById : beforeById).get(id)!).filter(Boolean) } });
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
    const ids = [...new Set(commands.map(command => command.type === 'create' ? command.object.id : command.id))];
    const before = this.snapshot(ids);
    this.executing = true;
    try { executeCommands(this.doc, commands, transactionOrigin); }
    finally { this.executing = false; }
    const after = this.snapshot(ids);
    const item = this.manager.undoStack.at(-1);
    if (!item) throw new Error('HISTORY_NOT_CAPTURED');
    item.meta.set(HISTORY, { ids, before, after } satisfies HistorySnapshot);
    const pureCreate = commands.every(command => command.type === 'create');
    const pureDelete = commands.every(command => command.type === 'delete');
    if (pureCreate || pureDelete) {
      this.manager.undoStack.pop();
      const source = pureCreate ? after : before;
      const objects = ids.map(id => JSON.parse(source[id] ?? 'null')).filter(Boolean);
      this.undoHistory.push({ type: 'structural', value: { action: pureCreate ? 'create' : 'delete', objects } });
    } else this.undoHistory.push({ type: 'manager', item });
    this.redoHistory = [];
  }

  private recreate(objects: ReturnType<typeof readObjects>): ReturnType<typeof readObjects> {
    const mapping = new Map(objects.map(object => [object.id, this.newId(object.id)]));
    if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_RESTORE_ID');
    const recreated = objects.map(object => ({
      ...structuredClone(object), id: mapping.get(object.id)!, restoredFrom: object.id,
      parentId: object.parentId ? mapping.get(object.parentId) ?? object.parentId : null,
      ...(object.connector ? { connector: {
        from: mapping.get(object.connector.from) ?? object.connector.from,
        to: mapping.get(object.connector.to) ?? object.connector.to,
      } } : {}),
    }));
    executeCommands(this.doc, recreated.map(object => ({ type: 'create' as const, object })), COMPENSATION);
    return recreated;
  }

  private undoStructural(entry: StructuralHistory): StructuralHistory {
    if (entry.action === 'create') {
      const live = new Map(readObjects(this.doc).map(object => [object.id, object]));
      if (!entry.objects.every(object => JSON.stringify(live.get(object.id) ?? null) === JSON.stringify(object))) throw new Error('STRUCTURAL_HISTORY_CONFLICT');
      executeCommands(this.doc, entry.objects.map(object => ({ type: 'delete' as const, id: object.id })), COMPENSATION);
      return entry;
    }
    return { ...entry, objects: this.recreate(entry.objects) };
  }

  private redoStructural(entry: StructuralHistory): StructuralHistory {
    if (entry.action === 'create') return { ...entry, objects: this.recreate(entry.objects) };
    const live = new Map(readObjects(this.doc).map(object => [object.id, object]));
    if (!entry.objects.every(object => JSON.stringify(live.get(object.id) ?? null) === JSON.stringify(object))) throw new Error('STRUCTURAL_HISTORY_CONFLICT');
    executeCommands(this.doc, entry.objects.map(object => ({ type: 'delete' as const, id: object.id })), COMPENSATION);
    return entry;
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
      return true;
    } catch { return false; }
    finally { trial?.destroy(); candidate.destroy(); }
  }
  private matchesSnapshot(item: StackItem, direction: 'undo' | 'redo'): boolean {
    const history = item.meta.get(HISTORY) as HistorySnapshot | undefined;
    if (!history) return false;
    const expected = direction === 'undo' ? history.after : history.before;
    const current = this.snapshot(history.ids);
    return history.ids.every(id => current[id] === expected[id]);
  }
  private applyOne(direction: 'undo' | 'redo'): void {
    // Yjs normally skips no-op entries. Never let it silently cross a separately
    // validated history entry in the same operation.
    const key = direction === 'undo' ? 'undoStack' : 'redoStack';
    const stack = this.manager[key], item = stack.at(-1)!;
    const history = item.meta.get(HISTORY);
    this.manager[key] = [item];
    try {
      if (direction === 'undo') this.manager.undo(); else this.manager.redo();
      const opposite = direction === 'undo' ? this.manager.redoStack.at(-1) : this.manager.undoStack.at(-1);
      if (opposite && history) opposite.meta.set(HISTORY, history);
    }
    finally { this.manager[key] = [...stack.slice(0, -1), ...this.manager[key]]; }
  }
  undo(): 'undone' | 'empty' | 'conflict' {
    const entry = this.undoHistory.at(-1);
    if (!entry) return 'empty';
    if (entry.type === 'manager') {
      const item = this.manager.undoStack.at(-1);
      if (item !== entry.item || !this.matchesSnapshot(item, 'undo') || !this.canApply(item, 'undo')) return 'conflict';
      this.applyOne('undo');
      entry.item = this.manager.redoStack.at(-1)!;
    } else {
      try { entry.value = this.undoStructural(entry.value); }
      catch { return 'conflict'; }
    }
    this.undoHistory.pop(); this.redoHistory.push(entry); return 'undone';
  }
  redo(): boolean {
    const entry = this.redoHistory.at(-1);
    if (!entry) return false;
    if (entry.type === 'manager') {
      const item = this.manager.redoStack.at(-1);
      if (item !== entry.item || !this.matchesSnapshot(item, 'redo') || !this.canApply(item, 'redo')) return false;
      this.applyOne('redo');
      entry.item = this.manager.undoStack.at(-1)!;
    } else {
      try { entry.value = this.redoStructural(entry.value); }
      catch { return false; }
    }
    this.redoHistory.pop(); this.undoHistory.push(entry); return true;
  }
  destroy(): void { this.doc.off('beforeTransaction', this.beforeTransaction); this.doc.off('afterTransaction', this.afterTransaction); this.manager.destroy(); }
}
