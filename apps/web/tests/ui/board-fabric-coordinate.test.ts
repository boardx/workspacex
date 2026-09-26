import { describe, expect, it } from "vitest";
import { ActiveSelection, Group, Rect } from "fabric";
import { canonicalSceneBounds } from "@repo/whiteboard-core";
import { representableWorldGeometry } from "@/components/whiteboard/fabric/fabric-transform";

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

describe("ActiveSelection canonical transform boundary", () => {
  it("rejects real Fabric skew from non-uniform scaling of a rotated child", () => {
    const rotated = new Rect({ left: 40, top: 60, width: 120, height: 80, angle: 35, originX: "left", originY: "top" });
    const plain = new Rect({ left: 260, top: 80, width: 100, height: 100, originX: "left", originY: "top" });
    const selection = new ActiveSelection([rotated, plain]);
    selection.set({ scaleX: 1.8, scaleY: 0.7 }); selection.setCoords();
    expect(() => representableWorldGeometry(rotated)).toThrow("FABRIC_TRANSFORM_NOT_REPRESENTABLE");
  });

  it("accepts uniform ActiveSelection scaling and rotation", () => {
    const rotated = new Rect({ left: 40, top: 60, width: 120, height: 80, angle: 35, originX: "left", originY: "top" });
    const plain = new Rect({ left: 260, top: 80, width: 100, height: 100, originX: "left", originY: "top" });
    const selection = new ActiveSelection([rotated, plain]);
    selection.set({ scaleX: 1.4, scaleY: 1.4, angle: 15 }); selection.setCoords();
    expect(representableWorldGeometry(rotated)).toMatchObject({ width: expect.any(Number), height: expect.any(Number), rotation: 50 });
  });
});
