"use client";

import * as React from "react";
import { ActiveSelection, Canvas, Circle, FabricImage, Group, Line, Path, Point, Rect, Textbox, Triangle, util, type FabricObject, type TPointerEventInfo } from "fabric";
import { calculateRotationSnap, calculateSnapGuides, drawingEraserLayers, type SnapResult } from "@repo/whiteboard-core";
import { BoardA11yMirror } from "./board-a11y-mirror";
import {
  clampBoardZoom,
  type BoardFabricGeometry,
  type BoardFabricObject,
  type BoardFabricStickyAppearance,
  type BoardFabricTool,
  type BoardSelectionSource,
  type BoardViewport,
  type BoardViewportSource,
} from "./board-fabric-object";
import { representableWorldGeometry } from "./fabric-transform";

type TaggedFabricObject = FabricObject & {
  data?: { boardObjectId?: string; adapterKind?: BoardFabricObject["kind"]; renderedRevision?: number; projectionFailure?: boolean; stickyVariant?: BoardFabricStickyAppearance["variant"]; sizingMode?: BoardFabricStickyAppearance["sizingMode"] };
};

export function connectorTipAngles(type: "straight" | "elbow" | "curve", x1: number, y1: number, x2: number, y2: number): { start: number; end: number } {
  const tangent = type === "straight"
    ? { start: { x: x2 - x1, y: y2 - y1 }, end: { x: x2 - x1, y: y2 - y1 } }
    : type === "elbow"
      ? { start: { x: x2 - x1, y: 0 }, end: { x: 0, y: y2 - y1 } }
      : { start: { x: -x1, y: 0 }, end: { x: x2, y: 0 } };
  const fallback = { x: x2 - x1 || 1, y: y2 - y1 };
  const angleOf = (vector: { x: number; y: number }) => {
    const resolved = vector.x === 0 && vector.y === 0 ? fallback : vector;
    return Math.atan2(resolved.y, resolved.x) * 180 / Math.PI + 90;
  };
  return { start: angleOf(tangent.start) + 180, end: angleOf(tangent.end) };
}

export interface BoardFabricSurfaceProps {
  /** Canonical projection input. The surface never owns or persists these records. */
  objects: readonly BoardFabricObject[];
  selectedObjectIds: readonly string[];
  readOnly: boolean;
  tool: BoardFabricTool;
  viewport: BoardViewport;
  onSelectionChange: (objectIds: readonly string[], source: BoardSelectionSource) => void;
  /** Fired once at Fabric's gesture completion boundary, never for projection patches. */
  /** Returns whether the canonical command accepted the gesture. Rejection restores the projection. */
  onObjectTransform: (objectId: string, geometry: BoardFabricGeometry) => boolean | Promise<boolean>;
  onObjectsTransform?: (items: readonly { id: string; geometry: BoardFabricGeometry; parentId?: string | null }[], options?: { duplicate: boolean }) => boolean | Promise<boolean>;
  onViewportChange: (viewport: BoardViewport, source: BoardViewportSource) => void;
  onCanvasClick?: (point: { x: number; y: number }) => void;
  onCanvasDoubleClick?: (point: { x: number; y: number }) => void;
  onObjectDoubleClick?: (objectId: string) => void;
  onToolDrop?: (point: { x: number; y: number }, payload: string) => void;
  onDrawingComplete?: (input: { tool: "pen" | "marker" | "highlighter" | "eraser"; points: Array<{ x: number; y: number; pressure: number }> }) => void;
  onPanelHoverChange?: (panelId: string | null) => void;
  onObjectReparent?: (objectId: string, panelId: string | null) => void;
  onObjectHoverChange?: (objectId: string | null) => void;
  className?: string;
}

function textOptionsFor(object: BoardFabricObject, defaults: { fontSize: number; alignment: "left" | "center" | "right" }) {
  const linked = Boolean(object.style.link);
  return {
    fontFamily: object.style.fontFamily ?? "Noto Sans SC, sans-serif",
    fontSize: object.style.fontSize ?? defaults.fontSize,
    fontWeight: object.style.bold ? 700 : 400,
    fontStyle: object.style.italic ? "italic" as const : "normal" as const,
    underline: Boolean(object.style.underline || linked),
    textAlign: object.style.alignment ?? defaults.alignment,
    lineHeight: object.style.lineHeight ?? 1.3,
    fill: object.style.textColor,
    hoverCursor: linked ? "pointer" : "text",
  };
}

function applyResizePolicy(projected: TaggedFabricObject, object: BoardFabricObject): void {
  const sticky = object.kind === "sticky" ? object.sticky : undefined;
  const autoSize = sticky?.sizingMode === "auto-size";
  const autoHeight = sticky?.sizingMode === "auto-height";
  const proportional = sticky?.variant === "square" || sticky?.variant === "circle";
  projected.set({ lockScalingX: Boolean(object.locked) || autoSize, lockScalingY: Boolean(object.locked) || autoSize, lockMovementX: Boolean(object.locked), lockMovementY: Boolean(object.locked), lockRotation: Boolean(object.locked), hoverCursor: object.locked ? "not-allowed" : object.style.link ? "pointer" : "move" });
  projected.setControlsVisibility({
    mtr: true,
    ml: !autoSize && !proportional,
    mr: !autoSize && !proportional,
    mt: !autoSize && !autoHeight && !proportional,
    mb: !autoSize && !autoHeight && !proportional,
    tl: !autoSize && !autoHeight,
    tr: !autoSize && !autoHeight,
    bl: !autoSize && !autoHeight,
    br: !autoSize && !autoHeight,
  });
}

function createFabricObject(object: BoardFabricObject): TaggedFabricObject {
  const richText = textOptionsFor(object, { fontSize: 20, alignment: "center" });
  const textOptions = {
    width: Math.max(24, object.geometry.width - 32),
    ...richText,
    originX: "center" as const,
    originY: "center" as const,
  };
  let projected: FabricObject;
  if (object.kind === "connector" && object.connector) {
    const { start, end, type, lineStyle, label, startStyle, endStyle } = object.connector;
    const width = Math.max(1, Math.abs(end.x - start.x)), height = Math.max(1, Math.abs(end.y - start.y));
    const x1 = start.x <= end.x ? -width / 2 : width / 2, y1 = start.y <= end.y ? -height / 2 : height / 2;
    const x2 = -x1, y2 = -y1;
    const dash = lineStyle === "dashed" ? [10, 7] : lineStyle === "dotted" ? [2, 6] : undefined;
    const stroke = object.style.stroke ?? "#29261E";
    const line = type === "straight"
      ? new Line([x1, y1, x2, y2], { stroke, strokeWidth: 2, strokeDashArray: dash, selectable: false, evented: false })
      : new Path(type === "elbow" ? `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} C 0 ${y1}, 0 ${y2}, ${x2} ${y2}`, { fill: "", stroke, strokeWidth: 2, strokeDashArray: dash, selectable: false, evented: false });
    const tips: FabricObject[] = [];
    const tip = (style: typeof startStyle, x: number, y: number, angle: number) => {
      if (style === "circle") return new Circle({ left: x, top: y, radius: 5, fill: stroke, originX: "center", originY: "center" });
      if (style === "diamond") return new Rect({ left: x, top: y, width: 9, height: 9, angle: 45, fill: stroke, originX: "center", originY: "center" });
      if (style === "arrow") return new Triangle({ left: x, top: y, width: 10, height: 12, angle, fill: stroke, originX: "center", originY: "center" });
      return null;
    };
    const angles = connectorTipAngles(type, x1, y1, x2, y2);
    const startTip = tip(startStyle, x1, y1, angles.start), endTip = tip(endStyle, x2, y2, angles.end);
    if (startTip) tips.push(startTip); if (endTip) tips.push(endTip);
    projected = new Group([line, ...tips, new Textbox(label, { ...textOptions, width: Math.max(80, width), fontSize: 13, backgroundColor: "#FFFFFF" })]);
  } else if (object.kind === "drawing" && object.boardContent?.type === "drawing") {
    const eraserTargets = new Map(drawingEraserLayers(object.boardContent).map((layer) => [layer.stroke.id, new Set(layer.targetStrokeIds)]));
    projected = new Group(object.boardContent.strokes.flatMap((stroke) => stroke.points.slice(1).map((point, index) => {
      const previous = stroke.points[index]!;
      const path = `M ${previous.x - object.geometry.x} ${previous.y - object.geometry.y} L ${point.x - object.geometry.x} ${point.y - object.geometry.y}`;
      const pressure = Math.max(.1, (previous.pressure + point.pressure) / 2);
      return new Path(path, { fill: "", stroke: stroke.color, strokeWidth: stroke.width * (.35 + pressure * .65), opacity: stroke.opacity, strokeLineCap: "round", strokeLineJoin: "round", globalCompositeOperation: stroke.tool === "eraser" && eraserTargets.get(stroke.id)?.size ? "destination-out" : "source-over" });
    })));
  } else if (object.kind === "image" && object.boardContent?.type === "image") {
    if (object.boardContent.status === "ready" && object.imageAssetUrl) {
      const image = new Image();
      image.alt = object.boardContent.fileName;
      const crop = object.boardContent.crop;
      const naturalWidth = Math.max(1, object.boardContent.intrinsicWidth * crop.width), naturalHeight = Math.max(1, object.boardContent.intrinsicHeight * crop.height);
      const scaleX = object.geometry.width / naturalWidth, scaleY = object.geometry.height / naturalHeight;
      const clipPath = new Rect({ width: naturalWidth, height: naturalHeight, rx: object.boardContent.cornerRadius / Math.max(scaleX, .0001), ry: object.boardContent.cornerRadius / Math.max(scaleY, .0001), originX: "center", originY: "center" });
      const bitmap = new FabricImage(image, { cropX: object.boardContent.intrinsicWidth * crop.x, cropY: object.boardContent.intrinsicHeight * crop.y, width: naturalWidth, height: naturalHeight, scaleX, scaleY, opacity: object.boardContent.opacity, originX: "center", originY: "center", clipPath });
      image.onload = () => { bitmap.setElement(image); bitmap.canvas?.requestRenderAll(); };
      image.src = object.imageAssetUrl;
      projected = new Group([new Rect({ width: object.geometry.width, height: object.geometry.height, rx: object.boardContent.cornerRadius, ry: object.boardContent.cornerRadius, fill: "#F4F4F5", stroke: object.boardContent.borderColor, strokeWidth: object.boardContent.borderWidth, originX: "center", originY: "center" }), bitmap]);
    } else {
      const state = object.boardContent.status === "failed" ? "图片上传失败" : object.boardContent.status === "ready" ? "图片需在当前会话重新验证" : "图片上传中";
      projected = new Group([new Rect({ width: object.geometry.width, height: object.geometry.height, rx: 12, ry: 12, fill: "#F4F4F5", stroke: "#A1A1AA", strokeDashArray: [8, 6], originX: "center", originY: "center" }), new Textbox(`${state}\n${object.boardContent.fileName}`, textOptions)]);
    }
  } else if (object.kind === "card" && object.boardContent && object.boardContent.type !== "shape" && object.boardContent.type !== "drawing" && object.boardContent.type !== "image") {
    const content = object.boardContent;
    const kicker = content.type === "web-tile" ? "链接" : content.type === "table" ? "表格" : content.type === "icon" ? "图标" : content.type === "template" ? "模板" : "卡片";
    const description = content.type === "tile" || content.type === "web-tile" ? content.description : content.type === "table" ? `${content.columns.length} 列 · ${content.rows.length} 行` : content.type === "icon" ? `${content.set} / ${content.name}` : `版本 ${content.versionId}`;
    projected = new Group([
      new Rect({ width: object.geometry.width, height: object.geometry.height, rx: 16, ry: 16, fill: object.style.fill, stroke: object.style.stroke ?? "#D4D4D8", strokeWidth: 1, originX: "center", originY: "center" }),
      new Textbox(kicker, { ...textOptions, top: -object.geometry.height / 2 + 30, fontSize: 12, fill: "#71717A", textAlign: "left" }),
      new Textbox(object.content.text, { ...textOptions, top: -8, fontSize: 20, fontWeight: 650, textAlign: "left" }),
      new Textbox(description, { ...textOptions, top: object.geometry.height / 2 - 42, fontSize: 13, fill: "#52525B", textAlign: "left" }),
    ]);
  } else if (object.kind === "shape" && object.boardContent?.type === "shape") {
    const variant = object.boardContent.variant;
    const w = object.geometry.width, h = object.geometry.height;
    const shape = variant === "circle" || variant === "ellipse"
      ? new Circle({ radius: 50, scaleX: w / 100, scaleY: h / 100, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 1, strokeDashArray: dashFor(object.style.borderStyle), opacity: object.style.opacity, originX: "center", originY: "center" })
      : ["diamond", "decision", "triangle", "hexagon", "cloud", "database", "document", "data", "predefined-process"].includes(variant)
        ? new Path(shapePath(variant, w, h), { fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 1, strokeDashArray: dashFor(object.style.borderStyle), opacity: object.style.opacity, originX: "center", originY: "center" })
        : new Rect({ width: w, height: h, rx: variant === "terminator" ? h / 2 : object.style.radius ?? (variant === "rounded-rectangle" ? 20 : 0), ry: variant === "terminator" ? h / 2 : object.style.radius ?? (variant === "rounded-rectangle" ? 20 : 0), fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 1, strokeDashArray: dashFor(object.style.borderStyle), opacity: object.style.opacity, originX: "center", originY: "center" });
    const labelTop = object.style.verticalAlignment === "top" ? -h / 2 + 24 : object.style.verticalAlignment === "bottom" ? h / 2 - 24 : 0;
    projected = new Group([shape, new Textbox(object.content.text, { ...textOptions, top: labelTop })]);
  } else if (object.kind === "placeholder") {
    projected = new Group([
      new Rect({ width: object.geometry.width, height: object.geometry.height, rx: 8, ry: 8, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: 2, strokeDashArray: [8, 6], originX: "center", originY: "center" }),
      new Textbox(object.content.text, textOptions),
    ]);
  } else if (object.kind === "text") {
    projected = new Textbox(object.content.text, {
      width: object.geometry.width,
      ...textOptionsFor(object, { fontSize: 24, alignment: "left" }),
    });
  } else if (object.kind === "ellipse") {
    projected = new Group([
      new Circle({ radius: 50, scaleX: object.geometry.width / 100, scaleY: object.geometry.height / 100, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0, originX: "center", originY: "center" }),
      new Textbox(object.content.text, textOptions),
    ]);
  } else if (object.kind === "panel") {
    projected = new Group([
      new Rect({ width: object.geometry.width, height: object.geometry.height, rx: 14, ry: 14, fill: object.style.fill, stroke: object.style.stroke ?? "#78716C", strokeWidth: 2, strokeDashArray: object.panel?.clipContent ? undefined : [8, 5], originX: "center", originY: "center" }),
      new Textbox(object.panel?.title ?? object.content.text, { ...textOptions, top: -object.geometry.height / 2 + 24, fontSize: 16, fontWeight: 700 }),
    ]);
  } else if (object.kind === "group") {
    projected = new Rect({ width: object.geometry.width, height: object.geometry.height, fill: "transparent", stroke: "#6366F1", strokeWidth: 1, strokeDashArray: [5, 5] });
  } else if (object.kind === "sticky" && object.sticky?.variant === "circle") {
    projected = new Group([
      new Circle({ radius: Math.min(object.geometry.width, object.geometry.height) / 2, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0, originX: "center", originY: "center" }),
      new Textbox(object.content.text, { ...textOptions, width: Math.max(24, Math.min(object.geometry.width, object.geometry.height) - 40) }),
    ]);
  } else {
    const cornerRadius = object.kind === "sticky" ? 6 : 12;
    projected = new Group([
      new Rect({ width: object.geometry.width, height: object.geometry.height, rx: cornerRadius, ry: cornerRadius, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0, originX: "center", originY: "center" }),
      new Textbox(object.content.text, textOptions),
    ]);
  }
  projected.set({
    left: object.geometry.x,
    top: object.geometry.y,
    originX: "left",
    originY: "top",
    angle: object.geometry.rotation,
    data: { boardObjectId: object.id, adapterKind: object.kind, renderedRevision: object.revision, stickyVariant: object.sticky?.variant, sizingMode: object.sticky?.sizingMode },
    selectable: object.kind !== "placeholder",
    evented: object.kind !== "placeholder",
    lockMovementX: Boolean(object.locked), lockMovementY: Boolean(object.locked),
    lockScalingX: Boolean(object.locked), lockScalingY: Boolean(object.locked), lockRotation: Boolean(object.locked),
  });
  applyResizePolicy(projected, object);
  projected.setCoords();
  return projected;
}

function dashFor(style: BoardFabricObject["style"]["borderStyle"]): number[] | undefined { return style === "dashed" ? [10, 7] : style === "dotted" ? [2, 5] : undefined; }

function shapePath(variant: string, width: number, height: number): string {
  const x = width / 2, y = height / 2;
  if (variant === "diamond" || variant === "decision") return `M 0 ${-y} L ${x} 0 L 0 ${y} L ${-x} 0 Z`;
  if (variant === "triangle") return `M 0 ${-y} L ${x} ${y} L ${-x} ${y} Z`;
  if (variant === "hexagon") return `M ${-x * .55} ${-y} L ${x * .55} ${-y} L ${x} 0 L ${x * .55} ${y} L ${-x * .55} ${y} L ${-x} 0 Z`;
  if (variant === "cloud") return `M ${-x} ${y * .25} C ${-x} ${-y * .35} ${-x * .45} ${-y * .6} ${-x * .15} ${-y * .35} C 0 ${-y} ${x * .65} ${-y * .7} ${x * .55} ${-y * .25} C ${x} ${-y * .2} ${x} ${y * .5} ${x * .55} ${y * .55} L ${-x * .55} ${y * .55} C ${-x * .9} ${y * .55} ${-x} ${y * .25} ${-x} ${y * .25} Z`;
  if (variant === "database") return `M ${-x} ${-y * .7} C ${-x} ${-y} ${x} ${-y} ${x} ${-y * .7} L ${x} ${y * .7} C ${x} ${y} ${-x} ${y} ${-x} ${y * .7} Z`;
  if (variant === "data") return `M ${-x * .7} ${-y} L ${x} ${-y} L ${x * .7} ${y} L ${-x} ${y} Z`;
  if (variant === "predefined-process") return `M ${-x} ${-y} L ${x} ${-y} L ${x} ${y} L ${-x} ${y} Z M ${-x * .72} ${-y} L ${-x * .72} ${y} M ${x * .72} ${-y} L ${x * .72} ${y}`;
  return `M ${-x} ${-y} L ${x * .55} ${-y} L ${x} ${-y * .55} L ${x} ${y} L ${-x} ${y} Z`;
}

export function applyCanonicalObject(projected: TaggedFabricObject, object: BoardFabricObject, readOnly: boolean): void {
  const selection = projected.group instanceof ActiveSelection ? projected.group : undefined;
  const members = selection?.getObjects();
  // Leave the selection plane before restoring scene geometry. Keeping the same
  // ActiveSelection instance avoids canvas selection events and preserves mixed
  // locked selections. Rebuild its bounds after every canonical patch, including
  // asynchronous rejection and duplicate restoration.
  selection?.removeAll();
  try {
    applyCanonicalObjectInScene(projected, object, readOnly);
  } finally {
    if (selection && members) {
      selection.set({ angle: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false });
      selection.add(...members);
      selection.setCoords();
    }
  }
}

function applyCanonicalObjectInScene(projected: TaggedFabricObject, object: BoardFabricObject, readOnly: boolean): void {
  const richText = textOptionsFor(object, { fontSize: object.kind === "text" ? 24 : 20, alignment: object.kind === "text" ? "left" : "center" });
  if (object.kind === "text") {
    projected.set({ text: object.content.text, ...richText });
  } else if (object.kind !== "connector" && "getObjects" in projected && typeof projected.getObjects === "function") {
    const [shape, label] = projected.getObjects();
    shape?.set({ fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0, ...(object.kind === "panel" ? { strokeDashArray: object.panel?.clipContent ? undefined : [8, 5] } : {}) });
    label?.set({ text: object.content.text, ...richText });
  }
  const naturalWidth = projected.width || object.geometry.width;
  const naturalHeight = projected.height || object.geometry.height;
  projected.set({
    left: object.geometry.x,
    top: object.geometry.y,
    originX: "left",
    originY: "top",
    angle: object.geometry.rotation,
    scaleX: object.geometry.width / naturalWidth,
    scaleY: object.geometry.height / naturalHeight,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
    // Locked objects remain selectable for inspection and mixed selections;
    // the lock flags below prevent every Fabric transform.
    selectable: !readOnly && object.kind !== "placeholder" && object.kind !== "connector",
    evented: !readOnly && object.kind !== "placeholder",
    hasControls: object.kind !== "connector",
    lockMovementX: object.kind === "connector",
    lockMovementY: object.kind === "connector",
    data: { boardObjectId: object.id, adapterKind: object.kind, renderedRevision: object.revision, stickyVariant: object.sticky?.variant, sizingMode: object.sticky?.sizingMode },
  });
  applyResizePolicy(projected, object);
  projected.setCoords();
}

function projectionFailureObject(object: BoardFabricObject): BoardFabricObject {
  const message = "对象渲染失败，内容已安全保留。";
  return {
    ...object,
    kind: "placeholder",
    locked: true,
    style: { fill: "#FEF2F2", textColor: "#991B1B", stroke: "#DC2626", fontSize: 14 },
    content: { text: message },
    projectionIssue: { code: "BOARD_PROJECTION_FAILED", sourceKind: object.projectionIssue?.sourceKind ?? object.kind, message },
  };
}

function createProjectionEntry(object: BoardFabricObject, readOnly: boolean): { projected: TaggedFabricObject; rendered: BoardFabricObject } {
  try {
    const projected = createFabricObject(object);
    applyCanonicalObject(projected, object, readOnly);
    return { projected, rendered: object };
  } catch {
    const rendered = projectionFailureObject(object);
    const projected = createFabricObject(rendered);
    applyCanonicalObject(projected, rendered, true);
    projected.data = { ...projected.data, boardObjectId: object.id, renderedRevision: object.revision, projectionFailure: true };
    return { projected, rendered };
  }
}

function geometryFromFabric(projected: TaggedFabricObject, canonical?: BoardFabricObject, useSceneBounds = false): BoardFabricGeometry {
  const scene = useSceneBounds ? projected.getBoundingRect() : null;
  const geometry = {
    x: Math.round(scene?.left ?? projected.left),
    y: Math.round(scene?.top ?? projected.top),
    width: Math.max(1, Math.round(scene?.width ?? (projected.width || 1) * projected.scaleX)),
    height: Math.max(1, Math.round(scene?.height ?? (projected.height || 1) * projected.scaleY)),
    rotation: Math.round(projected.angle ?? 0),
  };
  if (canonical?.kind === "sticky") {
    if (canonical.sticky?.sizingMode === "auto-size") {
      geometry.width = canonical.geometry.width;
      geometry.height = canonical.geometry.height;
    } else if (canonical.sticky?.sizingMode === "auto-height") {
      geometry.height = canonical.geometry.height;
    }
    if (canonical.sticky?.variant === "square" || canonical.sticky?.variant === "circle") {
      const side = Math.max(geometry.width, geometry.height);
      geometry.width = side;
      geometry.height = side;
    }
  }
  return geometry;
}

/** ActiveSelection keeps child coordinates in its local plane. The total scene
 * matrix is the only authoritative result after group move/scale/rotation. */
export function geometryFromFabricSceneTransform(projected: TaggedFabricObject): BoardFabricGeometry {
  const decomposition = util.qrDecompose(projected.calcTransformMatrix());
  const rotation = typeof projected.getTotalAngle === "function" ? projected.getTotalAngle() : decomposition.angle;
  const width = Math.max(1, (projected.width || 1) * Math.abs(decomposition.scaleX));
  const height = Math.max(1, (projected.height || 1) * Math.abs(decomposition.scaleY));
  const radians = rotation * Math.PI / 180;
  const x = decomposition.translateX - Math.cos(radians) * width / 2 + Math.sin(radians) * height / 2;
  const y = decomposition.translateY - Math.sin(radians) * width / 2 - Math.cos(radians) * height / 2;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), rotation: Math.round(rotation) };
}

export function BoardFabricSurface({ objects, selectedObjectIds, readOnly, tool, viewport, onSelectionChange, onObjectTransform, onObjectsTransform, onViewportChange, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop, onDrawingComplete, onPanelHoverChange, onObjectReparent, onObjectHoverChange, className }: BoardFabricSurfaceProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasElementRef = React.useRef<HTMLCanvasElement>(null);
  const canvasRef = React.useRef<Canvas | null>(null);
  const registryRef = React.useRef(new Map<string, TaggedFabricObject>());
  const canonicalRef = React.useRef(new Map<string, BoardFabricObject>());
  const renderedRef = React.useRef(new Map<string, BoardFabricObject>());
  const [renderedObjects, setRenderedObjects] = React.useState<readonly BoardFabricObject[]>(objects);
  const [snapPreview, setSnapPreview] = React.useState<SnapResult | null>(null);
  const [selectionScene, setSelectionScene] = React.useState<{ bounds: { left: number; top: number; width: number; height: number }; hitPoints: Array<{ x: number; y: number }> } | null>(null);
  const [objectScenes, setObjectScenes] = React.useState<Array<{ id: string; left: number; top: number; width: number; height: number }>>([]);
  const selectedObjectIdsRef = React.useRef(selectedObjectIds);
  const reconcilingSelectionRef = React.useRef(false);
  const renderFrameRef = React.useRef<number | null>(null);
  const callbacksRef = React.useRef({ onSelectionChange, onObjectTransform, onObjectsTransform, onViewportChange, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop, onDrawingComplete, onPanelHoverChange, onObjectReparent, onObjectHoverChange });
  const stateRef = React.useRef({ readOnly, tool, viewport });
  callbacksRef.current = { onSelectionChange, onObjectTransform, onObjectsTransform, onViewportChange, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop, onDrawingComplete, onPanelHoverChange, onObjectReparent, onObjectHoverChange };
  stateRef.current = { readOnly, tool, viewport };
  selectedObjectIdsRef.current = selectedObjectIds;
  const scheduleRender = React.useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = null;
      canvasRef.current?.requestRenderAll();
    });
  }, []);

  React.useEffect(() => {
    const host = hostRef.current;
    const element = canvasElementRef.current;
    if (!host || !element) return;
    const registry = registryRef.current;
    const rendered = renderedRef.current;
    let disposed = false;
    const canvas = new Canvas(element, { selection: !stateRef.current.readOnly, preserveObjectStacking: true, uniformScaling: true });
    canvasRef.current = canvas;
    const resize = () => {
      canvas.setDimensions({ width: host.clientWidth || 1200, height: host.clientHeight || 720 });
      canvas.requestRenderAll();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const selectionChanged = () => {
      if (reconcilingSelectionRef.current) return;
      const active = canvas.getActiveObject() as TaggedFabricObject | undefined;
      const id = active?.data?.boardObjectId;
      if (id) { callbacksRef.current.onSelectionChange([id], "canvas"); return; }
      const nested = active && "getObjects" in active && typeof active.getObjects === "function" ? active.getObjects() as TaggedFabricObject[] : [];
      const activeIds = new Set(nested.flatMap((object) => object.data?.boardObjectId ? [object.data.boardObjectId] : []));
      const stable = selectedObjectIdsRef.current.filter((objectId) => activeIds.delete(objectId));
      for (const object of canvas.getObjects() as TaggedFabricObject[]) if (object.data?.boardObjectId && activeIds.delete(object.data.boardObjectId)) stable.push(object.data.boardObjectId);
      callbacksRef.current.onSelectionChange(stable, "canvas");
    };
    let duplicateGesture: { ids: string[]; start: { x: number; y: number }; current: { x: number; y: number }; handled: boolean } | null = null;
    const topmostPanelAt = (point: { x: number; y: number }, excludedId: string) => {
      for (const projected of [...canvas.getObjects()].reverse() as TaggedFabricObject[]) {
        const panelId = projected.data?.boardObjectId;
        const candidate = panelId ? canonicalRef.current.get(panelId) : undefined;
        if (!panelId || panelId === excludedId || candidate?.kind !== "panel") continue;
        const { x, y, width, height, rotation } = candidate.geometry;
        const radians = -rotation * Math.PI / 180, dx = point.x - x, dy = point.y - y;
        const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
        const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
        if (localX >= 0 && localX <= width && localY >= 0 && localY <= height) return candidate;
      }
      return undefined;
    };
    const previewSnap = (event: { target?: FabricObject; e?: Event }, mode: "move" | "scale" | "rotate" = "move") => {
      const target = event.target as TaggedFabricObject | undefined;
      if ((event.e as MouseEvent | undefined)?.altKey) { setSnapPreview(null); return; }
      const id = target?.data?.boardObjectId;
      const canonical = id ? canonicalRef.current.get(id) : undefined;
      const nested = target && !id && "getObjects" in target && typeof target.getObjects === "function" ? target.getObjects() as TaggedFabricObject[] : [];
      const nestedIds = new Set(nested.flatMap(object => object.data?.boardObjectId ? [object.data.boardObjectId] : []));
      if (!target || (!canonical && nested.length === 0) || canonical?.locked || stateRef.current.readOnly) { setSnapPreview(null); return; }
      if (mode === "scale" && nested.length) {
        const uniformScale = Math.abs(target.scaleX - 1) >= Math.abs(target.scaleY - 1) ? target.scaleX : target.scaleY;
        target.set({ scaleX: uniformScale, scaleY: uniformScale });
        target.setCoords();
      }
      const moving = id ? geometryFromFabric(target) : { x: target.getBoundingRect().left, y: target.getBoundingRect().top, width: target.getBoundingRect().width, height: target.getBoundingRect().height, rotation: 0 };
      const targets = [...canonicalRef.current.values()].filter(candidate => candidate.id !== id && !nestedIds.has(candidate.id));
      const result = calculateSnapGuides(moving, targets, 5 / Math.max(0.05, canvas.getZoom()));
      if (mode === "scale") {
        const xAnchor = result.guides.find(guide => guide.axis === "x")?.movingAnchor;
        const yAnchor = result.guides.find(guide => guide.axis === "y")?.movingAnchor;
        const width = Math.max(1, moving.width + (xAnchor === "start" ? -result.delta.x : xAnchor === "end" ? result.delta.x : 0));
        const height = Math.max(1, moving.height + (yAnchor === "start" ? -result.delta.y : yAnchor === "end" ? result.delta.y : 0));
        if (nested.length) {
          const uniformFactor = xAnchor ? width / moving.width : yAnchor ? height / moving.height : 1;
          target.set({
            left: target.left + (xAnchor === "start" ? result.delta.x : xAnchor === "center" ? result.delta.x : 0),
            top: target.top + (yAnchor === "start" ? result.delta.y : yAnchor === "center" ? result.delta.y : 0),
            scaleX: target.scaleX * uniformFactor,
            scaleY: target.scaleY * uniformFactor,
          });
        } else target.set({
          left: target.left + (xAnchor === "start" ? result.delta.x : xAnchor === "center" ? result.delta.x : 0),
          top: target.top + (yAnchor === "start" ? result.delta.y : yAnchor === "center" ? result.delta.y : 0),
          scaleX: target.scaleX * width / moving.width,
          scaleY: target.scaleY * height / moving.height,
        });
      } else if (mode === "move") target.set({ left: target.left + result.delta.x, top: target.top + result.delta.y });
      else {
        const rotation = calculateRotationSnap({ ...moving, rotation: target.angle ?? moving.rotation }, targets, 4);
        target.set({ angle: rotation.geometry.rotation, left: target.left + result.delta.x, top: target.top + result.delta.y });
      }
      target.setCoords();
      setSnapPreview(result.guides.length || result.measurements.length ? result : null);
      canvas.requestRenderAll();
    };
    const transformCompleted = (event: { target?: FabricObject }) => {
      setSnapPreview(null);
      const target = event.target as TaggedFabricObject | undefined;
      if (!target) return;
      const capturedDuplicate = duplicateGesture && !duplicateGesture.handled ? duplicateGesture : null;
      const capturedMembers = capturedDuplicate?.ids.flatMap((id) => { const member = registryRef.current.get(id); return member ? [member] : []; });
      const members = capturedMembers?.length ? capturedMembers : target.data?.boardObjectId ? [target] : ("getObjects" in target && typeof target.getObjects === "function" ? target.getObjects() as TaggedFabricObject[] : []);
      const canonicals = members.flatMap((member) => { const id = member.data?.boardObjectId; const canonical = id ? canonicalRef.current.get(id) : undefined; return id && canonical ? [{ id, member, canonical }] : []; });
      if (!canonicals.length) return;
      const movableCanonicals = canonicals.filter(({ canonical }) => !canonical.locked && canonical.kind !== "placeholder");
      if (stateRef.current.readOnly || !movableCanonicals.length) {
        for (const { member, canonical } of canonicals) applyCanonicalObject(member, canonical, true);
        canvas.requestRenderAll();
        return;
      }
      for (const { member, canonical } of canonicals) if (canonical.locked || canonical.kind === "placeholder") applyCanonicalObject(member, canonical, true);
      const duplicateOffset = capturedDuplicate ? { x: capturedDuplicate.current.x - capturedDuplicate.start.x, y: capturedDuplicate.current.y - capturedDuplicate.start.y } : null;
      const transforms = movableCanonicals.map(({ id, member, canonical }) => {
        if (duplicateOffset) return { id, geometry: { ...canonical.geometry, x: canonical.geometry.x + duplicateOffset.x, y: canonical.geometry.y + duplicateOffset.y }, parentId: canonical.parentId ?? null };
        const bounds = members.length > 1 ? geometryFromFabricSceneTransform(member) : geometryFromFabric(member, canonical);
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const parent = topmostPanelAt(center, id);
        const currentPanel = canonical.parentId ? canonicalRef.current.get(canonical.parentId) : undefined;
        const retainedParent = currentPanel?.kind === "panel" && (currentPanel.panel?.autoExpand || currentPanel.panel?.clipContent) ? currentPanel.id : null;
        return { id, geometry: bounds, parentId: canonical.kind === "group" || canonical.kind === "connector" ? canonical.parentId ?? null : parent?.id ?? retainedParent };
      });
      const restoreCanonicalGeometry = () => {
        if (disposed) return;
        // A delayed result must never mutate a replacement projection. When the
        // object still exists, restore the latest canonical revision so remote
        // updates that arrived while the command was pending are preserved.
        for (const { id, member } of canonicals) {
          if (registryRef.current.get(id) !== member) continue;
          const latestCanonical = canonicalRef.current.get(id);
          if (latestCanonical) applyCanonicalObject(member, latestCanonical, stateRef.current.readOnly);
        }
        canvas.requestRenderAll();
      };
      try {
        const duplicate = Boolean((event as { e?: MouseEvent }).e?.altKey) || Boolean(capturedDuplicate);
        if (capturedDuplicate) capturedDuplicate.handled = true;
        const accepted = callbacksRef.current.onObjectsTransform
          ? callbacksRef.current.onObjectsTransform(transforms, { duplicate })
          : callbacksRef.current.onObjectTransform(transforms[0]!.id, transforms[0]!.geometry);
        const commitLegacyParent = () => {
          if (callbacksRef.current.onObjectsTransform) return;
          for (const item of transforms) {
            const canonical = canonicalRef.current.get(item.id);
            if (canonical && item.parentId !== (canonical.parentId ?? null)) callbacksRef.current.onObjectReparent?.(item.id, item.parentId ?? null);
          }
        };
        if (typeof accepted === "boolean") {
          if (!accepted || duplicate) restoreCanonicalGeometry();
          if (accepted && !duplicate) commitLegacyParent();
          callbacksRef.current.onPanelHoverChange?.(null);
          return;
        }
        void accepted.then((resolved) => {
          if (!resolved || duplicate) restoreCanonicalGeometry();
          if (resolved && !duplicate) commitLegacyParent();
          callbacksRef.current.onPanelHoverChange?.(null);
        }, () => { restoreCanonicalGeometry(); callbacksRef.current.onPanelHoverChange?.(null); });
      } catch {
        restoreCanonicalGeometry();
        callbacksRef.current.onPanelHoverChange?.(null);
      }
    };
    const moving = (event: { target?: FabricObject }) => {
      const target = event.target as TaggedFabricObject | undefined;
      const id = target?.data?.boardObjectId;
      if (!target || !id) return;
      const canonical = canonicalRef.current.get(id);
      if (!canonical || canonical.kind === "group" || canonical.kind === "connector") return;
      const bounds = geometryFromFabric(target), center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const parent = topmostPanelAt(center, id);
      callbacksRef.current.onPanelHoverChange?.(parent?.id ?? null);
    };
    let panning = false;
    let last = { x: 0, y: 0 };
    let drawing: Array<{ x: number; y: number; pressure: number }> | null = null;
    const pressureOf = (event: TPointerEventInfo) => typeof (event.e as PointerEvent).pressure === "number" ? (event.e as PointerEvent).pressure : .5;
    const pointerDown = (event: TPointerEventInfo) => {
      const point = canvas.getScenePoint(event.e);
      const ids = selectedObjectIdsRef.current.filter((id) => { const canonical = canonicalRef.current.get(id); return canonical && !canonical.locked && canonical.kind !== "placeholder"; });
      duplicateGesture = (event.e as MouseEvent).altKey && ids.length ? { ids, start: { x: point.x, y: point.y }, current: { x: point.x, y: point.y }, handled: false } : null;
      if ((stateRef.current.tool.startsWith("draw-") || stateRef.current.tool === "erase") && !stateRef.current.readOnly) {
        const pointer = canvas.getScenePoint(event.e);
        drawing = [{ x: pointer.x, y: pointer.y, pressure: pressureOf(event) }];
        return;
      }
      if (stateRef.current.tool === "select" && !event.target) {
        const pointer = canvas.getScenePoint(event.e);
        callbacksRef.current.onCanvasClick?.({ x: pointer.x, y: pointer.y });
      }
      if (stateRef.current.tool !== "hand") return;
      const pointer = event.e as MouseEvent;
      panning = true;
      last = { x: pointer.clientX, y: pointer.clientY };
    };
    const doubleClick = (event: TPointerEventInfo) => {
      const target = event.target as TaggedFabricObject | undefined;
      const id = target?.data?.boardObjectId;
      if (id) callbacksRef.current.onObjectDoubleClick?.(id);
      else {
        const pointer = canvas.getScenePoint(event.e);
        callbacksRef.current.onCanvasDoubleClick?.({ x: pointer.x, y: pointer.y });
      }
    };
    const pointerMove = (event: TPointerEventInfo) => {
      if (duplicateGesture && !duplicateGesture.handled) { const point = canvas.getScenePoint(event.e); duplicateGesture.current = { x: point.x, y: point.y }; }
      if (drawing) { const pointer = canvas.getScenePoint(event.e); drawing.push({ x: pointer.x, y: pointer.y, pressure: pressureOf(event) }); return; }
      if (!panning) return;
      const pointer = event.e as MouseEvent;
      const transform = [...canvas.viewportTransform] as typeof canvas.viewportTransform;
      transform[4] += pointer.clientX - last.x;
      transform[5] += pointer.clientY - last.y;
      last = { x: pointer.clientX, y: pointer.clientY };
      canvas.setViewportTransform(transform);
    };
    const pointerUp = (event: TPointerEventInfo) => {
      if (duplicateGesture && !duplicateGesture.handled) {
        const gesture = duplicateGesture;
        const point = canvas.getScenePoint(event.e);
        gesture.current = { x: point.x, y: point.y };
        const offset = { x: gesture.current.x - gesture.start.x, y: gesture.current.y - gesture.start.y };
        if (Math.abs(offset.x) > .5 || Math.abs(offset.y) > .5) {
          const transforms = gesture.ids.flatMap((id) => {
            const canonical = canonicalRef.current.get(id);
            return canonical ? [{ id, geometry: { ...canonical.geometry, x: canonical.geometry.x + offset.x, y: canonical.geometry.y + offset.y }, parentId: canonical.parentId ?? null }] : [];
          });
          gesture.handled = true;
          try { callbacksRef.current.onObjectsTransform?.(transforms, { duplicate: true }); }
          catch { /* The canonical editor reports the rejected operation; the projection is restored below. */ }
          finally {
            for (const id of gesture.ids) { const canonical = canonicalRef.current.get(id), member = registryRef.current.get(id); if (canonical && member) applyCanonicalObject(member, canonical, stateRef.current.readOnly); }
            canvas.requestRenderAll();
          }
        }
      }
      duplicateGesture = null;
      if (drawing) {
        const completed = drawing; drawing = null;
        if (completed.length > 1) callbacksRef.current.onDrawingComplete?.({ tool: stateRef.current.tool === "erase" ? "eraser" : stateRef.current.tool.replace("draw-", "") as "pen" | "marker" | "highlighter", points: completed });
        return;
      }
      if (!panning) return;
      panning = false;
      const transform = canvas.viewportTransform;
      callbacksRef.current.onViewportChange({ ...stateRef.current.viewport, zoom: canvas.getZoom(), panX: transform[4], panY: transform[5] }, "pan");
    };
    const wheel = (event: TPointerEventInfo<WheelEvent>) => {
      event.e.preventDefault();
      event.e.stopPropagation();
      const nextZoom = clampBoardZoom(canvas.getZoom() * Math.pow(.998, event.e.deltaY));
      canvas.zoomToPoint(new Point(event.e.offsetX, event.e.offsetY), nextZoom);
      const transform = canvas.viewportTransform;
      callbacksRef.current.onViewportChange({ ...stateRef.current.viewport, zoom: nextZoom, panX: transform[4], panY: transform[5] }, "wheel");
    };
    canvas.on("selection:created", selectionChanged);
    canvas.on("selection:updated", selectionChanged);
    canvas.on("selection:cleared", selectionChanged);
    canvas.on("object:modified", transformCompleted);
    canvas.on("object:moving", event => { moving(event); previewSnap(event, "move"); });
    canvas.on("object:scaling", event => previewSnap(event, "scale"));
    canvas.on("object:rotating", event => previewSnap(event, "rotate"));
    canvas.on("mouse:down", pointerDown);
    canvas.on("mouse:move", pointerMove);
    canvas.on("mouse:up", pointerUp);
    canvas.on("mouse:wheel", wheel);
    canvas.on("mouse:dblclick", doubleClick);
    canvas.on("mouse:over", (event) => callbacksRef.current.onObjectHoverChange?.((event.target as TaggedFabricObject | undefined)?.data?.boardObjectId ?? null));
    canvas.on("mouse:out", () => callbacksRef.current.onObjectHoverChange?.(null));
    return () => {
      disposed = true;
      resizeObserver.disconnect();
      canvas.dispose();
      canvasRef.current = null;
      registry.clear();
      rendered.clear();
      if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const incoming = new Map(objects.map((object) => [object.id, object]));
    for (const [id, projected] of registryRef.current) {
      if (!incoming.has(id)) {
        canvas.remove(projected);
        registryRef.current.delete(id);
        renderedRef.current.delete(id);
      }
    }
    const kindOrder = (object: BoardFabricObject) => object.kind === "panel" ? 0 : object.kind === "connector" ? 3 : object.kind === "group" ? 2 : 1;
    const orderedObjects = [...objects].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || kindOrder(left) - kindOrder(right) || left.orderKey.localeCompare(right.orderKey));
    const nextRendered: BoardFabricObject[] = [];
    for (const object of orderedObjects) {
      const current = registryRef.current.get(object.id);
      const failedAtThisRevision = current?.data?.projectionFailure === true && current.data.renderedRevision === object.revision;
      let rendered = failedAtThisRevision ? renderedRef.current.get(object.id) ?? projectionFailureObject(object) : object;
      const stickyShapeChanged = current?.data?.stickyVariant !== object.sticky?.variant;
      const richProjectionChanged = Boolean(current && current.data?.renderedRevision !== object.revision && ["shape", "drawing", "image", "card"].includes(object.kind));
      const connectorProjectionChanged = Boolean(current && current.data?.renderedRevision !== object.revision && object.kind === "connector");
      if (!current || (!failedAtThisRevision && (current.data?.adapterKind !== object.kind || stickyShapeChanged || richProjectionChanged || connectorProjectionChanged))) {
        if (current) canvas.remove(current);
        const entry = createProjectionEntry(object, readOnly);
        rendered = entry.rendered;
        registryRef.current.set(object.id, entry.projected);
        canvas.add(entry.projected);
      } else if (!failedAtThisRevision && (current.data?.renderedRevision !== object.revision || current.selectable === readOnly)) {
        try {
          applyCanonicalObject(current, object, readOnly);
        } catch {
          canvas.remove(current);
          const entry = createProjectionEntry(projectionFailureObject(object), true);
          entry.projected.data = { ...entry.projected.data, boardObjectId: object.id, renderedRevision: object.revision, projectionFailure: true };
          rendered = entry.rendered;
          registryRef.current.set(object.id, entry.projected);
          canvas.add(entry.projected);
        }
      }
      renderedRef.current.set(object.id, rendered);
      nextRendered.push(rendered);
    }
    canonicalRef.current = new Map(nextRendered.map((object) => [object.id, object]));
    setRenderedObjects(nextRendered);
    orderedObjects.forEach((object, index) => {
      const projected = registryRef.current.get(object.id);
      if (projected) {
        canvas.moveObjectTo(projected, index);
        const parent = object.parentId ? incoming.get(object.parentId) : undefined;
        if (parent?.kind === "panel" && parent.panel?.clipContent) {
          projected.clipPath = new Rect({ left: parent.geometry.x, top: parent.geometry.y, width: parent.geometry.width, height: parent.geometry.height, angle: parent.geometry.rotation, originX: "left", originY: "top", absolutePositioned: true });
        } else projected.clipPath = undefined;
      }
    });
    setObjectScenes([...registryRef.current].map(([id, projected]) => ({ id, ...projected.getBoundingRect() })));
    scheduleRender();
  }, [objects, readOnly, scheduleRender]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = tool === "select" && !readOnly;
    canvas.defaultCursor = tool === "hand" ? "grab" : tool.startsWith("draw-") ? "crosshair" : tool === "erase" ? "cell" : "default";
    for (const [id, projected] of registryRef.current) {
      const canonical = canonicalRef.current.get(id);
      const selectable = !readOnly && tool === "select" && canonical?.kind !== "placeholder";
      const evented = !readOnly && tool === "select" && canonical?.kind !== "placeholder";
      const autoSize = canonical?.kind === "sticky" && canonical.sticky?.sizingMode === "auto-size";
      projected.set({ selectable, evented, lockMovementX: Boolean(canonical?.locked), lockMovementY: Boolean(canonical?.locked), lockScalingX: Boolean(canonical?.locked) || autoSize, lockScalingY: Boolean(canonical?.locked) || autoSize, lockRotation: Boolean(canonical?.locked) });
    }
    canvas.requestRenderAll();
  }, [readOnly, tool]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const projected = selectedObjectIds.flatMap((id) => { const object = registryRef.current.get(id); return object ? [object] : []; });
    const transformable = projected.filter((object) => {
      const canonical = canonicalRef.current.get(object.data?.boardObjectId ?? "");
      return canonical && !canonical.locked && canonical.kind !== "placeholder" && canonical.kind !== "connector";
    });
    // Keep locked objects in the canonical selection for inspection, while the
    // Fabric transform boundary previews and moves only the unlocked subset.
    reconcilingSelectionRef.current = true;
    try {
      if (projected.length > 1 && transformable.length > 1) {
        const activeSelection = new ActiveSelection(transformable, { canvas });
        activeSelection.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
        canvas.setActiveObject(activeSelection);
      }
      else if (projected.length > 1 && transformable[0]) canvas.setActiveObject(transformable[0]);
      else if (projected[0]) canvas.setActiveObject(projected[0]);
      else canvas.discardActiveObject();
    } finally {
      reconcilingSelectionRef.current = false;
    }
    const active = canvas.getActiveObject();
    if (active && transformable.length > 1) {
      const bounds = active.getBoundingRect();
      setSelectionScene({ bounds, hitPoints: transformable.map((object) => { const item = object.getBoundingRect(); return { x: item.left + item.width / 2, y: item.top + item.height / 2 }; }) });
    } else setSelectionScene(null);
    scheduleRender();
  }, [objects, scheduleRender, selectedObjectIds]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const zoom = clampBoardZoom(viewport.zoom);
    canvas.setViewportTransform([zoom, 0, 0, zoom, viewport.panX, viewport.panY]);
    canvas.requestRenderAll();
  }, [viewport.panX, viewport.panY, viewport.zoom]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.fitRequest === 0) return;
    const currentViewport = stateRef.current.viewport;
    const fitMode = currentViewport.fitMode ?? "board";
    const projected = fitMode === "selection"
      ? selectedObjectIdsRef.current.flatMap((id) => {
          const object = registryRef.current.get(id);
          return object ? [object] : [];
        })
      : canvas.getObjects();
    if (fitMode === "selection" && projected.length === 0) return;
    if (projected.length === 0) {
      callbacksRef.current.onViewportChange({ ...currentViewport, zoom: 1, panX: 0, panY: 0 }, "fit");
      return;
    }
    const bounds = projected.map((object) => object.getBoundingRect());
    const left = Math.min(...bounds.map((bound) => bound.left));
    const top = Math.min(...bounds.map((bound) => bound.top));
    const right = Math.max(...bounds.map((bound) => bound.left + bound.width));
    const bottom = Math.max(...bounds.map((bound) => bound.top + bound.height));
    const zoom = clampBoardZoom(Math.min((canvas.getWidth() - 96) / Math.max(1, right - left), (canvas.getHeight() - 96) / Math.max(1, bottom - top)));
    const panX = (canvas.getWidth() - (right - left) * zoom) / 2 - left * zoom;
    const panY = (canvas.getHeight() - (bottom - top) * zoom) / 2 - top * zoom;
    canvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
    callbacksRef.current.onViewportChange({ ...currentViewport, zoom, panX, panY }, "fit");
    canvas.requestRenderAll();
  }, [viewport.fitRequest]);

  const selectFromOutline = React.useCallback((objectId: string) => onSelectionChange([objectId], "outline"), [onSelectionChange]);
  return (
    <div ref={hostRef} className={className ?? "relative h-full w-full overflow-hidden bg-muted/30"} data-testid="board-fabric-surface"
      data-viewport-zoom={clampBoardZoom(viewport.zoom)} data-viewport-pan-x={viewport.panX} data-viewport-pan-y={viewport.panY}
      data-selection-scene={selectionScene ? JSON.stringify(selectionScene) : undefined}
      data-object-scenes={JSON.stringify(objectScenes)}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-workspacex-board-tool")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(event) => {
        const payload = event.dataTransfer.getData("application/x-workspacex-board-tool");
        if (!payload || readOnly) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        callbacksRef.current.onToolDrop?.({ x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }, payload);
      }}>
      <canvas ref={canvasElementRef} data-testid="board-fabric-canvas" aria-label="Fabric.js 白板画布" />
      {snapPreview ? <div className="pointer-events-none absolute inset-0 z-10" data-testid="board-smart-guides" aria-hidden="true">
        {snapPreview.guides.map((guide, index) => guide.axis === "x"
          ? <span key={`guide-${index}`} className="absolute inset-y-0 w-px bg-primary" style={{ left: guide.position * viewport.zoom + viewport.panX }} />
          : <span key={`guide-${index}`} className="absolute inset-x-0 h-px bg-primary" style={{ top: guide.position * viewport.zoom + viewport.panY }} />)}
        {snapPreview.measurements.map((measurement, index) => <span key={`measurement-${index}`} data-testid="board-spacing-measurement" className="absolute rounded-control bg-primary px-1 text-11 font-semibold text-primary-foreground" style={measurement.axis === "x" ? { left: ((measurement.from + measurement.to) / 2) * viewport.zoom + viewport.panX, top: 12 + index * 20 } : { left: 12 + index * 48, top: ((measurement.from + measurement.to) / 2) * viewport.zoom + viewport.panY }}>{Math.round(measurement.size)} px</span>)}
      </div> : null}
      <BoardA11yMirror objects={renderedObjects} selectedObjectIds={selectedObjectIds} onSelect={selectFromOutline} readOnly={readOnly} />
    </div>
  );
}
