"use client";

import * as React from "react";
import { Canvas, Circle, Group, Point, Rect, Textbox, type FabricObject, type TPointerEventInfo } from "fabric";
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
  data?: { boardObjectId?: string; adapterKind?: BoardFabricObject["kind"]; renderedRevision?: number };
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
  onObjectTransform: (objectId: string, geometry: BoardFabricGeometry) => void;
  onViewportChange: (viewport: BoardViewport, source: BoardViewportSource) => void;
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
    textAlign: "center" as const,
  };
  let projected: FabricObject;
  if (object.kind === "text") {
    projected = new Textbox(object.content.text, {
      width: object.geometry.width,
      fontFamily: textOptions.fontFamily,
      fontSize: object.style.fontSize ?? 24,
      fill: object.style.textColor,
    });
  } else if (object.kind === "ellipse") {
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
    selectable: !object.locked,
    evented: true,
  });
  projected.setControlsVisibility({ mtr: true });
  projected.setCoords();
  return projected;
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
    selectable: !readOnly && !object.locked,
    evented: !readOnly && !object.locked,
    data: { boardObjectId: object.id, adapterKind: object.kind, renderedRevision: object.revision },
  });
  projected.setCoords();
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

export function BoardFabricSurface({ objects, selectedObjectIds, readOnly, tool, viewport, onSelectionChange, onObjectTransform, onViewportChange, className }: BoardFabricSurfaceProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasElementRef = React.useRef<HTMLCanvasElement>(null);
  const canvasRef = React.useRef<Canvas | null>(null);
  const registryRef = React.useRef(new Map<string, TaggedFabricObject>());
  const canonicalRef = React.useRef(new Map<string, BoardFabricObject>());
  const selectedObjectIdsRef = React.useRef(selectedObjectIds);
  const renderFrameRef = React.useRef<number | null>(null);
  const callbacksRef = React.useRef({ onSelectionChange, onObjectTransform, onViewportChange });
  const stateRef = React.useRef({ readOnly, tool, viewport });
  callbacksRef.current = { onSelectionChange, onObjectTransform, onViewportChange };
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
      if (stateRef.current.readOnly || canonical.locked) {
        applyCanonicalObject(target, canonical, true);
        canvas.requestRenderAll();
        return;
      }
      callbacksRef.current.onObjectTransform(id, geometryFromFabric(target));
    };
    let panning = false;
    let last = { x: 0, y: 0 };
    const pointerDown = (event: TPointerEventInfo) => {
      if (stateRef.current.tool !== "hand") return;
      const pointer = event.e as MouseEvent;
      panning = true;
      last = { x: pointer.clientX, y: pointer.clientY };
    };
    const pointerMove = (event: TPointerEventInfo) => {
      if (!panning) return;
      const pointer = event.e as MouseEvent;
      const transform = [...canvas.viewportTransform] as typeof canvas.viewportTransform;
      transform[4] += pointer.clientX - last.x;
      transform[5] += pointer.clientY - last.y;
      last = { x: pointer.clientX, y: pointer.clientY };
      canvas.setViewportTransform(transform);
    };
    const pointerUp = () => {
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
    return () => {
      resizeObserver.disconnect();
      canvas.dispose();
      canvasRef.current = null;
      registry.clear();
      if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const incoming = new Map(objects.map((object) => [object.id, object]));
    canonicalRef.current = incoming;
    for (const [id, projected] of registryRef.current) {
      if (!incoming.has(id)) {
        canvas.remove(projected);
        registryRef.current.delete(id);
      }
    }
    const orderedObjects = [...objects].sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    for (const object of orderedObjects) {
      const current = registryRef.current.get(object.id);
      if (!current || current.data?.adapterKind !== object.kind) {
        if (current) canvas.remove(current);
        const created = createFabricObject(object);
        applyCanonicalObject(created, object, readOnly);
        registryRef.current.set(object.id, created);
        canvas.add(created);
      } else if (current.data?.renderedRevision !== object.revision || current.selectable === readOnly) {
        applyCanonicalObject(current, object, readOnly);
      }
    }
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
    canvas.defaultCursor = tool === "hand" ? "grab" : "default";
    for (const [id, projected] of registryRef.current) {
      const canonical = canonicalRef.current.get(id);
      projected.set({ selectable: !readOnly && tool === "select" && !canonical?.locked, evented: !readOnly && tool === "select" && !canonical?.locked });
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
    <div ref={hostRef} className={className ?? "relative h-full w-full overflow-hidden bg-muted/30"} data-testid="board-fabric-surface">
      <canvas ref={canvasElementRef} data-testid="board-fabric-canvas" aria-label="Fabric.js 白板画布" />
      <BoardA11yMirror objects={objects} selectedObjectIds={selectedObjectIds} onSelect={selectFromOutline} readOnly={readOnly} />
    </div>
  );
}
