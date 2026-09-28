import type { DrawingStroke, WhiteboardObject } from "@repo/whiteboard-core";

type DrawingGeometry = WhiteboardObject["geometry"];
type DrawingPoint = DrawingStroke["points"][number];
const canonicalNumber = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Drawing points live in the drawing's intrinsic, unrotated coordinate plane.
 * Geometry is the only world transform. This lets Fabric move, resize, and
 * rotate a drawing without rewriting every vector point.
 */
export function drawingPointBounds(points: ReadonlyArray<Pick<DrawingPoint, "x" | "y">>): DrawingGeometry {
  if (!points.length) return { x: 0, y: 0, width: 1, height: 1, rotation: 0 };
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y), rotation: 0 };
}

function intrinsicBounds(strokes: readonly DrawingStroke[]): DrawingGeometry {
  return drawingPointBounds(strokes.flatMap((stroke) => stroke.points));
}

/** Convert a freshly captured world-space stroke into an existing drawing's
 * intrinsic plane. The returned points render at the exact captured world
 * positions under the current geometry, including rotation. */
export function worldStrokeToDrawingSpace(
  geometry: DrawingGeometry,
  existing: readonly DrawingStroke[],
  stroke: DrawingStroke,
): DrawingStroke {
  const source = intrinsicBounds(existing);
  const radians = geometry.rotation * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const scaleX = source.width / Math.max(1, geometry.width);
  const scaleY = source.height / Math.max(1, geometry.height);
  return {
    ...stroke,
    points: stroke.points.map((point) => {
      const dx = point.x - geometry.x, dy = point.y - geometry.y;
      const localX = dx * cosine + dy * sine;
      const localY = -dx * sine + dy * cosine;
      return { ...point, x: canonicalNumber(source.x + localX * scaleX), y: canonicalNumber(source.y + localY * scaleY) };
    }),
  };
}

/** Expand the transformed geometry only when a new intrinsic stroke exceeds
 * its source bounds. Existing vectors retain their world position, scale, and
 * rotation while the new vector remains at the captured world position. */
export function geometryForAppendedDrawingStroke(
  geometry: DrawingGeometry,
  existing: readonly DrawingStroke[],
  stroke: DrawingStroke,
): DrawingGeometry {
  const source = intrinsicBounds(existing);
  const combined = drawingPointBounds([...existing.flatMap((item) => item.points), ...stroke.points]);
  const scaleX = geometry.width / source.width, scaleY = geometry.height / source.height;
  const localOffsetX = (combined.x - source.x) * scaleX;
  const localOffsetY = (combined.y - source.y) * scaleY;
  const radians = geometry.rotation * Math.PI / 180;
  return {
    x: canonicalNumber(geometry.x + localOffsetX * Math.cos(radians) - localOffsetY * Math.sin(radians)),
    y: canonicalNumber(geometry.y + localOffsetX * Math.sin(radians) + localOffsetY * Math.cos(radians)),
    width: canonicalNumber(combined.width * scaleX),
    height: canonicalNumber(combined.height * scaleY),
    rotation: geometry.rotation,
  };
}
