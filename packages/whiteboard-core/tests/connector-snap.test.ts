import { expect, it } from 'vitest';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { snapConnectorEndpoint } from '../src/connector-snap';
const node = (id: string, patch: Partial<WhiteboardObject> = {}): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky', text: '', style: {}, parentId: null, orderKey: 'a', geometry: { x: 100, y: 200, width: 80, height: 40, rotation: 90 }, ...patch });
it('snaps rotated cardinal anchors with CSS radius and excludes unauthorized targets', () => {
  const a = node('a');
  expect(snapConnectorEndpoint([a], { x: 80, y: 280 }, { zoom: 2 })).toMatchObject({ objectId: 'a', anchor: 'right', point: { x: 80, y: 280 } });
  expect(snapConnectorEndpoint([a], { x: 87, y: 280 }, { zoom: 2 })).toBeNull();
  expect(snapConnectorEndpoint([a], { x: 87, y: 280 }, { zoom: 1 })).not.toBeNull();
  for (const target of [node('a', { locked: true }), node('a', { hidden: true }), node('a', { kind: 'connector' })]) expect(snapConnectorEndpoint([target], { x: 80, y: 280 })).toBeNull();
  expect(snapConnectorEndpoint([a], { x: 80, y: 280 }, { excludeIds: ['a'] })).toBeNull(); expect(snapConnectorEndpoint([a], { x: 80, y: 280 }, { bypass: true })).toBeNull();
});
it('uses deterministic identity tie break and rejects invalid zoom', () => {
  expect(snapConnectorEndpoint([node('z'), node('a')], { x: 80, y: 280 })?.objectId).toBe('a'); expect(() => snapConnectorEndpoint([], { x: 0, y: 0 }, { zoom: 0 })).toThrow('INPUT_INVALID');
});
