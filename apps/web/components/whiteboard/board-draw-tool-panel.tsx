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

const strokeOptions = [{ value: 3 }, { value: 8 }, { value: 20 }] as const;
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
  return <section data-testid="board-draw-tool-panel" data-board-chrome="draw-panel" aria-label="Draw tools" className="absolute bottom-24 left-1/2 z-40 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-2xl max-sm:bottom-20">
    <div className="flex items-center gap-1">
      {tools.map(({id,label,icon:Icon})=><button key={id} type="button" aria-label={label} title={label} data-testid={`board-draw-${id}`} aria-pressed={choice===id} disabled={readOnly} onClick={()=>{onAppearanceChange(drawingChoiceStyle(id));onChoiceChange(id);}} className={cn("grid h-11 min-w-11 place-items-center rounded-xl border border-border-subtle text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground",choice===id&&"border-primary bg-primary/5 text-foreground ring-1 ring-primary")}><Icon className={cn("h-6 w-6",id==="highlighter"&&"text-warning",id==="eraser"&&"text-destructive")}/><span data-testid={`board-draw-preview-${id}`} aria-hidden className="block w-8 rounded-full" style={{height:Math.min((choice===id?appearance:drawingChoiceStyle(id)).width,12),backgroundColor:(choice===id?appearance:drawingChoiceStyle(id)).color,opacity:(choice===id?appearance:drawingChoiceStyle(id)).opacity}}/></button>)}
      <button type="button" data-testid="board-draw-select" onClick={onSelect} className="ml-auto min-h-11 rounded-xl px-2 text-12 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">Select</button>
      <button type="button" aria-label="Close draw tools" onClick={onClose} className="grid h-11 min-w-11 place-items-center rounded-xl transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-3" onClickCapture={event=>{if(readOnly)event.stopPropagation();}}>
      <fieldset className="flex w-[9.5rem] shrink-0 items-center gap-1"><legend className="sr-only">Stroke</legend>{choice==="eraser"?<output aria-label="Eraser width" className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border-subtle text-12"><span data-testid="board-draw-eraser-width-preview" aria-hidden className="block shrink-0 rounded-full border border-dashed border-current" style={{width:drawingChoiceStyle("eraser").width,height:drawingChoiceStyle("eraser").width}}/>{drawingChoiceStyle("eraser").width}px</output>:strokeOptions.map(option=><button key={option.value} type="button" data-testid={`board-draw-stroke-${option.value}`} aria-label={`Stroke ${option.value}`} aria-pressed={appearance.width===option.value} disabled={readOnly} onClick={()=>onAppearanceChange({...appearance,width:option.value})} className={cn("grid h-11 w-12 place-items-center rounded-xl border border-border-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",appearance.width===option.value&&"border-primary ring-1 ring-primary")}><span className="block w-7 rounded-full" style={{height:option.value,backgroundColor:appearance.color,opacity:appearance.opacity}}/></button>)}</fieldset>
      <fieldset disabled={readOnly||choice==="eraser"} className="min-w-0 flex-1"><legend className="sr-only">Color</legend><div className="flex flex-wrap items-center gap-2">{colors.map(color=><button key={color} type="button" data-testid={`board-draw-color-${color.slice(1).toLowerCase()}`} aria-label={`Color ${color}`} aria-pressed={appearance.color===color} onClick={()=>onAppearanceChange({...appearance,color})} className={cn("h-7 w-7 rounded-full border border-border-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",appearance.color===color&&"ring-2 ring-primary ring-offset-2")} style={{backgroundColor:color}}/>)}<label className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-border-subtle bg-muted text-muted-foreground"><span className="sr-only">Custom draw color</span><Palette className="h-4 w-4"/><input data-testid="board-draw-color-custom" aria-label="Custom draw color" type="color" value={appearance.color} onChange={event=>onAppearanceChange({...appearance,color:event.target.value.toUpperCase()})} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></label></div></fieldset>
    </div>
  </section>;
}
