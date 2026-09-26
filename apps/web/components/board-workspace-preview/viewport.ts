/** Fit the sample document below the header and above the touch dock. */
export function previewViewport(width: number, height: number): [number, number, number, number, number, number] {
  const top = 104;
  const bottom = Math.min(220, height * 0.35);
  const availableHeight = Math.max(40, height - top - bottom);
  const zoom = Math.max(0.05, Math.min(1, (width - 48) / 495, availableHeight / 270));
  return [zoom, 0, 0, zoom, (width - 495 * zoom) / 2 - 100 * zoom, top + (availableHeight - 270 * zoom) / 2 - 130 * zoom];
}
