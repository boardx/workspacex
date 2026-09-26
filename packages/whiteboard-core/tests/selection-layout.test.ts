import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  SelectionLayoutCommandPort,
  WhiteboardUndo,
  arrangeObjects,
  calculateSnapGuides,
  createWhiteboardDocument,
  executeCommands,
  readObjects,
  resolveSelection,
  type PanelMetadata,
  type LayoutPrecondition,
  type WhiteboardGeometry,
  type WhiteboardLayoutCommand,
  type WhiteboardObject,
} from '../src';

const geometry = (x: number, y: number, width = 100, height = 80): WhiteboardGeometry => ({ x, y, width, height, rotation: 0 });
const note = (id: string, x: number, y: number, options: Partial<WhiteboardObject> = {}): WhiteboardObject => ({
  id, schemaVersion: 1, kind: 'sticky', geometry: geometry(x, y), text: id, style: {}, parentId: null,
  orderKey: id, locked: false, hidden: false, zIndex: 0, ...options,
});
const panel: PanelMetadata = { version: 1, mode: 'freeform', autoExpand: false, clipContent: false, padding: 10, gap: 24, columns: 2, flowDirection: 'horizontal' };

function frame(id: string, bounds: WhiteboardGeometry, metadata = panel): WhiteboardObject {
  return { id, schemaVersion: 1, kind: 'frame', geometry: bounds, text: id, style: {}, parentId: null, orderKey: id, locked: false, hidden: false, zIndex: 0, extensionData: { spatial: metadata } };
}
function seed(...objects: WhiteboardObject[]): Y.Doc {
  const doc = createWhiteboardDocument();
  executeCommands(doc, objects.map(object => ({ type: 'create' as const, object })), 'fixture');
  return doc;
}
function command(kind: WhiteboardLayoutCommand['kind'], objectIds: string[], extra: Partial<WhiteboardLayoutCommand> = {}): WhiteboardLayoutCommand {
  return { type: 'arrange-objects', kind, objectIds, ...extra } as WhiteboardLayoutCommand;
}
function dispatch(port: SelectionLayoutCommandPort, gestureId: string, layout: WhiteboardLayoutCommand, preconditions?: LayoutPrecondition[]) {
  return port.dispatch({ boardId: 'board', clientId: 'human-or-agent', gestureId, command: layout, preconditions });
}

describe('stable multi-selection semantics', () => {
  it('preserves caller order and reports same vs mixed parent boundaries without mutating', () => {
    const objects = [note('a', 0, 0, { parentId: 'p' }), note('b', 200, 0, { parentId: 'p' }), note('c', 400, 0)];
    expect(resolveSelection(objects, ['b', 'a'])).toMatchObject({ objectIds: ['b', 'a'], parentBoundary: 'same-parent', parentId: 'p' });
    expect(resolveSelection(objects, ['c', 'a'])).toMatchObject({ objectIds: ['c', 'a'], parentBoundary: 'mixed-parent', parentId: null });
    expect(objects.map(value => value.geometry.x)).toEqual([0, 200, 400]);
  });

  it('rejects duplicate, missing, hidden, locked, connector and mixed-parent layout selections', () => {
    const hidden = note('hidden', 0, 0, { hidden: true }), locked = note('locked', 0, 0, { locked: true });
    const edge: WhiteboardObject = { ...note('edge', 0, 0), kind: 'connector', connector: { from: 'a', to: 'b' } };
    const objects = [note('a', 0, 0), note('b', 200, 0), hidden, locked, edge];
    expect(() => resolveSelection(objects, ['a', 'a'])).toThrow('SELECTION_INVALID');
    expect(() => resolveSelection(objects, ['missing'])).toThrow('OBJECT_NOT_FOUND');
    expect(() => resolveSelection(objects, ['hidden'])).toThrow('OBJECT_HIDDEN');
    expect(() => resolveSelection(objects, ['locked'])).toThrow('OBJECT_LOCKED');
    expect(() => resolveSelection(objects, ['edge'])).toThrow('OBJECT_NOT_LAYOUTABLE');
    expect(() => arrangeObjects([note('a', 0, 0), note('b', 100, 100, { parentId: 'panel' })], command('row', ['a', 'b']))).toThrow('SELECTION_PARENT_BOUNDARY');
  });
});

describe('canonical layout calculations', () => {
  it('aligns rotated objects by their rendered scene bounds', () => {
    const plain = note('plain', 10, 10, { geometry: { x: 10, y: 10, width: 100, height: 40, rotation: 0 } });
    const rotated = note('rotated', 200, 50, { geometry: { x: 200, y: 50, width: 100, height: 40, rotation: 90 } });
    const arranged = arrangeObjects([plain, rotated], command('align-left', ['plain', 'rotated']));
    const plainAfter = arranged.find(value => value.id === 'plain')!.geometry;
    const rotatedAfter = arranged.find(value => value.id === 'rotated')!.geometry;
    expect(plainAfter.x).toBeCloseTo(rotatedAfter.x - 40);
    expect(rotatedAfter.rotation).toBe(90);
  });
  it.each([
    ['align-left', [{ x: 0 }, { x: 0 }]],
    ['align-center', [{ x: 75 }, { x: 50 }]],
    ['align-right', [{ x: 150 }, { x: 100 }]],
    ['align-top', [{ y: 0 }, { y: 0 }]],
    ['align-middle', [{ y: 80 }, { y: 60 }]],
    ['align-bottom', [{ y: 160 }, { y: 120 }]],
  ] as const)('%s aligns mixed-size objects at the selection bounds', (kind, expected) => {
    const objects = [note('a', 0, 0, { geometry: geometry(0, 0, 100, 80) }), note('b', 100, 120, { geometry: geometry(100, 120, 150, 120) })];
    const actual = arrangeObjects(objects, command(kind, ['a', 'b']));
    expect(actual.map(value => value.geometry)).toEqual([expect.objectContaining(expected[0]), expect.objectContaining(expected[1])]);
    expect(actual.map(value => [value.geometry.width, value.geometry.height])).toEqual([[100, 80], [150, 120]]);
  });

  it('distributes at least three objects while preserving endpoints and every object size', () => {
    const objects = [note('middle', 300, 20, { geometry: geometry(300, 20, 50, 80) }), note('last', 500, 40, { geometry: geometry(500, 40, 100, 80) }), note('first', 0, 0, { geometry: geometry(0, 0, 100, 80) })];
    const after = arrangeObjects(objects, command('distribute-horizontal', ['middle', 'last', 'first']));
    expect(after.find(value => value.id === 'first')?.geometry).toEqual(objects[2]?.geometry);
    expect(after.find(value => value.id === 'last')?.geometry).toEqual(objects[1]?.geometry);
    expect(after.find(value => value.id === 'middle')?.geometry).toMatchObject({ x: 275, y: 20, width: 50, height: 80 });
    expect(() => arrangeObjects(objects.slice(0, 2), command('distribute-vertical', ['middle', 'last']))).toThrow('DISTRIBUTION_REQUIRES_THREE');
  });

  it('lays out row, column and configurable grid with a 24px default gap', () => {
    const objects = [note('b', 200, 100, { geometry: geometry(200, 100, 50, 60) }), note('a', 0, 0, { geometry: geometry(0, 0, 100, 80) }), note('c', 500, 300, { geometry: geometry(500, 300, 70, 40) })];
    expect(arrangeObjects(objects, command('row', ['b', 'a', 'c'])).map(value => value.geometry)).toEqual([
      geometry(0, 0, 50, 60), geometry(74, 0, 100, 80), geometry(198, 0, 70, 40),
    ]);
    expect(arrangeObjects(objects, command('column', ['b', 'a', 'c'], { gap: 10 })).map(value => value.geometry)).toEqual([
      geometry(0, 0, 50, 60), geometry(0, 70, 100, 80), geometry(0, 160, 70, 40),
    ]);
    expect(arrangeObjects(objects, command('grid', ['b', 'a', 'c'], { columns: 2, horizontalGap: 12, verticalGap: 8 })).map(value => value.geometry)).toEqual([
      geometry(0, 0, 50, 60), geometry(82, 0, 100, 80), geometry(0, 88, 70, 40),
    ]);
  });

  it('tidies in deterministic visual reading order independent of source array order', () => {
    const objects = [note('c', 400, 300), note('a', 200, 0), note('b', 0, 0), note('d', 0, 300)];
    const after = arrangeObjects(objects, command('tidy-up', ['c', 'a', 'b', 'd'], { columns: 2, gap: 20 }));
    const positions = Object.fromEntries(after.map(value => [value.id, [value.geometry.x, value.geometry.y]]));
    expect(positions).toEqual({ c: [120, 100], a: [120, 0], b: [0, 0], d: [0, 100] });
  });

  it('supports a zero-write preview when objects are already arranged', () => {
    const objects = [note('a', 0, 0), note('b', 124, 0)];
    const before = structuredClone(objects);
    expect(arrangeObjects(objects, command('row', ['a', 'b']))).toEqual(objects.map(value => ({ id: value.id, geometry: value.geometry })));
    expect(objects).toEqual(before);
    const doc = seed(...objects), port = new SelectionLayoutCommandPort(doc);
    expect(() => dispatch(port, 'empty-write', command('row', ['a', 'b']))).toThrow('NO_LAYOUT_CHANGE');
    expect(readObjects(doc).map(value => value.geometry)).toEqual(objects.map(value => value.geometry));
    doc.destroy();
  });

  it('rejects NaN, Infinity, invalid columns and impossible parent escapes', () => {
    expect(() => command('grid', ['a', 'b'], { gap: Number.NaN })).not.toThrow();
    expect(() => arrangeObjects([note('a', 0, 0), note('b', 100, 0)], command('grid', ['a', 'b'], { gap: Number.NaN }))).toThrow();
    expect(() => arrangeObjects([note('a', 0, 0), note('b', 100, 0)], command('grid', ['a', 'b'], { horizontalGap: Infinity }))).toThrow();
    expect(() => arrangeObjects([note('a', 0, 0), note('b', 100, 0)], command('grid', ['a', 'b'], { columns: 0 }))).toThrow();
    expect(() => arrangeObjects([note('a', Number.NaN, 0), note('b', 100, 0)], command('row', ['a', 'b']))).toThrow();
    const objects = [frame('p', geometry(0, 0, 220, 120)), note('a', 10, 10, { parentId: 'p' }), note('b', 110, 10, { parentId: 'p' })];
    expect(() => arrangeObjects(objects, command('row', ['a', 'b'], { gap: 50 }))).toThrow('PARENT_BOUNDS_EXCEEDED');
  });
});

describe('smart guides and measurements', () => {
  it('snaps nearest edge/center deterministically and exposes equal-spacing measurements', () => {
    const result = calculateSnapGuides(geometry(101, 100, 100, 80), [
      note('left', -23, 100), note('right', 225, 100), note('center-target', 100, 0),
    ], 5);
    expect(result.geometry).toMatchObject({ x: 101, y: 100 });
    expect(result.guides).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis: 'y', position: 100 }),
    ]));
    expect(result.measurements.filter(value => value.axis === 'x')).toHaveLength(2);
    expect(result.measurements.every(value => value.equalSpacing)).toBe(true);
    expect(calculateSnapGuides(geometry(101, 250, 100, 80), [note('center-target', 100, 0)], 5)).toMatchObject({
      geometry: { x: 100 }, guides: [expect.objectContaining({ axis: 'x', targetId: 'center-target', position: 100 })],
    });
  });

  it('ignores hidden targets and rejects unsafe thresholds', () => {
    expect(calculateSnapGuides(geometry(4, 4), [note('hidden', 0, 0, { hidden: true })], 5)).toMatchObject({ delta: { x: 0, y: 0 }, guides: [] });
    expect(() => calculateSnapGuides(geometry(0, 0), [], Number.NaN)).toThrow('SNAP_THRESHOLD_INVALID');
    expect(() => calculateSnapGuides(geometry(0, 0), [], 101)).toThrow('SNAP_THRESHOLD_INVALID');
    expect(() => calculateSnapGuides(geometry(Infinity, 0), [], 5)).toThrow();
  });
});

describe('operation, event, CAS and undo boundary', () => {
  it('commits a batch once, emits before/after, is idempotent and undoes/redoes as one unit', () => {
    const doc = seed(note('a', 0, 0), note('b', 300, 100), note('c', 700, 200));
    const undo = new WhiteboardUndo(doc), port = new SelectionLayoutCommandPort(doc);
    let transactions = 0;
    doc.on('afterTransaction', transaction => { if ((transaction.origin as { kind?: string } | null)?.kind === 'whiteboard-command') transactions++; });
    const input = command('row', ['c', 'a', 'b']);
    const accepted = dispatch(port, 'row', input), replay = dispatch(port, 'row', structuredClone(input));
    expect(replay).toEqual(accepted);
    expect(transactions).toBe(1);
    expect(accepted.events).toEqual([expect.objectContaining({
      type: 'ObjectsArranged', operationId: accepted.operationId, layoutKind: 'row', selectionObjectIds: ['c', 'a', 'b'], objectIds: ['c', 'a', 'b'],
      before: expect.arrayContaining([expect.objectContaining({ id: 'c', geometry: geometry(700, 200) })]),
      after: expect.arrayContaining([expect.objectContaining({ id: 'c', geometry: geometry(0, 0) })]),
    })]);
    expect(() => dispatch(port, 'row', command('column', ['c', 'a', 'b']))).toThrow('LAYOUT_COMMAND_INVALID');
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc).map(value => value.geometry)).toEqual([geometry(0, 0), geometry(300, 100), geometry(700, 200)]);
    expect(undo.redo()).toBe(true);
    expect(readObjects(doc).map(value => [value.id, value.geometry.x])).toEqual([['a', 124], ['b', 248], ['c', 0]]);
    undo.destroy(); doc.destroy();
  });

  it('rejects stale remote geometry, locked descendants and nested selection atomically', () => {
    const group: WhiteboardObject = { ...note('group', 0, 0), kind: 'group', geometry: geometry(0, 0, 250, 150) };
    const doc = seed(group, note('child', 20, 20, { parentId: 'group', locked: true }), note('other', 400, 0));
    const port = new SelectionLayoutCommandPort(doc), before = readObjects(doc);
    expect(() => dispatch(port, 'locked-descendant', command('row', ['group', 'other']))).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc)).toEqual(before);
    expect(() => dispatch(port, 'nested', command('row', ['group', 'child']))).toThrow();
    executeCommands(doc, [{ type: 'state', id: 'child', locked: false }], 'fixture');
    const expected = readObjects(doc).find(value => value.id === 'other')!;
    executeCommands(doc, [{ type: 'geometry', id: 'other', geometry: geometry(450, 0) }], 'remote');
    expect(() => dispatch(port, 'stale', command('column', ['group', 'other']), [{ id: 'other', geometry: expected.geometry }])).toThrow('LAYOUT_CONFLICT');
    expect(readObjects(doc).find(value => value.id === 'other')?.geometry).toEqual(geometry(450, 0));
    doc.destroy();
  });

  it('auto-expands an eligible panel in the same transaction instead of letting children escape', () => {
    const expanding = { ...panel, autoExpand: true };
    const doc = seed(frame('p', geometry(0, 0, 220, 120), expanding), note('a', 10, 10, { parentId: 'p' }), note('b', 110, 10, { parentId: 'p' }));
    const undo = new WhiteboardUndo(doc), port = new SelectionLayoutCommandPort(doc);
    dispatch(port, 'expand', command('row', ['a', 'b'], { gap: 80 }));
    expect(readObjects(doc).find(value => value.id === 'p')?.geometry.width).toBe(300);
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc).find(value => value.id === 'p')?.geometry.width).toBe(220);
    undo.destroy(); doc.destroy();
  });

  it('moves container descendants and reports implicit connector geometry changes in one event', () => {
    const group: WhiteboardObject = { ...note('group', 400, 0), kind: 'group', geometry: geometry(400, 0, 200, 140) };
    const child = note('child', 420, 20, { parentId: 'group' }), other = note('other', 0, 300);
    const edge: WhiteboardObject = {
      ...note('edge', 120, 40, { geometry: geometry(120, 40, 280, 1) }), kind: 'connector', text: '',
      connector: { from: 'child', to: 'other', fromAnchor: 'right', toAnchor: 'left', type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: '' },
    };
    const doc = seed(group, child, other, edge), port = new SelectionLayoutCommandPort(doc);
    const accepted = dispatch(port, 'containers', command('column', ['group', 'other'], { gap: 40 }));
    expect(readObjects(doc).find(value => value.id === 'child')?.geometry).toMatchObject({ x: 20, y: 20 });
    expect(readObjects(doc).find(value => value.id === 'other')?.geometry).toMatchObject({ x: 0, y: 180 });
    expect(accepted.events[0].objectIds).toEqual(['group', 'other', 'child', 'edge']);
    expect(accepted.events[0].before.map(value => value.id)).toEqual(accepted.events[0].after.map(value => value.id));
    doc.destroy();
  });
});
