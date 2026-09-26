"use client";

import * as React from "react";
import { Canvas, Circle, Group, Rect, Shadow, Textbox, type FabricObject } from "fabric";

export type AuthoringScene =
  | "default"
  | "continuous"
  | "composing"
  | "resize"
  | "contextual"
  | "link-failed"
  | "readonly"
  | "undo-conflict";

interface SurfaceObject {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly shape?: "square" | "rectangle" | "circle";
  readonly kind?: "sticky" | "text";
}

type TaggedGroup = Group & { data?: { boardObjectId: string; canonical: "mock-command-adapter" } };

const BASE: readonly SurfaceObject[] = [
  { id: "sticky-focus", text: "把用户的原话\n放在这里", x: 250, y: 190, width: 224, height: 196, fill: "hsl(48 88% 72%)" },
  { id: "sticky-context", text: "邀请工程与设计\n一起看证据", x: 650, y: 280, width: 224, height: 196, fill: "hsl(203 78% 82%)" },
  { id: "sticky-link", text: "竞品研究\nmiro.com/templates", x: 940, y: 160, width: 244, height: 170, fill: "hsl(264 58% 84%)", shape: "rectangle" },
  { id: "text-heading", text: "先看事实，再归纳机会", x: 310, y: 70, width: 430, height: 56, fill: "hsl(225 18% 18%)", kind: "text" },
];

function sceneObjects(scene: AuthoringScene): readonly SurfaceObject[] {
  if (scene === "continuous") {
    return Array.from({ length: 11 }, (_, index) => ({
      id: `sticky-series-${index + 1}`,
      text: index === 0 ? "先写观察" : `想法 ${index + 1}`,
      x: 150 + (index % 6) * 188,
      y: 150 + Math.floor(index / 6) * 190,
      width: 164,
      height: 164,
      fill: index % 3 === 0 ? "hsl(48 88% 72%)" : index % 3 === 1 ? "hsl(203 78% 82%)" : "hsl(264 58% 84%)",
    }));
  }
  if (scene === "resize") {
    return [
      { id: "sticky-normal", text: "Normal\n保持比例", x: 230, y: 180, width: 190, height: 190, fill: "hsl(48 88% 72%)" },
      { id: "sticky-free", text: "Free\n自由尺寸", x: 520, y: 200, width: 300, height: 150, fill: "hsl(203 78% 82%)", shape: "rectangle" },
      { id: "sticky-auto", text: "Auto-height\n长文本会按照内容自动增加高度，缩放画布不会改变对象的真实尺寸。", x: 930, y: 140, width: 240, height: 270, fill: "hsl(264 58% 84%)", shape: "rectangle" },
    ];
  }
  return BASE;
}

function makeObject(item: SurfaceObject): FabricObject {
  if (item.kind === "text") {
    const object = new Textbox(item.text, {
      left: item.x,
      top: item.y,
      width: item.width,
      fontFamily: "Noto Sans SC, sans-serif",
      fontSize: 30,
      fontWeight: 650,
      fill: item.fill,
      data: { boardObjectId: item.id, canonical: "mock-command-adapter" },
    });
    return object;
  }
  const text = new Textbox(item.text, {
    width: item.width - 40,
    fontFamily: "Noto Sans SC, sans-serif",
    fontSize: 20,
    fontWeight: 520,
    lineHeight: 1.35,
    textAlign: "left",
    fill: "hsl(225 18% 18%)",
    originX: "center",
    originY: "center",
  });
  const base = item.shape === "circle"
    ? new Circle({ radius: item.width / 2, fill: item.fill, originX: "center", originY: "center" })
    : new Rect({
        width: item.width,
        height: item.height,
        rx: item.shape === "rectangle" ? 12 : 5,
        ry: item.shape === "rectangle" ? 12 : 5,
        fill: item.fill,
        originX: "center",
        originY: "center",
        shadow: new Shadow({ color: "hsl(225 20% 20% / .16)", blur: 20, offsetY: 9 }),
      });
  const group = new Group([base, text], {
    left: item.x,
    top: item.y,
    selectable: true,
  }) as TaggedGroup;
  group.set({ data: { boardObjectId: item.id, canonical: "mock-command-adapter" } } as Partial<TaggedGroup>);
  if (item.id === "sticky-focus" || item.id === "sticky-auto") {
    group.set({ borderColor: "hsl(225 18% 18%)", cornerColor: "hsl(225 18% 18%)", cornerStyle: "circle" });
  }
  return group;
}

export function BoardObjectAuthoringSurface({ scene }: { readonly scene: AuthoringScene }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    const element = canvasRef.current;
    if (!host || !element) return;
    const canvas = new Canvas(element, { selection: scene !== "readonly", preserveObjectStacking: true });
    const objects = sceneObjects(scene).map(makeObject);
    canvas.add(...objects);
    for (const object of objects) object.set({ selectable: scene !== "readonly", evented: scene !== "readonly" });
    const selected = objects.find((object) => (object as TaggedGroup).data?.boardObjectId === (scene === "contextual" ? "text-heading" : scene === "resize" ? "sticky-auto" : "sticky-focus"));
    if (selected && scene !== "readonly" && scene !== "undo-conflict") canvas.setActiveObject(selected);
    const resize = () => {
      canvas.setDimensions({ width: host.clientWidth || 1280, height: host.clientHeight || 720 });
      canvas.requestRenderAll();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => { observer.disconnect(); canvas.dispose(); };
  }, [scene]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden bg-muted/30" data-testid="board-authoring-fabric-stage">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px]" />
      <canvas ref={canvasRef} data-testid="board-authoring-fabric-canvas" aria-label="Fabric.js 白板对象画布" />
    </div>
  );
}
