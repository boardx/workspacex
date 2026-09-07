"use client";
/**
 * 迭代 4 —— 多画板画布（Claude Design 式）：所有页并排铺在一块可平移/缩放的画板上。
 *
 * 交互：滚轮平移、Ctrl/⌘ + 滚轮缩放（以指针为中心）、空白处拖拽平移、右下角 −/＋/1:1/适应 按钮，
 * 键盘 −/＝/0。点一块画板的标题 ⇒ 聚焦该页（父组件的 `frame`）。选中态与单页视图共用同一个
 * `selectedId`，只在它所在的页高亮。
 *
 * 变换只用一层 `transform: translate(x,y) scale(k)`（inline style，不是 Tailwind 任意值——`lint-design`
 * U5b 拦的是间距字面量，动态变换本来就不该写成 class）。没有惯性、没有橡皮筋，够用且可预测。
 */
import * as React from "react";
import { Minus, Plus, Maximize2, Scan } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrototypeCanvas, DEVICE_SIZE, type PrototypeDevice } from "./prototype-canvas";
import type { PrototypeNode } from "@/lib/live-design-workbench";

const MIN = 0.25;
const MAX = 2.5;
const STEP = 1.2;
const GAP = 48;

const clamp = (k: number): number => Math.min(MAX, Math.max(MIN, k));

export function PrototypeBoard({
  frames, prototype, activeFrame, onFocusFrame, selectedId, onSelect, device = "phone",
}: {
  frames: readonly string[];
  prototype: readonly PrototypeNode[];
  activeFrame: number;
  onFocusFrame: (index: number) => void;
  selectedId: string | null;
  onSelect: ((id: string | null) => void) | null;
  device?: PrototypeDevice;
}) {
  // 每块画板占位宽高（与 `PrototypeCanvas` 的设备尺寸一致，+ 标题行），用于「适应」的估算。
  const BOARD_W = DEVICE_SIZE[device].w;
  const BOARD_H = DEVICE_SIZE[device].h + 30;
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ x: GAP, y: GAP / 2, k: 1 });
  const drag = React.useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const fit = React.useCallback(() => {
    const el = viewportRef.current;
    if (el === null) return;
    // 用真实渲染尺寸（offsetWidth/Height 不受 transform 影响）；拿不到（jsdom）再按设备尺寸估。
    const stage = stageRef.current;
    const contentW = stage !== null && stage.offsetWidth > 0 ? stage.offsetWidth : frames.length * BOARD_W + Math.max(0, frames.length - 1) * GAP;
    const contentH = stage !== null && stage.offsetHeight > 0 ? stage.offsetHeight : BOARD_H;
    // 「适应」允许低于手动缩放下限：20 页的画板本来就得缩到 25% 以下才装得下，但不小于 5%、不放大超过 1。
    const k = Math.max(0.05, Math.min((el.clientWidth - GAP * 2) / contentW, (el.clientHeight - GAP) / contentH, 1));
    setView({ x: Math.max(GAP, (el.clientWidth - contentW * k) / 2), y: Math.max(GAP / 2, (el.clientHeight - contentH * k) / 2), k });
  }, [frames.length, BOARD_W, BOARD_H]);

  // 首次与页数变化时适应一次；jsdom 里 clientWidth 为 0，fit 会把 k 夹到 MIN——测试不依赖具体值。
  React.useEffect(() => { fit(); }, [fit]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const k = clamp(v.k * factor);
      if (cx === undefined || cy === undefined) return { ...v, k };
      // 以指针为中心：指针下的内容点保持不动。
      const r = k / v.k;
      return { x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r, k };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0));
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // 点节点 / 画板标题 / 缩放工具条（任何可交互控件）都不是拖画板——否则 pointer capture 会吃掉按钮的 click。
    if ((e.target as HTMLElement).closest("[data-node-id],[data-board-title],[data-board-controls],button,a,input,select,textarea") !== null) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); // jsdom 没有这个方法；浏览器里有
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d === null) return;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
  };
  const onPointerUp = () => { drag.current = null; };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomAt(STEP); }
    else if (e.key === "-") { e.preventDefault(); zoomAt(1 / STEP); }
    else if (e.key === "0") { e.preventDefault(); setView((v) => ({ ...v, k: 1 })); }
  };

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full touch-none overflow-hidden bg-background [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      data-testid="design-detail-board"
      data-allow-x-scroll="画板需平移缩放；transform 由 pointer/wheel 驱动"
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect?.(null); }}
    >
      <div
        ref={stageRef}
        className="absolute left-0 top-0 flex origin-top-left items-start"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, gap: GAP }}
        data-testid="design-detail-board-stage"
      >
        {frames.map((label, i) => (
          <div key={`${i}-${label}`} className="flex flex-col gap-1.5" data-testid={`design-detail-board-frame-${i}`}>
            <button
              type="button"
              data-board-title
              onClick={() => onFocusFrame(i)}
              className={cn(
                "self-start rounded-control px-1.5 py-0.5 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                i === activeFrame ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-card",
              )}
            >
              {i + 1} · {label}
            </button>
            <div className={cn("rounded-container transition-shadow duration-fast", i === activeFrame && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background")}>
              <PrototypeCanvas
                label={label}
                root={prototype[i] ?? null}
                selectedId={selectedId}
                onSelect={onSelect === null ? null : (id) => { onFocusFrame(i); onSelect(id); }}
                device={device}
                frameIndex={i}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-card border border-border bg-card p-0.5 text-11 shadow-lg" data-testid="design-detail-board-zoom" data-board-controls>
        <button type="button" aria-label="缩小" onClick={() => zoomAt(1 / STEP)} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-out"><Minus aria-hidden className="h-3.5 w-3.5" /></button>
        <span className="min-w-10 text-center font-mono text-10 text-muted-foreground" data-testid="design-detail-zoom-level">{Math.round(view.k * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => zoomAt(STEP)} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-in"><Plus aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label="实际大小" onClick={() => setView((v) => ({ ...v, k: 1 }))} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-reset"><Scan aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label="适应画板" onClick={fit} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-fit"><Maximize2 aria-hidden className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
