"use client";

import { Hand, MousePointer2, StickyNote, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StickyVariant, TextStylePreset } from "@repo/whiteboard-core";

export type BoardCreationTool =
  | { kind: "sticky"; variant: StickyVariant }
  | { kind: "text"; preset: TextStylePreset }
  | null;

interface BoardBottomDockProps {
  activeTool: "select" | "hand";
  creationTool: BoardCreationTool;
  readOnly: boolean;
  onToolChange: (tool: "select" | "hand") => void;
  onCreationToolChange: (tool: BoardCreationTool) => void;
  onQuickCreate: (tool: Exclude<BoardCreationTool, null>) => void;
  onBulkSticky: () => void;
}

const STICKIES: Array<{ variant: StickyVariant; label: string; shape: string }> = [
  { variant: "square", label: "方形便利贴", shape: "h-8 w-8 rounded-md" },
  { variant: "rectangle", label: "长方形便利贴", shape: "h-7 w-11 rounded-md" },
  { variant: "circle", label: "圆形便利贴", shape: "h-8 w-8 rounded-full" },
];

const TEXT_PRESETS: Array<{ preset: TextStylePreset; label: string }> = [
  { preset: "title", label: "标题" },
  { preset: "heading", label: "一级标题" },
  { preset: "subheading", label: "二级标题" },
  { preset: "body", label: "正文" },
  { preset: "caption", label: "说明" },
];

export function BoardBottomDock({ activeTool, creationTool, readOnly, onToolChange, onCreationToolChange, onQuickCreate, onBulkSticky }: BoardBottomDockProps) {
  const stickyOpen = creationTool?.kind === "sticky";
  const textOpen = creationTool?.kind === "text";
  return (
    <nav aria-label="白板工具" className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
      {(stickyOpen || textOpen) && (
        <div data-testid="board-tool-picker" className="mb-2 flex min-w-64 items-center justify-center gap-2 rounded-2xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in">
          {stickyOpen ? STICKIES.map(({ variant, label, shape }) => (
            <button
              key={variant}
              type="button"
              draggable={!readOnly}
              data-testid={`board-sticky-${variant}`}
              aria-label={label}
              aria-pressed={creationTool.variant === variant}
              disabled={readOnly}
              onClick={() => onCreationToolChange({ kind: "sticky", variant })}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-workspacex-board-tool", JSON.stringify({ kind: "sticky", variant }));
              }}
              className={cn("flex min-h-12 min-w-14 items-center justify-center rounded-xl border transition duration-fast hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", creationTool.variant === variant ? "border-primary bg-primary/10" : "border-transparent")}
            >
              <span aria-hidden="true" className={cn("block bg-warning-tint shadow-sm", shape)} />
            </button>
          )) : TEXT_PRESETS.map(({ preset, label }) => (
            <button
              key={preset}
              type="button"
              data-testid={`board-text-${preset}`}
              aria-pressed={creationTool.preset === preset}
              disabled={readOnly}
              onClick={() => onCreationToolChange({ kind: "text", preset })}
              className={cn("min-h-11 rounded-xl px-3 text-13 transition duration-fast hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", creationTool.preset === preset && "bg-primary text-primary-foreground")}
            >{label}</button>
          ))}
          {stickyOpen && <Button data-testid="board-bulk-open" variant="ghost" onClick={onBulkSticky} disabled={readOnly}>批量</Button>}
        </div>
      )}
      <div className="flex items-end gap-1 rounded-2xl border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur">
        <DockButton testId="board-tool-select" label="选择" shortcut="V" pressed={activeTool === "select" && !creationTool} onClick={() => { onCreationToolChange(null); onToolChange("select"); }}><MousePointer2 className="h-5 w-5" /></DockButton>
        <DockButton testId="board-tool-hand" label="移动画布" shortcut="H" pressed={activeTool === "hand"} onClick={() => { onCreationToolChange(null); onToolChange("hand"); }}><Hand className="h-5 w-5" /></DockButton>
        <span aria-hidden="true" className="mx-1 h-10 w-px bg-border" />
        <DockButton testId="board-add-sticky" label="便利贴" shortcut="N" pressed={stickyOpen} disabled={readOnly} onClick={() => { const next = { kind: "sticky", variant: stickyOpen ? creationTool.variant : "square" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><StickyNote className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-text" label="文字" shortcut="T" pressed={textOpen} disabled={readOnly} onClick={() => { const next = { kind: "text", preset: textOpen ? creationTool.preset : "body" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><Type className="h-5 w-5" /></DockButton>
      </div>
    </nav>
  );
}

function DockButton({ testId, label, shortcut, pressed, disabled, onClick, children }: { testId?: string; label: string; shortcut: string; pressed: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" data-testid={testId} title={`${label} (${shortcut})`} aria-label={`${label}，快捷键 ${shortcut}`} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn("group flex min-h-12 min-w-14 flex-col items-center justify-center rounded-xl px-2 text-11 transition duration-fast hover:-translate-y-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", pressed && "bg-foreground text-background shadow-md")}>
    <span className="transition-transform group-hover:scale-110">{children}</span><span className="mt-0.5">{label}</span>
  </button>;
}
