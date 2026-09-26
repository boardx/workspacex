export type BoardFabricKind = "sticky" | "text" | "rectangle" | "ellipse";
export type BoardFabricTool = "select" | "hand";

export interface BoardFabricGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface BoardFabricStyle {
  fill: string;
  textColor: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
}

export interface BoardFabricObject {
  id: string;
  kind: BoardFabricKind;
  revision: number;
  orderKey: string;
  geometry: BoardFabricGeometry;
  style: BoardFabricStyle;
  content: { text: string };
  parentId?: string;
  locked?: boolean;
}

export interface BoardViewport {
  zoom: number;
  panX: number;
  panY: number;
  /** Increment to request a fit-to-board calculation. This is local UI state. */
  fitRequest: number;
  /** Selection fitting is ignored when the controlled selection is empty. */
  fitMode?: "board" | "selection";
}

export type BoardSelectionSource = "canvas" | "outline";
export type BoardViewportSource = "controlled" | "wheel" | "pan" | "fit";

export const BOARD_ZOOM_MIN = 0.05;
export const BOARD_ZOOM_MAX = 8;

export function clampBoardZoom(value: number): number {
  return Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, value));
}
