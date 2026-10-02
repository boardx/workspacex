import type { Group } from "fabric";

/** Keep ink outside the canonical vector frame inside its isolated cache. */
export function preserveDrawingInkCache(group: Group): void {
  const original = group._getCacheCanvasDimensions;
  group._getCacheCanvasDimensions = function () {
    const dimensions = original.call(this);
    let width = this.width;
    let height = this.height;
    for (const child of this.getObjects()) {
      const center = child.getRelativeCenterPoint();
      width = Math.max(width, 2 * Math.abs(center.x) + child.width * child.scaleX);
      height = Math.max(height, 2 * Math.abs(center.y) + child.height * child.scaleY);
    }
    const extraX = Math.max(0, width - this.width) * dimensions.zoomX;
    const extraY = Math.max(0, height - this.height) * dimensions.zoomY;
    return { ...dimensions, width: Math.ceil(dimensions.width + extraX), height: Math.ceil(dimensions.height + extraY), x: dimensions.x + extraX, y: dimensions.y + extraY };
  };
}
