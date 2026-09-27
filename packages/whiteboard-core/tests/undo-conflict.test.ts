import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects, validateDocument, WhiteboardUndo, WhiteboardCommandOrigin } from '../src';
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
it('undoes only local text and redoes it without changing the shared identity', () => {
  const doc = groups(), undo = new WhiteboardUndo(doc);
  undo.execute([{ type: 'text', id: 'b', index: 0, deleteCount: 0, insert: '甲' }]);
  executeCommands(doc, [{ type: 'text', id: 'b', index: 1, deleteCount: 0, insert: '乙' }], {});
  expect(undo.undo()).toBe('undone'); expect(readObjects(doc).find(o => o.id === 'b')).toMatchObject({id: 'b', text: '乙'});
  expect(undo.redo()).toBe(true); expect(readObjects(doc).find(o => o.id === 'b')).toMatchObject({id: 'b', text: '甲乙'});
});
it('round-trips a 100-object create batch as one history item', () => {
  const doc = createWhiteboardDocument(), undo = new WhiteboardUndo(doc);
  undo.execute(Array.from({ length: 100 }, (_, index) => ({ type: 'create', object: { ...object(`note-${index}`), kind: 'sticky' as const } })));
  expect(readObjects(doc)).toHaveLength(100);
  expect(undo.undo()).toBe('undone'); expect(readObjects(doc)).toEqual([]);
  expect(undo.undo()).toBe('empty');
  expect(undo.redo()).toBe(true); expect(readObjects(doc)).toHaveLength(100);
});

it('redo of a created subgraph remaps tombstoned IDs while preserving content and connector identity links', () => {
  const doc = createWhiteboardDocument(), undo = new WhiteboardUndo(doc);
  const geometry = { x: 24, y: 36, width: 180, height: 180, rotation: 0 };
  undo.execute([
    { type: 'create', object: { id: 'idea-a', schemaVersion: 1, kind: 'sticky', geometry, text: 'Research', style: {}, parentId: null, orderKey: 'a' } },
    { type: 'create', object: { id: 'idea-b', schemaVersion: 1, kind: 'sticky', geometry: { ...geometry, x: 228 }, text: 'Design', style: {}, parentId: null, orderKey: 'b' } },
    { type: 'create', object: { id: 'edge', schemaVersion: 1, kind: 'connector', geometry: { x: 204, y: 108, width: 24, height: 1, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: 'c', connector: { from: 'idea-a', to: 'idea-b', semanticRelation: 'leads_to' } } },
  ]);

  expect(undo.undo()).toBe('undone');
  expect(readObjects(doc)).toEqual([]);
  expect(undo.redo()).toBe(true);

  const restored = readObjects(doc);
  expect(restored.map(object => object.id).sort()).not.toEqual(['edge', 'idea-a', 'idea-b']);
  expect(restored.map(object => object.restoredFrom).sort()).toEqual(['edge', 'idea-a', 'idea-b']);
  const byOrigin = new Map(restored.map(object => [object.restoredFrom, object]));
  expect(byOrigin.get('idea-a')).toMatchObject({ kind: 'sticky', text: 'Research', geometry });
  expect(byOrigin.get('idea-b')).toMatchObject({ kind: 'sticky', text: 'Design', geometry: { ...geometry, x: 228 } });
  expect(byOrigin.get('edge')?.connector).toEqual({ from: byOrigin.get('idea-a')?.id, to: byOrigin.get('idea-b')?.id, semanticRelation: 'leads_to' });
  validateDocument(doc);
  undo.destroy(); doc.destroy();
});

it('rejects mixed deletion compensation before changing local state or emitting a raw tombstone clear', () => {
  const doc = groups(false), undo = new WhiteboardUndo(doc);
  undo.execute([{ type: 'delete', id: 'a' }, { type: 'text', id: 'b', index: 0, deleteCount: 0, insert: 'mixed' }]);
  const before = Y.encodeStateAsUpdate(doc); let updates = 0;
  doc.on('update', () => updates++);
  expect(undo.undo()).toBe('conflict');
  expect(undo.undo()).toBe('conflict');
  expect(updates).toBe(0);
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  expect(readObjects(doc)).toMatchObject([{ id: 'b', text: 'mixed' }]);
});

it('repeated original-ID delete undo references the new redo receipt and keeps relations intact', () => {
  const doc=groups(), origin=new WhiteboardCommandOrigin('board','client','initial-delete','operation','transaction');
  executeCommands(doc,[{type:'create',object:{...object('edge'),kind:'connector',connector:{from:'a',to:'b'}}}],{});
  const undo=new WhiteboardUndo(doc,origin), intents:unknown[]=[];
  doc.on('update',(_update:Uint8Array,eventOrigin:unknown)=>{
    const value=eventOrigin as {restoreDeletion?:unknown};
    if(value?.restoreDeletion)intents.push(structuredClone(value.restoreDeletion));
  });
  undo.execute([{type:'delete',id:'edge'},{type:'delete',id:'b'},{type:'delete',id:'a'}]);
  expect(undo.undo('first-undo')).toBe('undone');
  expect(undo.redo('second-delete')).toBe(true);
  expect(undo.undo('second-undo')).toBe('undone');
  expect(intents).toEqual([
    {deleteGestureId:'initial-delete',objectIds:expect.arrayContaining(['a','b','edge'])},
    {deleteGestureId:'second-delete',objectIds:expect.arrayContaining(['a','b','edge'])},
  ]);
  expect(readObjects(doc).map(o=>o.id).sort()).toEqual(['a','b','edge']);
  expect(readObjects(doc).find(o=>o.id==='b')?.parentId).toBe('a');
});

for (const direction of ['undo', 'redo'] as const) for (const reverse of [false, true]) {
  it(`${direction} rejects a later peer connector (${reverse ? 'incoming' : 'outgoing'}) without consuming history`, () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [{ type: 'create', object: object('remote-node') }], {});
    const undo = new WhiteboardUndo(doc);
    undo.execute([{ type: 'create', object: object('local-node') }]);
    if (direction === 'redo') {
      undo.execute([{ type: 'delete', id: 'local-node' }]);
      expect(undo.undo()).toBe('undone');
    }
    const peer = cloneDocumentForPeer(doc);
    executeCommands(peer, [{ type: 'create', object: {
      ...object('remote-edge'), kind: 'connector',
      connector: reverse ? { from: 'remote-node', to: 'local-node' } : { from: 'local-node', to: 'remote-node' },
    } }], {});
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), {});
    const before = Y.encodeStateAsUpdate(doc); let updates = 0;
    doc.on('update', () => updates++);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(direction === 'undo' ? undo.undo() : undo.redo()).toBe(direction === 'undo' ? 'conflict' : false);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
      expect(updates).toBe(0);
      expect(readObjects(doc).map(value => value.id).sort()).toEqual(['local-node', 'remote-edge', 'remote-node']);
      validateDocument(doc);
    }
    executeCommands(doc, [{ type: 'delete', id: 'remote-edge' }], {});
    expect(direction === 'undo' ? undo.undo() : undo.redo()).toBe(direction === 'undo' ? 'undone' : true);
    expect(readObjects(doc).map(value => value.id)).toEqual(['remote-node']);
    undo.destroy(); peer.destroy(); doc.destroy();
  });
}
function cloneDocumentForPeer(doc: Y.Doc): Y.Doc {
  const peer = createWhiteboardDocument();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  return peer;
}

it('normal endpoint deletion still cascades its connector as one reversible gesture', () => {
  const doc = groups(false);
  executeCommands(doc, [{ type: 'create', object: { ...object('edge'), kind: 'connector', connector: { from: 'a', to: 'b' } } }], {});
  const undo = new WhiteboardUndo(doc);
  undo.execute([{ type: 'delete', id: 'a' }]);
  expect(readObjects(doc).map(value => value.id)).toEqual(['b']);
  expect(undo.undo()).toBe('undone');
  expect(readObjects(doc).map(value => value.id).sort()).toEqual(['a', 'b', 'edge']);
  expect(undo.redo()).toBe(true);
  expect(readObjects(doc).map(value => value.id)).toEqual(['b']);
  validateDocument(doc); undo.destroy(); doc.destroy();
});
