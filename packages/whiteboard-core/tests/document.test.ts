import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, cloneDocument, readObjects, executeCommands, copyObjects, validateDocument, WhiteboardUndo, type WhiteboardObject } from '../src';
const geometry = { x: 0, y: 0, width: 200, height: 150, rotation: 0 };
const note = (id: string): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry, text: '你好', style: {}, parentId: null, orderKey: '' });
const create = (doc: Y.Doc, id = 'note') => executeCommands(doc, [{ type: 'create', object: note(id) }], {});
const sync = (a: Y.Doc, b: Y.Doc) => { const au = Y.encodeStateAsUpdate(a), bu = Y.encodeStateAsUpdate(b); Y.applyUpdate(a, bu); Y.applyUpdate(b, au); };

describe('whiteboard content kernel', () => {
  it('reads independent snapshots, clones documents and remaps copy references', () => {
    const doc = createWhiteboardDocument(); create(doc, 'a'); create(doc, 'b');
    executeCommands(doc, [{ type: 'create', object: { ...note('edge'), kind: 'connector', connector: { from: 'a', to: 'b' } } }], {});
    const clone = cloneDocument(doc); expect(readObjects(clone)).toEqual(readObjects(doc));
    const copy = copyObjects(doc, ['a', 'b', 'edge'], id => `copy-${id}`);
    expect(copy.find(item => item.kind === 'connector')?.connector).toEqual({ from: 'copy-a', to: 'copy-b' });
    copy[0].geometry.x = 99; expect(readObjects(doc)[0].geometry.x).toBe(0);
  });
  it('merges concurrent Chinese character edits and atomic geometry', () => {
    const a = createWhiteboardDocument(); create(a); const b = cloneDocument(a);
    executeCommands(a, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '世界' }, { type: 'geometry', id: 'note', geometry: { ...geometry, x: 10, y: 20 } }], {});
    executeCommands(b, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '协作' }, { type: 'geometry', id: 'note', geometry: { ...geometry, x: 30, y: 40 } }], {});
    sync(a, b);
    expect(readObjects(a)).toEqual(readObjects(b));
    expect(readObjects(a)[0].text).toContain('世界'); expect(readObjects(a)[0].text).toContain('协作');
    expect([{ ...geometry, x: 10, y: 20 }, { ...geometry, x: 30, y: 40 }]).toContainEqual(readObjects(a)[0].geometry);
  });
  it('merges duplicated and out-of-order updates', () => {
    const a = createWhiteboardDocument(), updates: Uint8Array[] = [];
    a.on('update', update => updates.push(update)); create(a);
    executeCommands(a, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '！' }], {});
    const b = createWhiteboardDocument();
    Y.applyUpdate(b, updates[1]); Y.applyUpdate(b, updates[1]); Y.applyUpdate(b, updates[0]); Y.applyUpdate(b, updates[0]);
    expect(readObjects(b)).toEqual(readObjects(a));
  });
  it('late edits cannot resurrect deletions and dangling connectors are filtered', () => {
    const a = createWhiteboardDocument(); create(a); create(a, 'other');
    executeCommands(a, [{ type: 'create', object: { ...note('edge'), kind: 'connector', connector: { from: 'note', to: 'other' } } }], {});
    const b = cloneDocument(a);
    executeCommands(a, [{ type: 'delete', id: 'note' }], {});
    executeCommands(b, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '迟到' }], {});
    sync(a, b); expect(readObjects(a).map(value => value.id)).toEqual(['other']); expect(readObjects(b)).toEqual(readObjects(a));
    expect(() => create(a)).toThrow('ID_ALREADY_USED');
  });
  it('rejects overlong and invalid batches without applying the valid prefix', () => {
    const doc = createWhiteboardDocument(); create(doc); const before = readObjects(doc);
    expect(() => executeCommands(doc, [{ type: 'geometry', id: 'note', geometry: { ...geometry, x: 20 } }, { type: 'text', id: 'note', index: 999, deleteCount: 0, insert: 'x' }], {})).toThrow('TEXT_RANGE');
    expect(readObjects(doc)).toEqual(before);
    expect(() => executeCommands(doc, [{ type: 'create', object: { ...note('bad'), text: 'x'.repeat(20001) } }], {})).toThrow();
    expect(() => executeCommands(doc, [{ type: 'create', object: { ...note('bad'), extensionData: { html: 'x'.repeat(20000) } } }], {})).toThrow();
  });
  it('rejects parent cycles, unknown fields and hostile shared types', () => {
    const doc = createWhiteboardDocument();
    expect(() => executeCommands(doc, [{ type: 'create', object: { ...note('cycle'), kind: 'frame', parentId: 'cycle' } }], {})).toThrow('PARENT_CYCLE');
    expect(() => executeCommands(doc, [{ type: 'create', object: { ...note('bad'), admin: true } }], {})).toThrow();
    doc.getMap('objects').set('bad', { text: 'plain object' }); expect(() => validateDocument(doc)).toThrow('INVALID_SHARED_TYPE');
  });
  it('rejects oversized batches and rich text outside the plain-text contract', () => {
    const doc = createWhiteboardDocument();
    expect(() => executeCommands(doc, Array.from({ length: 201 }, (_, n) => ({ type: 'create', object: note(`note-${n}`) })), {})).toThrow();
    expect(readObjects(doc)).toEqual([]); create(doc);
    const item = doc.getMap<Y.Map<unknown>>('objects').get('note')!;
    (item.get('text') as Y.Text).format(0, 1, { link: 'javascript:alert(1)' });
    expect(() => validateDocument(doc)).toThrow('UNSUPPORTED_TEXT_FORMAT');
  });
  it('updates one structured extension namespace without dropping unknown data', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [{ type: 'create', object: { ...note('note'), extensionData: { plugin: { keep: true }, objectExperience: { future: 'preserve', tags: ['old'] } } } }], {});
    executeCommands(doc, [{ type: 'extension', id: 'note', key: 'objectExperience', value: { future: 'preserve', tags: ['old', 'new'], reactions: { '👍': ['actor'] } } }], {});
    expect(readObjects(doc)[0].extensionData).toEqual({ plugin: { keep: true }, objectExperience: { future: 'preserve', tags: ['old', 'new'], reactions: { '👍': ['actor'] } } });
    expect(() => executeCommands(doc, [{ type: 'extension', id: 'note', key: '__proto__', value: {} }], {})).toThrow();
    expect(() => executeCommands(doc, [{ type: 'extension', id: 'note', key: 'large', value: 'x'.repeat(20000) }], {})).toThrow();
    expect(readObjects(doc)[0].extensionData).not.toHaveProperty('large');
  });
  it('undoes and redoes creation, but rejects creation undo after a collaborator edit', () => {
    const a = createWhiteboardDocument(), undo = new WhiteboardUndo(a);
    undo.execute([{ type: 'create', object: note('note') }]);
    expect(undo.undo()).toBe('undone'); expect(readObjects(a)).toEqual([]);
    expect(undo.redo()).toBe(true); expect(readObjects(a)).toHaveLength(1);
    const restoredId = readObjects(a)[0].id;
    const b = cloneDocument(a);
    executeCommands(b, [{ type: 'text', id: restoredId, index: 2, deleteCount: 0, insert: '同事' }], {});
    sync(a, b); expect(undo.undo()).toBe('conflict'); expect(readObjects(a)[0].text).toContain('同事');
  });
  it('rejects text undo after a remote change and round-trips a local deletion', () => {
    const a = createWhiteboardDocument(); create(a); const b = cloneDocument(a), undo = new WhiteboardUndo(a);
    undo.execute([{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '甲' }]);
    executeCommands(b, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '乙' }], {}); sync(a, b);
    expect(undo.undo()).toBe('conflict'); expect(readObjects(a)[0].text).toContain('甲'); expect(readObjects(a)[0].text).toContain('乙');
    const clean = createWhiteboardDocument(); create(clean); const deletion = new WhiteboardUndo(clean);
    deletion.execute([{ type: 'delete', id: 'note' }]); expect(readObjects(clean)).toEqual([]);
    expect(deletion.undo()).toBe('undone'); expect(readObjects(clean)).toHaveLength(1);
    expect(deletion.redo()).toBe(true); expect(readObjects(clean)).toEqual([]);
  });
});
