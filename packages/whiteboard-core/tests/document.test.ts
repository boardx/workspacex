import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, cloneDocument, readObjects, executeCommands, copyObjects, validateDocument, WHITEBOARD_UPDATE_LIMITS, WhiteboardUndo, type WhiteboardObject } from '../src';
const geometry = { x: 0, y: 0, width: 200, height: 150, rotation: 0 };
const note = (id: string): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', geometry, text: '你好', style: {}, parentId: null, orderKey: '' });
const create = (doc: Y.Doc, id = 'note') => executeCommands(doc, [{ type: 'create', object: note(id) }], {});
const sync = (a: Y.Doc, b: Y.Doc) => { const au = Y.encodeStateAsUpdate(a), bu = Y.encodeStateAsUpdate(b); Y.applyUpdate(a, bu); Y.applyUpdate(b, au); };

function exactTransactionUpdate(candidate: Y.Doc, mutate: () => void): Uint8Array {
  let update: Uint8Array | undefined;
  candidate.on('update', bytes => { update = new Uint8Array(bytes); });
  candidate.transact(mutate);
  if (!update) throw new Error('Expected a Yjs transaction update');
  return update;
}

function exactCreateUpdate(objects: WhiteboardObject[]): Uint8Array {
  const candidate = createWhiteboardDocument();
  const update = exactTransactionUpdate(candidate, () => {
    const objectsMap = candidate.getMap<Y.Map<unknown>>('objects');
    for (const object of objects) {
      const { id, text, style, ...rest } = object;
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(rest)) item.set(key, structuredClone(value));
      item.set('text', new Y.Text(text));
      item.set('style', new Y.Map<unknown>(Object.entries(style)));
      objectsMap.set(id, item);
    }
  });
  candidate.destroy();
  return update;
}

function expectAtomicLimitRejection(doc: Y.Doc, commands: unknown[]): void {
  const undo = new WhiteboardUndo(doc), before = Y.encodeStateAsUpdate(doc), visible = readObjects(doc);
  let updates = 0;
  doc.on('update', () => updates++);
  expect(() => undo.execute(commands)).toThrow('UPDATE_LIMIT_EXCEEDED');
  expect(updates).toBe(0);
  expect(readObjects(doc)).toEqual(visible);
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  expect(undo.undo()).toBe('empty');
  undo.destroy();
}

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
    expect(() => executeCommands(doc, Array.from({ length: 501 }, (_, n) => ({ type: 'create', object: note(`note-${n}`) })), {})).toThrow();
    expect(readObjects(doc)).toEqual([]); create(doc);
    const item = doc.getMap<Y.Map<unknown>>('objects').get('note')!;
    (item.get('text') as Y.Text).format(0, 1, { link: 'javascript:alert(1)' });
    expect(() => validateDocument(doc)).toThrow('UNSUPPORTED_TEXT_FORMAT');
  });
  it('rejects exact oversized short and maximum-text create updates before mutation, update emission or undo capture', () => {
    for (const text of ['x', 'x'.repeat(20_000)]) {
      const objects = Array.from({ length: 500 }, (_, index) => ({ ...note(`bulk-${index}`), text }));
      expect(exactCreateUpdate(objects).byteLength).toBeGreaterThan(WHITEBOARD_UPDATE_LIMITS.bytes);
      const doc = createWhiteboardDocument();
      expectAtomicLimitRejection(doc, objects.map(object => ({ type: 'create' as const, object })));
      doc.destroy();
    }
  });
  it('rejects oversized connector and mixed command updates as whole batches', () => {
    const connectorDoc = createWhiteboardDocument();
    executeCommands(connectorDoc, [
      { type: 'create', object: note('from') },
      { type: 'create', object: note('to') },
    ], 'seed');
    const connectors = Array.from({ length: 500 }, (_, index) => ({
      type: 'create' as const,
      object: { ...note(`edge-${index}`), kind: 'connector' as const, connector: { from: 'from', to: 'to' } },
    }));
    expect(exactCreateUpdate(connectors.map(command => command.object)).byteLength).toBeGreaterThan(WHITEBOARD_UPDATE_LIMITS.bytes);
    expectAtomicLimitRejection(connectorDoc, connectors);
    connectorDoc.destroy();

    const mixedDoc = createWhiteboardDocument();
    const values = Array.from({ length: 250 }, (_, index) => note(`mixed-${index}`));
    for (const value of values) executeCommands(mixedDoc, [{ type: 'create', object: value }], 'seed');
    const mixed = values.flatMap(value => [
      { type: 'geometry' as const, id: value.id, geometry: { ...value.geometry, x: 1 } },
      { type: 'text' as const, id: value.id, index: value.text.length, deleteCount: 0, insert: 'x'.repeat(20_000 - value.text.length) },
    ]);
    expect(mixed).toHaveLength(500);
    const mixedCandidate = cloneDocument(mixedDoc);
    const mixedUpdate = exactTransactionUpdate(mixedCandidate, () => {
      const objectsMap = mixedCandidate.getMap<Y.Map<unknown>>('objects');
      for (const value of values) {
        const item = objectsMap.get(value.id)!;
        item.set('geometry', { ...value.geometry, x: 1 });
        (item.get('text') as Y.Text).insert(value.text.length, 'x'.repeat(20_000 - value.text.length));
      }
    });
    mixedCandidate.destroy();
    expect(mixedUpdate.byteLength).toBeGreaterThan(WHITEBOARD_UPDATE_LIMITS.bytes);
    expectAtomicLimitRejection(mixedDoc, mixed);
    mixedDoc.destroy();
  });
  it('keeps the exact 500-command boundary while rejecting 501 commands before a transaction', () => {
    const doc = createWhiteboardDocument(); create(doc);
    const commands = Array.from({ length: 500 }, (_, index) => ({
      type: 'geometry' as const,
      id: 'note',
      geometry: { ...geometry, x: index },
    }));
    const updates: Uint8Array[] = [];
    doc.on('update', update => updates.push(new Uint8Array(update)));
    expect(() => executeCommands(doc, commands, 'bulk')).not.toThrow();
    expect(readObjects(doc)[0]!.geometry.x).toBe(499);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThanOrEqual(WHITEBOARD_UPDATE_LIMITS.bytes);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => executeCommands(doc, [...commands, commands[0]!], 'bulk')).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    doc.destroy();
  });
  it('reuses one shadow client instead of adding a Yjs client per accepted command', () => {
    const doc = createWhiteboardDocument();
    for (let index = 0; index < 20; index++) create(doc, `client-${index}`);
    expect(doc.store.clients.size).toBe(1);
    doc.destroy();
  });
  it('accepts schema-valid no-op commands without mutation, update emission or undo capture', () => {
    const doc = createWhiteboardDocument(); create(doc);
    const undo = new WhiteboardUndo(doc), before = Y.encodeStateAsUpdate(doc); let updates = 0;
    doc.on('update', () => updates++);
    const update = executeCommands(doc, [
      { type: 'style', id: 'note', style: {} },
      { type: 'text', id: 'note', index: 0, deleteCount: 0, insert: '' },
    ], undo.origin);
    expect(Y.decodeUpdate(update).structs).toHaveLength(0);
    expect(updates).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(undo.undo()).toBe('empty');
    undo.destroy(); doc.destroy();
  });
  it('rejects every direct mutation of locked objects and rolls back the whole batch', () => {
    const doc = createWhiteboardDocument();
    const locked = { ...note('locked'), extensionData: { locked: true } };
    executeCommands(doc, [{ type: 'create', object: note('free') }, { type: 'create', object: locked }, { type: 'create', object: { ...note('frame'), kind: 'frame' } }], {});
    const mutations = [
      { type: 'geometry' as const, id: 'locked', geometry: { ...geometry, x: 10 } },
      { type: 'style' as const, id: 'locked', style: { fill: 'locked' } },
      { type: 'text' as const, id: 'locked', index: 0, deleteCount: 0, insert: 'x' },
      { type: 'parent' as const, id: 'locked', parentId: 'frame', orderKey: '' },
      { type: 'delete' as const, id: 'locked' },
    ];
    for (const mutation of mutations) expect(() => executeCommands(doc, [mutation], {})).toThrow('OBJECT_LOCKED');
    const before = readObjects(doc);
    expect(() => executeCommands(doc, [
      { type: 'geometry', id: 'free', geometry: { ...geometry, x: 99 } },
      { type: 'geometry', id: 'locked', geometry: { ...geometry, x: 99 } },
    ], {})).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc)).toEqual(before);
    expect(() => executeCommands(doc, Array.from({ length: 501 }, () => ({ type: 'geometry' as const, id: 'free', geometry })), {})).toThrow();
    doc.destroy();
  });
  it('rejects an indirect command that would hide a locked connector', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [
      { type: 'create', object: note('from') },
      { type: 'create', object: note('to') },
      { type: 'create', object: { ...note('edge'), kind: 'connector', connector: { from: 'from', to: 'to' }, extensionData: { locked: true } } },
    ], {});
    const before = readObjects(doc);
    expect(() => executeCommands(doc, [{ type: 'delete', id: 'from' }], {})).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc)).toEqual(before);
    doc.destroy();
  });
  it('rejects hiding a newly-created locked connector in the same command batch', () => {
    const doc = createWhiteboardDocument();
    expect(() => executeCommands(doc, [
      { type: 'create', object: note('from') },
      { type: 'create', object: note('to') },
      { type: 'create', object: { ...note('edge'), kind: 'connector', connector: { from: 'from', to: 'to' }, extensionData: { locked: true } } },
      { type: 'delete', id: 'from' },
    ], {})).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc)).toEqual([]);
    doc.destroy();
  });
  it('protects collaborator content from creation undo, including edits still in flight', () => {
    const a = createWhiteboardDocument(), undo = new WhiteboardUndo(a);
    undo.execute([{ type: 'create', object: note('note') }]);
    expect(undo.undo()).toBe('creation-requires-explicit-delete');
    const b = cloneDocument(a);
    executeCommands(b, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '同事' }], {});
    sync(a, b); expect(undo.undo()).toBe('creation-requires-explicit-delete'); expect(readObjects(a)[0].text).toContain('同事');
  });
  it('undoes local text without undoing remote text or deletion tombstones', () => {
    const a = createWhiteboardDocument(); create(a); const b = cloneDocument(a), undo = new WhiteboardUndo(a);
    undo.execute([{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '甲' }]);
    executeCommands(b, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: '乙' }], {}); sync(a, b);
    expect(undo.undo()).toBe('undone'); expect(readObjects(a)[0].text).toBe('你好乙');
    expect(undo.redo()).toBe(true); expect(readObjects(a)[0].text).toContain('甲');
    undo.execute([{ type: 'delete', id: 'note' }]); undo.undo(); expect(readObjects(a)).toEqual([]);
  });
});
