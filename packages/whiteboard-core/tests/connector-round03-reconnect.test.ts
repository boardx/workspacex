import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, resolveConnectorPath, rotatedAnchorPoint, SpatialRelationshipCommandPort, WhiteboardUndo, type ConnectorRelationship } from '../src';

const relationship: ConnectorRelationship = {
  from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'curve',
  startStyle: 'circle', endStyle: 'diamond', lineStyle: 'dashed', label: '关系', semanticRelation: '',
  strokeWidth: 8, route: { kind: 'curve', startOffset: { x: 40, y: -70 }, endOffset: { x: -20, y: 90 } },
  labelPosition: { t: .7, normalOffset: -23 },
};
function fixture() {
  const doc = createWhiteboardDocument();
  executeCommands(doc, ['a', 'b'].map((id, i) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: i * 300, y: 0, width: 100, height: 80, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id } })), 'fixture');
  new SpatialRelationshipCommandPort(doc).dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'edge-create', command: { type: 'create-connector', id: 'edge', relationship } });
  return doc;
}

it('converges two independent document replicas after disconnected node movement and connector style editing', () => {
  const first = fixture(), second = createWhiteboardDocument(), reloaded = createWhiteboardDocument();
  try {
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstVector = Y.encodeStateVector(first), secondVector = Y.encodeStateVector(second);
    new SpatialRelationshipCommandPort(first).dispatch({ boardId: 'board', clientId: 'user-a', gestureId: 'style', command: { type: 'update-connector', id: 'edge', relationship: { ...relationship, strokeWidth: 17, label: '重新连接', labelPosition: { t: .2, normalOffset: 31 } } } });
    executeCommands(second, [{ type: 'geometry', id: 'b', geometry: { x: 420, y: 160, width: 100, height: 80, rotation: 90 } }], 'remote-user-b');
    const firstUpdate = Y.encodeStateAsUpdate(first, firstVector), secondUpdate = Y.encodeStateAsUpdate(second, secondVector);
    Y.applyUpdate(first, secondUpdate); Y.applyUpdate(second, firstUpdate);
    // Reconnect replay must be idempotent in either delivery order.
    Y.applyUpdate(first, firstUpdate); Y.applyUpdate(second, secondUpdate);
    expect(readObjects(first)).toEqual(readObjects(second));
    const objects = readObjects(first), edge = objects.find(object => object.id === 'edge')!;
    expect(edge.connector).toEqual({ ...relationship, strokeWidth: 17, label: '重新连接', labelPosition: { t: .2, normalOffset: 31 } });
    const start = rotatedAnchorPoint(objects.find(object => object.id === 'a')!, 'right');
    const end = rotatedAnchorPoint(objects.find(object => object.id === 'b')!, 'left');
    expect(start).toEqual({ x: 100, y: 40 }); expect(end).toEqual({ x: 380, y: 160 });
    const path = resolveConnectorPath({ start, end, type: edge.connector!.type, route: edge.connector!.route });
    expect(path.start).toEqual(start); expect(path.end).toEqual(end);
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(first));
    expect(readObjects(reloaded)).toEqual(objects);
  } finally { first.destroy(); second.destroy(); reloaded.destroy(); }
});

it('undoes a cascaded node deletion without overwriting a remote surviving endpoint move', () => {
  const doc = fixture(), history = new WhiteboardUndo(doc);
  try {
    const original = readObjects(doc).find(object => object.id === 'edge')!;
    new SpatialRelationshipCommandPort(doc).dispatch({ boardId: 'board', clientId: 'local', gestureId: 'delete-a', command: { type: 'delete-objects', ids: ['a'] } });
    expect(readObjects(doc).map(object => object.id)).toEqual(['b']);
    executeCommands(doc, [{ type: 'geometry', id: 'b', geometry: { x: 510, y: 90, width: 100, height: 80, rotation: 0 } }], 'remote');
    expect(history.undo()).toBe('undone');
    const restored = readObjects(doc), edge = restored.find(object => object.id === 'edge')!;
    expect(edge.connector).toEqual(original.connector);
    expect(restored.find(object => object.id === 'b')!.geometry.x).toBe(510);
    expect(edge.geometry).not.toEqual(original.geometry);
    expect(history.redo()).toBe(true);
    expect(readObjects(doc).map(object => object.id)).toEqual(['b']);
    expect(readObjects(doc)[0]!.geometry.x).toBe(510);
  } finally { history.destroy(); doc.destroy(); }
});

it.each(['edge', 'a'])('rejects redo after a peer edits restored %s without deleting or overwriting that edit', id => {
  const doc = fixture(), history = new WhiteboardUndo(doc);
  try {
    new SpatialRelationshipCommandPort(doc).dispatch({ boardId: 'board', clientId: 'local', gestureId: 'delete-a', command: { type: 'delete-objects', ids: ['a'] } });
    executeCommands(doc, [{ type: 'geometry', id: 'b', geometry: { x: 510, y: 90, width: 100, height: 80, rotation: 0 } }], 'remote');
    expect(history.undo()).toBe('undone');
    executeCommands(doc, [{ type: 'style', id, style: { stroke: '#FF0000' } }], 'remote-after-restore');
    const before = Y.encodeStateAsUpdate(doc);
    expect(history.redo()).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readObjects(doc).find(object => object.id === id)!.style.stroke).toBe('#FF0000');
    expect(readObjects(doc).find(object => object.id === 'b')!.geometry.x).toBe(510);
  } finally { history.destroy(); doc.destroy(); }
});
