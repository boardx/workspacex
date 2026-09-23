import * as Y from 'yjs';
import { WhiteboardCommandBatch } from '@repo/contracts/whiteboard-document';
import { executeCommands, objectMap } from './document';

const CREATION = Symbol('whiteboard-creation');
/**
 * Conservative collaboration safety: creation undo is always explicit deletion.
 * A peer's edit may be in flight, so a local "no remote edits" check is insufficient.
 * Deletion uses monotonic tombstones; it is never undone by removing a tombstone.
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
  undo(): 'undone' | 'empty' | 'creation-requires-explicit-delete' {
    const item = this.manager.undoStack.at(-1);
    if (!item) return 'empty';
    if (item.meta.get(CREATION)) return 'creation-requires-explicit-delete';
    this.manager.undo();
    return 'undone';
  }
  redo(): boolean { return this.manager.redo() !== null; }
  destroy(): void { this.manager.destroy(); }
}
