"use client";

import { Eraser, Highlighter, Paintbrush, Palette, PenTool, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardFabricTool } from "./fabric/board-fabric-object";
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

const strokeOptions = [3, 8, 20].map(value => ({ value }));
const colors = ["#18181B", "#A1A1AA", "#F4F4F5", "#F9A8D4", "#EF4444", "#FB923C", "#FACC15", "#4ADE80", "#2563EB", "#A855F7"] as const;

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
  return <section data-testid="board-draw-tool-panel" data-board-chrome="draw-panel" aria-label="Draw tools" className="absolute bottom-24 left-1/2 z-40 h-[8.5rem] w-[min(47.5rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 shadow-xl max-sm:bottom-20 max-sm:h-[12rem]">
    <div className="flex h-6 items-center gap-2">
      <span className="text-12 font-semibold">Draw</span>
      <button type="button" data-testid="board-draw-select" onClick={onSelect} className="min-h-6 rounded px-2 text-12 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">Select</button>
      <button type="button" aria-label="Close draw tools" title="Close draw tools" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button>
    </div>
    <div className="grid gap-3 pt-1 sm:grid-cols-[1fr_1.1fr]" onClickCapture={event=>{if(readOnly)event.stopPropagation();}}>
      <div className="grid grid-cols-5 gap-1 border-border-subtle sm:border-r sm:pr-3">
        {tools.map(({id,label,icon:Icon})=>{const style=choice===id?appearance:drawingChoiceStyle(id);return <button key={id} type="button" title={label} data-testid={`board-draw-${id}`} aria-pressed={choice===id} disabled={readOnly} onClick={()=>{onAppearanceChange(drawingChoiceStyle(id));onChoiceChange(id);}} className={cn("group flex min-w-0 flex-col items-center gap-1 rounded text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground",choice===id&&"font-semibold text-foreground")}>
          <span className={cn("grid h-14 w-full place-items-center rounded border border-border-subtle bg-muted/40 group-hover:bg-accent",choice===id&&"border-primary bg-primary/5")}><Icon className="h-5 w-5"/><span data-testid={`board-draw-preview-${id}`} aria-hidden className="block w-8 rounded-full" style={{height:Math.min(style.width,12),backgroundColor:style.color,opacity:style.opacity}}/></span><span>{label}</span>
        </button>;})}
      </div>
      <div className="grid gap-1">
          <fieldset className="flex items-center gap-2"><legend className="sr-only">Stroke</legend>{choice==="eraser"?<output aria-label="Eraser width" className="flex h-8 items-center gap-2 text-12"><span aria-hidden className="h-6 w-6 rounded-full border border-border bg-background"/>{drawingChoiceStyle("eraser").width}px</output>:strokeOptions.map(option=><button key={option.value} type="button" data-testid={`board-draw-stroke-${option.value}`} aria-label={`Stroke ${option.value}`} title={`${option.value}px`} aria-pressed={appearance.width===option.value} disabled={readOnly} onClick={()=>onAppearanceChange({...appearance,width:option.value})} className={cn("grid h-8 w-14 place-items-center rounded border border-border-subtle bg-background focus-visible:ring-2 focus-visible:ring-ring",appearance.width===option.value&&"border-primary ring-1 ring-primary")}><span className="w-8 rounded-full" style={{height:Math.min(option.value,16),backgroundColor:appearance.color,opacity:appearance.opacity}}/></button>)}</fieldset>
        <fieldset disabled={readOnly||choice==="eraser"}><legend className="sr-only">Color</legend><div className="flex flex-wrap items-center gap-1">{colors.map(color=><button key={color} type="button" title={`Color ${color}`} data-testid={`board-draw-color-${color.slice(1).toLowerCase()}`} aria-label={`Color ${color}`} aria-pressed={appearance.color===color} onClick={()=>onAppearanceChange({...appearance,color})} className={cn("h-6 w-6 rounded-full border border-border-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",appearance.color===color&&"ring-2 ring-primary ring-offset-2")} style={{backgroundColor:color}}/>)}<label title="Custom draw color" className="relative grid h-6 w-6 place-items-center overflow-hidden rounded-full border border-border-subtle bg-muted text-muted-foreground"><span className="sr-only">Custom draw color</span><Palette className="h-4 w-4"/><input data-testid="board-draw-color-custom" aria-label="Custom draw color" type="color" value={appearance.color} onChange={event=>onAppearanceChange({...appearance,color:event.target.value.toUpperCase()})} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></label></div></fieldset>
      </div>
    </div>
  </section>;
}
