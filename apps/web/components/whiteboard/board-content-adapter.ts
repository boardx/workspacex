import { readContentObject, type CanonicalContentObject, type DrawingTool, type ShapeVariant, type WhiteboardObject } from "@repo/whiteboard-core";

export type BoardShapeVariant = ShapeVariant;
export type BoardDrawingTool = Exclude<DrawingTool, "eraser">;
export type BoardStructuredKind = Extract<CanonicalContentObject["type"], "tile" | "web-tile" | "table" | "icon" | "template">;
export type BoardContentData = CanonicalContentObject;

/** Renderer-facing name keeps the web boundary explicit while validation stays canonical. */
export function readBoardContent(object: WhiteboardObject): BoardContentData | undefined {
  return readContentObject(object) ?? undefined;
}
