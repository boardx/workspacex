import { describe, expect, it, vi } from "vitest";
import { ActiveSelection, Group, Rect } from "fabric";
import { canonicalSceneBounds } from "@repo/whiteboard-core";
import { applyCanonicalObject, withCanonicalProjectionBatch } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";
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


describe("canonical projection inside a real ActiveSelection", () => {
  const records: BoardFabricObject[] = [560, 1536].map((x, index) => ({
    id: `object-${index}`, kind: "shape", revision: 1, orderKey: String(index),
    geometry: { x, y: 200 + index * 200, width: 100, height: 80, rotation: 0 },
    style: { fill: "#ffffff", textColor: "#000000" }, content: { text: "" },
  }));
  const boundsAndFit = (objects: Rect[]) => {
    const bounds = objects.map((object) => object.getBoundingRect());
    const left = Math.min(...bounds.map((bound) => bound.left));
    const top = Math.min(...bounds.map((bound) => bound.top));
    const right = Math.max(...bounds.map((bound) => bound.left + bound.width));
    const bottom = Math.max(...bounds.map((bound) => bound.top + bound.height));
    const zoom = Math.min(1104 / (right - left), 704 / (bottom - top));
    return { left, top, right, bottom, zoom, panX: (1200 - (right - left) * zoom) / 2 - left * zoom, panY: (800 - (bottom - top) * zoom) / 2 - top * zoom };
  };

  it.each([false, true])("keeps world bounds and Fit stable through repeated grouped canonical patches (transformed=%s)", (transformed) => {
    const objects = records.map((record) => {
      const object = new Rect({ width: 100, height: 80, strokeWidth: 0 });
      applyCanonicalObject(object, record, false);
      return object;
    });
    const initial = boundsAndFit(objects);
    for (let iteration = 0; iteration < 8; iteration++) {
      const selection = new ActiveSelection(objects);
      if (transformed) selection.set({ left: selection.left + 150, top: selection.top - 70, angle: 32, scaleX: 1.7, scaleY: 0.8 });
      selection.setCoords();
      objects.forEach((object, index) => applyCanonicalObject(object, { ...records[index]!, revision: iteration + 2 }, false));
      objects.forEach((object, index) => {
        expect(object.group).toBe(selection);
        expect(representableWorldGeometry(object)).toEqual(records[index]!.geometry);
      });
      for (const [key, value] of Object.entries(initial)) expect(boundsAndFit(objects)[key as keyof typeof initial]).toBeCloseTo(value, 7);
      selection.onDeselect();
      objects.forEach((object, index) => expect(representableWorldGeometry(object)).toEqual(records[index]!.geometry));
      for (const [key, value] of Object.entries(initial)) expect(boundsAndFit(objects)[key as keyof typeof initial]).toBeCloseTo(value, 7);
    }
  });
});


describe("batched canonical projection", () => {
  it.each([2, 500])("rebuilds a %s-member selection once and preserves every world geometry", (count) => {
    const records: BoardFabricObject[] = Array.from({ length: count }, (_, index) => ({
      id: `batch-${index}`, kind: "rectangle", revision: 2, orderKey: String(index),
      geometry: { x: 560 + index * 120, y: 200 + index % 7 * 100, width: 100, height: 80, rotation: index % 3 * 15 },
      style: { fill: "#ffffff", textColor: "#000000" }, content: { text: "" },
    }));
    const objects = records.map((record) => {
      const object = new Rect({ width: 100, height: 80, strokeWidth: 0 });
      applyCanonicalObject(object, record, false);
      return object;
    });
    const selection = new ActiveSelection(objects);
    selection.set({ left: selection.left + 400, angle: 20, scaleX: 1.5, scaleY: .8 });
    selection.setCoords();
    const detach = vi.spyOn(selection, "removeAll"), rebuild = vi.spyOn(selection, "add");
    withCanonicalProjectionBatch(objects, () => {
      objects.forEach((object, index) => applyCanonicalObject(object, records[index]!, false));
    });
    expect(detach).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild.mock.calls[0]).toHaveLength(count);
    objects.forEach((object, index) => {
      expect(object.group).toBe(selection);
      expect(representableWorldGeometry(object)).toEqual(records[index]!.geometry);
    });
    selection.onDeselect();
    objects.forEach((object, index) => expect(representableWorldGeometry(object)).toEqual(records[index]!.geometry));
  });
});
