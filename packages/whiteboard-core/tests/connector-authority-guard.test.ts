import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type ConnectorRelationship } from '../src';

const relationship: ConnectorRelationship = { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: '' };
function fixture() {
  const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
  executeCommands(doc, ['a', 'b', 'c'].map((id, index) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: index * 200, y: 0, width: 100, height: 100, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id } })), 'fixture');
  port.dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship } });
  return { doc, port };
}

it.each(['retained', 'new', 'detached'] as const)('rejects an update against a latest locked %s target without any canonical write', scenario => {
  const { doc, port } = fixture();
  try {
    const id = scenario === 'new' ? 'c' : 'a';
    executeCommands(doc, [{ type: 'state', id, locked: true }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    const next = scenario === 'new' ? { ...relationship, from: 'c' } : scenario === 'detached' ? { ...relationship, from: undefined, fromPoint: { x: 10, y: 20 } } : { ...relationship, strokeWidth: 6 };
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'edit', command: { type: 'update-connector', id: 'edge', relationship: next } })).toThrow('OBJECT_LOCKED');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it.each([
  { label: 'remote' },
  { strokeWidth: 9 },
  { labelPosition: { t: .25, normalOffset: 10 } },
])('rejects a remote connector edit %j with unchanged geometry using the original connector baseline', change => {
  const { doc, port } = fixture();
  try {
    const edge = readObjects(doc).find(item => item.id === 'edge')!;
    port.dispatch({ boardId: 'board', clientId: 'remote', gestureId: 'remote-edit', command: { type: 'update-connector', id: 'edge', relationship: { ...relationship, ...change } } });
    expect(readObjects(doc).find(item => item.id === 'edge')!.geometry).toEqual(edge.geometry);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'stale', preconditions: [{ id: edge.id, geometry: edge.geometry, connector: edge.connector }], command: { type: 'update-connector', id: 'edge', relationship: { ...relationship, strokeWidth: 4 } } })).toThrow('SPATIAL_CONFLICT');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it('retains the existing target geometry precondition and leaves a rejected gesture available for a fresh retry', () => {
  const { doc, port } = fixture();
  try {
    const target = readObjects(doc).find(item => item.id === 'a')!;
    executeCommands(doc, [{ type: 'geometry', id: 'a', geometry: { ...target.geometry, x: 30 } }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    const envelope = { boardId: 'board', clientId: 'local', gestureId: 'retry', command: { type: 'update-connector' as const, id: 'edge', relationship: { ...relationship, strokeWidth: 5 } } };
    expect(() => port.dispatch({ ...envelope, preconditions: [{ id: 'a', geometry: target.geometry, locked: false }] })).toThrow('SPATIAL_CONFLICT');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(() => port.dispatch({ ...envelope, preconditions: [{ id: 'a', geometry: readObjects(doc).find(item => item.id === 'a')!.geometry, locked: false }] })).not.toThrow();
  } finally { doc.destroy(); }
});

it('accepts a semantically identical baseline regardless of property insertion order', () => {
  const { doc, port } = fixture();
  try {
    const edge = readObjects(doc).find(item => item.id === 'edge')!;
    const connector = Object.fromEntries(Object.entries(edge.connector!).reverse());
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'fresh', preconditions: [{ id: 'edge', connector }], command: { type: 'update-connector', id: 'edge', relationship: { ...relationship, strokeWidth: 4 } } })).not.toThrow();
    expect(readObjects(doc).find(item => item.id === 'edge')!.connector?.strokeWidth).toBe(4);
  } finally { doc.destroy(); }
});
