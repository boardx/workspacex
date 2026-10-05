import type { DrawingStroke } from "@repo/whiteboard-core";

const DRAWING_EXTENSION_BUDGET = 14_000;

export function fitDrawingStrokeToExtensionBudget(existing: readonly DrawingStroke[], stroke: DrawingStroke): DrawingStroke {
  const sample = (points: ReadonlyArray<DrawingStroke["points"][number]>, target: number) => target >= points.length ? [...points] : Array.from({ length: target }, (_, index) => points[Math.round(index * (points.length - 1) / (target - 1))]!);
  let target = Math.min(512, stroke.points.length), points = sample(stroke.points, target);
  const size = () => new TextEncoder().encode(JSON.stringify({ contentObject: { version: 1, type: "drawing", strokes: [...existing, { ...stroke, points }] } })).length;
  while (size() > DRAWING_EXTENSION_BUDGET && points.length > 2) {
    target = Math.max(2, Math.floor(target * .72));
    points = sample(stroke.points, target);
  }
  if (size() > DRAWING_EXTENSION_BUDGET) throw new Error("DRAWING_EXTENSION_BUDGET_EXCEEDED");
  return { ...stroke, points };
}

