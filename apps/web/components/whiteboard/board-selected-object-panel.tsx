"use client";

import { useRef, useState, type PointerEvent, type ReactNode, type KeyboardEvent, type CSSProperties, type Ref } from "react";
import { MoveDiagonal2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WhiteboardGeometry, WhiteboardObject } from "@repo/whiteboard-core";

const WIDTH_MIN = 300;
const WIDTH_MAX = 640;
const HEIGHT_MIN = 320;
const HEIGHT_MAX = 960;

interface BoardSelectedObjectPanelProps {
  title: string;
  typeLabel: string;
  object: WhiteboardObject;
  readOnly: boolean;
  onClose: () => void;
  onGeometryChange: (geometry: WhiteboardGeometry) => void;
  panelRef?: Ref<HTMLElement>;
  floatingStyle?: CSSProperties;
  children: ReactNode;
}

/** Resizable, scrollable inspector keeps selection controls in one predictable place. */
export function BoardSelectedObjectPanel({ title, typeLabel, object, readOnly, onClose, onGeometryChange, panelRef, floatingStyle, children }: BoardSelectedObjectPanelProps) {
  const [width, setWidth] = useState(368);
  const [height, setHeight] = useState(520);
  const maxWidth = Math.min(WIDTH_MAX, typeof window === "undefined" ? WIDTH_MAX : Math.max(1, window.innerWidth - 32));
  const minWidth = Math.min(WIDTH_MIN, maxWidth);
  const maxHeight = Math.min(HEIGHT_MAX, typeof window === "undefined" ? 720 : Math.max(1, Math.round(window.innerHeight * 0.8)));
  const minHeight = Math.min(HEIGHT_MIN, maxHeight);
  const responsiveFloatingStyle = typeof window !== "undefined" && window.innerWidth <= 640 ? undefined : floatingStyle;
  const drag = useRef<{ pointerX: number; pointerY: number; width: number; height: number; axis: "x" | "y" } | null>(null);
  const resizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, width, height, axis: "x" };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    if (drag.current.axis === "x") {
      setWidth(Math.max(minWidth, Math.min(maxWidth, drag.current.width + drag.current.pointerX - event.clientX)));
    } else {
      setHeight(Math.max(minHeight, Math.min(maxHeight, drag.current.height + event.clientY - drag.current.pointerY)));
    }
  };
  const resizeEnd = () => { drag.current = null; };
  const resizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setWidth((current) => Math.max(minWidth, Math.min(maxWidth, current + (event.key === "ArrowRight" ? 24 : -24))));
  };
  const dimensions: Array<[keyof WhiteboardGeometry, string]> = [["x", "X"], ["y", "Y"], ["width", "宽度"], ["height", "高度"], ["rotation", "旋转"]];
  const setGeometryField = (key: keyof WhiteboardGeometry, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const next = { ...object.geometry, [key]: key === "width" || key === "height" ? Math.max(24, value) : value };
    onGeometryChange(next);
  };

  return <aside ref={panelRef} data-testid="board-context-toolbar" data-board-selected-object-panel="true" aria-label={`${typeLabel}属性`} className="absolute right-4 top-16 z-40 flex h-[min(var(--board-inspector-height),80vh)] max-h-[80vh] w-[min(var(--board-inspector-width),calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-xl backdrop-blur max-sm:bottom-20 max-sm:left-4 max-sm:right-4 max-sm:top-auto max-sm:max-h-[72vh] max-sm:w-auto" style={{ "--board-inspector-width": `${width}px`, "--board-inspector-height": `${height}px`, ...responsiveFloatingStyle } as CSSProperties}>
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-3 py-2.5">
      <div className="min-w-0"><p className="text-11 font-medium uppercase tracking-wide text-muted-foreground">{typeLabel} · 属性</p><h2 className="truncate text-15 font-semibold">{title || "未命名对象"}</h2></div>
      <Button type="button" variant="ghost" size="icon" data-testid="board-inspector-close" aria-label="关闭对象属性" onClick={onClose}><X className="h-4 w-4" /></Button>
    </div>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-testid="board-inspector-scroll-content">
      <details data-testid="board-inspector-geometry" className="group rounded-xl border border-border bg-background/70">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2 text-12 font-semibold"><MoveDiagonal2 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />位置与尺寸</span><span className="text-11 text-muted-foreground">X {Math.round(object.geometry.x)} · Y {Math.round(object.geometry.y)}</span></summary>
        <div aria-label="位置与尺寸" className="grid grid-cols-2 gap-2 border-t border-border p-3">
        {dimensions.map(([key, label]) => <label key={key} className="grid gap-1 text-11 text-muted-foreground">{label}<Input data-testid={`board-inspector-geometry-${key}`} aria-label={label} type="number" step={key === "rotation" ? 1 : 8} disabled={readOnly} defaultValue={object.geometry[key]} key={`${object.id}:${key}:${object.geometry[key]}`} onBlur={(event) => setGeometryField(key, event.currentTarget.value)} className="h-9 text-13 text-foreground focus-visible:ring-2 focus-visible:ring-ring" /></label>)}
        </div>
      </details>
      <fieldset disabled={readOnly} className="min-w-0 space-y-4 disabled:text-muted-foreground"><legend className="sr-only">对象编辑属性</legend>{children}</fieldset>
    </div>
    <div role="separator" aria-label="调整属性面板宽度" aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)} tabIndex={0} data-testid="board-inspector-resize" onPointerDown={resizeStart} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} onLostPointerCapture={resizeEnd} onKeyDown={resizeKey} className="absolute bottom-2 left-0 top-16 z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center rounded-full bg-transparent transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="h-10 w-1 rounded-full bg-border" /></div>
    <div role="separator" aria-label="调整属性面板高度" aria-orientation="horizontal" aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={Math.round(height)} tabIndex={0} data-testid="board-inspector-resize-height" onPointerDown={(event) => { event.preventDefault(); drag.current = { pointerX: event.clientX, pointerY: event.clientY, width, height, axis: "y" }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} onLostPointerCapture={resizeEnd} onKeyDown={(event) => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); setHeight((current) => Math.max(minHeight, Math.min(maxHeight, current + (event.key === "ArrowDown" ? 24 : -24)))); }} className="absolute bottom-0 left-1/2 z-10 flex h-6 w-20 -translate-x-1/2 cursor-ns-resize touch-none items-center justify-center rounded-full bg-transparent transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="h-1 w-10 rounded-full bg-border" /></div>
  </aside>;
}
