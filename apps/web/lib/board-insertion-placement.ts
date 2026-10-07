import { rotatedGeometryCorners } from '@repo/whiteboard-core';
import type { WhiteboardGeometry } from '@repo/contracts/whiteboard-document';

export type PlacementBounds = { x: number; y: number; width: number; height: number };
export function insertionBounds(geometries: WhiteboardGeometry[]): PlacementBounds {
  const points = geometries.flatMap(rotatedGeometryCorners);
  if (!points.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(1, Math.max(...points.map(p => p.x)) - x), height: Math.max(1, Math.max(...points.map(p => p.y)) - y) };
}
export function insertionPlacement(existing: WhiteboardGeometry[], incoming: WhiteboardGeometry[]) {
  const source = insertionBounds(incoming), occupied = insertionBounds(existing);
  const gap = Math.max(source.width, source.height) / 10;
  const recommended = { x: (existing.length ? occupied.x + occupied.width + gap : 0) - source.x, y: (existing.length ? occupied.y : 0) - source.y };
  const placed = { ...source, x: source.x + recommended.x, y: source.y + recommended.y, rotation: 0 };
  const union = insertionBounds([...existing, placed]);
  const padding = Math.max(union.width, union.height) / 8;
  return { source, recommended, view: { x: union.x - padding, y: union.y - padding, width: union.width + padding * 2, height: union.height + padding * 2 } };
}
