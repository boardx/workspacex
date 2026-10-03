// @vitest-environment jsdom
import { config, Group, StaticCanvas } from "fabric";
import { describe, expect, it } from "vitest";
import { applyCanonicalObject, createFabricObject, geometryFromFabricSceneTransform } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const shape: BoardFabricObject = {
  id: "cache-support", kind: "shape", revision: 1, orderKey: "a",
  geometry: { x: 70.125, y: 60.375, width: 65, height: 55, rotation: 17 },
  style: { fill: "#2563EB", stroke: "#18181B", textColor: "#18181B" }, content: { text: "" },
  boardContent: { version: 1, type: "shape", variant: "rectangle", fill: "#2563EB", borderColor: "#18181B", borderWidth: 1, borderStyle: "solid", opacity: 1, radius: 0, textColor: "#18181B", horizontalAlign: "center", verticalAlign: "middle" },
};

describe("Shape cache stroke support", () => {
  it("renders moved and rotated border updates without changing logical geometry", async () => {
    const canvas = new StaticCanvas(undefined, { width: 600, height: 600, enableRetinaScaling: false, renderOnAddRemove: false });
    const projected = createFabricObject({ ...shape, style: { ...shape.style, strokeWidth: 0 } }) as Group;
    try {
      canvas.add(projected); canvas.setZoom(4); projected.set({ objectCaching: true });
      for (const strokeWidth of [0, 4, 0, 4]) {
        const updated = { ...shape, geometry: { ...shape.geometry, x: 120, y: 150, rotation: -21 }, style: { ...shape.style, strokeWidth } };
        applyCanonicalObject(projected, updated, false); canvas.renderAll();
        expect(geometryFromFabricSceneTransform(projected)).toEqual(updated.geometry);
        expect(projected.width).toBe(65); expect(projected.height).toBe(55);
        const cached = projected as Group & { _cacheCanvas: HTMLCanvasElement; cacheTranslationX: number };
        const half = (65 + strokeWidth) * 4 / 2;
        expect(cached.cacheTranslationX - half).toBeGreaterThanOrEqual(0);
        expect(cached.cacheTranslationX + half).toBeLessThanOrEqual(cached._cacheCanvas.width);
      }
    } finally { await canvas.dispose(); }
  });

  it("retains Fabric cache limits for extreme render scales", async () => {
    const canvas = new StaticCanvas(undefined, { width: 600, height: 600, enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false });
    const projected = createFabricObject({ ...shape, style: { ...shape.style, strokeWidth: 4 } }) as Group;
    try {
      canvas.add(projected); canvas.setZoom(128); projected.set({ objectCaching: true }); canvas.renderAll();
      const cached = projected as Group & { _cacheCanvas: HTMLCanvasElement };
      expect(cached._cacheCanvas.width).toBeLessThanOrEqual(config.maxCacheSideLimit);
      expect(cached._cacheCanvas.height).toBeLessThanOrEqual(config.maxCacheSideLimit);
      expect(cached._cacheCanvas.width * cached._cacheCanvas.height).toBeLessThanOrEqual(config.perfLimitSizeTotal);
      expect(projected.width).toBe(65); expect(projected.height).toBe(55);
      // Limit-clamped caches are not evidence of full-resolution stroke containment.
    } finally { await canvas.dispose(); }
  });
  it.each(["rectangle", "ellipse", "diamond"] as const)("contains %s support under nonuniform group scaling", async (variant) => {
    const canvas = new StaticCanvas(undefined, { width: 600, height: 600, enableRetinaScaling: false, renderOnAddRemove: false });
    const record: BoardFabricObject = { ...shape, style: { ...shape.style, strokeWidth: 4 }, boardContent: { ...shape.boardContent!, type: "shape", variant } as BoardFabricObject["boardContent"] };
    const projected = createFabricObject(record) as Group;
    try {
      canvas.add(projected); canvas.setZoom(2); projected.set({ scaleX: 2, scaleY: 0.5, objectCaching: true });
      expect(projected.getTotalObjectScaling().x).toBeCloseTo(4, 8);
      expect(projected.getTotalObjectScaling().y).toBeCloseTo(1, 8);
      const dimensions = projected._getCacheCanvasDimensions();
      expect(dimensions.width).toBeGreaterThanOrEqual(Math.ceil((65 * 2 + 4) * 2 + 2));
      expect(dimensions.height).toBeGreaterThanOrEqual(Math.ceil((55 * 0.5 + 4) * 2 + 2));
      const baseline = geometryFromFabricSceneTransform(projected);
      expect(baseline.width).toBeCloseTo(130, 8); expect(baseline.height).toBeCloseTo(27.5, 8);
      applyCanonicalObject(projected, { ...record, geometry: baseline }, false);
      expect(geometryFromFabricSceneTransform(projected)).toEqual(baseline);
    } finally { await canvas.dispose(); }
  });
  it.each([0, 1, 4].flatMap(strokeWidth => [0.5, 1, 2].flatMap(objectScale => [1, 2, 4].map(renderScale => ({ strokeWidth, objectScale, renderScale })))))
  ("contains stroke $strokeWidth at object scale $objectScale and viewport scale $renderScale", async ({ strokeWidth, objectScale, renderScale }) => {
    const canvas = new StaticCanvas(undefined, { width: 600, height: 600, enableRetinaScaling: false, renderOnAddRemove: false });
    const record: BoardFabricObject = { ...shape, style: { ...shape.style, strokeWidth } };
    const projected = createFabricObject(record) as Group;
    try {
      canvas.add(projected); canvas.setZoom(renderScale); projected.set({ scaleX: objectScale, scaleY: objectScale, objectCaching: true });
      expect(projected.getTotalObjectScaling().x).toBeCloseTo(objectScale * renderScale, 8);
      expect(projected.getObjects()[0]!.strokeUniform).toBe(true);
      const dimensions = projected._getCacheCanvasDimensions();
      // Uniform child stroke keeps its world width while logical geometry scales.
      expect(dimensions.width).toBeGreaterThanOrEqual(Math.ceil((65 * objectScale + strokeWidth) * renderScale + 2));
      expect(dimensions.height).toBeGreaterThanOrEqual(Math.ceil((55 * objectScale + strokeWidth) * renderScale + 2));
      canvas.renderAll();
      const cached = projected as Group & { _cacheCanvas: HTMLCanvasElement; cacheTranslationX: number; cacheTranslationY: number };
      const halfWidth = (65 * objectScale + strokeWidth) * renderScale / 2;
      const halfHeight = (55 * objectScale + strokeWidth) * renderScale / 2;
      expect(cached.cacheTranslationX - halfWidth).toBeGreaterThanOrEqual(0);
      expect(cached.cacheTranslationX + halfWidth).toBeLessThanOrEqual(cached._cacheCanvas.width);
      expect(cached.cacheTranslationY - halfHeight).toBeGreaterThanOrEqual(0);
      expect(cached.cacheTranslationY + halfHeight).toBeLessThanOrEqual(cached._cacheCanvas.height);
      expect(projected.width).toBe(65); expect(projected.height).toBe(55);
      const baseline = geometryFromFabricSceneTransform(projected);
      expect(baseline.width).toBeCloseTo(65 * objectScale, 8); expect(baseline.height).toBeCloseTo(55 * objectScale, 8);
      const hydrated: BoardFabricObject = { ...record, geometry: baseline };
      for (let index = 0; index < 3; index++) {
        applyCanonicalObject(projected, hydrated, false);
        expect(geometryFromFabricSceneTransform(projected)).toEqual(baseline);
      }
    } finally { await canvas.dispose(); }
  });
});
