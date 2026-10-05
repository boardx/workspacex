import { expect, it } from "vitest";
import { boardSpacingMeasurementPosition } from "@/components/whiteboard/board-spacing-measurement";
const geometry = { x: 320, y: 400, width: 100, height: 80, rotation: 0 };
const viewport = { zoom: 2, panX: -100, panY: 30, fitRequest: 0 };
const measurement = { axis: "y" as const, from: 372, to: 400, size: 28, relatedObjectIds: ["above", "below"] as [string, string], equalSpacing: true };
it("places vertical gap labels beside the moving object and centered on each actual gap after pan and zoom", () => {
  expect(boardSpacingMeasurementPosition(measurement, geometry, viewport)).toEqual({ left: 540, top: 802, transform: "translate(-100%, -50%)" });
  expect(boardSpacingMeasurementPosition({ ...measurement, from: 480, to: 508 }, geometry, viewport).top).toBe(1018);
});
it("centers horizontal labels on the gap at the moving object's top edge", () => {
  expect(boardSpacingMeasurementPosition({ ...measurement, axis: "x", from: 292, to: 320 }, geometry, viewport)).toEqual({ left: 512, top: 830, transform: "translate(-50%, -100%)" });
});
