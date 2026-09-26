import type { BoardContentData } from "../board-content-adapter";

export type BoardFabricKind = "sticky" | "text" | "rectangle" | "ellipse" | "shape" | "drawing" | "image" | "card" | "placeholder";
export type BoardFabricTool = "select" | "hand" | "draw-pen" | "draw-marker" | "draw-highlighter" | "erase";

export interface BoardProjectionIssue {
  code: "BOARD_OBJECT_UNSUPPORTED" | "BOARD_PROJECTION_FAILED";
  sourceKind: string;
  message: string;
}

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
  borderStyle?: "solid" | "dashed" | "dotted";
  opacity?: number;
  radius?: number;
  verticalAlignment?: "top" | "middle" | "bottom";
  fontSize?: number;
  /** Validated thinking-input typography. Optional for legacy canonical objects. */
  textPreset?: "title" | "heading" | "subheading" | "body" | "caption";
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alignment?: "left" | "center" | "right";
  lineHeight?: number;
  list?: "none" | "bullet" | "number";
  link?: string | null;
}

export interface BoardFabricStickyAppearance {
  variant: "square" | "rectangle" | "circle";
  sizingMode: "auto-height" | "fixed" | "auto-size";
}

export interface BoardFabricObject {
  id: string;
  kind: BoardFabricKind;
  revision: number;
  orderKey: string;
  geometry: BoardFabricGeometry;
  style: BoardFabricStyle;
  content: { text: string };
  /** Renderer-only sticky shape and resize behavior derived from canonical extension data. */
  sticky?: BoardFabricStickyAppearance;
  /** Validated content-object payload. Never contains unvalidated extension data. */
  boardContent?: BoardContentData;
  /** Verified browser-local bytes. Fabric must never fall back to boardContent.sourceUrl. */
  imageAssetUrl?: string;
  parentId?: string;
  locked?: boolean;
  /** Renderer-only diagnostic. It is derived from canonical content and is never persisted. */
  projectionIssue?: BoardProjectionIssue;
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
