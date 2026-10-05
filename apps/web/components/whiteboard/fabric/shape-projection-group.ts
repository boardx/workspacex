import { Group, Path, util } from "fabric";

/** Keeps the logical frame fixed while reserving cache space for child strokes. */
export class ShapeProjectionGroup extends Group {
  /** Cache only when copying the bitmap preserves the backing-grid stroke samples.
   * A rotated/fractional bitmap is sampled again; padding cannot repair that blur.
   */
  private requiresDirectStrokeRendering(): boolean {
    const stroked = this.getObjects().filter(child => child.stroke && child.strokeWidth > 0);
    if (!stroked.length || this.needsItsOwnCache() || stroked.some(child => child.needsItsOwnCache())) return false;
    const viewport = this.canvas?.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const retina = this.canvas?.getRetinaScaling() ?? 1;
    return [this, ...stroked].some(object => {
      const [a, b, c, d, e, f] = util.multiplyTransformMatrices(viewport, object.calcTransformMatrix()).map(value => value * retina);
      const integer = (value: number) => Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-8;
      // Keep the conservative, unrotated integer lattice. Quarter turns can also
      // differ at antialiased edges; they use the direct vector path as well.
      return Math.abs(b!) > 1e-8 || Math.abs(c!) > 1e-8 || a! < 1 || d! < 1 || ![a!, d!, e!, f!].every(integer);
    });
  }

  override shouldCache(): boolean {
    if (this.requiresDirectStrokeRendering()) {
      this.ownCaching = false;
      return false;
    }
    return super.shouldCache();
  }

  override drawObject(...args: Parameters<Group["drawObject"]>): void {
    if (!this.requiresDirectStrokeRendering()) return super.drawObject(...args);
    // A child would otherwise start its own bitmap cache after its parent
    // declines caching. Preserve the requested settings after this render.
    const children = this.getObjects().filter(child => child.stroke && child.strokeWidth > 0);
    const requested = children.map(child => child.objectCaching);
    children.forEach(child => { child.objectCaching = false; });
    try { super.drawObject(...args); }
    finally { children.forEach((child, index) => { child.objectCaching = requested[index]!; }); }
  }

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
