import { describe, expect, it } from "vitest";
import { spatialDragPosition, spatialPointerDrag, spatialMicroPosition } from "../../e2e/support/board-spatial-pointer";

describe("spatial browser pointer coordinates", () => {
  it("explains the retained Chromium trace without tolerating a product offset", () => {
    const zoom = 0.9598070739549825;
    // call@344/348 submitted fractions; MouseEvent delivered integer client coordinates.
    expect(spatialDragPosition({ x: 1182, y: 584.5 }, { x: 979, y: 562 }, { x: 1018, y: 591 }, zoom))
      .toEqual({ x: 1222.633166, y: 614.714405 });
    expect(spatialDragPosition({ x: 1182, y: 584.5 }, { x: 979, y: 562 }, { x: 1018, y: 591 }, zoom))
      .not.toEqual({ x: 1222, y: 614.5 });
  });
  it("plans representable screen coordinates and derives exact zoomed world movement", () => {
    const zoom = 0.9598070739549825;
    const { from, to } = spatialPointerDrag({ x: 979.7717041800644, y: 562.5819935691319 }, { x: 40, y: 30 }, zoom);
    expect(from).toEqual({ x: 980, y: 563 });
    expect(to).toEqual({ x: 1018, y: 592 });
    expect(spatialDragPosition({ x: 1182, y: 584.5 }, from, to, zoom))
      .toEqual({ x: 1221.59129, y: 614.714405 });
  });
  it("retains half-unit canonical origins at 100 percent and signed drags", () => {
    const { from, to } = spatialPointerDrag({ x: 595, y: 373.5 }, { x: 12, y: 8 }, 1);
    expect(spatialDragPosition({ x: 550, y: 256.5 }, from, to, 1)).toEqual({ x: 562, y: 264.5 });
    const back = spatialPointerDrag(to, { x: -12, y: -8 }, 1);
    expect(spatialDragPosition({ x: 562, y: 264.5 }, back.from, back.to, 1)).toEqual({ x: 550, y: 256.5 });
  });
  it("rejects invalid viewport scale instead of passing with an invented delta", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => spatialPointerDrag({ x: 0, y: 0 }, { x: 1, y: 1 }, zoom)).toThrow();
      expect(() => spatialDragPosition({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, zoom)).toThrow();
    }
  });
});

it("removes representation tails but rejects every different canonical micro-unit", () => {
 const expected = spatialMicroPosition({x:1221.59129,y:614.714405});
 expect(spatialMicroPosition({x:1221.59129,y:614.7144049999999})).toEqual(expected);
 for (const y of [614.714406,614.5,615]) expect(spatialMicroPosition({x:1221.59129,y})).not.toEqual(expected);
});
