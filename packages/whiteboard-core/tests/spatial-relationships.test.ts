import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  SpatialRelationshipCommandPort,
  WhiteboardUndo,
  createWhiteboardDocument,
  executeCommands,
  readObjects,
  readPanelMetadata,
  validateDocument,
  type ConnectorRelationship,
  type SpatialCommand,
  type WhiteboardObject,
} from '../src';

const geometry = (x = 0, y = 0, width = 100, height = 80) => ({ x, y, width, height, rotation: 0 });
const note = (id: string, x = 0, y = 0, parentId: string | null = null, zIndex = 0): WhiteboardObject => ({
  id, schemaVersion: 1, kind: 'sticky', geometry: geometry(x, y), text: id, style: {}, parentId, orderKey: id, locked: false, zIndex,
});
const panel = { version: 1 as const, mode: 'freeform' as const, autoExpand: true, clipContent: false, padding: 10, gap: 24, columns: 2, flowDirection: 'horizontal' as const };
const relationship: ConnectorRelationship = { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'elbow', startStyle: 'none', endStyle: 'arrow', lineStyle: 'dashed', label: 'depends on', semanticRelation: 'depends_on' };
const identity = { boardId: 'board', clientId: 'client' };

function dispatch(port: SpatialRelationshipCommandPort, gestureId: string, command: SpatialCommand) {
  return port.dispatch({ ...identity, gestureId, command });
}

function seed(...objects: WhiteboardObject[]): Y.Doc {
  const doc = createWhiteboardDocument();
  if (objects.length) executeCommands(doc, objects.map(object => ({ type: 'create' as const, object })), 'fixture');
  return doc;
}

describe('semantic panels and hierarchy', () => {
  it('creates freeform/grid/flow panels, rejects cycles and auto-expands on reparent', () => {
    const doc = seed(note('a', 300, 240)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'panel', { type: 'create-panel', id: 'panel', geometry: geometry(0, 0, 120, 100), panel });
    dispatch(port, 'reparent', { type: 'reparent', id: 'a', parentId: 'panel' });
    const values = readObjects(doc), frame = values.find(value => value.id === 'panel')!;
    expect(readPanelMetadata(frame)).toMatchObject({ mode: 'freeform', autoExpand: true });
    expect(values.find(value => value.id === 'a')?.parentId).toBe('panel');
    expect(frame.geometry).toMatchObject({ width: 410, height: 330 });
    expect(() => dispatch(port, 'cycle', { type: 'reparent', id: 'panel', parentId: 'panel' })).toThrow('PARENT_CYCLE');
    dispatch(port, 'grid-mode', { type: 'update-panel', id: 'panel', panel: { ...panel, mode: 'grid', autoExpand: false } });
    expect(readObjects(doc).find(value => value.id === 'a')?.geometry).toMatchObject({ x: 10, y: 10 });
    executeCommands(doc, [{ type: 'geometry', id: 'a', geometry: geometry(99, 88) }], 'fixture');
    dispatch(port, 'arrange', { type: 'arrange-panel', id: 'panel' });
    expect(readObjects(doc).find(value => value.id === 'a')?.geometry).toMatchObject({ x: 10, y: 10 });
    dispatch(port, 'flow-mode', { type: 'update-panel', id: 'panel', panel: { ...panel, mode: 'flow', autoExpand: false, flowDirection: 'vertical' } });
    expect(() => validateDocument(doc)).not.toThrow(); doc.destroy();
  });

  it('moves panel descendants together but resizing never scales children', () => {
    const doc = seed(note('child', 20, 30)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'panel', { type: 'create-panel', id: 'panel', geometry: geometry(0, 0, 200, 160), panel: { ...panel, autoExpand: false } });
    dispatch(port, 'parent', { type: 'reparent', id: 'child', parentId: 'panel' });
    dispatch(port, 'lock-child', { type: 'set-locked', objectIds: ['child'], locked: true });
    expect(() => dispatch(port, 'blocked-move', { type: 'move', id: 'panel', x: 100, y: 50 })).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc).find(value => value.id === 'panel')?.geometry).toMatchObject({ x: 0, y: 0 });
    dispatch(port, 'unlock-child', { type: 'set-locked', objectIds: ['child'], locked: false });
    dispatch(port, 'move', { type: 'move', id: 'panel', x: 100, y: 50 });
    expect(readObjects(doc).find(value => value.id === 'child')?.geometry).toMatchObject({ x: 120, y: 80, width: 100, height: 80 });
    dispatch(port, 'resize', { type: 'resize', id: 'panel', width: 500, height: 400 });
    expect(readObjects(doc).find(value => value.id === 'child')?.geometry).toMatchObject({ x: 120, y: 80, width: 100, height: 80 });
    doc.destroy();
  });

  it('updates panel title and layout in one guarded operation', () => {
    const doc = seed(); const undo = new WhiteboardUndo(doc); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'panel', { type: 'create-panel', id: 'panel', geometry: geometry(), text: 'Draft', panel });
    const accepted = port.dispatch({ ...identity, gestureId: 'rename', command: { type: 'update-panel', id: 'panel', text: 'Research', panel: { ...panel, mode: 'grid' } }, preconditions: [{ id: 'panel', locked: false }] });
    expect(accepted.events.map(value => value.operationId)).toEqual([accepted.operationId]);
    expect(readObjects(doc).find(value => value.id === 'panel')).toMatchObject({ text: 'Research' });
    expect(readPanelMetadata(readObjects(doc).find(value => value.id === 'panel')!)).toMatchObject({ mode: 'grid' });
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc).find(value => value.id === 'panel')).toMatchObject({ text: 'Draft' });
    dispatch(port, 'lock', { type: 'set-locked', objectIds: ['panel'], locked: true });
    expect(() => dispatch(port, 'blocked-title', { type: 'update-panel', id: 'panel', text: 'Blocked', panel })).toThrow('OBJECT_LOCKED');
    expect(() => port.dispatch({ ...identity, gestureId: 'stale-title', command: { type: 'update-panel', id: 'panel', text: 'Stale', panel }, preconditions: [{ id: 'panel', locked: false }] })).toThrow('SPATIAL_CONFLICT');
    expect(() => dispatch(port, 'long-title', { type: 'update-panel', id: 'panel', text: 'x'.repeat(20001), panel })).toThrow();
    undo.destroy(); doc.destroy();
  });

  it('renames a Panel with locked children and expands when an existing child crosses its bounds', () => {
    const doc = seed(note('child', 20, 20)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'panel', { type: 'create-panel', id: 'panel', geometry: geometry(0, 0, 200, 160), text: 'Before', panel });
    dispatch(port, 'parent', { type: 'reparent', id: 'child', parentId: 'panel' });
    dispatch(port, 'lock-child', { type: 'set-locked', objectIds: ['child'], locked: true });
    dispatch(port, 'rename', { type: 'update-panel', id: 'panel', text: 'After', panel });
    expect(readObjects(doc).find(value => value.id === 'panel')?.text).toBe('After');
    dispatch(port, 'unlock-child', { type: 'set-locked', objectIds: ['child'], locked: false });
    dispatch(port, 'move-child', { type: 'transform', items: [{ id: 'child', geometry: geometry(300, 260), parentId: 'panel' }] });
    expect(readObjects(doc).find(value => value.id === 'panel')?.geometry).toMatchObject({ width: 410, height: 350 });
    doc.destroy();
  });

  it('deletes panels with explicit preserve or cascade semantics', () => {
    const preserve = seed(note('child')); const preservePort = new SpatialRelationshipCommandPort(preserve);
    dispatch(preservePort, 'p', { type: 'create-panel', id: 'panel', geometry: geometry(), panel });
    dispatch(preservePort, 'r', { type: 'reparent', id: 'child', parentId: 'panel' });
    dispatch(preservePort, 'd', { type: 'delete-panel', id: 'panel', children: 'preserve' });
    expect(readObjects(preserve).map(value => [value.id, value.parentId])).toEqual([['child', null]]);
    preserve.destroy();

    const cascade = seed(note('child'), note('outside', 300)); const cascadePort = new SpatialRelationshipCommandPort(cascade);
    dispatch(cascadePort, 'p', { type: 'create-panel', id: 'panel', geometry: geometry(), panel });
    dispatch(cascadePort, 'r', { type: 'reparent', id: 'child', parentId: 'panel' });
    dispatch(cascadePort, 'c', { type: 'create-connector', id: 'edge', relationship: { ...relationship, from: 'child', to: 'outside' } });
    dispatch(cascadePort, 'd', { type: 'delete-panel', id: 'panel', children: 'cascade' });
    expect(readObjects(cascade).map(value => value.id)).toEqual(['outside']);
    cascade.destroy();
  });
});

describe('groups, copies, layers and locks', () => {
  it('keeps Group distinct from Panel, ungroups without moving content, and duplicates full subgraphs', () => {
    const doc = seed(note('a', 0, 0), note('b', 140, 0)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'group', { type: 'group', id: 'group', objectIds: ['a', 'b'] });
    const group = readObjects(doc).find(value => value.id === 'group')!;
    expect(group.kind).toBe('group'); expect(group).not.toHaveProperty('extensionData');
    dispatch(port, 'edge', { type: 'create-connector', id: 'edge', relationship });
    const accepted = dispatch(port, 'copy', { type: 'duplicate-subgraph', rootIds: ['group'], newIds: { group: 'group2', a: 'a2', b: 'b2', edge: 'edge2' } });
    expect(accepted.events[0]).toMatchObject({ type: 'ObjectsDuplicated', objectIds: expect.arrayContaining(['group2', 'a2', 'b2', 'edge2']) });
    expect(readObjects(doc).find(value => value.id === 'edge2')?.connector).toMatchObject({ from: 'a2', to: 'b2', semanticRelation: 'depends_on' });
    dispatch(port, 'ungroup', { type: 'ungroup', id: 'group' });
    expect(readObjects(doc).find(value => value.id === 'a')).toMatchObject({ parentId: null, geometry: geometry(0, 0) });
    doc.destroy();
  });

  it('supports all four layer commands and rejects every ordinary mutation of locked objects atomically', () => {
    const doc = seed(note('a', 0, 0, null, 1), note('b', 0, 0, null, 2)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'front', { type: 'layer', objectIds: ['a'], action: 'bring-to-front' });
    dispatch(port, 'backward', { type: 'layer', objectIds: ['a'], action: 'send-backward' });
    dispatch(port, 'forward', { type: 'layer', objectIds: ['b'], action: 'bring-forward' });
    dispatch(port, 'back', { type: 'layer', objectIds: ['b'], action: 'send-to-back' });
    dispatch(port, 'lock', { type: 'set-locked', objectIds: ['a'], locked: true });
    const before = readObjects(doc);
    for (const command of [
      { type: 'geometry', id: 'a', geometry: geometry(1, 1) },
      { type: 'style', id: 'a', style: { fill: '#fff' } },
      { type: 'text', id: 'a', index: 0, deleteCount: 0, insert: 'x' },
      { type: 'parent', id: 'a', parentId: null, orderKey: '' },
      { type: 'extension', id: 'a', extensionData: {} },
      { type: 'delete', id: 'a' },
    ] as const) expect(() => executeCommands(doc, [command], 'bypass')).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc)).toEqual(before);
    dispatch(port, 'unlock', { type: 'set-locked', objectIds: ['a'], locked: false });
    dispatch(port, 'move', { type: 'move', id: 'a', x: 10, y: 10 });
    expect(readObjects(doc).find(value => value.id === 'a')).toMatchObject({ locked: false, geometry: { x: 10, y: 10 } });
    doc.destroy();
  });

  it('assigns a deterministic unique total layer order even when the input contains ties', () => {
    const doc = seed(note('a', 0, 0, null, 1), note('b', 0, 0, null, 1), note('c', 0, 0, null, 2)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'forward', { type: 'layer', objectIds: ['a'], action: 'bring-forward' });
    expect(readObjects(doc).map(value => value.zIndex).sort((a, b) => a! - b!)).toEqual([0, 1, 2]);
    expect(new Set(readObjects(doc).map(value => value.zIndex)).size).toBe(3);
    dispatch(port, 'front', { type: 'layer', objectIds: ['a', 'b'], action: 'bring-to-front' });
    expect(new Set(readObjects(doc).map(value => value.zIndex)).size).toBe(3);
    doc.destroy();
  });

  it('moves an unlocked selection across an unselected locked sibling without mutating the lock', () => {
    const doc = seed(note('a', 0, 0, null, 0), note('locked', 0, 0, null, 1), note('c', 0, 0, null, 2)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'lock-sibling', { type: 'set-locked', objectIds: ['locked'], locked: true });
    dispatch(port, 'front', { type: 'layer', objectIds: ['a'], action: 'bring-to-front' });
    const values = readObjects(doc);
    expect(values.find(value => value.id === 'locked')).toMatchObject({ locked: true, zIndex: 1 });
    expect(values.find(value => value.id === 'a')!.zIndex).toBeGreaterThan(values.find(value => value.id === 'c')!.zIndex!);
    expect(new Set(values.map(value => value.zIndex)).size).toBe(3);
    doc.destroy();
  });
});

describe('semantic connectors and operation boundaries', () => {
  it('retains relation semantics and recomputes attachment geometry when either endpoint moves', () => {
    const doc = seed(note('a', 0, 0), note('b', 300, 100)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'edge', { type: 'create-connector', id: 'edge', relationship });
    const before = readObjects(doc).find(value => value.id === 'edge')!;
    expect(before.connector).toEqual(relationship);
    dispatch(port, 'move', { type: 'move', id: 'b', x: 500, y: 200 });
    const after = readObjects(doc).find(value => value.id === 'edge')!;
    expect(after.connector).toEqual(relationship); expect(after.geometry).not.toEqual(before.geometry);
    dispatch(port, 'curve', { type: 'update-connector', id: 'edge', relationship: { ...relationship, type: 'curve', lineStyle: 'dotted', endStyle: 'diamond', label: 'causes', semanticRelation: 'causes' } });
    expect(readObjects(doc).find(value => value.id === 'edge')).toMatchObject({ text: 'causes', connector: { type: 'curve', lineStyle: 'dotted', endStyle: 'diamond', semanticRelation: 'causes' } });
    doc.destroy();
  });

  it('cascades connector deletion with an endpoint and blocks the whole delete when that relation is locked', () => {
    const doc = seed(note('a'), note('b')); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'edge', { type: 'create-connector', id: 'edge', relationship });
    dispatch(port, 'lock', { type: 'set-locked', objectIds: ['edge'], locked: true });
    expect(() => dispatch(port, 'delete-a', { type: 'delete-object', id: 'a' })).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc).map(value => value.id)).toEqual(expect.arrayContaining(['a', 'b', 'edge']));
    dispatch(port, 'unlock', { type: 'set-locked', objectIds: ['edge'], locked: false });
    dispatch(port, 'delete-a-2', { type: 'delete-object', id: 'a' });
    expect(readObjects(doc).map(value => value.id)).toEqual(['b']); doc.destroy();
  });

  it('preserves a connector as a free endpoint and keeps its attached endpoint live', () => {
    const doc = seed(note('a'), note('b', 300)); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'edge', { type: 'create-connector', id: 'edge', relationship });
    dispatch(port, 'delete-preserve', { type: 'delete-object', id: 'a', connectors: 'preserve-free' });
    const preserved = readObjects(doc).find(value => value.id === 'edge')!;
    expect(preserved.connector).toMatchObject({ fromPoint: { x: 100, y: 40 }, to: 'b' });
    expect(preserved.connector?.from).toBeUndefined();
    const before = preserved.geometry;
    dispatch(port, 'move-b', { type: 'move', id: 'b', x: 500, y: 200 });
    expect(readObjects(doc).find(value => value.id === 'edge')?.geometry).not.toEqual(before);
    expect(() => validateDocument(doc)).not.toThrow(); doc.destroy();
  });

  it('commits multi-object geometry and reparent as one atomic gesture and rejects every item on conflict', () => {
    const doc = seed(note('a'), note('b', 200)); const undo = new WhiteboardUndo(doc); const port = new SpatialRelationshipCommandPort(doc);
    dispatch(port, 'panel', { type: 'create-panel', id: 'panel', geometry: geometry(0, 0, 500, 400), panel: { ...panel, autoExpand: false } });
    const before = readObjects(doc);
    dispatch(port, 'transform', { type: 'transform', items: [
      { id: 'a', geometry: geometry(40, 60, 120, 90), parentId: 'panel' },
      { id: 'b', geometry: { ...geometry(260, 80, 130, 100), rotation: 15 }, parentId: 'panel' },
    ] });
    expect(readObjects(doc).filter(value => ['a', 'b'].includes(value.id)).every(value => value.parentId === 'panel')).toBe(true);
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc)).toEqual(before);
    dispatch(port, 'lock-b', { type: 'set-locked', objectIds: ['b'], locked: true });
    const lockedBefore = readObjects(doc);
    expect(() => dispatch(port, 'rejected-transform', { type: 'transform', items: [{ id: 'a', geometry: geometry(99, 99) }, { id: 'b', geometry: geometry(300, 300) }] })).toThrow('OBJECT_LOCKED');
    expect(readObjects(doc)).toEqual(lockedBefore);
    undo.destroy(); doc.destroy();
  });

  it('is caller-key idempotent, emits one operation boundary, undoes as one unit and detects remote stale state', () => {
    const doc = seed(note('a'), note('b', 200)); const undo = new WhiteboardUndo(doc);
    const port = new SpatialRelationshipCommandPort(doc);
    const input = { ...identity, gestureId: 'group', command: { type: 'group' as const, id: 'group', objectIds: ['a', 'b'] } };
    const accepted = port.dispatch(input), replay = port.dispatch(structuredClone(input));
    expect(replay).toEqual(accepted); expect(accepted.events[0]?.operationId).toBe(accepted.operationId);
    expect(() => port.dispatch({ ...input, command: { type: 'layer', objectIds: ['a'], action: 'bring-to-front' } })).toThrow('SPATIAL_COMMAND_INVALID');
    // The port transaction is tracked as one history item even though it creates and reparents three objects.
    expect(undo.undo()).toBe('undone');
    expect(readObjects(doc).find(value => value.id === 'group')).toBeUndefined();
    expect(readObjects(doc).filter(value => ['a', 'b'].includes(value.id)).every(value => value.parentId === null)).toBe(true);
    expect(undo.redo()).toBe(true);
    const stale = readObjects(doc).find(value => value.id === 'a')!;
    executeCommands(doc, [{ type: 'geometry', id: 'a', geometry: geometry(50, 50) }], 'remote');
    expect(() => port.dispatch({ ...identity, gestureId: 'stale-move', command: { type: 'move', id: 'a', x: 10, y: 10 }, preconditions: [{ id: 'a', geometry: stale.geometry }] })).toThrow('SPATIAL_CONFLICT');
    expect(readObjects(doc).find(value => value.id === 'a')?.geometry).toEqual(geometry(50, 50));
    undo.destroy(); doc.destroy();
  });
});
