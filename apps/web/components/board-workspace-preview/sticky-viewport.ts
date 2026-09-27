export type Box = { left: number; top: number; width: number; height: number };
export type ViewTransform = [number, number, number, number, number, number];
/** Keep the whole paper inside measured unobscured space; preserve zoom unless it cannot fit. */
export function stickyViewport(bounds: Box, safe: Box, current: ViewTransform): ViewTransform {
  if (safe.width <= 0 || safe.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return current;
  const zoom = Math.min(current[0], safe.width / bounds.width, safe.height / bounds.height);
  const left = bounds.left * zoom + current[4];
  const top = bounds.top * zoom + current[5];
  const x = Math.min(Math.max(left, safe.left), safe.left + safe.width - bounds.width * zoom);
  const y = Math.min(Math.max(top, safe.top), safe.top + safe.height - bounds.height * zoom);
  return [zoom, 0, 0, zoom, x - bounds.left * zoom, y - bounds.top * zoom];
}
