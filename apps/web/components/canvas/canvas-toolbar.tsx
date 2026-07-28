"use client";
import {
  MousePointer2, StickyNote, Square, Spline, Trash2, Code2, Plus, Minus, Maximize,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CanvasTool = "select" | "sticky" | "node" | "edge" | "delete";

const TOOLS: { key: CanvasTool; label: string; icon: LucideIcon; write: boolean }[] = [
  { key: "select", label: "选择", icon: MousePointer2, write: false },
  { key: "sticky", label: "＋便签", icon: StickyNote, write: true },
  { key: "node", label: "＋节点", icon: Square, write: true },
  { key: "edge", label: "连线", icon: Spline, write: true },
  { key: "delete", label: "删除", icon: Trash2, write: true },
];

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

/**
 * 画布工具条（原型四节中栏）：`选择 ＋便签 ＋节点 连线 删除 源码 | ＋ − ⤢`
 * `源码` 是**视图切换**（画布 ⇄ 源码），承载 D-08 数据链的「可查看可手改」。
 * 缩放 ＋/−/⤢ 真实改动 stage 的 scale（受 ZOOM_MIN/MAX 夹取，到边界显式禁用）。
 * readOnly（观察者 / 只读别组画布，A2）时写工具全部禁用——禁用态走 token，不用 opacity。
 */
export function CanvasToolbar({
  tool, onToolChange, mode, onModeChange, readOnly,
  zoom, onZoomIn, onZoomOut, onZoomFit,
}: {
  tool: CanvasTool;
  onToolChange: (t: CanvasTool) => void;
  mode: "canvas" | "source";
  onModeChange: (m: "canvas" | "source") => void;
  readOnly: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}) {
  const zoomDisabled = mode === "source";
  return (
    <div
      data-testid="canvas-toolbar"
      className="flex items-center gap-1 border-b border-border bg-card px-2 py-1.5"
    >
      {TOOLS.map((t) => (
        <Button
          key={t.key}
          variant={tool === t.key && mode === "canvas" ? "secondary" : "ghost"}
          size="sm"
          disabled={mode === "source" || (readOnly && t.write)}
          onClick={() => onToolChange(t.key)}
          data-testid={`canvas-tool-${t.key}`}
          className={cn(t.key === "delete" && "text-destructive")}
        >
          <t.icon aria-hidden className="h-3.5 w-3.5" />
          {t.label}
        </Button>
      ))}

      <div className="mx-1 h-4 w-px bg-border" aria-hidden />

      <Button
        variant={mode === "source" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onModeChange(mode === "source" ? "canvas" : "source")}
        data-testid="canvas-tool-source"
      >
        <Code2 aria-hidden className="h-3.5 w-3.5" />
        源码
      </Button>

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="放大"
          disabled={zoomDisabled || zoom >= ZOOM_MAX}
          title={zoomDisabled ? "源码视图不支持缩放" : zoom >= ZOOM_MAX ? "已到最大缩放" : undefined}
          onClick={onZoomIn}
          data-testid="canvas-zoom-in"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <span className="w-10 text-center font-mono text-10 tabular-nums text-muted-foreground" data-testid="canvas-zoom-level">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="缩小"
          disabled={zoomDisabled || zoom <= ZOOM_MIN}
          title={zoomDisabled ? "源码视图不支持缩放" : zoom <= ZOOM_MIN ? "已到最小缩放" : undefined}
          onClick={onZoomOut}
          data-testid="canvas-zoom-out"
        >
          <Minus aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="适应画布"
          disabled={zoomDisabled}
          title={zoomDisabled ? "源码视图不支持缩放" : "适应画布（回到 100%）"}
          onClick={onZoomFit}
          data-testid="canvas-zoom-fit"
        >
          <Maximize aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
