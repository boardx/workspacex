// @vitest-environment jsdom
import { config, Group, StaticCanvas } from "fabric";
import { describe, expect, it, vi } from "vitest";
import { applyCanonicalObject, createFabricObject, geometryFromFabricSceneTransform } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("fabric", async () => await import("fabric/node"));

const shape: BoardFabricObject = {
  id: "cache-support", kind: "shape", revision: 1, orderKey: "a",
  geometry: { x: 70.125, y: 60.375, width: 65, height: 55, rotation: 17 },
  style: { fill: "#2563EB", stroke: "#18181B", textColor: "#18181B" }, content: { text: "" },
  boardContent: { version: 1, type: "shape", variant: "rectangle", fill: "#2563EB", borderColor: "#18181B", borderWidth: 1, borderStyle: "solid", opacity: 1, radius: 0, textColor: "#18181B", horizontalAlign: "center", verticalAlign: "middle" },
};

type CachedGroup = Group & { _cacheCanvas: HTMLCanvasElement; cacheTranslationX: number; cacheTranslationY: number };
const scaleMatrix = [0, 1, 4].flatMap(strokeWidth => [0.5, 1, 2].flatMap(objectScale => [1, 2, 4].map(renderScale => ({ strokeWidth, objectScale, renderScale }))));
const safeGeometry = { ...shape.geometry, x: 0, y: 0, rotation: 0 };

function assertCacheContains(projected: Group, width: number, height: number, strokeWidth: number, renderScale: number) {
  expect(projected.ownCaching).toBe(true);
  const cached = projected as CachedGroup;
  expect(cached._cacheCanvas).toBeDefined();
  const halfWidth = (width + strokeWidth) * renderScale / 2, halfHeight = (height + strokeWidth) * renderScale / 2;
  expect(cached.cacheTranslationX - halfWidth).toBeGreaterThanOrEqual(0);
  expect(cached.cacheTranslationX + halfWidth).toBeLessThanOrEqual(cached._cacheCanvas.width);
  expect(cached.cacheTranslationY - halfHeight).toBeGreaterThanOrEqual(0);
  expect(cached.cacheTranslationY + halfHeight).toBeLessThanOrEqual(cached._cacheCanvas.height);
}

// Reference is a literal Canvas2D path from canonical input, not a Fabric
// projection, cached bitmap, or the geometry serializer under test.
function assertLiteralRender(canvas: StaticCanvas, geometry: BoardFabricObject["geometry"], strokeWidth: number, renderScale: number) {
  const actual = canvas.lowerCanvasEl.getContext("2d")!;
  const reference = canvas.lowerCanvasEl.ownerDocument.createElement("canvas");
  reference.width = canvas.lowerCanvasEl.width; reference.height = canvas.lowerCanvasEl.height;
  const ctx = reference.getContext("2d")!, radians = geometry.rotation * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const center = { x: geometry.x + geometry.width / 2 * c - geometry.height / 2 * s, y: geometry.y + geometry.width / 2 * s + geometry.height / 2 * c };
  ctx.setTransform(renderScale*c,renderScale*s,-renderScale*s,renderScale*c,center.x*renderScale,center.y*renderScale);
  ctx.fillStyle = "#2563EB"; ctx.strokeStyle = "#18181B"; ctx.lineWidth = strokeWidth;
  ctx.beginPath(); ctx.moveTo(-geometry.width/2,-geometry.height/2); ctx.lineTo(geometry.width/2,-geometry.height/2);
  ctx.lineTo(geometry.width/2,geometry.height/2); ctx.lineTo(-geometry.width/2,geometry.height/2); ctx.closePath(); ctx.fill();
  if (strokeWidth > 0) ctx.stroke();
  // Zero-width shapes legitimately retain their cached fill. Their interior
  // must still render; stroked direct cases compare all three edge ROIs.
  const sites = strokeWidth === 0 ? [{x:geometry.width/2,y:geometry.height/2}] : [{x:geometry.width*.4,y:0},{x:geometry.width,y:geometry.height*.4},{x:geometry.width*.6,y:geometry.height}];
  for (const site of sites) {
    const x = Math.floor((geometry.x+site.x*c-site.y*s)*renderScale)-2, y = Math.floor((geometry.y+site.x*s+site.y*c)*renderScale)-2;
    expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
    expect(x+5).toBeLessThanOrEqual(reference.width); expect(y+5).toBeLessThanOrEqual(reference.height);
    const observed = actual.getImageData(x,y,5,5).data, expected = ctx.getImageData(x,y,5,5).data;
    expect([...expected].some((value,index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(Math.max(...observed.map((value,index) => Math.abs(value-expected[index]!)))).toBeLessThanOrEqual(5);
  }
}

describe("Shape cache stroke support", () => {
  it("renders moved and rotated border updates without changing logical geometry", async () => {
    const canvas = new StaticCanvas(undefined, { width: 1200, height: 1200, enableRetinaScaling: false, renderOnAddRemove: false });
    const projected = createFabricObject({ ...shape, style: { ...shape.style, strokeWidth: 0 } }) as Group;
    try {
      canvas.add(projected); canvas.setZoom(4); projected.set({ objectCaching: true });
      for (const strokeWidth of [0, 4, 0, 4]) {
        const updated = { ...shape, geometry: { ...shape.geometry, x: 120, y: 150, rotation: -21 }, style: { ...shape.style, strokeWidth } };
        applyCanonicalObject(projected, updated, false); canvas.renderAll();
        expect(geometryFromFabricSceneTransform(projected)).toEqual(updated.geometry);
        expect(projected.width).toBe(65); expect(projected.height).toBe(55);
        expect(projected.ownCaching).toBe(strokeWidth === 0);
        expect(projected.getObjects()[0]!.ownCaching).toBe(false);
        assertLiteralRender(canvas, updated.geometry, strokeWidth, 4);
        if (strokeWidth === 0) assertCacheContains(projected, 65, 55, 0, 4);
      }
    } finally { await canvas.dispose(); }
  });

  it("retains Fabric cache limits for extreme render scales", async () => {
    const canvas = new StaticCanvas(undefined, { width: 600, height: 600, enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false });
    const projected = createFabricObject({ ...shape, geometry: safeGeometry, style: { ...shape.style, strokeWidth: 4 } }) as Group;
    try {
      canvas.add(projected); canvas.setZoom(128); projected.set({ objectCaching: true }); canvas.renderAll();
      expect(projected.ownCaching).toBe(true);
      const cached = projected as Group & { _cacheCanvas: HTMLCanvasElement };
      expect(cached._cacheCanvas).toBeDefined();
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
      const draw = vi.spyOn(projected.getObjects()[0]!, "_render");
      canvas.renderAll(); expect(projected.ownCaching).toBe(false);
      expect(projected.getObjects()[0]!.ownCaching).toBe(false); expect(draw).toHaveBeenCalledTimes(1);
      const angle = shape.geometry.rotation*Math.PI/180;
      const centerX = shape.geometry.x+130/2*Math.cos(angle)-27.5/2*Math.sin(angle);
      const centerY = shape.geometry.y+130/2*Math.sin(angle)+27.5/2*Math.cos(angle);
      const fill = canvas.lowerCanvasEl.getContext("2d")!.getImageData(Math.floor(centerX*2),Math.floor(centerY*2),1,1).data;
      expect([...fill]).toEqual([37,99,235,255]);
      const baseline = geometryFromFabricSceneTransform(projected);
      expect(baseline.width).toBeCloseTo(130, 8); expect(baseline.height).toBeCloseTo(27.5, 8);
      applyCanonicalObject(projected, { ...record, geometry: baseline }, false);
      expect(geometryFromFabricSceneTransform(projected)).toEqual(baseline);
    } finally { await canvas.dispose(); }
  });
  it.each(scaleMatrix)
  ("contains stroke $strokeWidth at object scale $objectScale and viewport scale $renderScale", async ({ strokeWidth, objectScale, renderScale }) => {
    const canvas = new StaticCanvas(undefined, { width: 1200, height: 1200, enableRetinaScaling: false, renderOnAddRemove: false });
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
      expect(projected.ownCaching).toBe(strokeWidth === 0);
      expect(projected.getObjects()[0]!.ownCaching).toBe(false);
      assertLiteralRender(canvas, { ...shape.geometry, width: 65*objectScale, height: 55*objectScale }, strokeWidth, renderScale);
      if (strokeWidth === 0) assertCacheContains(projected, 65*objectScale, 55*objectScale, 0, renderScale);
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
  it("retains actual stroke cache support during safe dynamic border updates", async () => {
    const canvas = new StaticCanvas(undefined, {width:1200,height:1200,enableRetinaScaling:false,renderOnAddRemove:false});
    const projected = createFabricObject({...shape,geometry:safeGeometry,style:{...shape.style,strokeWidth:0}}) as Group;
    try {
      canvas.add(projected); canvas.setZoom(4); projected.set({objectCaching:true});
      for (const strokeWidth of [0,4,0,4]) {
        const updated = {...shape,geometry:{...safeGeometry,x:120,y:150},style:{...shape.style,strokeWidth}};
        applyCanonicalObject(projected,updated,false); canvas.renderAll();
        expect(geometryFromFabricSceneTransform(projected)).toEqual(updated.geometry);
        expect(projected.width).toBe(65); expect(projected.height).toBe(55);
        assertCacheContains(projected,65,55,strokeWidth,4);
      }
    } finally {await canvas.dispose();}
  });
  it.each(scaleMatrix)("keeps real safe cache containment for stroke $strokeWidth / object $objectScale / viewport $renderScale", async ({strokeWidth,objectScale,renderScale}) => {
    const canvas = new StaticCanvas(undefined,{width:600,height:600,enableRetinaScaling:true,renderOnAddRemove:false});
    // Explicit Node DPR simulation, followed by rebuilding the real backing grid.
    // DPR4 is needed only for the half-scale/zoom1 frame's half-pixel
    // center. DPR2 suffices for the other lattice phases and avoids the
    // real cache-area clamp at objectScale2/zoom4 (tested separately above).
    const dpr = objectScale === .5 && renderScale === 1 ? 4 : 2;
    const retina = vi.spyOn(canvas,"getRetinaScaling").mockReturnValue(dpr);
    canvas.setDimensions({width:600,height:600});
    const record = {...shape,geometry:safeGeometry,style:{...shape.style,strokeWidth}};
    const projected = createFabricObject(record) as Group;
    try {
      expect(canvas.lowerCanvasEl.width).toBe(600*dpr); expect(canvas.lowerCanvasEl.height).toBe(600*dpr);
      canvas.add(projected); canvas.setZoom(renderScale); projected.set({scaleX:objectScale,scaleY:objectScale,objectCaching:true});
      const backingScale = renderScale*dpr;
      expect(projected.getTotalObjectScaling().x).toBeCloseTo(objectScale*backingScale,8);
      expect(projected.getObjects()[0]!.strokeUniform).toBe(true);
      const dimensions = projected._getCacheCanvasDimensions();
      expect(dimensions.width).toBeGreaterThanOrEqual(Math.ceil((65*objectScale+strokeWidth)*backingScale+2));
      expect(dimensions.height).toBeGreaterThanOrEqual(Math.ceil((55*objectScale+strokeWidth)*backingScale+2));
      canvas.renderAll(); assertCacheContains(projected,65*objectScale,55*objectScale,strokeWidth,backingScale);
      expect(projected.width).toBe(65); expect(projected.height).toBe(55);
      const baseline = geometryFromFabricSceneTransform(projected);
      expect(baseline.width).toBeCloseTo(65*objectScale,8); expect(baseline.height).toBeCloseTo(55*objectScale,8);
      for(let index=0;index<3;index++) {
        applyCanonicalObject(projected,{...record,geometry:baseline},false);
        expect(geometryFromFabricSceneTransform(projected)).toEqual(baseline);
        canvas.renderAll(); assertCacheContains(projected,baseline.width,baseline.height,strokeWidth,backingScale);
      }
    } finally {retina.mockRestore();await canvas.dispose();}
  });

});
