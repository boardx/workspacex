"use client";
/**
 * 深度 S7（#3988）—— **演示模式**：把原型一页一页放给别人看。
 *
 * 在这之前，要给老板 / 投资人看一遍这套幻灯片，只能在编辑器里点页签翻——工具条、对话、图层全在旁边，
 * 画布还按编辑时的尺寸缩着。演示模式只有一件事：整屏放当前这一页，放大到铺满（编辑器里只缩不放，这里
 * 两头都可以），方向键 / 空格 / 点左右半屏翻页，右下角是页码，Esc 退出回到编辑器原来那一页。
 *
 * 能进真全屏就进（`requestFullscreen`）；浏览器不给（没有用户手势、iframe 里被禁）就铺满窗口，照样能用。
 * 用浏览器自己的方式退出全屏（它会吞掉那一下 Esc）同样退出演示——不留一个「不全屏的演示态」。
 *
 * 原型里连好的跳转照样能点（预览模式）：演示一个 App 的流程，点「下单」就该到下单页。
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DesignProject, PrototypeLink } from "@/lib/live-design-workbench";
import { CANVAS_LABEL_H as LABEL, PrototypeCanvas, rotated, type PrototypeDevicePreset } from "./prototype-canvas";

/** 页码与退出按钮占的那一条（像素）。 */
const BAR = 48;

export function PresentMode({
  project, startFrame, device, landscape, links, onExit,
}: {
  readonly project: DesignProject;
  readonly startFrame: number;
  readonly device: PrototypeDevicePreset;
  readonly landscape: boolean;
  readonly links: readonly (readonly PrototypeLink[])[];
  /** 退出时停在哪一页——编辑器回到那一页。 */
  readonly onExit: (frame: number) => void;
}) {
  const count = project.frames.length;
  const [frame, setFrame] = React.useState(() => Math.max(0, Math.min(startFrame, count - 1)));
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const frameRef = React.useRef(frame);
  const exitRef = React.useRef(onExit);
  React.useEffect(() => { frameRef.current = frame; exitRef.current = onExit; });

  const go = React.useCallback((delta: number) => setFrame((f) => Math.max(0, Math.min(count - 1, f + delta))), [count]);
  const exit = React.useCallback(() => {
    if (typeof document !== "undefined" && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    exitRef.current(frameRef.current);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); exit(); return; }
      // 焦点在按钮 / 输入框上时，空格是那个控件自己的（按下它、打一个空格），不翻页。
      const own = e.target instanceof HTMLElement && e.target.closest("button, input, textarea, select, [role=button]") !== null;
      if (e.key === " " && own) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { e.preventDefault(); setFrame(0); }
      else if (e.key === "End") { e.preventDefault(); setFrame(count - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, exit, count]);

  // 进全屏；浏览器用自己的方式退出全屏（吞掉 Esc）⇒ 演示也一起退。
  React.useEffect(() => {
    const el = stageRef.current;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === el) entered = true;
      else if (entered) exitRef.current(frameRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    if (el !== null && typeof el.requestFullscreen === "function") void el.requestFullscreen().catch(() => undefined);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  React.useLayoutEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const size = rotated(device, landscape);
  // 演示要**放大**：编辑器里的 `fitScale` 只缩不放，这里按屏幕铺满（留一圈边）。
  const scale = box.w > 0 && box.h > 0 ? Math.min((box.w - 48) / size.w, (box.h - BAR - 24) / (size.h + LABEL)) : 1;
  const root = project.prototype[frame] ?? null;

  return (
    <div
      ref={stageRef}
      role="dialog" aria-modal="true" aria-label={`演示：${project.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-black text-card-foreground"
      data-testid="design-present"
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* 点左右半屏翻页（鼠标 / 触屏都行）；页面里连好的跳转在画布自己身上，先于这里接住点击。 */}
        <button type="button" aria-hidden tabIndex={-1} onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/2 cursor-w-resize focus-visible:outline-none" />
        <button type="button" aria-hidden tabIndex={-1} onClick={() => go(1)} className="absolute inset-y-0 right-0 w-1/2 cursor-e-resize focus-visible:outline-none" />
        <div className="relative" style={{ width: size.w * scale, height: (size.h + LABEL) * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: size.w, height: size.h + LABEL }}>
            {root === null ? (
              <div className="flex h-full w-full items-center justify-center rounded-lg bg-card text-16 text-muted-foreground">
                「{project.frames[frame] ?? ""}」这一页还没画出来
              </div>
            ) : (
              <PrototypeCanvas
                label={project.frames[frame] ?? ""} root={root} device={device} landscape={landscape}
                accent={project.accent} tokens={project.tokens} theme={project.theme} wireframe={project.template === "wireframe"}
                frameIndex={frame} mode="preview" links={links[frame]}
                onNavigate={(to) => setFrame(Math.max(0, Math.min(count - 1, to)))}
              />
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 px-4" style={{ height: BAR }}>
        <button type="button" onClick={() => go(-1)} disabled={frame === 0} aria-label="上一页" className="rounded-control p-1.5 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:opacity-30">
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        <span className="min-w-12 text-center text-12 tabular-nums text-card-foreground" data-testid="design-present-counter" aria-live="polite">
          {frame + 1} / {count}
        </span>
        <button type="button" onClick={() => go(1)} disabled={frame === count - 1} aria-label="下一页" className="rounded-control p-1.5 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:opacity-30">
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
        <button type="button" onClick={exit} className="ml-2 inline-flex items-center gap-1 rounded-control px-2 py-1 text-12 text-muted-foreground transition-colors duration-fast hover:bg-card/60" data-testid="design-present-exit">
          <X aria-hidden className="h-3.5 w-3.5" /> 退出（Esc）
        </button>
      </div>
    </div>
  );
}
