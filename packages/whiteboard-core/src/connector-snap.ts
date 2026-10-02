import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { rotatedAnchorPoint, type SpatialAnchor, type SpatialPoint } from './spatial-geometry';

export interface ConnectorSnapCandidate { objectId: string; anchor: SpatialAnchor; point: SpatialPoint; distance: number }
/** Snap radius is CSS pixels; candidates and returned endpoint are world points. */
export function snapConnectorEndpoint(objects: readonly WhiteboardObject[], scenePoint: SpatialPoint, options: { zoom?: number; radius?: number; excludeIds?: readonly string[]; bypass?: boolean } = {}): ConnectorSnapCandidate | null {
  const { zoom = 1, radius = 12, excludeIds = [], bypass = false } = options;
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(radius) || radius < 0 || ![scenePoint.x, scenePoint.y].every(Number.isFinite)) throw new Error('CONNECTOR_SNAP_INPUT_INVALID');
  if (bypass) return null;
  const excluded = new Set(excludeIds), anchors: SpatialAnchor[] = ['top', 'right', 'bottom', 'left'];
  let best: ConnectorSnapCandidate | null = null;
  for (const object of objects) {
    if (object.kind === 'connector' || object.locked || object.hidden || excluded.has(object.id)) continue;
    for (const anchor of anchors) { const point = rotatedAnchorPoint(object, anchor), distance = Math.hypot(point.x - scenePoint.x, point.y - scenePoint.y); if (distance <= radius / zoom && (!best || distance < best.distance || (distance === best.distance && object.id.localeCompare(best.objectId) < 0))) best = { objectId: object.id, anchor, point, distance }; }
  }
  return best;
}
