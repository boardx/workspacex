type Point = { x: number; y: number };

/** Use whole CSS pixels for mouse input: Chromium MouseEvent client coordinates
 * quantize fractional protocol coordinates. World deltas need not be integers
 * at a fitted viewport scale. Never infer expected movement from output geometry. */
export function spatialPointerDrag(start: Point, worldDelta: Point, zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("Invalid spatial pointer zoom");
  const from = { x: Math.round(start.x), y: Math.round(start.y) };
  const to = { x: from.x + Math.round(worldDelta.x * zoom), y: from.y + Math.round(worldDelta.y * zoom) };
  return { from, to };
}

export function spatialDragPosition(origin: Point, from: Point, to: Point, zoom: number): Point {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("Invalid spatial pointer zoom");
  // Canonical gesture commits remove only floating-point noise at 1e-6 world units.
  const canonical = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return { x: canonical(origin.x + (to.x - from.x) / zoom), y: canonical(origin.y + (to.y - from.y) / zoom) };
}
