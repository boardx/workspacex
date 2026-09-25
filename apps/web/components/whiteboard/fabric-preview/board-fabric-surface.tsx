"use client";

import * as React from "react";
import {
  Canvas,
  Circle,
  Group,
  Point,
  Rect,
  Shadow,
  Textbox,
  type FabricObject,
  type TPointerEventInfo,
} from "fabric";

export type BoardPreviewTool = "select" | "hand" | "sticky" | "text" | "rectangle" | "ellipse";

export interface PreviewBoardObject {
  id: string;
  kind: Exclude<BoardPreviewTool, "select" | "hand">;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

const INITIAL_OBJECTS: readonly PreviewBoardObject[] = [
  { id: "sticky-observe", kind: "sticky", label: "每个人先写下一个观察", x: 170, y: 180, width: 220, height: 180, fill: "#F8D76E" },
  { id: "sticky-group", kind: "sticky", label: "把相似想法放在一起", x: 510, y: 250, width: 220, height: 180, fill: "#BBDDF8" },
  { id: "shape-decision", kind: "rectangle", label: "今天要确认的决定", x: 860, y: 190, width: 260, height: 150, fill: "#D9CDF7" },
  { id: "shape-next", kind: "ellipse", label: "下一步", x: 930, y: 470, width: 220, height: 140, fill: "#CDEBD7" },
  { id: "text-prompt", kind: "text", label: "团队创意工作坊", x: 180, y: 70, width: 420, height: 50, fill: "#252525" },
] as const;

interface BoardFabricSurfaceProps {
  tool: BoardPreviewTool;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (object: PreviewBoardObject | null) => void;
  onObjectsChange: (objects: readonly PreviewBoardObject[]) => void;
  fitSignal: number;
  selectionRequest: { id: string; nonce: number } | null;
}

type TaggedObject = FabricObject & { data?: { boardObjectId?: string; kind?: PreviewBoardObject["kind"] } };

function toFabricObject(item: PreviewBoardObject): FabricObject {
  const common = { left: item.x, top: item.y, fill: item.fill };
  if (item.kind === "text") {
    return new Textbox(item.label, {
      ...common,
      width: item.width,
      fontFamily: "Noto Sans SC, sans-serif",
      fontSize: 30,
      fontWeight: 650,
      editable: true,
    });
  }
  if (item.kind === "ellipse") {
    return new Group([
      new Circle({ radius: Math.min(item.width, item.height) / 2, fill: item.fill, originX: "center", originY: "center" }),
      new Textbox(item.label, { width: item.width - 48, fontFamily: "Noto Sans SC, sans-serif", fontSize: 22, textAlign: "center", originX: "center", originY: "center", fill: "#21372A" }),
    ], { ...common, fill: undefined });
  }
  const radius = item.kind === "sticky" ? 6 : 18;
  return new Group([
    new Rect({ width: item.width, height: item.height, rx: radius, ry: radius, fill: item.fill, stroke: item.kind === "sticky" ? "#D0AD3D" : "#8572B9", strokeWidth: 1.5, originX: "center", originY: "center", shadow: item.kind === "sticky" ? new Shadow({ color: "rgba(40,35,20,.14)", blur: 22, offsetY: 12 }) : undefined }),
    new Textbox(item.label, { width: item.width - 48, fontFamily: "Noto Sans SC, sans-serif", fontSize: 22, lineHeight: 1.35, originX: "center", originY: "center", fill: "#29261E" }),
  ], { ...common, fill: undefined });
}

function tagObject(object: FabricObject, item: PreviewBoardObject): TaggedObject {
  object.set({ data: { boardObjectId: item.id, kind: item.kind } });
  object.setControlsVisibility({ mt: true, mb: true, ml: true, mr: true, tl: true, tr: true, bl: true, br: true, mtr: true });
  return object;
}

function readObject(object: TaggedObject, fallback: PreviewBoardObject): PreviewBoardObject {
  return {
    ...fallback,
    x: Math.round(object.left),
    y: Math.round(object.top),
    width: Math.round((object.width ?? fallback.width) * object.scaleX),
    height: Math.round((object.height ?? fallback.height) * object.scaleY),
  };
}

export function BoardFabricSurface({ tool, zoom, onZoomChange, onSelectionChange, onObjectsChange, fitSignal, selectionRequest }: BoardFabricSurfaceProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const elementRef = React.useRef<HTMLCanvasElement>(null);
  const canvasRef = React.useRef<Canvas | null>(null);
  const toolRef = React.useRef(tool);
  const objectsRef = React.useRef<PreviewBoardObject[]>([...INITIAL_OBJECTS]);
  const sequenceRef = React.useRef(0);
  toolRef.current = tool;

  React.useEffect(() => {
    const host = hostRef.current;
    const element = elementRef.current;
    if (!host || !element) return;
    const canvas = new Canvas(element, { selection: true, preserveObjectStacking: true, fireRightClick: true });
    canvasRef.current = canvas;
    const addInitial = () => {
      for (const item of objectsRef.current) canvas.add(tagObject(toFabricObject(item), item));
      canvas.requestRenderAll();
      onObjectsChange(objectsRef.current);
    };
    const resize = () => {
      canvas.setDimensions({ width: host.clientWidth || 1200, height: host.clientHeight || 720 });
      canvas.requestRenderAll();
    };
    resize();
    addInitial();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const publishSelection = () => {
      const active = canvas.getActiveObject() as TaggedObject | undefined;
      const id = active?.data?.boardObjectId;
      onSelectionChange(objectsRef.current.find((entry) => entry.id === id) ?? null);
    };
    const publishGeometry = (event: { target?: FabricObject }) => {
      const target = event.target as TaggedObject | undefined;
      const id = target?.data?.boardObjectId;
      if (!target || !id) return;
      objectsRef.current = objectsRef.current.map((entry) => entry.id === id ? readObject(target, entry) : entry);
      onObjectsChange(objectsRef.current);
      publishSelection();
    };
    canvas.on("selection:created", publishSelection);
    canvas.on("selection:updated", publishSelection);
    canvas.on("selection:cleared", publishSelection);
    canvas.on("object:modified", publishGeometry);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (event: TPointerEventInfo) => {
      const pointerEvent = event.e as MouseEvent;
      if (toolRef.current === "hand") {
        dragging = true;
        lastX = pointerEvent.clientX;
        lastY = pointerEvent.clientY;
        canvas.selection = false;
        return;
      }
      if (toolRef.current === "select" || event.target) return;
      const point = canvas.getScenePoint(event.e);
      sequenceRef.current += 1;
      const kind = toolRef.current as PreviewBoardObject["kind"];
      const next: PreviewBoardObject = {
        id: `preview-${kind}-${sequenceRef.current}`,
        kind,
        label: kind === "sticky" ? "新的想法" : kind === "text" ? "输入文字" : kind === "rectangle" ? "主题" : "想法簇",
        x: point.x,
        y: point.y,
        width: kind === "text" ? 240 : 180,
        height: kind === "text" ? 48 : 140,
        fill: kind === "sticky" ? "#F8D76E" : kind === "text" ? "#252525" : kind === "rectangle" ? "#D9CDF7" : "#CDEBD7",
      };
      objectsRef.current = [...objectsRef.current, next];
      const created = tagObject(toFabricObject(next), next);
      canvas.add(created);
      canvas.setActiveObject(created);
      canvas.requestRenderAll();
      onObjectsChange(objectsRef.current);
      onSelectionChange(next);
    };
    const move = (event: TPointerEventInfo) => {
      if (!dragging) return;
      const pointerEvent = event.e as MouseEvent;
      const viewport = canvas.viewportTransform;
      viewport[4] += pointerEvent.clientX - lastX;
      viewport[5] += pointerEvent.clientY - lastY;
      lastX = pointerEvent.clientX;
      lastY = pointerEvent.clientY;
      canvas.setViewportTransform(viewport);
    };
    const up = () => { dragging = false; canvas.selection = toolRef.current === "select"; };
    const wheel = (event: TPointerEventInfo<WheelEvent>) => {
      event.e.preventDefault();
      event.e.stopPropagation();
      const next = Math.min(8, Math.max(0.05, canvas.getZoom() * Math.pow(0.998, event.e.deltaY)));
      canvas.zoomToPoint(new Point(event.e.offsetX, event.e.offsetY), next);
      onZoomChange(next);
    };
    canvas.on("mouse:down", down);
    canvas.on("mouse:move", move);
    canvas.on("mouse:up", up);
    canvas.on("mouse:wheel", wheel);

    return () => { observer.disconnect(); canvas.dispose(); canvasRef.current = null; };
  }, [onObjectsChange, onSelectionChange, onZoomChange]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = tool === "select";
    canvas.defaultCursor = tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
    for (const object of canvas.getObjects()) object.set({ selectable: tool === "select", evented: tool === "select" });
    canvas.requestRenderAll();
  }, [tool]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setZoom(Math.min(8, Math.max(0.05, zoom)));
    canvas.requestRenderAll();
  }, [zoom]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || fitSignal === 0 || canvas.getObjects().length === 0) return;
    const bounds = canvas.getObjects().map((object) => object.getBoundingRect());
    const left = Math.min(...bounds.map((value) => value.left));
    const top = Math.min(...bounds.map((value) => value.top));
    const right = Math.max(...bounds.map((value) => value.left + value.width));
    const bottom = Math.max(...bounds.map((value) => value.top + value.height));
    const next = Math.min(1.25, Math.max(0.05, Math.min((canvas.getWidth() - 96) / (right - left), (canvas.getHeight() - 96) / (bottom - top))));
    canvas.setViewportTransform([next, 0, 0, next, (canvas.getWidth() - (right - left) * next) / 2 - left * next, (canvas.getHeight() - (bottom - top) * next) / 2 - top * next]);
    onZoomChange(next);
    canvas.requestRenderAll();
  }, [fitSignal, onZoomChange]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectionRequest) return;
    const requested = canvas.getObjects().find((object) =>
      (object as TaggedObject).data?.boardObjectId === selectionRequest.id,
    );
    if (!requested) return;
    canvas.setActiveObject(requested);
    canvas.requestRenderAll();
  }, [selectionRequest]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden bg-muted/30" data-testid="board-fabric-stage">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]" />
      <canvas ref={elementRef} data-testid="board-fabric-canvas" aria-label="Fabric.js 白板画布" />
    </div>
  );
}
