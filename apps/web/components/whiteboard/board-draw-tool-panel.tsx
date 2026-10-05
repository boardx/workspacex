"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Eraser, Highlighter, MousePointer2, Paintbrush, Palette, PenTool, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardFabricTool } from "./fabric/board-fabric-object";
import { BOARD_INK_COLORS } from "./board-color-palette";
import { drawingChoiceStyle } from "./drawing-tool-style";

export type BoardDrawChoice = "pen" | "marker" | "pencil" | "highlighter" | "eraser";
export type BoardDrawAppearance = Readonly<{ width: number; opacity: number; color: string }>;

const tools = [
  { id: "pen", label: "Pen", icon: PenTool },
  { id: "marker", label: "Marker", icon: Paintbrush },
  { id: "pencil", label: "Pencil", icon: Pencil },
  { id: "highlighter", label: "Highlighter", icon: Highlighter },
  { id: "eraser", label: "Eraser", icon: Eraser },
] as const;

const strokeOptions = [{ value: 3 }, { value: 8 }, { value: 20 }] as const;
const colors = BOARD_INK_COLORS;

export function fabricToolForDrawChoice(choice: BoardDrawChoice): BoardFabricTool {
  if (choice === "eraser") return "erase";
  if (choice === "pencil") return "draw-pen";
  return `draw-${choice}`;
}

export function BoardDrawToolPanel({ choice, appearance, readOnly, onChoiceChange, onAppearanceChange, onSelect, onClose }: {
  choice: BoardDrawChoice;
  appearance: BoardDrawAppearance;
  readOnly: boolean;
  onChoiceChange: (choice: BoardDrawChoice) => void;
  onAppearanceChange: (appearance: BoardDrawAppearance) => void;
  onSelect: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const trigger = document.querySelector<HTMLElement>('[data-testid="board-add-draw"]');
    if (!trigger) return;
    const update = () => {
      const bounds = trigger.getBoundingClientRect(), panel = panelRef.current;
      const margin = 16, gap = 8;
      const width = panel?.getBoundingClientRect().width || Math.min(448, window.innerWidth - margin * 2);
      const height = panel?.scrollHeight || 160;
      const above = bounds.top - gap - margin;
      const openAbove = above >= height || above >= window.innerHeight - bounds.bottom - gap - margin;
      setAnchor({ left: Math.max(margin, Math.min(bounds.left + bounds.width / 2 - width / 2, window.innerWidth - width - margin)), top: openAbove ? bounds.top - gap - Math.min(height, above) : bounds.bottom + gap, maxHeight: Math.max(0, openAbove ? above : window.innerHeight - bounds.bottom - gap - margin) });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (panelRef.current) observer?.observe(panelRef.current);
    observer?.observe(trigger);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [choice]);
  return <section ref={panelRef} style={anchor ? { ...anchor, overflowY: "auto" } : undefined} data-testid="board-draw-tool-panel" data-board-chrome="draw-panel" aria-label="Draw tools" className={cn("z-40 w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card px-3 py-3 shadow-lg", anchor ? "fixed" : "absolute bottom-24 left-1/2 -translate-x-1/2 max-sm:bottom-20")}>
    <div className="flex items-center gap-0.5 border-b border-border/60 pb-2">
      {tools.map(({id,label,icon:Icon})=><button key={id} type="button" aria-label={label} title={label} data-testid={`board-draw-${id}`} aria-pressed={choice===id} disabled={readOnly} onClick={()=>{onAppearanceChange(drawingChoiceStyle(id));onChoiceChange(id);}} className={cn("flex h-12 min-w-11 flex-col items-center justify-center gap-1 rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground",choice===id&&"bg-accent text-foreground ring-1 ring-border")}><Icon className="h-5 w-5"/><span data-testid={`board-draw-preview-${id}`} aria-hidden className="block w-6 rounded-full" style={{height:Math.min((choice===id?appearance:drawingChoiceStyle(id)).width,12),backgroundColor:(choice===id?appearance:drawingChoiceStyle(id)).color,opacity:(choice===id?appearance:drawingChoiceStyle(id)).opacity}}/></button>)}
      <button type="button" data-testid="board-draw-select" onClick={onSelect} aria-label="Select" title="Select" className="ml-auto grid h-10 min-w-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><MousePointer2 className="h-4 w-4"/></button>
      <button type="button" aria-label="Close draw tools" onClick={onClose} className="grid h-10 min-w-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2" onClickCapture={event=>{if(readOnly)event.stopPropagation();}}>
      <fieldset className="flex items-center gap-1"><legend className="sr-only">Stroke</legend>{choice==="eraser"?<output aria-label="Eraser width" className="flex h-10 w-full items-center gap-2 text-12 text-muted-foreground"><Eraser className="h-5 w-5"/><span>{drawingChoiceStyle("eraser").width}px</span></output>:strokeOptions.map(option=><button key={option.value} type="button" data-testid={`board-draw-stroke-${option.value}`} aria-label={`Stroke ${option.value}`} aria-pressed={appearance.width===option.value} disabled={readOnly} onClick={()=>onAppearanceChange({...appearance,width:option.value})} className={cn("grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",appearance.width===option.value&&"bg-accent ring-1 ring-border")}><span className="block w-7 rounded-full" style={{height:option.value,backgroundColor:appearance.color,opacity:appearance.opacity}}/></button>)}</fieldset>
      <fieldset disabled={readOnly||choice==="eraser"} className="min-w-0 flex-1"><legend className="sr-only">Color</legend><div className="flex flex-wrap items-center gap-2 border-l border-border/60 pl-2">{colors.map(color=><button key={color} type="button" data-testid={`board-draw-color-${color.slice(1).toLowerCase()}`} aria-label={`Color ${color}`} aria-pressed={appearance.color===color} onClick={()=>onAppearanceChange({...appearance,color})} className={cn("h-6 w-6 rounded-full border border-border-subtle transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",appearance.color===color&&"ring-2 ring-foreground ring-offset-2")} style={{backgroundColor:color}}/>)}<label className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-border-subtle bg-muted text-muted-foreground"><span className="sr-only">Custom draw color</span><Palette className="h-4 w-4"/><input data-testid="board-draw-color-custom" aria-label="Custom draw color" type="color" value={appearance.color} onChange={event=>onAppearanceChange({...appearance,color:event.target.value.toUpperCase()})} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></label></div></fieldset>
    </div>
  </section>;
}
