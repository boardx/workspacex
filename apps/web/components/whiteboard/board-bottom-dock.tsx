"use client";

import { useEffect, useRef, useState } from "react";
import { Brush, ChevronUp, Frame, Hand, ImagePlus, LayoutTemplate, MousePointer2, Network, Shapes, StickyNote, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectorType, PanelMode, StickyVariant, TextStylePreset } from "@repo/whiteboard-core";
import type { BoardDrawingTool, BoardShapeVariant, BoardStructuredKind } from "./board-content-adapter";
import type { BoardFabricTool } from "./fabric/board-fabric-object";

export type BoardCreationTool =
  | { kind: "sticky"; variant: StickyVariant }
  | { kind: "text"; preset: TextStylePreset }
  | { kind: "shape"; variant: BoardShapeVariant }
  | { kind: "content"; contentType: BoardStructuredKind }
  | { kind: "panel"; mode: PanelMode }
  | { kind: "connector"; connectorType: ConnectorType }
  | null;

interface BoardBottomDockProps {
  extension?: React.ReactNode;
  activeTool: BoardFabricTool;
  creationTool: BoardCreationTool;
  readOnly: boolean;
  onToolChange: (tool: BoardFabricTool) => void;
  onCreationToolChange: (tool: BoardCreationTool) => void;
  onQuickCreate: (tool: Exclude<BoardCreationTool, null>) => void;
  onBulkSticky: () => void;
  onImageRequest: () => void;
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

const SHAPES: Array<{ variant: BoardShapeVariant; label: string }> = [
  { variant: "rectangle", label: "矩形" }, { variant: "rounded-rectangle", label: "圆角矩形" }, { variant: "circle", label: "圆形" }, { variant: "ellipse", label: "椭圆" },
  { variant: "diamond", label: "菱形" }, { variant: "triangle", label: "三角形" }, { variant: "hexagon", label: "六边形" },
  { variant: "cloud", label: "云" }, { variant: "database", label: "数据库" }, { variant: "document", label: "文档" },
  { variant: "process", label: "流程" }, { variant: "decision", label: "决策" }, { variant: "terminator", label: "开始 / 结束" },
  { variant: "data", label: "数据" }, { variant: "predefined-process", label: "预定义流程" },
];
const DRAW_TOOLS: Array<{ tool: BoardDrawingTool | "eraser"; label: string }> = [{ tool: "pen", label: "画笔" }, { tool: "marker", label: "马克笔" }, { tool: "highlighter", label: "荧光笔" }, { tool: "eraser", label: "橡皮擦" }];
const MORE: Array<{ contentType: BoardStructuredKind; label: string }> = [{ contentType: "tile", label: "信息卡片" }, { contentType: "web-tile", label: "网页卡片" }, { contentType: "table", label: "表格" }, { contentType: "icon", label: "图标" }, { contentType: "template", label: "模板" }];

export function BoardBottomDock({ extension, activeTool, creationTool, readOnly, onToolChange, onCreationToolChange, onQuickCreate, onBulkSticky, onImageRequest }: BoardBottomDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  useEffect(() => { const closeOutside = (event: PointerEvent) => { if (!dockRef.current?.contains(event.target as Node)) setPickerOpen(false); }; window.addEventListener("pointerdown", closeOutside); return () => window.removeEventListener("pointerdown", closeOutside); }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  const stickyOpen = creationTool?.kind === "sticky";
  const textOpen = creationTool?.kind === "text";
  const shapeOpen = creationTool?.kind === "shape";
  const contentOpen = creationTool?.kind === "content";
  const drawOpen = activeTool.startsWith("draw-") || activeTool === "erase";
  const panelOpen = creationTool?.kind === "panel";
  const connectorOpen = creationTool?.kind === "connector";
  return (
    <nav ref={dockRef} aria-label="白板工具" className="absolute bottom-5 left-1/2 z-30 max-w-[calc(100vw-2rem)] -translate-x-1/2">
      {pickerOpen && (stickyOpen || textOpen || shapeOpen || contentOpen || drawOpen || panelOpen || connectorOpen) && (
        <div data-testid="board-tool-picker" className="mb-2 flex max-h-64 min-w-64 flex-wrap items-center justify-center gap-2 overflow-auto rounded-2xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in">
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
              className={cn("flex min-h-12 min-w-14 items-center justify-center rounded-xl border transition duration-fast motion-safe:hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", creationTool.variant === variant ? "border-primary bg-primary/10" : "border-transparent")}
            >
              <span aria-hidden="true" className={cn("block bg-warning-tint shadow-sm", shape)} />
            </button>
          )) : textOpen ? TEXT_PRESETS.map(({ preset, label }) => (
            <button
              key={preset}
              type="button"
              data-testid={`board-text-${preset}`}
              aria-pressed={creationTool.preset === preset}
              disabled={readOnly}
              onClick={() => onCreationToolChange({ kind: "text", preset })}
              className={cn("min-h-11 rounded-xl px-3 text-13 transition duration-fast motion-safe:hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", creationTool.preset === preset && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}
            >{label}</button>
          )) : shapeOpen ? SHAPES.map(({ variant, label }) => <button key={variant} type="button" data-testid={`board-shape-${variant}`} aria-pressed={creationTool.variant === variant} disabled={readOnly} onClick={() => onCreationToolChange({ kind: "shape", variant })} className={cn("min-h-11 rounded-xl px-3 text-13 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.variant === variant && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>)
            : contentOpen ? MORE.map(({ contentType, label }) => <button key={contentType} type="button" data-testid={`board-content-${contentType}`} aria-pressed={creationTool.contentType === contentType} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "content", contentType } as const; onCreationToolChange(next); onQuickCreate(next); }} className={cn("min-h-11 rounded-xl px-3 text-13 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.contentType === contentType && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>)
              : panelOpen ? ([['freeform', '自由'], ['grid', '网格'], ['flow', '流程']] as const).map(([mode, label]) => <button key={mode} type="button" data-testid={`board-panel-${mode}`} aria-pressed={creationTool.mode === mode} onClick={() => onCreationToolChange({ kind: "panel", mode })} className={cn("min-h-11 rounded-xl px-4 text-13 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.mode === mode && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>)
                : connectorOpen ? ([['straight', '直线'], ['elbow', '折线'], ['curve', '曲线']] as const).map(([connectorType, label]) => <button key={connectorType} type="button" data-testid={`board-connector-${connectorType}`} aria-pressed={creationTool.connectorType === connectorType} onClick={() => onCreationToolChange({ kind: "connector", connectorType })} className={cn("min-h-11 rounded-xl px-4 text-13 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.connectorType === connectorType && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>)
                  : DRAW_TOOLS.map(({ tool, label }) => { const fabricTool: BoardFabricTool = tool === "eraser" ? "erase" : `draw-${tool}`; return <button key={tool} type="button" data-testid={`board-draw-${tool}`} aria-pressed={activeTool === fabricTool} disabled={readOnly} onClick={() => { onCreationToolChange(null); onToolChange(fabricTool); }} className="min-h-11 rounded-xl px-3 text-13 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">{label}</button>; })}
          {stickyOpen && <Button data-testid="board-bulk-open" variant="ghost" onClick={onBulkSticky} disabled={readOnly}>批量</Button>}
        </div>
      )}
      <div className="flex items-end gap-1 overflow-x-auto rounded-2xl border border-border bg-card/95 p-1.5 shadow-2xl backdrop-blur">
        <DockButton testId="board-tool-select" label="选择" shortcut="V" pressed={activeTool === "select" && !creationTool} onClick={() => { onCreationToolChange(null); onToolChange("select"); }}><MousePointer2 className="h-5 w-5" /></DockButton>
        <DockButton testId="board-tool-hand" label="移动画布" shortcut="H" pressed={activeTool === "hand"} onClick={() => { onCreationToolChange(null); onToolChange("hand"); }}><Hand className="h-5 w-5" /></DockButton>
        <span aria-hidden="true" className="mx-1 h-10 w-px bg-border" />
        <DockButton testId="board-add-sticky" label="便利贴" shortcut="N" pressed={stickyOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "sticky", variant: stickyOpen ? creationTool.variant : "square" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><StickyNote className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-text" label="文字" shortcut="T" pressed={textOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "text", preset: textOpen ? creationTool.preset : "body" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><Type className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-shape" label="形状" shortcut="S" pressed={shapeOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "shape", variant: shapeOpen ? creationTool.variant : "rounded-rectangle" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><Shapes className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-draw" label="绘制" shortcut="P" pressed={drawOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); onCreationToolChange(null); onToolChange("draw-pen"); }}><Brush className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-connector" label="连接" shortcut="C" pressed={connectorOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "connector", connectorType: connectorOpen ? creationTool.connectorType : "straight" } as const; onToolChange("select"); onCreationToolChange(next); }}><Network className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-image" label="图片" shortcut="I" pressed={false} disabled={readOnly} onClick={onImageRequest}><ImagePlus className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-more" label="更多" shortcut="" pressed={contentOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "content", contentType: contentOpen ? creationTool.contentType : "tile" } as const; onToolChange("select"); onCreationToolChange(next); }}><span className="relative"><LayoutTemplate className="h-5 w-5" /><ChevronUp className="absolute -right-2 -top-2 h-3 w-3" /></span></DockButton>
        <DockButton testId="board-add-panel" label="区域" shortcut="F" pressed={panelOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "panel", mode: panelOpen ? creationTool.mode : "freeform" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><Frame className="h-5 w-5" /></DockButton>
        {extension}
      </div>
    </nav>
  );
}

function DockButton({ testId, label, shortcut, pressed, disabled, onClick, children }: { testId?: string; label: string; shortcut: string; pressed: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" data-testid={testId} title={shortcut ? `${label} (${shortcut})` : label} aria-label={shortcut ? `${label}，快捷键 ${shortcut}` : label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn("group flex min-h-12 min-w-14 shrink-0 flex-col items-center justify-center rounded-xl px-2 text-11 transition duration-fast motion-safe:hover:-translate-y-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", pressed && "bg-primary text-primary-foreground shadow-md hover:bg-primary-hover hover:text-primary-foreground")}>
    <span className="transition-transform motion-safe:group-hover:scale-110">{children}</span><span className="mt-0.5">{label}</span>
  </button>;
}
