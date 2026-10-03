import type { StrokePoint } from "@repo/whiteboard-core";

type Origin = Readonly<{ x: number; y: number }>;

function capsule(from: Origin, to: Origin, radius: number): string {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length === 0) {
    return `M ${from.x + radius} ${from.y} A ${radius} ${radius} 0 0 0 ${from.x - radius} ${from.y} A ${radius} ${radius} 0 0 0 ${from.x + radius} ${from.y} Z`;
  }
  const nx = -dy / length * radius, ny = dx / length * radius;
  return `M ${from.x + nx} ${from.y + ny} L ${to.x + nx} ${to.y + ny} A ${radius} ${radius} 0 0 0 ${to.x - nx} ${to.y - ny} L ${from.x - nx} ${from.y - ny} A ${radius} ${radius} 0 0 0 ${from.x + nx} ${from.y + ny} Z`;
}

/** One nonzero fill unions round segments before applying the stroke's alpha.
 * Separate translucent strokes still composite independently, as intended. */
export function drawingStrokePath(points: readonly StrokePoint[], width: number, origin: Origin = { x: 0, y: 0 }): string {
  return points.slice(1).map((point, index) => {
    const previous = points[index]!;
    const pressure = Math.max(.1, (previous.pressure + point.pressure) / 2);
    const radius = width * (.35 + pressure * .65) / 2;
    return capsule({ x: previous.x - origin.x, y: previous.y - origin.y }, { x: point.x - origin.x, y: point.y - origin.y }, radius);
  }).join(" ");
}
