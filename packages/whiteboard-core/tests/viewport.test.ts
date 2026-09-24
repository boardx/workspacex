import { expect, it } from 'vitest';
import { selectVisibleObjects, type WhiteboardObject } from '../src';

const sticky = (id: string, x: number, y: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: 'sticky',
  geometry: { x, y, width: 180, height: 140, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });

it('projects a 10,000-object board to a bounded viewport without losing selection', () => {
  const objects = Array.from({ length: 10_000 }, (_, index) => sticky(`n-${index}`, (index % 100) * 300, Math.floor(index / 100) * 220));
  const selected = new Set(['n-9999']);
  const visible = selectVisibleObjects(objects, { x: 0, y: 0, width: 1280, height: 720 }, selected);
  expect(visible.length).toBeLessThan(100);
  expect(visible.some(object => object.id === 'n-9999')).toBe(true);
});

it('retains connectors whose segment crosses the viewport using indexed endpoints', () => {
  const a = sticky('a', -1000, 100), b = sticky('b', 1000, 100);
  const connector: WhiteboardObject = { id: 'edge', schemaVersion: 1, kind: 'connector',
    geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, text: '', style: {}, parentId: null,
    orderKey: '', connector: { from: 'a', to: 'b' } };
  expect(selectVisibleObjects([a, b, connector], { x: 0, y: 0, width: 500, height: 500 }, new Set(), 0)).toEqual([connector]);
});
