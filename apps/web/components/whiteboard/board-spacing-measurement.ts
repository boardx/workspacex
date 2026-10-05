import { canonicalSceneBounds, type SnapMeasurement, type WhiteboardGeometry } from "@repo/whiteboard-core";
import type { BoardViewport } from "./fabric/board-fabric-object";

/** The label belongs to the measured world-space gap, never to the viewport edge. */
export function boardSpacingMeasurementPosition(measurement: SnapMeasurement, moving: WhiteboardGeometry, viewport: BoardViewport) {
  const bounds = canonicalSceneBounds(moving);
  const midpoint = (measurement.from + measurement.to) / 2;
  return {
    left: (measurement.axis === "x" ? midpoint : bounds.left) * viewport.zoom + viewport.panX,
    top: (measurement.axis === "y" ? midpoint : bounds.top) * viewport.zoom + viewport.panY,
    transform: measurement.axis === "x" ? "translate(-50%, -100%)" : "translate(-100%, -50%)",
  };
}
