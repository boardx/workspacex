import * as Y from 'yjs';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { executeCommands, objectMap, readObjects, tombstones, validateDocument } from './document';
import { WhiteboardCommandOrigin } from './command-port';

const HISTORY = Symbol('whiteboard-history');
type HistorySnapshot = { ids: string[]; before: Record<string, string>; after: Record<string, string> };
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
  constructor(private readonly doc: Y.Doc, readonly origin: object = {}) {
    this.manager = new Y.UndoManager([objectMap(doc), tombstones(doc)], { trackedOrigins: new Set([origin, WhiteboardCommandOrigin]), captureTimeout: 0 });
  }
  private snapshot(ids: readonly string[]): Record<string, string> {
    const objects = new Map(readObjects(this.doc).map(object => [object.id, object]));
    return Object.fromEntries(ids.map(id => [id, JSON.stringify(objects.get(id) ?? null)]));
  }
  execute(input: unknown, transactionOrigin: unknown = this.origin): void {
    const commands = WhiteboardCommandBatch.parse(input);
    const ids = [...new Set(commands.map(command => command.type === 'create' ? command.object.id : command.id))];
    const before = this.snapshot(ids);
    executeCommands(this.doc, commands, transactionOrigin);
    this.manager.undoStack.at(-1)?.meta.set(HISTORY, { ids, before, after: this.snapshot(ids) } satisfies HistorySnapshot);
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
    const item = this.manager.undoStack.at(-1);
    if (!item) return 'empty';
    if (!this.matchesSnapshot(item, 'undo') || !this.canApply(item, 'undo')) return 'conflict';
    this.applyOne('undo');
    return 'undone';
  }
  redo(): boolean {
    const item = this.manager.redoStack.at(-1);
    if (!item || !this.matchesSnapshot(item, 'redo') || !this.canApply(item, 'redo')) return false;
    this.applyOne('redo'); return true;
  }
  destroy(): void { this.manager.destroy(); }
}
