"use client";
import * as React from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MOCK_SECTIONS, MOCK_STICKIES, MOCK_NODES, MOCK_EDGES,
} from "@/lib/mock/projects";

/**
 * 画布本体 —— **只是壳与静态呈现，不接 mermaid 渲染引擎**（那属于后续 feature）。
 * 分区框 / 便签 / 节点用绝对定位的 div 表现，连线用 currentColor 的 SVG 直线。
 * AI 落笔的便签与连线带 AVA 角标（D-10）。选中态用 ring 表达。
 */
export function CanvasStage({ readOnly }: { readOnly: boolean }) {
  const [selected, setSelected] = React.useState<string | null>("n1");

  return (
    <div className="relative flex-1 overflow-hidden bg-panel-alt" data-testid="canvas-stage">
      {/* mock 声明：明确告诉 sign-off 这不是真实布局引擎 */}
      <div className="pointer-events-none absolute left-2 top-2 z-10">
        <Badge tone="outline">静态占位 · 非 mermaid 渲染</Badge>
      </div>

      <div className="relative h-full min-h-96 w-full">
        {/* 分区框（## 段落）*/}
        {MOCK_SECTIONS.map((s) => (
          <div
            key={s.id}
            data-testid={`canvas-section-${s.id}`}
            className="absolute rounded-lg border border-dashed border-border bg-card/40"
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
            const from = MOCK_NODES.find((n) => n.id === e.from);
            const to = MOCK_NODES.find((n) => n.id === e.to);
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
        {MOCK_STICKIES.map((st) => (
          <StageChip
            key={st.id}
            testid={`canvas-sticky-${st.id}`}
            x={st.x} y={st.y}
            selected={selected === st.id}
            onSelect={() => setSelected(st.id)}
            byAi={st.byAi}
            author={st.author}
            variant="sticky"
          >
            {st.text}
          </StageChip>
        ))}

        {/* 节点 */}
        {MOCK_NODES.map((n) => (
          <StageChip
            key={n.id}
            testid={`canvas-node-${n.id}`}
            x={n.x} y={n.y}
            selected={selected === n.id}
            onSelect={() => setSelected(n.id)}
            variant="node"
          >
            {n.label}
          </StageChip>
        ))}
      </div>

      {/* 交互口径提示（原型固定文案）*/}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md border border-border-subtle bg-card/90 px-2 py-1">
        <p className="text-10 text-muted-foreground">
          滚轮缩放 · alt 拖拽平移 · 拖节点连线按边界锚点重算{readOnly && " · 只读，写操作已禁用"}
        </p>
      </div>
    </div>
  );
}

function StageChip({
  children, testid, x, y, selected, onSelect, byAi, author, variant,
}: {
  children: React.ReactNode;
  testid: string;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  byAi?: boolean;
  author?: string;
  variant: "sticky" | "node";
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testid}
      aria-pressed={selected}
      style={{ left: `${x}%`, top: `${y}%` }}
      className={cn(
        "absolute flex w-40 flex-col gap-1 rounded-md border p-2 text-left shadow-sm",
        "transition-all duration-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        variant === "sticky" ? "bg-warning/10 border-warning/30" : "bg-card border-border",
        selected && "ring-2 ring-primary",
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
