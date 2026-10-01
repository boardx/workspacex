import { describe, expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, rotatedAnchorPoint, SpatialRelationshipCommandPort, type ConnectorRelationship, type WhiteboardObject } from '../src';

const object = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'rectangle', geometry: { x, y: 20, width: 100, height: 80, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });
const relationship: ConnectorRelationship = { from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'top', fromOffset: { x: 17, y: 29 }, toOffset: { x: -23, y: 11 }, type: 'straight', startStyle: 'none', endStyle: 'arrow', lineStyle: 'solid', label: '', semanticRelation: '' };

describe('direct geometry commands preserve attached connector offsets', () => {
  it.each([
    { name: 'move', geometry: { x: 130, y: 90, width: 100, height: 80, rotation: 0 } },
    { name: 'resize', geometry: { x: 10, y: 20, width: 220, height: 160, rotation: 0 } },
    { name: 'rotation', geometry: { x: 10, y: 20, width: 100, height: 80, rotation: 37 } },
  ])('matches projected endpoints after $name on either attached object', ({ geometry }) => {
    const doc = createWhiteboardDocument();
    try {
      executeCommands(doc, [{ type: 'create', object: object('a', 10) }, { type: 'create', object: object('b', 350) }], {});
      new SpatialRelationshipCommandPort(doc).dispatch({ boardId: 'board', clientId: 'client', gestureId: 'create', command: { type: 'create-connector', id: 'edge', relationship } });
      for (const id of ['a', 'b']) {
        executeCommands(doc, [{ type: 'geometry', id, geometry }], {});
        const records = readObjects(doc), a = records.find(item => item.id === 'a')!, b = records.find(item => item.id === 'b')!, edge = records.find(item => item.id === 'edge')!;
        // This is the endpoint resolution used by the Fabric projection.
        const start = rotatedAnchorPoint(a, relationship.fromAnchor, relationship.fromOffset);
        const end = rotatedAnchorPoint(b, relationship.toAnchor, relationship.toOffset);
        expect(edge.geometry).toEqual({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(1, Math.abs(end.x - start.x)), height: Math.max(1, Math.abs(end.y - start.y)), rotation: 0 });
        expect(edge.connector).toMatchObject({ fromOffset: relationship.fromOffset, toOffset: relationship.toOffset });
      }
    } finally { doc.destroy(); }
  });
});
