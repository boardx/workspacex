"use client";

import * as React from "react";
import { Canvas, Circle, FabricImage, Group, Path, Point, Rect, Textbox, type FabricObject, type TPointerEventInfo } from "fabric";
import { drawingEraserLayers } from "@repo/whiteboard-core";
import { BoardA11yMirror } from "./board-a11y-mirror";
import {
  clampBoardZoom,
  type BoardFabricGeometry,
  type BoardFabricObject,
  type BoardFabricTool,
  type BoardSelectionSource,
  type BoardViewport,
  type BoardViewportSource,
} from "./board-fabric-object";

type TaggedFabricObject = FabricObject & {
  data?: { boardObjectId?: string; adapterKind?: BoardFabricObject["kind"]; renderedRevision?: number; projectionFailure?: boolean };
};

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
  onViewportChange: (viewport: BoardViewport, source: BoardViewportSource) => void;
  onCanvasClick?: (point: { x: number; y: number }) => void;
  onCanvasDoubleClick?: (point: { x: number; y: number }) => void;
  onObjectDoubleClick?: (objectId: string) => void;
  onToolDrop?: (point: { x: number; y: number }, payload: string) => void;
  onDrawingComplete?: (input: { tool: "pen" | "marker" | "highlighter" | "eraser"; points: Array<{ x: number; y: number; pressure: number }> }) => void;
  className?: string;
}

function createFabricObject(object: BoardFabricObject): TaggedFabricObject {
  const textOptions = {
    width: Math.max(24, object.geometry.width - 32),
    fontFamily: "Noto Sans SC, sans-serif",
    fontSize: object.style.fontSize ?? 20,
    fill: object.style.textColor,
    originX: "center" as const,
    originY: "center" as const,
    textAlign: object.style.alignment ?? "center" as const,
  };
  let projected: FabricObject;
  if (object.kind === "drawing" && object.boardContent?.type === "drawing") {
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
      fontFamily: textOptions.fontFamily,
      fontSize: object.style.fontSize ?? 24,
      fill: object.style.textColor,
    });
  } else if (object.kind === "ellipse" || object.sticky?.variant === "circle") {
    projected = new Group([
      new Circle({ radius: 50, scaleX: object.geometry.width / 100, scaleY: object.geometry.height / 100, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0, originX: "center", originY: "center" }),
      new Textbox(object.content.text, textOptions),
    ]);
  } else {
    projected = new Group([
      new Rect({ width: object.geometry.width, height: object.geometry.height, rx: object.kind === "sticky" ? 6 : 12, ry: object.kind === "sticky" ? 6 : 12, fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0, originX: "center", originY: "center" }),
      new Textbox(object.content.text, textOptions),
    ]);
  }
  projected.set({
    left: object.geometry.x,
    top: object.geometry.y,
    angle: object.geometry.rotation,
    data: { boardObjectId: object.id, adapterKind: object.kind, renderedRevision: object.revision },
    selectable: !object.locked && object.kind !== "placeholder",
    evented: !object.locked && object.kind !== "placeholder",
  });
  projected.setControlsVisibility({ mtr: true });
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

function applyCanonicalObject(projected: TaggedFabricObject, object: BoardFabricObject, readOnly: boolean): void {
  if (object.kind === "text") {
    projected.set({ text: object.content.text, fill: object.style.textColor, fontSize: object.style.fontSize ?? 24 });
  } else if ("getObjects" in projected && typeof projected.getObjects === "function") {
    const [shape, label] = projected.getObjects();
    shape?.set({ fill: object.style.fill, stroke: object.style.stroke, strokeWidth: object.style.strokeWidth ?? 0 });
    label?.set({ text: object.content.text, fill: object.style.textColor, fontSize: object.style.fontSize ?? 20 });
  }
  const naturalWidth = projected.width || object.geometry.width;
  const naturalHeight = projected.height || object.geometry.height;
  projected.set({
    left: object.geometry.x,
    top: object.geometry.y,
    angle: object.geometry.rotation,
    scaleX: object.geometry.width / naturalWidth,
    scaleY: object.geometry.height / naturalHeight,
    selectable: !readOnly && !object.locked && object.kind !== "placeholder",
    evented: !readOnly && !object.locked && object.kind !== "placeholder",
    data: { boardObjectId: object.id, adapterKind: object.kind, renderedRevision: object.revision },
  });
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

function geometryFromFabric(projected: TaggedFabricObject): BoardFabricGeometry {
  return {
    x: Math.round(projected.left),
    y: Math.round(projected.top),
    width: Math.max(1, Math.round((projected.width || 1) * projected.scaleX)),
    height: Math.max(1, Math.round((projected.height || 1) * projected.scaleY)),
    rotation: Math.round(projected.angle ?? 0),
  };
}

export function BoardFabricSurface({ objects, selectedObjectIds, readOnly, tool, viewport, onSelectionChange, onObjectTransform, onViewportChange, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop, onDrawingComplete, className }: BoardFabricSurfaceProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasElementRef = React.useRef<HTMLCanvasElement>(null);
  const canvasRef = React.useRef<Canvas | null>(null);
  const registryRef = React.useRef(new Map<string, TaggedFabricObject>());
  const canonicalRef = React.useRef(new Map<string, BoardFabricObject>());
  const renderedRef = React.useRef(new Map<string, BoardFabricObject>());
  const [renderedObjects, setRenderedObjects] = React.useState<readonly BoardFabricObject[]>(objects);
  const selectedObjectIdsRef = React.useRef(selectedObjectIds);
  const renderFrameRef = React.useRef<number | null>(null);
  const callbacksRef = React.useRef({ onSelectionChange, onObjectTransform, onViewportChange, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop, onDrawingComplete });
  const stateRef = React.useRef({ readOnly, tool, viewport });
  callbacksRef.current = { onSelectionChange, onObjectTransform, onViewportChange, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop, onDrawingComplete };
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
    const canvas = new Canvas(element, { selection: !stateRef.current.readOnly, preserveObjectStacking: true });
    canvasRef.current = canvas;
    const resize = () => {
      canvas.setDimensions({ width: host.clientWidth || 1200, height: host.clientHeight || 720 });
      canvas.requestRenderAll();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const selectionChanged = () => {
      const active = canvas.getActiveObject() as TaggedFabricObject | undefined;
      const id = active?.data?.boardObjectId;
      callbacksRef.current.onSelectionChange(id ? [id] : [], "canvas");
    };
    const transformCompleted = (event: { target?: FabricObject }) => {
      const target = event.target as TaggedFabricObject | undefined;
      const id = target?.data?.boardObjectId;
      if (!target || !id) return;
      const canonical = canonicalRef.current.get(id);
      if (!canonical) return;
      if (stateRef.current.readOnly || canonical.locked || canonical.kind === "placeholder") {
        applyCanonicalObject(target, canonical, true);
        canvas.requestRenderAll();
        return;
      }
      const restoreCanonicalGeometry = () => {
        // A delayed result must never mutate a replacement projection. When the
        // object still exists, restore the latest canonical revision so remote
        // updates that arrived while the command was pending are preserved.
        if (registryRef.current.get(id) !== target) return;
        const latestCanonical = canonicalRef.current.get(id);
        if (!latestCanonical) return;
        applyCanonicalObject(target, latestCanonical, stateRef.current.readOnly);
        canvas.requestRenderAll();
      };
      try {
        const accepted = callbacksRef.current.onObjectTransform(id, geometryFromFabric(target));
        if (typeof accepted === "boolean") {
          if (!accepted) restoreCanonicalGeometry();
          return;
        }
        void accepted.then((resolved) => {
          if (!resolved) restoreCanonicalGeometry();
        }, restoreCanonicalGeometry);
      } catch {
        restoreCanonicalGeometry();
      }
    };
    let panning = false;
    let last = { x: 0, y: 0 };
    let drawing: Array<{ x: number; y: number; pressure: number }> | null = null;
    const pressureOf = (event: TPointerEventInfo) => typeof (event.e as PointerEvent).pressure === "number" ? (event.e as PointerEvent).pressure : .5;
    const pointerDown = (event: TPointerEventInfo) => {
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
      if (drawing) { const pointer = canvas.getScenePoint(event.e); drawing.push({ x: pointer.x, y: pointer.y, pressure: pressureOf(event) }); return; }
      if (!panning) return;
      const pointer = event.e as MouseEvent;
      const transform = [...canvas.viewportTransform] as typeof canvas.viewportTransform;
      transform[4] += pointer.clientX - last.x;
      transform[5] += pointer.clientY - last.y;
      last = { x: pointer.clientX, y: pointer.clientY };
      canvas.setViewportTransform(transform);
    };
    const pointerUp = () => {
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
    canvas.on("mouse:down", pointerDown);
    canvas.on("mouse:move", pointerMove);
    canvas.on("mouse:up", pointerUp);
    canvas.on("mouse:wheel", wheel);
    canvas.on("mouse:dblclick", doubleClick);
    return () => {
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
    const orderedObjects = [...objects].sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const nextRendered: BoardFabricObject[] = [];
    for (const object of orderedObjects) {
      const current = registryRef.current.get(object.id);
      const failedAtThisRevision = current?.data?.projectionFailure === true && current.data.renderedRevision === object.revision;
      let rendered = failedAtThisRevision ? renderedRef.current.get(object.id) ?? projectionFailureObject(object) : object;
      const richProjectionChanged = Boolean(current && current.data?.renderedRevision !== object.revision && ["shape", "drawing", "image", "card"].includes(object.kind));
      if (!current || (!failedAtThisRevision && (current.data?.adapterKind !== object.kind || richProjectionChanged))) {
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
      if (projected) canvas.moveObjectTo(projected, index);
    });
    scheduleRender();
  }, [objects, readOnly, scheduleRender]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = tool === "select" && !readOnly;
    canvas.defaultCursor = tool === "hand" ? "grab" : tool.startsWith("draw-") ? "crosshair" : tool === "erase" ? "cell" : "default";
    for (const [id, projected] of registryRef.current) {
      const canonical = canonicalRef.current.get(id);
      const editable = !readOnly && tool === "select" && !canonical?.locked && canonical?.kind !== "placeholder";
      projected.set({ selectable: editable, evented: editable });
    }
    canvas.requestRenderAll();
  }, [readOnly, tool]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const primary = selectedObjectIds[0] ? registryRef.current.get(selectedObjectIds[0]) : undefined;
    if (primary) canvas.setActiveObject(primary);
    else canvas.discardActiveObject();
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
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-workspacex-board-tool")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(event) => {
        const payload = event.dataTransfer.getData("application/x-workspacex-board-tool");
        if (!payload || readOnly) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        callbacksRef.current.onToolDrop?.({ x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }, payload);
      }}>
      <canvas ref={canvasElementRef} data-testid="board-fabric-canvas" aria-label="Fabric.js 白板画布" />
      <BoardA11yMirror objects={renderedObjects} selectedObjectIds={selectedObjectIds} onSelect={selectFromOutline} readOnly={readOnly} />
    </div>
  );
}
