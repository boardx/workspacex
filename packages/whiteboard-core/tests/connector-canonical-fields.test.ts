import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { WhiteboardConnector, WHITEBOARD_CONNECTOR_LIMITS } from '@repo/contracts/whiteboard-document';
import { BoardCommandPort, SpatialRelationshipCommandPort, WhiteboardUndo, createWhiteboardDocument, duplicateWhiteboardSnapshot, executeCommands, readObjects, resolveConnectorPath, rotatedAnchorPoint, type ConnectorRelationship } from '../src';

const relation: ConnectorRelationship = { fromPoint: { x: 10, y: 20 }, toPoint: { x: 210, y: 120 }, fromAnchor: 'right', toAnchor: 'left', type: 'elbow', startStyle: 'none', endStyle: 'arrow', lineStyle: 'dashed', label: '中文关系', semanticRelation: '', strokeWidth: 7, route: { kind: 'elbow', waypoints: [{ x: 50, y: 80 }, { x: 150, y: 80 }] }, labelPosition: { t: .7, normalOffset: -12 } };
const geometry = { x: 0, y: 0, width: 80, height: 60, rotation: 0 };
function fixture(attached = false) {
  const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
  if (attached) executeCommands(doc, ['a', 'b'].map((id, i) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { ...geometry, x: i * 200 }, style: {}, text: id, parentId: null, orderKey: id } })), 'fixture');
  port.dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship: attached ? { ...relation, from: 'a', to: 'b', fromPoint: undefined, toPoint: undefined } : relation } });
  return { doc, port, edge: () => readObjects(doc).find(o => o.id === 'edge')! };
}
it('keeps legacy absent fields absent and bounds the new canonical strict values', () => {
  expect(WhiteboardConnector.parse({ from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b' });
  expect(WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth).toBe(2);
  for (const change of [{ strokeWidth: 0 }, { strokeWidth: 25 }, { strokeWidth: Infinity }, { route: { kind: 'curve', startOffset: { x: 1, y: 2 }, endOffset: { x: 3, y: 4 } } }, { route: { kind: 'elbow', waypoints: [] } }, { route: { kind: 'elbow', waypoints: Array.from({ length: 9 }, () => ({ x: 0, y: 0 })) } }, { labelPosition: { t: 1.1, normalOffset: 0 } }, { labelPosition: { t: .5, normalOffset: NaN } }, { labelPosition: { t: .5, normalOffset: 0, sourceId: 'a' } }]) expect(WhiteboardConnector.safeParse({ ...relation, ...change }).success).toBe(false);
  expect(WhiteboardConnector.safeParse({ ...relation, type: 'straight' }).success).toBe(false);
});
it('serializes and whole-board duplicates all canonical connector fields without changing route coordinates', () => {
  const f = fixture(true), target = createWhiteboardDocument();
  try {
    Y.applyUpdate(target, duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(f.doc), id => `copy_${id}`).snapshot);
    expect(readObjects(target).find(o => o.id === 'copy_edge')!.connector).toEqual({ ...f.edge().connector, from: 'copy_a', to: 'copy_b' });
  } finally { f.doc.destroy(); target.destroy(); }
});
it('moves a fully free path once and preserves width and normalized label parameters', () => {
  const f = fixture();
  try {
    const before = f.edge().geometry;
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'move', command: { type: 'move', id: 'edge', x: before.x + 30, y: before.y - 15 } });
    expect(f.edge().connector).toMatchObject({ fromPoint: { x: 40, y: 5 }, toPoint: { x: 240, y: 105 }, route: { kind: 'elbow', waypoints: [{ x: 80, y: 65 }, { x: 180, y: 65 }] }, strokeWidth: 7, labelPosition: relation.labelPosition });
  } finally { f.doc.destroy(); }
});
it('translates elbow guides once for equal two-node moves and leaves them fixed for one-node motion', () => {
  const f = fixture(true);
  try {
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'together', command: { type: 'transform', items: [{ id: 'a', geometry: { ...geometry, x: 30, y: 40 } }, { id: 'b', geometry: { ...geometry, x: 230, y: 40 } }] } });
    const route = { kind: 'elbow', waypoints: [{ x: 80, y: 120 }, { x: 180, y: 120 }] };
    expect(f.edge().connector?.route).toEqual(route);
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'one', command: { type: 'move', id: 'a', x: 45, y: 70 } });
    expect(f.edge().connector?.route).toEqual(route);
  } finally { f.doc.destroy(); }
});
it('offset-copies free endpoints and elbow guides once while retaining label and width', () => {
  const f = fixture();
  try {
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'duplicate', command: { type: 'duplicate-subgraph', rootIds: ['edge'], newIds: { edge: 'copy_edge' }, offset: { x: 12, y: -8 } } });
    expect(readObjects(f.doc).find(o => o.id === 'copy_edge')!.connector).toMatchObject({ fromPoint: { x: 22, y: 12 }, toPoint: { x: 222, y: 112 }, route: { kind: 'elbow', waypoints: [{ x: 62, y: 72 }, { x: 162, y: 72 }] }, labelPosition: relation.labelPosition, strokeWidth: 7 });
  } finally { f.doc.destroy(); }
});
it('updates path, label and width in one undo item and rejects mismatched route types atomically', () => {
  const f = fixture(), undo = new WhiteboardUndo(f.doc);
  try {
    const before = f.edge(), changed = { ...relation, strokeWidth: 11, labelPosition: { t: .2, normalOffset: 25 }, route: { kind: 'elbow' as const, waypoints: [{ x: 100, y: -30 }] } };
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'edit', command: { type: 'update-connector', id: 'edge', relationship: changed } });
    const after = f.edge(); expect(after.connector).toEqual(changed); expect(undo.undo()).toBe('undone'); expect(f.edge()).toEqual(before); expect(undo.redo()).toBe(true); expect(f.edge()).toEqual(after);
    expect(() => new BoardCommandPort(f.doc).dispatch({ boardId: 'board', clientId: 'local', gestureId: 'invalid', commands: [{ type: 'style', id: 'edge', style: { stroke: '#FF0000' } }, { type: 'connector', id: 'edge', connector: { ...changed, type: 'straight' } }] })).toThrow(); expect(f.edge()).toEqual(after);
  } finally { undo.destroy(); f.doc.destroy(); }
});
it('uses shared full-route bounds after a direct attached-node command without adding stroke padding to canonical geometry', () => {
  const f = fixture(true);
  try {
    const route = { kind: 'elbow' as const, waypoints: [{ x: -400, y: 500 }, { x: 650, y: -300 }] };
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'route', command: { type: 'update-connector', id: 'edge', relationship: { ...relation, from: 'a', to: 'b', fromPoint: undefined, toPoint: undefined, route } } });
    executeCommands(f.doc, [{ type: 'geometry', id: 'a', geometry: { ...geometry, x: 40, y: 60, rotation: 30 } }], 'public-api');
    const objects = readObjects(f.doc), a = objects.find(o => o.id === 'a')!, b = objects.find(o => o.id === 'b')!;
    const path = resolveConnectorPath({ start: rotatedAnchorPoint(a, 'right'), end: rotatedAnchorPoint(b, 'left'), type: 'elbow', route, fromAnchor: 'right', toAnchor: 'left' });
    expect(f.edge().geometry).toEqual({ ...path.bounds, width: Math.max(1, path.bounds.width), height: Math.max(1, path.bounds.height), rotation: 0 });
    expect(f.edge().connector?.strokeWidth).toBe(7);
  } finally { f.doc.destroy(); }
});
it('canonicalizes route creation and route-only updates through low-level commands, including forward references', () => {
  const doc = createWhiteboardDocument();
  try {
    const connector = { from: 'a', to: 'b', type: 'curve' as const, route: { kind: 'curve' as const, startOffset: { x: 100, y: -250 }, endOffset: { x: -50, y: 350 } }, strokeWidth: 9, labelPosition: { t: .4, normalOffset: 10 } };
    executeCommands(doc, [{ type: 'create', object: { id: 'edge', schemaVersion: 1, kind: 'connector', geometry, text: 'curve', style: {}, parentId: null, orderKey: '', connector } }, ...['a', 'b'].map((id, i) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { ...geometry, x: i * 200 }, text: id, style: {}, parentId: null, orderKey: id } }))], 'api');
    const edge = () => readObjects(doc).find(o => o.id === 'edge')!;
    const path = resolveConnectorPath({ start: { x: 40, y: 30 }, end: { x: 240, y: 30 }, type: 'curve', route: connector.route });
    expect(edge().geometry).toEqual({ ...path.bounds, rotation: 0 });
    executeCommands(doc, [{ type: 'connector', id: 'edge', connector: { from: 'a', to: 'b', type: 'straight' } }], 'api');
    expect(edge().geometry).toEqual({ x: 40, y: 30, width: 200, height: 1, rotation: 0 });
  } finally { doc.destroy(); }
});
it('rejects resolved out-of-world curve controls atomically even when each stored vector passes schema', () => {
  const f = fixture();
  try {
    const before = readObjects(f.doc);
    const connector = { fromPoint: { x: 900000, y: 0 }, toPoint: { x: 0, y: 0 }, type: 'curve' as const, route: { kind: 'curve' as const, startOffset: { x: 200000, y: 0 }, endOffset: { x: 0, y: 0 } } };
    expect(WhiteboardConnector.safeParse(connector).success).toBe(true);
    expect(() => executeCommands(f.doc, [{ type: 'style', id: 'edge', style: { stroke: '#FF0000' } }, { type: 'connector', id: 'edge', connector }], 'api')).toThrow();
    expect(readObjects(f.doc)).toEqual(before);
  } finally { f.doc.destroy(); }
});
it('moves a free path within a group and then by a direct transform without double translating guides', () => {
  const f = fixture();
  try {
    executeCommands(f.doc, [{ type: 'create', object: { id: 'frame', schemaVersion: 1, kind: 'frame', geometry: { ...geometry, width: 500, height: 300 }, text: '', style: {}, parentId: null, orderKey: '' } }, { type: 'parent', id: 'edge', parentId: 'frame', orderKey: 'edge' }], 'fixture');
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'group-move', command: { type: 'move', id: 'frame', x: 30, y: 40 } });
    expect(f.edge().connector?.route).toEqual({ kind: 'elbow', waypoints: [{ x: 80, y: 120 }, { x: 180, y: 120 }] });
    const before = f.edge().geometry;
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'free-transform', command: { type: 'transform', items: [{ id: 'edge', geometry: { ...before, x: before.x - 10, y: before.y + 5 } }] } });
    expect(f.edge().connector).toMatchObject({ fromPoint: { x: 30, y: 65 }, toPoint: { x: 230, y: 165 }, route: { kind: 'elbow', waypoints: [{ x: 70, y: 125 }, { x: 170, y: 125 }] } });
  } finally { f.doc.destroy(); }
});
it('recomputes restored routed-edge bounds after remote target movement, including edge-first restore order', () => {
  const f = fixture(true);
  try {
    const route = { kind: 'curve' as const, startOffset: { x: 20, y: 50 }, endOffset: { x: -20, y: -50 } };
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'curve', command: { type: 'update-connector', id: 'edge', relationship: { ...relation, from: 'a', to: 'b', fromPoint: undefined, toPoint: undefined, type: 'curve', route } } });
    executeCommands(f.doc, [{ type: 'delete', id: 'a' }], 'local');
    executeCommands(f.doc, [{ type: 'geometry', id: 'b', geometry: { ...geometry, x: 600 } }], 'remote');
    const beforeRestore = Y.encodeStateAsUpdate(f.doc);
    expect(() => executeCommands(f.doc, [{ type: 'restore', id: 'edge' }], 'invalid')).toThrow();
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(beforeRestore);
    executeCommands(f.doc, [{ type: 'restore', id: 'edge' }, { type: 'restore', id: 'a' }], 'local');
    const objects = readObjects(f.doc), a = objects.find(o => o.id === 'a')!, b = objects.find(o => o.id === 'b')!;
    const bounds = resolveConnectorPath({ start: rotatedAnchorPoint(a, 'right'), end: rotatedAnchorPoint(b, 'left'), type: 'curve', route }).bounds;
    expect(f.edge().geometry).toEqual({ ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), rotation: 0 });
  } finally { f.doc.destroy(); }
});
it.each(['free-move', 'group-move', 'two-node-transform'] as const)('round-trips all canonical fields in one Undo/Redo item for %s', action => {
  const f = fixture(action === 'two-node-transform');
  if (action === 'group-move') executeCommands(f.doc, [{ type: 'create', object: { id: 'frame', schemaVersion: 1, kind: 'frame', geometry: { ...geometry, width: 500, height: 300 }, text: '', style: {}, parentId: null, orderKey: '' } }, { type: 'parent', id: 'edge', parentId: 'frame', orderKey: 'edge' }], 'fixture');
  const undo = new WhiteboardUndo(f.doc);
  try {
    const before = readObjects(f.doc), edgeGeometry = f.edge().geometry;
    f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: action, command: action === 'two-node-transform' ? { type: 'transform', items: [{ id: 'a', geometry: { ...geometry, x: 30, y: 40 } }, { id: 'b', geometry: { ...geometry, x: 230, y: 40 } }] } : action === 'group-move' ? { type: 'move', id: 'frame', x: 30, y: 40 } : { type: 'move', id: 'edge', x: edgeGeometry.x + 30, y: edgeGeometry.y + 40 } });
    const after = readObjects(f.doc); expect(after).not.toEqual(before);
    expect(undo.undo()).toBe('undone'); expect(readObjects(f.doc)).toEqual(before);
    expect(undo.redo()).toBe(true); expect(readObjects(f.doc)).toEqual(after);
  } finally { undo.destroy(); f.doc.destroy(); }
});
it('rejects a schema-valid route with unrepresentable bounds before changing style, text, objects or tombstones', () => {
  const f = fixture();
  try {
    const connector = { ...relation, route: { kind: 'elbow' as const, waypoints: [{ x: -100000, y: 0 }, { x: 100000, y: 0 }] } };
    expect(WhiteboardConnector.safeParse(connector).success).toBe(true);
    const before = Y.encodeStateAsUpdate(f.doc);
    expect(() => executeCommands(f.doc, [{ type: 'style', id: 'edge', style: { stroke: '#FF0000' } }, { type: 'text', id: 'edge', index: 0, deleteCount: 0, insert: 'changed' }, { type: 'create', object: { id: 'temporary', schemaVersion: 1, kind: 'sticky', geometry, text: '', style: {}, parentId: null, orderKey: '' } }, { type: 'delete', id: 'temporary' }, { type: 'connector', id: 'edge', connector }], 'invalid')).toThrow();
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  } finally { f.doc.destroy(); }
});
it('keeps the three new optional fields absent through legacy move and duplicate', () => {
  const doc = createWhiteboardDocument(), target = createWhiteboardDocument();
  try {
    executeCommands(doc, [{ type: 'create', object: { id: 'legacy', schemaVersion: 1, kind: 'connector', geometry, text: '', style: {}, parentId: null, orderKey: '', connector: { fromPoint: { x: 0, y: 0 }, toPoint: { x: 80, y: 60 } } } }], 'seed');
    new SpatialRelationshipCommandPort(doc).dispatch({ boardId: 'board', clientId: 'local', gestureId: 'legacy-move', command: { type: 'move', id: 'legacy', x: 20, y: 30 } });
    Y.applyUpdate(target, duplicateWhiteboardSnapshot(Y.encodeStateAsUpdate(doc), id => `copy_${id}`).snapshot);
    for (const value of [readObjects(doc)[0]!, readObjects(target)[0]!]) { expect(value.connector).not.toHaveProperty('route'); expect(value.connector).not.toHaveProperty('strokeWidth'); expect(value.connector).not.toHaveProperty('labelPosition'); }
  } finally { doc.destroy(); target.destroy(); }
});
