import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { cloneDocument, createWhiteboardDocument, executeCommands, expandSelection, readObjects, validateDocument, WhiteboardUndo, type WhiteboardObject } from '../src';

const geometry = (x: number, y: number, width = 100, height = 80) => ({ x, y, width, height, rotation: 0 });
const object = (id: string, kind: WhiteboardObject['kind'], x: number, y: number, parentId: string | null = null): WhiteboardObject => ({ id, schemaVersion: 1, kind, geometry: geometry(x, y), text: id, style: {}, parentId, orderKey: id });
const sync = (a: Y.Doc, b: Y.Doc) => { const au = Y.encodeStateAsUpdate(a), bu = Y.encodeStateAsUpdate(b); Y.applyUpdate(a, bu); Y.applyUpdate(b, au); };
const byId = (doc: Y.Doc, id: string) => readObjects(doc).find(value => value.id === id)!;

describe('semantic frames and groups', () => {
  it('groups nested content and translates every recursive descendant exactly once', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [
      { type: 'create', object: object('note-a', 'sticky', 10, 20) },
      { type: 'create', object: object('note-b', 'sticky', 30, 40) },
      { type: 'group', object: object('inner', 'group', 5, 10), memberIds: ['note-a'] },
      { type: 'group', object: object('outer', 'group', 0, 0), memberIds: ['inner', 'note-b'] },
      { type: 'group', object: object('outer', 'group', 0, 0), memberIds: ['inner', 'note-b'] },
    ], 'local');
    expect(expandSelection(doc, ['outer', 'note-a'])).toEqual(expect.arrayContaining(['outer', 'inner', 'note-a', 'note-b']));
    executeCommands(doc, [{ type: 'translate', id: 'outer', delta: { x: 7, y: -3 } }], 'local');
    expect(byId(doc, 'outer').geometry).toMatchObject({ x: 7, y: -3 });
    expect(byId(doc, 'inner').geometry).toMatchObject({ x: 12, y: 7 });
    expect(byId(doc, 'note-a').geometry).toMatchObject({ x: 17, y: 17 });
    expect(byId(doc, 'note-b').geometry).toMatchObject({ x: 37, y: 37 });
  });

  it('keeps connector endpoints valid across grouping, movement and ungrouping', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [
      { type: 'create', object: object('a', 'sticky', 0, 0) },
      { type: 'create', object: object('b', 'sticky', 100, 0) },
      { type: 'create', object: { ...object('edge', 'connector', 0, 0), connector: { from: 'a', to: 'b' } } },
      { type: 'group', object: object('group', 'group', 0, 0), memberIds: ['a', 'b'] },
      { type: 'translate', id: 'group', delta: { x: 20, y: 30 } },
      { type: 'ungroup', id: 'group' },
      { type: 'ungroup', id: 'group' },
    ], 'local');
    expect(byId(doc, 'edge').connector).toEqual({ from: 'a', to: 'b' });
    expect(byId(doc, 'a')).toMatchObject({ parentId: null, geometry: { x: 20, y: 30 } });
    expect(readObjects(doc).some(value => value.id === 'group')).toBe(false);
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it('promotes direct children when a container is deleted and never loses nested content', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [
      { type: 'create', object: object('frame', 'frame', 0, 0) },
      { type: 'create', object: object('group', 'group', 10, 10, 'frame') },
      { type: 'create', object: object('note', 'sticky', 20, 20, 'group') },
      { type: 'delete', id: 'frame' },
    ], 'local');
    expect(byId(doc, 'group').parentId).toBeNull();
    expect(byId(doc, 'note').parentId).toBe('group');
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it('rejects self-parenting, cycles, non-containers, missing and deleted parents without a partial mutation', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [{ type: 'create', object: object('a', 'group', 0, 0) }, { type: 'create', object: object('b', 'group', 0, 0, 'a') }, { type: 'create', object: object('note', 'sticky', 0, 0) }], 'local');
    const before = readObjects(doc);
    expect(() => executeCommands(doc, [{ type: 'parent', id: 'a', parentId: 'a', orderKey: '' }], 'local')).toThrow('PARENT_CYCLE');
    expect(() => executeCommands(doc, [{ type: 'parent', id: 'a', parentId: 'b', orderKey: '' }], 'local')).toThrow('PARENT_CYCLE');
    expect(() => executeCommands(doc, [{ type: 'parent', id: 'b', parentId: 'note', orderKey: '' }], 'local')).toThrow('INVALID_PARENT');
    expect(() => executeCommands(doc, [{ type: 'parent', id: 'note', parentId: 'missing', orderKey: '' }], 'local')).toThrow('INVALID_PARENT');
    expect(readObjects(doc)).toEqual(before);
    executeCommands(doc, [{ type: 'delete', id: 'a' }], 'local');
    expect(() => executeCommands(doc, [{ type: 'parent', id: 'note', parentId: 'a', orderKey: '' }], 'local')).toThrow('INVALID_PARENT');
  });

  it('undoes and redoes group, ungroup and recursive movement as indivisible operations', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [{ type: 'create', object: object('a', 'sticky', 0, 0) }, { type: 'create', object: object('b', 'sticky', 20, 20) }], 'seed');
    const undo = new WhiteboardUndo(doc);
    undo.execute([{ type: 'group', object: object('group', 'group', 0, 0), memberIds: ['a', 'b'] }]);
    expect(byId(doc, 'a').parentId).toBe('group');
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc).map(value => value.id)).not.toContain('group');
    expect(byId(doc, 'a').parentId).toBeNull();
    expect(undo.redo()).toBe(true);
    undo.execute([{ type: 'translate', id: 'group', delta: { x: 15, y: 5 } }]);
    expect(undo.undo()).toBe('undone');
    expect(byId(doc, 'a').geometry).toMatchObject({ x: 0, y: 0 });
    expect(undo.redo()).toBe(true);
    expect(byId(doc, 'a').geometry).toMatchObject({ x: 15, y: 5 });
    undo.execute([{ type: 'ungroup', id: 'group' }]);
    expect(readObjects(doc).map(value => value.id)).not.toContain('group');
    expect(undo.undo()).toBe('undone');
    expect(byId(doc, 'a').parentId).toBe('group');
    expect(undo.redo()).toBe(true);
    expect(byId(doc, 'a').parentId).toBeNull();
  });

  it('converges concurrent regrouping and container movement', () => {
    const a = createWhiteboardDocument();
    executeCommands(a, [{ type: 'create', object: object('left', 'group', 0, 0) }, { type: 'create', object: object('right', 'frame', 200, 0) }, { type: 'create', object: object('note', 'sticky', 30, 30, 'left') }], 'seed');
    const b = cloneDocument(a);
    executeCommands(a, [{ type: 'translate', id: 'left', delta: { x: 10, y: 0 } }], 'a');
    executeCommands(b, [{ type: 'translate', id: 'left', delta: { x: 0, y: 10 } }], 'b');
    sync(a, b);
    expect(readObjects(a)).toEqual(readObjects(b));
    const left = byId(a, 'left').geometry, note = byId(a, 'note').geometry;
    expect({ x: note.x-left.x, y: note.y-left.y }).toEqual({ x: 30, y: 30 });
    expect(() => validateDocument(a)).not.toThrow();

    const c = cloneDocument(a), d = cloneDocument(a);
    executeCommands(c, [{ type: 'parent', id: 'note', parentId: 'left', orderKey: 'a' }], 'c');
    executeCommands(d, [{ type: 'parent', id: 'note', parentId: 'right', orderKey: 'b' }], 'd');
    sync(c, d);
    expect(readObjects(c)).toEqual(readObjects(d));
    expect(() => validateDocument(c)).not.toThrow();
  });
});
