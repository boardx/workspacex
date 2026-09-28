"use client";

import { useEffect, useRef, useState } from "react";
import { Brush, ChevronUp, Frame, Hand, ImagePlus, MousePointer2, MoveUpRight, Shapes, Type, MoreHorizontal } from "lucide-react";
import {BoardStickyPicker} from "./board-sticky-picker";
import {STICKY_COLOR_PRESETS} from "@repo/whiteboard-core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConnectorType, PanelMode, StickyVariant, TextStylePreset } from "@repo/whiteboard-core";
import type { BoardShapeVariant, BoardStructuredKind } from "./board-content-adapter";
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
  stickyColor?:string;
  onStickyColorChange?:(color:string)=>void;
  activeTool: BoardFabricTool;
  creationTool: BoardCreationTool;
  readOnly: boolean;
  onToolChange: (tool: BoardFabricTool) => void;
  onCreationToolChange: (tool: BoardCreationTool) => void;
  onQuickCreate: (tool: Exclude<BoardCreationTool, null>) => void;
  onBulkSticky: () => void;
  onImageRequest: () => void;
}

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
const MORE: Array<{ contentType: BoardStructuredKind; label: string }> = [{ contentType: "tile", label: "信息卡片" }, { contentType: "web-tile", label: "网页卡片" }, { contentType: "table", label: "表格" }, { contentType: "icon", label: "图标" }, { contentType: "template", label: "模板" }];

export function BoardBottomDock({ stickyColor=STICKY_COLOR_PRESETS.yellow,onStickyColorChange,extension, activeTool, creationTool, readOnly, onToolChange, onCreationToolChange, onQuickCreate, onBulkSticky, onImageRequest }: BoardBottomDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  // React portals retain this component ancestry even though their DOM lives
  // outside nav. Do not unmount an extension before its portal receives a click
  // or before Dialog restores focus after Escape.
  const portalEvents = useRef(new WeakSet<Event>());
  const capturePortalEvent = (event: React.SyntheticEvent<HTMLElement>) => {
    if (!dockRef.current?.contains(event.target as Node)) portalEvents.current.add(event.nativeEvent);
  };
  useEffect(() => { const closeOutside = (event: PointerEvent) => { if (!portalEvents.current.has(event) && !dockRef.current?.contains(event.target as Node)) setPickerOpen(false); }; window.addEventListener("pointerdown", closeOutside); return () => window.removeEventListener("pointerdown", closeOutside); }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !portalEvents.current.has(event)) setPickerOpen(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  const stickyOpen = creationTool?.kind === "sticky";
  const textOpen = creationTool?.kind === "text";
  const shapeOpen = creationTool?.kind === "shape";
  const contentOpen = creationTool?.kind === "content";
  const drawOpen = activeTool.startsWith("draw-") || activeTool === "erase";
  const panelOpen = creationTool?.kind === "panel";
  const connectorOpen = creationTool?.kind === "connector";
  return (
    <nav data-testid="board-creation-dock" data-board-chrome="dock" ref={dockRef} onPointerDownCapture={capturePortalEvent} onKeyDownCapture={capturePortalEvent} aria-label="白板工具" className="absolute bottom-5 left-1/2 z-30 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
      {pickerOpen && (stickyOpen || textOpen || shapeOpen || contentOpen || connectorOpen) && (
        <div data-testid="board-tool-picker" style={stickyOpen?{width:420,maxWidth:"calc(100vw - 2rem)",marginInline:"auto"}:undefined} className="mb-4 flex max-h-80 min-w-64 max-w-full flex-wrap items-center justify-center gap-2 overflow-auto rounded-2xl border border-border-subtle bg-card p-2 shadow-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in">
          {stickyOpen ? <BoardStickyPicker color={stickyColor} variant={creationTool.variant} readOnly={readOnly} onColorChange={value=>onStickyColorChange?.(value)} onVariantChange={variant=>onCreationToolChange({kind:"sticky",variant})} onBulk={onBulkSticky}/> : textOpen ? TEXT_PRESETS.map(({ preset, label }) => (
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
            : contentOpen ? <>{MORE.map(({ contentType, label }) => <button key={contentType} type="button" data-testid={`board-content-${contentType}`} aria-pressed={creationTool.contentType === contentType} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "content", contentType } as const; onCreationToolChange(next); onQuickCreate(next); }} className={cn("min-h-11 rounded-xl px-3 text-13 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.contentType === contentType && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>)}{extension}</>
              : connectorOpen ? ([['straight', '直线'], ['elbow', '折线'], ['curve', '曲线']] as const).map(([connectorType, label]) => <button key={connectorType} type="button" data-testid={`board-connector-${connectorType}`} aria-pressed={creationTool.connectorType === connectorType} onClick={() => onCreationToolChange({ kind: "connector", connectorType })} className={cn("min-h-11 rounded-xl px-4 text-13 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.connectorType === connectorType && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>) : null}

        </div>
      )}
      <div className="flex w-max max-w-full items-end gap-0.5 overflow-x-auto rounded-2xl border border-border bg-card p-1 shadow-xl xl:gap-1 xl:p-1.5">
        <DockButton testId="board-tool-select" label="选择" shortcut="V" pressed={activeTool === "select" && !creationTool} onClick={() => { onCreationToolChange(null); onToolChange("select"); }}><MousePointer2 className="h-5 w-5" /></DockButton>
        <DockButton testId="board-tool-hand" label="移动画布" shortcut="H" pressed={activeTool === "hand"} onClick={() => { onCreationToolChange(null); onToolChange("hand"); }}><Hand className="h-5 w-5" /></DockButton>
        <span aria-hidden="true" className="mx-1 h-10 w-px bg-border" />
        <DockButton testId="board-add-sticky" label="便利贴" shortcut="N" pressed={stickyOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "sticky", variant: stickyOpen ? creationTool.variant : "square" } as const; onToolChange("select"); onCreationToolChange(next); }}><span aria-hidden="true" className="block h-6 w-6 shrink-0 rounded-sm border border-border/30 shadow-sm" style={{backgroundColor:stickyColor}}/></DockButton>
        <DockButton testId="board-add-text" label="文字" shortcut="T" pressed={textOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "text", preset: textOpen ? creationTool.preset : "body" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><Type className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-shape" label="形状" shortcut="S" pressed={shapeOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "shape", variant: shapeOpen ? creationTool.variant : "rounded-rectangle" } as const; onToolChange("select"); onCreationToolChange(next); onQuickCreate(next); }}><Shapes className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-connector" label="箭头" shortcut="C" pressed={connectorOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "connector", connectorType: connectorOpen ? creationTool.connectorType : "straight" } as const; onToolChange("select"); onCreationToolChange(next); }}><MoveUpRight className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-draw" label="绘制" shortcut="P" pressed={drawOpen} disabled={readOnly} onClick={() => { setPickerOpen(false); onCreationToolChange(null); onToolChange("draw-pen"); }}><Brush className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-image" label="图片" shortcut="I" pressed={false} disabled={readOnly} onClick={onImageRequest}><ImagePlus className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-frame" label="Frame" shortcut="F" pressed={panelOpen} disabled={readOnly} onClick={() => { setPickerOpen(false); onToolChange("select"); onCreationToolChange({kind:"panel",mode:panelOpen?creationTool.mode:"freeform"}); }}><Frame className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-more" label="更多" shortcut="" pressed={contentOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "content", contentType: contentOpen ? creationTool.contentType : "tile" } as const; onToolChange("select"); onCreationToolChange(next); }}><span className="relative"><MoreHorizontal className="h-6 w-6" /><ChevronUp className="absolute -right-2 -top-2 h-3 w-3" /></span></DockButton>

      </div>
    </nav>
  );
}

function DockButton({ testId, label, shortcut, pressed, disabled, onClick, children }: { testId?: string; label: string; shortcut: string; pressed: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" data-testid={testId} title={shortcut ? `${label} (${shortcut})` : label} aria-label={shortcut ? `${label}，快捷键 ${shortcut}` : label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn("group flex min-h-14 min-w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 text-11 transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", pressed && "bg-primary text-primary-foreground shadow-md hover:bg-primary-hover hover:text-primary-foreground")}>
    <span className="transition-transform motion-safe:group-hover:scale-110">{children}</span><span className="leading-none max-sm:sr-only">{label}</span>
  </button>;
}
