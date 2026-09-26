import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, validateDocument, WhiteboardUndo } from '../src';
const object = (id: string, parentId: string | null = null) => ({ id, schemaVersion: 1, kind: 'group', geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, text: '', style: {}, parentId, orderKey: '' });
const parent = (id: string, parentId: string | null) => ({ type: 'parent', id, parentId, orderKey: '' });
function groups(child = true): Y.Doc {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: 'create', object: object('a') }, { type: 'create', object: object('b', child ? 'a' : null) }], {});
  return doc;
}
it('preflights undo against remote parenting; a conflict emits nothing and preserves the entire stack', () => {
  const doc = groups(), undo = new WhiteboardUndo(doc), clientID = doc.clientID;
  undo.execute([parent('b', null), { type: 'text', id: 'b', index: 0, deleteCount: 0, insert: 'local batch' }]);
  executeCommands(doc, [parent('a', 'b')], {});
  const before = Y.encodeStateAsUpdate(doc); let updates = 0; doc.on('update', () => updates++);
  expect(undo.undo()).toBe('conflict'); expect(undo.undo()).toBe('conflict');
  expect(updates).toBe(0); expect(Y.encodeStateAsUpdate(doc)).toEqual(before); expect(doc.clientID).toBe(clientID);
  expect(readObjects(doc).find(o => o.id === 'b')?.text).toBe('local batch'); expect(() => validateDocument(doc)).not.toThrow();
  // Resolving the remote dependency makes the same untouched history entry undoable.
  executeCommands(doc, [parent('a', null)], {});
  expect(undo.undo()).toBe('undone'); expect(readObjects(doc).find(o => o.id === 'b')).toMatchObject({ parentId: 'a', text: '' });
  expect(undo.redo()).toBe(true); expect(readObjects(doc).find(o => o.id === 'b')).toMatchObject({ parentId: null, text: 'local batch' });
  expect(undo.undo()).toBe('undone'); expect(() => validateDocument(doc)).not.toThrow();
});
it('preflights redo without discarding a conflicting redo entry', () => {
  const doc = groups(false), undo = new WhiteboardUndo(doc);
  undo.execute([parent('b', 'a')]); expect(undo.undo()).toBe('undone');
  executeCommands(doc, [parent('a', 'b')], {});
  const before = Y.encodeStateAsUpdate(doc); let updates = 0; doc.on('update', () => updates++);
  expect(undo.redo()).toBe(false); expect(undo.redo()).toBe(false);
  expect(updates).toBe(0); expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  executeCommands(doc, [parent('a', null)], {});
  expect(undo.redo()).toBe(true); expect(readObjects(doc).find(o => o.id === 'b')?.parentId).toBe('a');
});
it('never skips a remotely superseded operation to reach an older history item', () => {
  const doc = createWhiteboardDocument(), undo = new WhiteboardUndo(doc);
  undo.execute([{ type: 'create', object: object('a') }]);
  undo.execute([{ type: 'geometry', id: 'a', geometry: { ...object('a').geometry, x: 20 } }]);
  executeCommands(doc, [{ type: 'geometry', id: 'a', geometry: { ...object('a').geometry, x: 30 } }], {});
  expect(undo.undo()).toBe('conflict'); expect(readObjects(doc)).toHaveLength(1); expect(readObjects(doc)[0].geometry.x).toBe(30);
});
it('rejects undo when the same object received foreign text', () => {
  const doc = groups(), undo = new WhiteboardUndo(doc);
  undo.execute([{ type: 'text', id: 'b', index: 0, deleteCount: 0, insert: '甲' }]);
  executeCommands(doc, [{ type: 'text', id: 'b', index: 1, deleteCount: 0, insert: '乙' }], {});
  expect(undo.undo()).toBe('conflict'); expect(readObjects(doc).find(o => o.id === 'b')?.text).toBe('甲乙');
});
it('round-trips a 100-object create batch as one history item', () => {
  const doc = createWhiteboardDocument(), undo = new WhiteboardUndo(doc);
  undo.execute(Array.from({ length: 100 }, (_, index) => ({ type: 'create', object: { ...object(`note-${index}`), kind: 'sticky' as const } })));
  expect(readObjects(doc)).toHaveLength(100);
  expect(undo.undo()).toBe('undone'); expect(readObjects(doc)).toEqual([]);
  expect(undo.undo()).toBe('empty');
  expect(undo.redo()).toBe(true); expect(readObjects(doc)).toHaveLength(100);
});
