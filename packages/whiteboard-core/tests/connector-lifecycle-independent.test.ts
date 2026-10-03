import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, WhiteboardUndo, type ConnectorRelationship } from '../src';

function fixture() {
  const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
  executeCommands(doc, ['a', 'b', 'c'].map((id, i) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: i * 200, y: 0, width: 100, height: 100, rotation: id === 'c' ? 90 : 0 }, text: id, style: {}, parentId: null, orderKey: id } })), 'fixture');
  const relationship: ConnectorRelationship = { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'curve', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '关系', semanticRelation: '', strokeWidth: 7, route: { kind: 'curve', startOffset: { x: 40, y: -20 }, endOffset: { x: -30, y: 50 } }, labelPosition: { t: .3, normalOffset: -12 } };
  port.dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship } });
  const edge = () => readObjects(doc).find(o => o.id === 'edge')!;
  const update = (gestureId: string, next: ConnectorRelationship) => port.dispatch({ boardId: 'board', clientId: 'local', gestureId, command: { type: 'update-connector', id: 'edge', relationship: next } });
  return { doc, port, relationship, edge, update };
}

it('detaches both endpoints in one undo item and persists the free path without resurrecting bindings', () => {
  const f = fixture(), undo = new WhiteboardUndo(f.doc), restored = createWhiteboardDocument();
  try {
    const before = f.edge();
    f.update('detach', { ...f.relationship, from: undefined, to: undefined, fromPoint: { x: 100, y: 50 }, toPoint: { x: 200, y: 50 } });
    const detached = f.edge();
    expect(detached.connector).toMatchObject({ fromPoint: { x: 100, y: 50 }, toPoint: { x: 200, y: 50 }, route: f.relationship.route, labelPosition: f.relationship.labelPosition, strokeWidth: 7 });
    expect(detached.connector?.from).toBeUndefined(); expect(detached.connector?.to).toBeUndefined();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(f.doc));
    expect(readObjects(restored).find(o => o.id === 'edge')).toEqual(detached);
    expect(undo.undo()).toBe('undone'); expect(f.edge()).toEqual(before);
    expect(undo.redo()).toBe(true); expect(f.edge()).toEqual(detached);
  } finally { undo.destroy(); restored.destroy(); f.doc.destroy(); }
});

it('reconnects a free endpoint to a rotated node while preserving manual curve offsets and label parameters through reload', () => {
  const f = fixture(), restored = createWhiteboardDocument();
  try {
    f.update('free', { ...f.relationship, from: undefined, fromPoint: { x: 10, y: 20 } });
    f.update('reconnect', { ...f.relationship, from: 'c', fromAnchor: 'right' });
    expect(f.edge().connector?.fromPoint).toBeUndefined();
    expect(f.edge().connector).toMatchObject({ from: 'c', route: f.relationship.route, labelPosition: f.relationship.labelPosition, strokeWidth: 7 });
    // Top-left rotation makes c's right anchor (350, 100), independent of the path resolver.
    expect(f.edge().geometry.x).toBeLessThanOrEqual(350);
    expect(f.edge().geometry.x + f.edge().geometry.width).toBeGreaterThanOrEqual(350);
    expect(f.edge().geometry.y + f.edge().geometry.height).toBeGreaterThanOrEqual(100);
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(f.doc));
    expect(readObjects(restored)).toEqual(readObjects(f.doc));
  } finally { restored.destroy(); f.doc.destroy(); }
});

it('rejects a pre-undo detached baseline after binding restoration without changing the document', () => {
  const f = fixture(), undo = new WhiteboardUndo(f.doc);
  try {
    f.update('detach', { ...f.relationship, from: undefined, fromPoint: { x: 100, y: 50 } });
    const detached = f.edge(); expect(undo.undo()).toBe('undone');
    const before = Y.encodeStateAsUpdate(f.doc);
    expect(() => f.port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'stale-after-undo', preconditions: [{ id: 'edge', connector: detached.connector }], command: { type: 'update-connector', id: 'edge', relationship: { ...f.relationship, label: 'stale' } } })).toThrow('SPATIAL_CONFLICT');
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(before);
  } finally { undo.destroy(); f.doc.destroy(); }
});
