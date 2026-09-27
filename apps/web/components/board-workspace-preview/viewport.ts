export type Bounds = { left: number; top: number; width: number; height: number };
export function documentBounds(objects: Bounds[]): Bounds {
  if (!objects.length) return { left: 0, top: 0, width: 495, height: 270 };
  const left = Math.min(...objects.map(o => o.left)); const top = Math.min(...objects.map(o => o.top));
  return { left, top, width: Math.max(...objects.map(o => o.left + o.width)) - left, height: Math.max(...objects.map(o => o.top + o.height)) - top };
}
/** Fit real Fabric scene bounds below the header and above the touch dock. */
export function previewViewport(width: number, height: number, bounds: Bounds = { left: 100, top: 130, width: 495, height: 270 }): [number, number, number, number, number, number] {
  const top = 104; const bottom = Math.min(220, height * 0.35);
  const availableHeight = Math.max(40, height - top - bottom);
  const zoom = Math.max(0.05, Math.min(1, (width - 48) / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)));
  return [zoom, 0, 0, zoom, (width - bounds.width * zoom) / 2 - bounds.left * zoom, top + (availableHeight - bounds.height * zoom) / 2 - bounds.top * zoom];
}
