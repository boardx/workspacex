import { scenePointFromLocal } from "@repo/whiteboard-core";
import { drawingPointBounds } from "../drawing-coordinate-space";
import type { BoardFabricObject } from "./board-fabric-object";
type Point = { x: number; y: number };
function pointDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x-from.x, dy = to.y-from.y, length = dx*dx+dy*dy;
  const ratio = length ? Math.max(0, Math.min(1, ((point.x-from.x)*dx+(point.y-from.y)*dy)/length)) : 0;
  return Math.hypot(point.x-from.x-ratio*dx, point.y-from.y-ratio*dy);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const abC = cross(a,b,c), abD = cross(a,b,d), cdA = cross(c,d,a), cdB = cross(c,d,b);
  if (abC*abD < 0 && cdA*cdB < 0) return 0;
  return Math.min(pointDistance(a,c,d), pointDistance(b,c,d), pointDistance(c,a,b), pointDistance(d,a,b));
}
/** Hit actual vector ink in scene coordinates. The eraser cannot target other object kinds. */
export function drawingEraserTargets(objects: Iterable<BoardFabricObject>, points: readonly Point[], width: number): string[] {
  if (points.length < 2) return [];
  const result: string[] = [];
  for (const object of objects) {
    if (object.kind !== "drawing" || object.hidden || object.locked || object.boardContent?.type !== "drawing") continue;
    const bounds = drawingPointBounds(object.boardContent.strokes.flatMap(stroke => stroke.points));
    const scaleX = object.geometry.width / bounds.width, scaleY = object.geometry.height / bounds.height;
    const toScene = (point: Point) => scenePointFromLocal(object.geometry, { x: (point.x-bounds.x)*scaleX, y: (point.y-bounds.y)*scaleY });
    const hit = object.boardContent.strokes.some(stroke => stroke.tool !== "eraser" && stroke.points.slice(1).some((point,index) => {
      const from = toScene(stroke.points[index]!), to = toScene(point);
      const radius = (width + stroke.width*Math.max(scaleX,scaleY))/2;
      return points.slice(1).some((eraser,index) => segmentDistance(from,to,points[index]!,eraser) <= radius);
    }));
    if (hit) result.push(object.id);
  }
  return result;
}
