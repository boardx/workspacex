import type { DrawingTool } from "@repo/whiteboard-core";

export type BoardDrawingToolStyle = Readonly<{
  color: string;
  width: number;
  opacity: number;
}>;

/**
 * Canonical visual style for a newly recorded drawing stroke.
 *
 * The live Fabric preview and the persisted vector stroke both read this
 * table, so releasing the pointer cannot visibly change the chosen tool.
 */
export const BOARD_DRAWING_TOOL_STYLES = {
  pen: { color: "#18181B", width: 3, opacity: 1 },
  marker: { color: "#2563EB", width: 8, opacity: .9 },
  highlighter: { color: "#FACC15", width: 20, opacity: .35 },
  eraser: { color: "#FFFFFF", width: 24, opacity: 1 },
} as const satisfies Readonly<Record<DrawingTool, BoardDrawingToolStyle>>;

export function drawingToolStyle(tool: DrawingTool): BoardDrawingToolStyle {
  return BOARD_DRAWING_TOOL_STYLES[tool];
}
