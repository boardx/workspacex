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

/**
 * 画布工具条（原型四节中栏）：`选择 ＋便签 ＋节点 连线 删除 源码 | ＋ − ⤢`
 * `源码` 是**视图切换**（画布 ⇄ 源码），承载 D-08 数据链的「可查看可手改」。
 * readOnly（观察者 / 只读别组画布，A2）时写工具全部禁用——禁用态走 token，不用 opacity。
 */
export function CanvasToolbar({
  tool, onToolChange, mode, onModeChange, readOnly,
}: {
  tool: CanvasTool;
  onToolChange: (t: CanvasTool) => void;
  mode: "canvas" | "source";
  onModeChange: (m: "canvas" | "source") => void;
  readOnly: boolean;
}) {
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
        <Button variant="ghost" size="icon" aria-label="放大" data-testid="canvas-zoom-in">
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="缩小" data-testid="canvas-zoom-out">
          <Minus aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="适应画布" data-testid="canvas-zoom-fit">
          <Maximize aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
