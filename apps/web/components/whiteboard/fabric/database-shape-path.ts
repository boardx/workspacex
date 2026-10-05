/** Cylinder silhouette and front arcs share the same canonical centered frame. */
export function databaseShapePath(width: number, height: number): string {
  const x = width / 2, y = height / 2, radiusY = height * .12;
  const top = -y + radiusY, bottom = y - radiusY;
  // Back top half + sides + front bottom half enclose the fill. The remaining
  // subpaths run right to left, matching the shell winding so the nonzero
  // fill rule never cuts transparent half-moons out of the cylinder.
  return `M ${-x} ${top} A ${x} ${radiusY} 0 0 1 ${x} ${top} L ${x} ${bottom} A ${x} ${radiusY} 0 0 1 ${-x} ${bottom} Z M ${x} ${top} A ${x} ${radiusY} 0 0 1 ${-x} ${top} M ${x} 0 A ${x} ${radiusY} 0 0 1 ${-x} 0`;
}
