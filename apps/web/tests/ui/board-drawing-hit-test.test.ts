import { describe, expect, it } from "vitest";
import { drawingEraserTargets } from "@/components/whiteboard/fabric/drawing-hit-test";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";
const ink: BoardFabricObject = { id: "ink", kind: "drawing", revision: 1, orderKey: "a", geometry: { x: 100, y: 200, width: 200, height: 100, rotation: 90 }, style: { fill: "", textColor: "#111" }, content: { text: "" }, boardContent: { version: 1, type: "drawing", strokes: [{ id: "line", tool: "pen", color: "#111", width: 2, opacity: 1, points: [{ x: 0, y: 0, pressure: 1 }, { x: 100, y: 100, pressure: 1 }] }] } };
describe("drawing-only eraser hit testing", () => {
  it("hits a scaled rotated segment when the eraser crosses it", () => {
    expect(drawingEraserTargets([ink], [{ x: 40, y: 295 }, { x: 60, y: 305 }], 2)).toEqual(["ink"]);
  });
  it("does not hit empty space inside a drawing bounding box or any non-drawing", () => {
    expect(drawingEraserTargets([ink, { ...ink, id: "sticky", kind: "sticky" }], [{ x: 10, y: 210 }, { x: 15, y: 215 }], 2)).toEqual([]);
  });
  it("never targets locked ink or old eraser strokes", () => {
    expect(drawingEraserTargets([{ ...ink, locked: true }], [{ x: 40, y: 295 }, { x: 60, y: 305 }], 2)).toEqual([]);
    const erased: BoardFabricObject = { ...ink, boardContent: { version: 1, type: "drawing", strokes: [{ id: "mask", tool: "eraser", color: "#fff", width: 24, opacity: 1, points: [{ x: 0, y: 0, pressure: 1 }, { x: 100, y: 100, pressure: 1 }] }] } };
    expect(drawingEraserTargets([erased], [{ x: 40, y: 295 }, { x: 60, y: 305 }], 2)).toEqual([]);
  });
});
