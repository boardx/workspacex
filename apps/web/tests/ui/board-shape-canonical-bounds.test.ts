// @vitest-environment jsdom
import { ActiveSelection, Group, Rect } from "fabric";
import { describe, expect, it } from "vitest";
import { applyCanonicalObject, createFabricObject, geometryFromFabricSceneTransform } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const shape: BoardFabricObject = {
  id: "bordered", kind: "shape", revision: 1, orderKey: "a",
  geometry: { x: 180, y: 195, width: 65, height: 55, rotation: -21 },
  style: { fill: "#FFFFFF", textColor: "#111111", stroke: "#111111" }, content: { text: "" },
  boardContent: { version: 1, type: "shape", variant: "rectangle", fill: "#FFFFFF", borderColor: "#111111", borderWidth: 1, borderStyle: "solid", opacity: 1, radius: 0, textColor: "#111111", horizontalAlign: "center", verticalAlign: "middle" },
};

describe("bordered Shape canonical container", () => {
  it.each([[1, 0], [1.5, 0], [3, 45]])("preserves canonical geometry through real ActiveSelection scale %s rotation %s", (scale, rotation) => {
    const projected = createFabricObject(shape);
    expect(projected).toBeInstanceOf(Group);
    expect((projected as Group).getObjects()[0]!.strokeWidth).toBe(1);
    const peer = new Rect({ left: 70, top: 150, width: 60, height: 45, strokeWidth: 0 });
    const selection = new ActiveSelection([peer, projected]);
    // ActiveSelection uses its center as the scaling/rotation origin.
    const origin = selection.getCenterPoint();
    selection.set({ left: selection.left + 20, top: selection.top + 30, scaleX: scale, scaleY: scale, angle: rotation });
    selection.setCoords();
    const geometry = geometryFromFabricSceneTransform(projected);
    expect(geometry.width).toBeCloseTo(65 * scale, 6);
    expect(geometry.height).toBeCloseTo(55 * scale, 6);
    expect(geometry.rotation).toBeCloseTo(-21 + rotation!, 6);
    const radians = rotation! * Math.PI / 180;
    const dx = (180 - origin.x) * scale!, dy = (195 - origin.y) * scale!;
    expect(geometry.x).toBeCloseTo(origin.x + 20 + dx * Math.cos(radians) - dy * Math.sin(radians), 6);
    expect(geometry.y).toBeCloseTo(origin.y + 30 + dx * Math.sin(radians) + dy * Math.cos(radians), 6);
    selection.dispose();
  });

  it("retains border and logical dimensions across repeated hydration", () => {
    const projected = createFabricObject(shape) as Group;
    for (let index = 0; index < 3; index++) {
      applyCanonicalObject(projected, shape, false);
      expect(projected.width).toBe(65); expect(projected.height).toBe(55);
      expect(projected.getObjects()[0]!.strokeWidth).toBe(1);
      expect(projected.getObjects()[0]!.stroke).toBe("#111111");
      expect(projected.getObjects()[0]!.left).toBe(0); expect(projected.getObjects()[0]!.top).toBe(0);
      const geometry = geometryFromFabricSceneTransform(projected);
      expect(geometry.x).toBeCloseTo(180, 6); expect(geometry.y).toBeCloseTo(195, 6);
    }
    projected.dispose();
  });
  it.each(["circle", "diamond"] as const)("keeps %s border defaults and explicit widths during hydration", (variant) => {
    for (const strokeWidth of [undefined, 0, 4]) {
      const record: BoardFabricObject = { ...shape, style: { ...shape.style, strokeWidth }, boardContent: { ...shape.boardContent!, type: "shape", variant } as BoardFabricObject["boardContent"] };
      const projected = createFabricObject(record) as Group;
      const border = projected.getObjects()[0]!;
      expect(border.strokeWidth).toBe(strokeWidth ?? 1);
      applyCanonicalObject(projected, record, false);
      expect(border.strokeWidth).toBe(strokeWidth ?? 1); expect(border.strokeUniform).toBe(true);
      expect(projected.width).toBe(65); expect(projected.height).toBe(55);
      projected.dispose();
    }
  });
});
