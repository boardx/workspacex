import * as Y from 'yjs';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { executeCommands, objectMap, validateDocument } from './document';

const CREATION = Symbol('whiteboard-creation');
type StackItem = Y.UndoManager['undoStack'][number];
function copyDeleteSet(source: StackItem['deletions']): StackItem['deletions'] {
  const copy = Y.createDeleteSet();
  for (const [client, ranges] of source.clients) copy.clients.set(client, ranges.map(range => ({ clock: range.clock, len: range.len })));
  return copy;
}
/**
 * Conservative collaboration safety: creation undo is always explicit deletion.
 * A peer's edit may be in flight. Every undo/redo is preflighted against the current
 * document, because restoring a locally valid parent can conflict with remote work.
 * Deletion tombstones are outside the UndoManager scope and never removed by undo.
 */
export class WhiteboardUndo {
  private readonly manager: Y.UndoManager;
  private creating = false;
  constructor(private readonly doc: Y.Doc, readonly origin: object = {}) {
    this.manager = new Y.UndoManager(objectMap(doc), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
    this.manager.on('stack-item-added', ({ stackItem, type }) => {
      if (type === 'undo' && this.creating) stackItem.meta.set(CREATION, true);
    });
  }
  execute(input: unknown): void {
    const commands = WhiteboardCommandBatch.parse(input);
    this.creating = commands.some(command => command.type === 'create');
    try { executeCommands(this.doc, commands, this.origin); }
    finally { this.creating = false; }
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
      trial = new Y.UndoManager(objectMap(candidate), { trackedOrigins: new Set(), captureTimeout: 0 });
      const copy = { insertions: copyDeleteSet(item.insertions), deletions: copyDeleteSet(item.deletions), meta: new Map(item.meta) };
      trial[direction === 'undo' ? 'undoStack' : 'redoStack'] = [copy];
      const result = direction === 'undo' ? trial.undo() : trial.redo();
      if (!result) return false;
      validateDocument(candidate);
      return true;
    } catch { return false; }
    finally { trial?.destroy(); candidate.destroy(); }
  }
  private applyOne(direction: 'undo' | 'redo'): void {
    // Yjs normally skips no-op entries. Never let it silently cross a protected
    // creation or a separately validated history entry in the same operation.
    const key = direction === 'undo' ? 'undoStack' : 'redoStack';
    const stack = this.manager[key], item = stack.at(-1)!;
    this.manager[key] = [item];
    try { if (direction === 'undo') this.manager.undo(); else this.manager.redo(); }
    finally { this.manager[key] = [...stack.slice(0, -1), ...this.manager[key]]; }
  }
  undo(): 'undone' | 'empty' | 'creation-requires-explicit-delete' | 'conflict' {
    const item = this.manager.undoStack.at(-1);
    if (!item) return 'empty';
    if (item.meta.get(CREATION)) return 'creation-requires-explicit-delete';
    if (!this.canApply(item, 'undo')) return 'conflict';
    this.applyOne('undo');
    return 'undone';
  }
  redo(): boolean {
    const item = this.manager.redoStack.at(-1);
    if (!item || !this.canApply(item, 'redo')) return false;
    this.applyOne('redo'); return true;
  }
  /** A new out-of-band local transaction invalidates redo without erasing valid undo history. */
  discardRedo(): void { this.manager.clear(false, true); }
  destroy(): void { this.manager.destroy(); }
}
