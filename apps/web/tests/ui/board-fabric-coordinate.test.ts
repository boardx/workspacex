import { describe, expect, it } from "vitest";
import { Group, Rect } from "fabric";
import { canonicalSceneBounds } from "@repo/whiteboard-core";

describe("Board Fabric canonical coordinate contract", () => {
  it.each([0, 37, 90, -45])("matches canonical top-left scene bounds at %s degrees", (rotation) => {
    const geometry = { x: 200, y: 50, width: 100, height: 40, rotation };
    const projected = new Group([
      new Rect({ width: geometry.width, height: geometry.height, strokeWidth: 0, originX: "center", originY: "center" }),
    ], { left: geometry.x, top: geometry.y, angle: rotation, originX: "left", originY: "top" });
    projected.setCoords();

    const fabric = projected.getBoundingRect();
    const canonical = canonicalSceneBounds(geometry);
    expect(fabric.left).toBeCloseTo(canonical.left, 5);
    expect(fabric.top).toBeCloseTo(canonical.top, 5);
    expect(fabric.width).toBeCloseTo(canonical.width, 5);
    expect(fabric.height).toBeCloseTo(canonical.height, 5);
  });
});
