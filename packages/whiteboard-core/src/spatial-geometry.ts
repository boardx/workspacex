import type { WhiteboardGeometry, WhiteboardObject } from '@repo/contracts/whiteboard-document';

export type SpatialAnchor = 'top' | 'right' | 'bottom' | 'left' | 'center';
export type SpatialPoint = { x: number; y: number };
const stable = (value: number) => Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e12) / 1e12;

/** Canonical geometry uses the unrotated top-left as its origin. */
export function scenePointFromLocal(geometry: WhiteboardGeometry, point: SpatialPoint): SpatialPoint {
  const angle = geometry.rotation * Math.PI / 180;
  return {
    x: stable(geometry.x + point.x * Math.cos(angle) - point.y * Math.sin(angle)),
    y: stable(geometry.y + point.x * Math.sin(angle) + point.y * Math.cos(angle)),
  };
}

export function localPointFromScene(geometry: WhiteboardGeometry, point: SpatialPoint): SpatialPoint {
  const angle = -geometry.rotation * Math.PI / 180;
  const dx = point.x - geometry.x, dy = point.y - geometry.y;
  return { x: stable(dx * Math.cos(angle) - dy * Math.sin(angle)), y: stable(dx * Math.sin(angle) + dy * Math.cos(angle)) };
}

export function rotatedGeometryCorners(geometry: WhiteboardGeometry): SpatialPoint[] {
  return [
    scenePointFromLocal(geometry, { x: 0, y: 0 }),
    scenePointFromLocal(geometry, { x: geometry.width, y: 0 }),
    scenePointFromLocal(geometry, { x: geometry.width, y: geometry.height }),
    scenePointFromLocal(geometry, { x: 0, y: geometry.height }),
  ];
}

export function rotatedAnchorPoint(value: Pick<WhiteboardObject, 'geometry'>, anchor: SpatialAnchor, offset: SpatialPoint = {x:0,y:0}): SpatialPoint {
  const { width, height } = value.geometry;
  const local = anchor === 'top' ? { x: width / 2, y: 0 }
    : anchor === 'right' ? { x: width, y: height / 2 }
      : anchor === 'bottom' ? { x: width / 2, y: height }
        : anchor === 'left' ? { x: 0, y: height / 2 }
          : { x: width / 2, y: height / 2 };
  return scenePointFromLocal(value.geometry, {x:local.x+offset.x,y:local.y+offset.y});
}

export function geometryBoundsInLocalSpace(child: WhiteboardGeometry, parent: WhiteboardGeometry) {
  const points = rotatedGeometryCorners(child).map(point => localPointFromScene(parent, point));
  return {
    left: Math.min(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)),
    bottom: Math.max(...points.map(point => point.y)),
  };
}
