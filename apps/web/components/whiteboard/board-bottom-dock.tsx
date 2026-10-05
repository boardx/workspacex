"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brush, ChevronRight, Hand, ImagePlus, MousePointer2, Type, MoreHorizontal } from "lucide-react";
import { boardMenuPosition } from "./board-menu-position";
import {BoardStickyPicker} from "./board-sticky-picker";
import {STICKY_COLOR_PRESETS} from "@repo/whiteboard-core";
import { StickyToolPreview, ShapeToolPreview } from "./board-tool-preview";
import { BoardConnectorPicker } from "./board-connector-picker";
import { ConnectorToolPreview } from "./board-connector-preview";
import { validateTextAttributes } from "@repo/whiteboard-core";
import { cn } from "@/lib/utils";
import type { ConnectorType, PanelMode, StickyVariant, TextStylePreset } from "@repo/whiteboard-core";
import type { BoardShapeVariant, BoardStructuredKind } from "./board-content-adapter";
import type { BoardFabricTool } from "./fabric/board-fabric-object";

export const BOARD_TOOL_DRAG_MIME = "application/x-workspacex-board-tool";

export type BoardCreationTool =
  | { kind: "sticky"; variant: StickyVariant }
  | { kind: "text"; preset: TextStylePreset }
  | { kind: "shape"; variant: BoardShapeVariant }
  | { kind: "content"; contentType: BoardStructuredKind }
  | { kind: "panel"; mode: PanelMode }
  | { kind: "connector"; connectorType: ConnectorType }
  | null;

interface BoardBottomDockProps {
  editing?: boolean;
  connectorEnabled?: boolean;
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

export function BoardBottomDock({ editing=false,connectorEnabled=false,stickyColor=STICKY_COLOR_PRESETS.yellow,onStickyColorChange,extension, activeTool, creationTool, readOnly, onToolChange, onCreationToolChange, onQuickCreate, onBulkSticky, onImageRequest }: BoardBottomDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const heldToolPointer = useRef<number | null>(null);
  useEffect(() => { if (readOnly) heldToolPointer.current = null; }, [readOnly]);
  const startToolPointer = (event: React.PointerEvent<HTMLElement>) => {
    capturePortalEvent(event);
    const source = event.target instanceof Element ? event.target.closest('[data-board-create-tool]') : null;
    heldToolPointer.current = !readOnly && source && dockRef.current?.contains(source)
      && ['sticky', 'text', 'shape'].includes(source.getAttribute('data-board-create-tool') ?? '')
      ? event.pointerId : null;
  };
  const finishToolPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (heldToolPointer.current === event.pointerId) heldToolPointer.current = null;
  };
  const cancelToolPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (readOnly || heldToolPointer.current !== event.pointerId || !dockRef.current?.contains(event.target as Node)) return;
    if (event.type === 'lostpointercapture' && event.buttons === 0) return;
    heldToolPointer.current = null;
    setPickerOpen(false);
    onCreationToolChange(null);
    onToolChange('select');
  };
  const transferToolPointerToDrag = (event: React.DragEvent<HTMLElement>) => {
    const source = event.target instanceof Element ? event.target.closest('[data-board-create-tool]') : null;
    if (source && dockRef.current?.contains(source) && Array.from(event.dataTransfer.types ?? []).includes('application/x-workspacex-board-tool')) {
      // Native HTML drag owns this gesture and may emit pointercancel on takeover.
      heldToolPointer.current = null;
    }
  };
  const toolDragActive = useRef(false);
  // React portals retain this component ancestry even though their DOM lives
  // outside nav. Do not unmount an extension before its portal receives a click
  // or before Dialog restores focus after Escape.
  const portalEvents = useRef(new WeakSet<Event>());
  const capturePortalEvent = (event: React.SyntheticEvent<HTMLElement>) => {
    if (!dockRef.current?.contains(event.target as Node)) portalEvents.current.add(event.nativeEvent);
  };
  useEffect(() => { const closeOutside = (event: PointerEvent) => { if (!portalEvents.current.has(event) && !dockRef.current?.contains(event.target as Node)) setPickerOpen(false); }; window.addEventListener("pointerdown", closeOutside); return () => window.removeEventListener("pointerdown", closeOutside); }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A cleared one-shot mode ends its explicit dock menu. Shortcut arming must
  // not revive the previous menu merely because the same tool is selected.
  useEffect(() => { if (creationTool === null) setPickerOpen(false); }, [creationTool]);
  const recent = useRef({sticky:{kind:"sticky",variant:"square"} as Exclude<BoardCreationTool,null>,text:{kind:"text",preset:"body"} as Exclude<BoardCreationTool,null>,shape:{kind:"shape",variant:"rounded-rectangle"} as Exclude<BoardCreationTool,null>});
  useEffect(()=>{if(creationTool?.kind==="sticky"||creationTool?.kind==="text"||creationTool?.kind==="shape")recent.current[creationTool.kind]=creationTool;},[creationTool]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !portalEvents.current.has(event)) setPickerOpen(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  const stickyOpen = creationTool?.kind === "sticky";
  const stickyPreviewVariant = stickyOpen ? creationTool.variant : recent.current.sticky.kind === "sticky" ? recent.current.sticky.variant : "square";
  const textOpen = creationTool?.kind === "text";
  const shapeOpen = creationTool?.kind === "shape";
  const contentOpen = creationTool?.kind === "content";
  const drawOpen = activeTool.startsWith("draw-") || activeTool === "erase";
  const connectorOpen = creationTool?.kind === "connector";
  const [pickerPosition, setPickerPosition] = useState({ left: 16, bottom: 0, width: 420, maxHeight: 320 });
  const pickerKind = creationTool?.kind;
  useLayoutEffect(() => {
    if (!pickerOpen || !pickerKind) return;
    const dock = dockRef.current;
    const triggerId = `board-add-${pickerKind === "content" ? "more" : pickerKind}`;
    const trigger = Array.from(dock?.querySelectorAll<HTMLElement>("[data-testid]") ?? []).find(element => element.dataset.testid === triggerId);
    const update = () => {
      if (!dock || !trigger) return;
      const anchor = trigger.getBoundingClientRect();
      const preferredWidth = pickerKind === "connector" ? 208 : pickerKind === "text" ? 360 : 420;
      setPickerPosition(boardMenuPosition(anchor, preferredWidth, { width: window.innerWidth, height: window.innerHeight }, 8, dock.getBoundingClientRect().top));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (trigger) observer?.observe(trigger);
    if (dock) observer?.observe(dock);
    const scroller = trigger?.parentElement;
    scroller?.addEventListener("scroll", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); scroller?.removeEventListener("scroll", update); };
  }, [pickerOpen, pickerKind]);
  return (
    <nav data-testid="board-creation-dock" data-board-chrome="dock" ref={dockRef} onPointerDownCapture={startToolPointer} onPointerUpCapture={finishToolPointer} onPointerCancel={cancelToolPointer} onLostPointerCapture={cancelToolPointer} onKeyDownCapture={capturePortalEvent}
      onDragStart={(event) => { transferToolPointerToDrag(event); toolDragActive.current = Boolean(dockRef.current?.contains(event.target as Node) && Array.from(event.dataTransfer.types ?? []).includes("application/x-workspacex-board-tool")); }}
      onDragEnd={() => {
        if (!toolDragActive.current) return;
        toolDragActive.current = false;
        setPickerOpen(false);
        onCreationToolChange(null);
        onToolChange("select");
      }}
      aria-label="白板工具" className={cn("absolute bottom-5 inset-x-4 z-30 mx-auto w-max max-w-[calc(100vw-2rem)]",editing&&"max-sm:hidden")}>
      {pickerOpen && (stickyOpen || textOpen || shapeOpen || contentOpen || connectorOpen) && (
        <div data-testid="board-tool-picker" data-board-chrome="tool-picker" data-picker-anchor={creationTool?.kind} style={{ position: "fixed", bottom: pickerPosition.bottom, left: pickerPosition.left, width: pickerPosition.width, maxHeight: Math.min(320, pickerPosition.maxHeight) }} className="flex min-w-0 flex-wrap items-center justify-center gap-2 overflow-auto rounded-lg border border-border-subtle bg-card p-2 shadow-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in">
          {stickyOpen ? <BoardStickyPicker color={stickyColor} variant={creationTool.variant} readOnly={readOnly} onColorChange={value=>onStickyColorChange?.(value)} onVariantChange={variant=>onCreationToolChange({kind:"sticky",variant})} onBulk={onBulkSticky}/> : textOpen ? TEXT_PRESETS.map(({ preset, label }) => (
            <button
              key={preset}
              type="button"
              data-testid={`board-text-${preset}`}
              data-board-create-tool="text"
              aria-pressed={creationTool.preset === preset}
              disabled={readOnly}
              onClick={() => onCreationToolChange({ kind: "text", preset })} draggable={!readOnly} onDragStart={event=>event.dataTransfer.setData(BOARD_TOOL_DRAG_MIME,JSON.stringify({kind:"text",preset}))}
              className={cn("min-h-11 rounded-xl px-3 text-13 transition duration-fast motion-safe:hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", creationTool.preset === preset && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}
            ><span style={{fontSize:Math.max(12,Math.round(validateTextAttributes({preset}).fontSize*.75)),fontWeight:validateTextAttributes({preset}).bold?700:400}}>{label}</span></button>
          )) : shapeOpen ? SHAPES.map(({ variant, label }) => <button key={variant} type="button" data-testid={`board-shape-${variant}`} data-board-create-tool="shape" aria-pressed={creationTool.variant === variant} disabled={readOnly} onClick={() => onCreationToolChange({ kind: "shape", variant })} draggable={!readOnly} onDragStart={event=>event.dataTransfer.setData(BOARD_TOOL_DRAG_MIME,JSON.stringify({kind:"shape",variant}))} className={cn("flex min-h-11 items-center gap-2 rounded-xl px-3 text-13 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.variant === variant && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}><ShapeToolPreview variant={variant}/><span>{label}</span></button>)
            : contentOpen ? <>{MORE.map(({ contentType, label }) => <button key={contentType} type="button" data-testid={`board-content-${contentType}`} aria-pressed={creationTool.contentType === contentType} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "content", contentType } as const; onCreationToolChange(next); onQuickCreate(next); }} className={cn("min-h-11 rounded-xl px-3 text-13 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", creationTool.contentType === contentType && "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground")}>{label}</button>)}{extension}</>
              : connectorOpen ? <BoardConnectorPicker value={creationTool.connectorType} disabled={readOnly} onChange={connectorType=>onCreationToolChange({kind:"connector",connectorType})}/> : null}

        </div>
      )}
      <div className="flex w-max max-w-full items-end gap-0.5 overflow-x-auto rounded-2xl border border-border bg-card p-1 shadow-xl xl:gap-1 xl:p-1.5">
        <DockButton testId="board-tool-select" label="选择" shortcut="V" pressed={activeTool === "select" && !creationTool} onClick={() => { onCreationToolChange(null); onToolChange("select"); }}><MousePointer2 className="h-5 w-5" /></DockButton>
        <DockButton testId="board-tool-hand" label="移动画布" shortcut="H" pressed={activeTool === "hand"} onClick={() => { onCreationToolChange(null); onToolChange("hand"); }}><Hand className="h-5 w-5" /></DockButton>
        <span aria-hidden="true" className="mx-1 h-10 w-px bg-border" />
        <DockButton testId="board-add-sticky" dragTool={{...(creationTool?.kind==="sticky"?creationTool:recent.current.sticky),color:stickyColor}} submenu label="便利贴" shortcut="N" pressed={stickyOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = stickyOpen ? creationTool : recent.current.sticky; onToolChange("select"); onCreationToolChange(next); }}><StickyToolPreview variant={stickyPreviewVariant} color={stickyColor}/></DockButton>
        <DockButton testId="board-add-text" dragTool={creationTool?.kind==="text"?creationTool:recent.current.text} submenu label="文字" shortcut="T" pressed={textOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = textOpen ? creationTool : recent.current.text; onToolChange("select"); onCreationToolChange(next); }}><Type className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-shape" dragTool={creationTool?.kind==="shape"?creationTool:recent.current.shape} submenu label="形状" shortcut="S" pressed={shapeOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = shapeOpen ? creationTool : recent.current.shape; onToolChange("select"); onCreationToolChange(next); }}><ShapeToolPreview variant={shapeOpen?creationTool.variant:recent.current.shape.kind==="shape"?recent.current.shape.variant:"rounded-rectangle"}/></DockButton>
        <DockButton testId="board-add-draw" submenu label="绘制" shortcut="P" pressed={drawOpen} disabled={readOnly} onClick={() => { setPickerOpen(false); onCreationToolChange(null); onToolChange("draw-pen"); }}><Brush className="h-5 w-5" /></DockButton>
        <DockButton testId="board-add-image" label="图片" shortcut="I" pressed={false} disabled={readOnly} onClick={onImageRequest}><ImagePlus className="h-5 w-5" /></DockButton>
        {connectorEnabled&&<DockButton testId="board-add-connector" submenu label="连接线" shortcut="" pressed={connectorOpen} disabled={readOnly} onClick={()=>{setPickerOpen(true);onToolChange("select");onCreationToolChange({kind:"connector",connectorType:connectorOpen?creationTool.connectorType:"straight"});}}><ConnectorToolPreview type={connectorOpen?creationTool.connectorType:"straight"}/></DockButton>}
        <DockButton testId="board-add-more" submenu label="更多" shortcut="" pressed={contentOpen} disabled={readOnly} onClick={() => { setPickerOpen(true); const next = { kind: "content", contentType: contentOpen ? creationTool.contentType : "tile" } as const; onToolChange("select"); onCreationToolChange(next); }}><span className="relative" style={{width:24,height:24}}><MoreHorizontal style={{width:24,height:24}} /></span></DockButton>

      </div>
    </nav>
  );
}

function DockButton({ testId, label, shortcut, pressed, disabled, onClick, children, dragTool, submenu }: { dragTool?: Exclude<BoardCreationTool,null> & {color?:string}; submenu?: boolean; testId?: string; label: string; shortcut: string; pressed: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" draggable={Boolean(dragTool)&&!disabled} onDragStart={event=>{if(!dragTool||disabled)return;event.dataTransfer.setData(BOARD_TOOL_DRAG_MIME,JSON.stringify(dragTool));event.dataTransfer.effectAllowed="copy";const preview=event.currentTarget.querySelector<HTMLElement>("[data-board-drag-preview]");if(preview)event.dataTransfer.setDragImage?.(preview,preview.offsetWidth/2,preview.offsetHeight/2);}} data-testid={testId} data-board-create-tool={dragTool?.kind} title={shortcut ? `${label} (${shortcut})` : label} aria-label={shortcut ? `${label}，快捷键 ${shortcut}` : label} aria-pressed={pressed} disabled={disabled} onClick={onClick} style={{minHeight:56,minWidth:56,paddingInline:8}} className={cn("group flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-11 transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", pressed && "bg-primary text-primary-foreground shadow-md hover:bg-primary-hover hover:text-primary-foreground")}>
    <span style={{width:24,height:24}} className="relative grid shrink-0 place-items-center transition-transform motion-safe:group-hover:scale-110 [&>svg:not(.submenu)]:!h-full [&>svg:not(.submenu)]:!w-full"><span data-board-drag-preview className="grid h-full w-full place-items-center [&>svg]:!h-full [&>svg]:!w-full">{children}</span>{submenu?<ChevronRight data-testid={`${testId}-submenu`} aria-hidden className="submenu absolute -right-3 top-1/2 h-3 w-3 -translate-y-1/2"/>:null}</span><span className="sr-only">{label}</span>
  </button>;
}
