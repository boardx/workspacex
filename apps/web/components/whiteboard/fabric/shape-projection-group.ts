import { Group, Path } from "fabric";

/** Keeps the logical frame fixed while reserving cache space for child strokes. */
export class ShapeProjectionGroup extends Group {
  override _getCacheCanvasDimensions(): ReturnType<Group["_getCacheCanvasDimensions"]> {
    const dimensions = super._getCacheCanvasDimensions();
    const worldScale = this.getObjectScaling();
    const renderScale = this.getTotalObjectScaling();
    const viewportX = renderScale.x / worldScale.x;
    const viewportY = renderScale.y / worldScale.y;
    let paddingX = 0, paddingY = 0;
    for (const child of this.getObjects()) {
      if (!child.stroke || child.strokeWidth <= 0) continue;
      const scale = child.getObjectScaling();
      const join = child instanceof Path && child.strokeLineJoin === "miter" ? Math.max(1, child.strokeMiterLimit) : 1;
      const worldStrokeX = child.strokeWidth * join * (child.strokeUniform ? 1 : scale.x);
      const worldStrokeY = child.strokeWidth * join * (child.strokeUniform ? 1 : scale.y);
      paddingX = Math.max(paddingX, worldStrokeX * viewportX);
      paddingY = Math.max(paddingY, worldStrokeY * viewportY);
    }
    return { ...dimensions, width: Math.ceil(dimensions.width + paddingX), height: Math.ceil(dimensions.height + paddingY) };
  }
}
