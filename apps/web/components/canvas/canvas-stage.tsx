"use client";
import * as React from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MOCK_SECTIONS, MOCK_STICKIES, MOCK_NODES, MOCK_EDGES,
  type CanvasSticky, type CanvasNode,
} from "@/lib/mock/projects";
import type { CanvasTool } from "./canvas-toolbar";

/**
 * 画布本体 —— **只是壳与静态呈现，不接 mermaid 渲染引擎**（那属于后续 feature）。
 * 分区框 / 便签 / 节点用绝对定位的 div 表现，连线用 currentColor 的 SVG 直线。
 * AI 落笔的便签与连线带 AVA 角标（D-10）。选中态用 ring 表达。
 *
 * 工具条不是死壳：`zoom` 真实缩放 stage；`＋便签`/`＋节点` 点空白处落一个 chip（本地乐观，
 * 不落库）；`删除` 点 chip 移除它。这样人类能看到工具「被接住了」——不做真实布局引擎。
 */
export function CanvasStage({ readOnly, tool, zoom }: { readOnly: boolean; tool: CanvasTool; zoom: number }) {
  const [stickies, setStickies] = React.useState<CanvasSticky[]>(MOCK_STICKIES);
  const [nodes, setNodes] = React.useState<CanvasNode[]>(MOCK_NODES);
  const [selected, setSelected] = React.useState<string | null>("n1");
  const localSeq = React.useRef(0);
  const surfaceRef = React.useRef<HTMLDivElement>(null);

  const isPlaceTool = tool === "sticky" || tool === "node";
  const canPlace = isPlaceTool && !readOnly;

  const placeAt = (clientX: number, clientY: number) => {
    const el = surfaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // rect 已含缩放，用百分比换算与 zoom 无关
    const x = Math.max(2, Math.min(90, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(4, Math.min(88, ((clientY - rect.top) / rect.height) * 100));
    localSeq.current += 1;
    const id = `local-${tool}-${localSeq.current}`;
    if (tool === "sticky") {
      setStickies((s) => [...s, { id, text: "新便签（点选可改标签）", sectionId: "sec-hmw", x, y, author: "你" }]);
    } else {
      setNodes((n) => [...n, { id, label: "新节点", x, y }]);
    }
    setSelected(id);
  };

  const removeChip = (id: string) => {
    setStickies((s) => s.filter((c) => c.id !== id));
    setNodes((n) => n.filter((c) => c.id !== id));
    if (selected === id) setSelected(null);
  };

  const onChipClick = (id: string) => {
    if (tool === "delete" && !readOnly) removeChip(id);
    else setSelected(id);
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-panel-alt" data-testid="canvas-stage">
      {/* mock 声明：明确告诉 sign-off 这不是真实布局引擎 */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <Badge tone="outline">静态占位 · 非 mermaid 渲染</Badge>
        <Badge tone={tool === "delete" ? "danger" : tool === "select" ? "neutral" : "primary"} data-testid="canvas-active-tool">
          当前工具：{TOOL_LABEL[tool]}
        </Badge>
      </div>

      <div
        ref={surfaceRef}
        data-testid="canvas-surface"
        onClick={(e) => canPlace && e.target === e.currentTarget && placeAt(e.clientX, e.clientY)}
        className={cn(
          "relative h-full min-h-96 w-full origin-top-left transition-transform duration-200",
          canPlace && "cursor-crosshair",
          tool === "delete" && !readOnly && "cursor-not-allowed",
        )}
        style={{ transform: `scale(${zoom})` }}
      >
        {/* 分区框（## 段落）*/}
        {MOCK_SECTIONS.map((s) => (
          <div
            key={s.id}
            data-testid={`canvas-section-${s.id}`}
            className="pointer-events-none absolute rounded-lg border border-dashed border-border bg-card/40"
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%` }}
          >
            <div className="flex items-center gap-1 px-2 py-1">
              <span className="text-11 font-medium text-muted-foreground">## {s.label}</span>
              {s.required && <span className="text-10 text-muted-foreground">必填</span>}
            </div>
          </div>
        ))}

        {/* 连线（SVG，用 currentColor 取 token 颜色）*/}
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-border" aria-hidden>
          {MOCK_EDGES.map((e) => {
            const from = nodes.find((n) => n.id === e.from);
            const to = nodes.find((n) => n.id === e.to);
            if (!from || !to) return null;
            return (
              <line
                key={e.id}
                x1={`${from.x + 6}%`} y1={`${from.y + 3}%`}
                x2={`${to.x}%`} y2={`${to.y + 3}%`}
                stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3"
              />
            );
          })}
        </svg>

        {/* 便签 */}
        {stickies.map((st) => (
          <StageChip
            key={st.id}
            testid={`canvas-sticky-${st.id}`}
            x={st.x} y={st.y}
            selected={selected === st.id}
            deletable={tool === "delete" && !readOnly}
            onSelect={() => onChipClick(st.id)}
            byAi={st.byAi}
            author={st.author}
            variant="sticky"
          >
            {st.text}
          </StageChip>
        ))}

        {/* 节点 */}
        {nodes.map((n) => (
          <StageChip
            key={n.id}
            testid={`canvas-node-${n.id}`}
            x={n.x} y={n.y}
            selected={selected === n.id}
            deletable={tool === "delete" && !readOnly}
            onSelect={() => onChipClick(n.id)}
            variant="node"
          >
            {n.label}
          </StageChip>
        ))}
      </div>

      {/* 交互口径提示（随工具变化）*/}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md border border-border-subtle bg-card/90 px-2 py-1">
        <p className="text-10 text-muted-foreground" data-testid="canvas-tool-hint">
          {readOnly
            ? "只读，写操作已禁用 · 可缩放查看"
            : canPlace
              ? `点画布空白处落一个${tool === "sticky" ? "便签" : "节点"} · 缩放 ${Math.round(zoom * 100)}%`
              : tool === "delete"
                ? "点任意便签 / 节点将其删除"
                : tool === "edge"
                  ? "连线：按住 shift 点两个节点（原型壳，不接渲染引擎）"
                  : `点选一个对象查看 / 改标签 · 缩放 ${Math.round(zoom * 100)}%`}
        </p>
      </div>
    </div>
  );
}

const TOOL_LABEL: Record<CanvasTool, string> = {
  select: "选择",
  sticky: "＋便签",
  node: "＋节点",
  edge: "连线",
  delete: "删除",
};

function StageChip({
  children, testid, x, y, selected, deletable, onSelect, byAi, author, variant,
}: {
  children: React.ReactNode;
  testid: string;
  x: number;
  y: number;
  selected: boolean;
  deletable: boolean;
  onSelect: () => void;
  byAi?: boolean;
  author?: string;
  variant: "sticky" | "node";
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      data-testid={testid}
      aria-pressed={selected}
      style={{ left: `${x}%`, top: `${y}%` }}
      className={cn(
        "absolute flex w-40 flex-col gap-1 rounded-md border p-2 text-left shadow-sm",
        "transition-all duration-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        variant === "sticky" ? "bg-warning/10 border-warning/30" : "bg-card border-border",
        selected && "ring-2 ring-primary",
        deletable && "hover:border-destructive hover:ring-2 hover:ring-destructive",
      )}
    >
      <span className="text-11 leading-snug text-card-foreground">{children}</span>
      <span className="flex items-center justify-between">
        {byAi ? (
          <Badge tone="ai" data-testid={`${testid}-ai`}>
            <Sparkles aria-hidden className="h-2.5 w-2.5" />
            AVA
          </Badge>
        ) : (
          <span className="text-9 text-muted-foreground">{author}</span>
        )}
      </span>
    </button>
  );
}
