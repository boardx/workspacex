import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type ConnectorRelationship } from '../src';

const relation: ConnectorRelationship = { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: '' };
function fixture() {
  const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
  executeCommands(doc, ['a', 'b', 'c'].map((id, i) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: i ? 400 + (i - 1) * 200 : 40, y: i ? 200 : 50, width: 100, height: 60, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id } })), 'fixture');
  port.dispatch({ boardId: 'board', clientId: 'fixture', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship: relation } });
  const baseline = readObjects(doc).find(item => item.id === 'edge')!.connector!;
  return { doc, port, baseline };
}

it.each(['existing', 'new', 'detached'] as const)('rejects a latest hidden %s binding even when the edge baseline is unchanged', scenario => {
  const { doc, port, baseline } = fixture();
  try {
    executeCommands(doc, [{ type: 'state', id: scenario === 'new' ? 'c' : 'a', hidden: true }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    const relationship = scenario === 'new' ? { ...relation, from: 'c' } : scenario === 'detached' ? { ...relation, from: undefined, fromPoint: { x: 140, y: 80 } } : { ...relation, strokeWidth: 6 };
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'edit', preconditions: [{ id: 'edge', connector: baseline, locked: false }], command: { type: 'update-connector', id: 'edge', relationship } })).toThrow('CONNECTOR_ENDPOINT_INVALID');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it('rejects connector creation at a latest hidden target before publishing an edge', () => {
  const { doc, port } = fixture();
  try {
    executeCommands(doc, [{ type: 'state', id: 'a', hidden: true }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'new-edge', command: { type: 'create-connector', id: 'new-edge', relationship: relation } })).toThrow('CONNECTOR_ENDPOINT_INVALID');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it('rejects editing an edge hidden after selection without changing the hidden flag', () => {
  const { doc, port, baseline } = fixture();
  try {
    executeCommands(doc, [{ type: 'state', id: 'edge', hidden: true }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'hidden-edit', preconditions: [{ id: 'edge', connector: baseline }], command: { type: 'update-connector', id: 'edge', relationship: { ...relation, strokeWidth: 6 } } })).toThrow('SPATIAL_CONFLICT');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it('rejects deletion of the old bound target and its edge without resurrecting either', () => {
  const { doc, port, baseline } = fixture();
  try {
    executeCommands(doc, [{ type: 'delete', id: 'a' }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'stale', preconditions: [{ id: 'edge', connector: baseline }], command: { type: 'update-connector', id: 'edge', relationship: { ...relation, from: undefined, fromPoint: { x: 140, y: 80 } } } })).toThrow('OBJECT_NOT_FOUND');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readObjects(doc).some(item => item.id === 'edge' || item.id === 'a')).toBe(false);
  } finally { doc.destroy(); }
});

it('rejects a newly selected endpoint deleted before release while preserving the original edge', () => {
  const { doc, port, baseline } = fixture();
  try {
    executeCommands(doc, [{ type: 'delete', id: 'c' }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'reconnect', preconditions: [{ id: 'edge', connector: baseline }], command: { type: 'update-connector', id: 'edge', relationship: { ...relation, from: 'c' } } })).toThrow('OBJECT_NOT_FOUND');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it('refuses detaching the old target when it locks after the initial snapshot', () => {
  const { doc, port, baseline } = fixture();
  try {
    executeCommands(doc, [{ type: 'state', id: 'a', locked: true }], 'remote');
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'detach', preconditions: [{ id: 'edge', connector: baseline }], command: { type: 'update-connector', id: 'edge', relationship: { ...relation, from: undefined, fromPoint: { x: 140, y: 80 } } } })).toThrow('OBJECT_LOCKED');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { doc.destroy(); }
});

it('allows a pure remote target move and derives the updated edge from the latest target geometry', () => {
  const { doc, port, baseline } = fixture();
  try {
    executeCommands(doc, [{ type: 'geometry', id: 'a', geometry: { x: 90, y: 50, width: 100, height: 60, rotation: 0 } }], 'remote');
    port.dispatch({ boardId: 'board', clientId: 'local', gestureId: 'fresh-edit', preconditions: [{ id: 'edge', connector: baseline, locked: false }, { id: 'a', locked: false }, { id: 'b', locked: false }], command: { type: 'update-connector', id: 'edge', relationship: { ...relation, label: 'latest', strokeWidth: 6 } } });
    const edge = readObjects(doc).find(item => item.id === 'edge')!;
    expect(edge.geometry).toEqual({ x: 190, y: 80, width: 210, height: 150, rotation: 0 });
    expect(edge.connector).toEqual({ ...relation, label: 'latest', strokeWidth: 6 });
  } finally { doc.destroy(); }
});
