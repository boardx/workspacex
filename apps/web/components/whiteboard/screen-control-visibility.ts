/** Screen-space chrome policy; object geometry and selection remain canonical. */
type SizedGeometry = { width: number; height: number };
const minimumScreenSide = (geometry: SizedGeometry, zoom: number) =>
  Math.min(Math.abs(geometry.width), Math.abs(geometry.height)) * Math.max(0, Number.isFinite(zoom) ? zoom : 0);

/** Corner handles need room for their 44px touch targets. */
export const boardObjectControlsVisible = (geometry: SizedGeometry, zoom: number): boolean =>
  minimumScreenSide(geometry, zoom) >= 48;

/** Side ports need twice that space to stay clear of adjacent corners. */
export const boardObjectPortsVisible = (geometry: SizedGeometry, zoom: number): boolean =>
  minimumScreenSide(geometry, zoom) >= 96;
