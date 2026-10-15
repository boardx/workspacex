import { Rect, type FabricObject } from "fabric";
import type { BoardFabricObject } from "./board-fabric-object";

/** Shared interactive/offscreen panel clipping; never stored in canonical data. */
export function applyBoardParentClip(projected: FabricObject, parent: BoardFabricObject | undefined): void {
  projected.clipPath = parent?.kind === "panel" && parent.panel?.clipContent
    ? new Rect({ left: parent.geometry.x, top: parent.geometry.y, width: parent.geometry.width, height: parent.geometry.height, angle: parent.geometry.rotation, originX: "left", originY: "top", absolutePositioned: true })
    : undefined;
}
