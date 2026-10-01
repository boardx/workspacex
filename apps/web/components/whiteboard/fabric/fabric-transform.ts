import { util, type FabricObject } from "fabric";
import type { BoardFabricGeometry } from "./board-fabric-object";

/** Canonical objects cannot represent skew. Reject it instead of silently losing geometry. */
export function representableWorldGeometry(projected: FabricObject): BoardFabricGeometry {
  const decomposed = util.qrDecompose(projected.calcTransformMatrix());
  if (Math.abs(decomposed.skewX) > 0.001 || Math.abs(decomposed.skewY) > 0.001) throw new Error("FABRIC_TRANSFORM_NOT_REPRESENTABLE");
  const rotation = decomposed.angle;
  const width = Math.max(1, Math.abs((projected.width || 1) * decomposed.scaleX));
  const height = Math.max(1, Math.abs((projected.height || 1) * decomposed.scaleY));
  const radians = rotation * Math.PI / 180;
  return {
    x: Math.round(decomposed.translateX - width / 2 * Math.cos(radians) + height / 2 * Math.sin(radians)),
    y: Math.round(decomposed.translateY - width / 2 * Math.sin(radians) - height / 2 * Math.cos(radians)),
    width: Math.round(width), height: Math.round(height), rotation: Math.round(rotation),
  };
}
