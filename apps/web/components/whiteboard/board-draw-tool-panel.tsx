"use client";

import { Eraser, Highlighter, Info, Paintbrush, Palette, PenTool, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardFabricTool } from "./fabric/board-fabric-object";

export type BoardDrawChoice = "pen" | "marker" | "pencil" | "highlighter" | "eraser";
export type BoardDrawAppearance = Readonly<{ width: number; opacity: number; color: string }>;

const tools = [
  { id: "pen", label: "Pen", icon: PenTool },
  { id: "marker", label: "Marker", icon: Paintbrush },
  { id: "pencil", label: "Pencil", icon: Pencil },
  { id: "highlighter", label: "Highlighter", icon: Highlighter },
  { id: "eraser", label: "Eraser", icon: Eraser },
] as const;

const strokeOptions = [{ value: 3, size: 5 }, { value: 8, size: 10 }, { value: 20, size: 16 }] as const;
const opacityOptions = [{ value: .25, tone: 25 }, { value: .55, tone: 55 }, { value: 1, tone: 100 }] as const;
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
  return <section data-testid="board-draw-tool-panel" data-board-chrome="draw-panel" aria-label="Draw tools" className="absolute bottom-24 left-1/2 z-40 min-h-[17rem] w-[min(47.5rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card px-4 py-3 shadow-2xl max-sm:bottom-20 max-sm:max-h-[70vh] max-sm:min-h-0 max-sm:overflow-y-auto max-sm:rounded-b-none">
    <div className="flex items-center gap-2 border-b border-border-subtle pb-2">
      <button type="button" aria-pressed="true" className="flex min-h-11 items-center gap-2 rounded-xl bg-primary/10 px-4 text-13 font-semibold text-primary"><PenTool className="h-5 w-5"/>Draw</button>
      <button type="button" data-testid="board-draw-select" onClick={onSelect} className="flex min-h-11 items-center gap-2 rounded-xl px-4 text-13 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Select</button>
      <p className="ml-auto hidden items-center gap-2 text-12 text-muted-foreground sm:flex">Use your mouse, trackpad, or stylus to draw <Info className="h-4 w-4"/></p>
      <button type="button" aria-label="Close draw tools" onClick={onClose} className="ml-1 grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button>
    </div>
    <div className="grid gap-4 pt-3 md:grid-cols-[1.2fr_1fr]">
      <div className="grid grid-cols-5 gap-2 border-border-subtle md:border-r md:pr-5">
        {tools.map(({id,label,icon:Icon})=><button key={id} type="button" data-testid={`board-draw-${id}`} aria-pressed={choice===id} disabled={readOnly} onClick={()=>onChoiceChange(id)} className={cn("group flex min-w-0 flex-col items-center gap-2 rounded-xl text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground",choice===id&&"font-semibold text-foreground")}>
          <span className={cn("grid h-20 w-full place-items-center rounded-xl border border-border-subtle bg-muted/40 transition-colors group-hover:bg-accent",choice===id&&"border-primary bg-primary/5 ring-1 ring-primary")}><Icon className={cn("h-10 w-10",id==="highlighter"&&"text-warning",id==="eraser"&&"text-destructive")}/></span><span>{label}</span>
        </button>)}
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-5">
          <fieldset><legend className="mb-1 text-12 font-medium">Stroke</legend><div className="flex gap-2">{strokeOptions.map(option=><button key={option.value} type="button" data-testid={`board-draw-stroke-${option.value}`} aria-label={`Stroke ${option.value}`} aria-pressed={appearance.width===option.value} disabled={readOnly||choice==="eraser"} onClick={()=>onAppearanceChange({...appearance,width:option.value})} className={cn("grid h-11 w-12 place-items-center rounded-xl border border-border-subtle bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",appearance.width===option.value&&"border-primary ring-1 ring-primary")}><span className="rounded-full bg-foreground" style={{width:option.size,height:option.size}}/></button>)}</div></fieldset>
          <fieldset><legend className="mb-1 text-12 font-medium">Opacity</legend><div className="flex gap-2">{opacityOptions.map(option=><button key={option.value} type="button" data-testid={`board-draw-opacity-${option.tone}`} aria-label={`Opacity ${option.tone}%`} aria-pressed={appearance.opacity===option.value} disabled={readOnly||choice==="eraser"} onClick={()=>onAppearanceChange({...appearance,opacity:option.value})} className={cn("grid h-11 w-12 place-items-center rounded-xl border border-border-subtle bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",appearance.opacity===option.value&&"border-primary ring-1 ring-primary")}><span className="h-5 w-5 rounded-full bg-foreground" style={{opacity:option.value}}/></button>)}</div></fieldset>
        </div>
        <fieldset disabled={readOnly||choice==="eraser"}><legend className="mb-1 text-12 font-medium">Color</legend><div className="flex flex-wrap items-center gap-2">{colors.map(color=><button key={color} type="button" data-testid={`board-draw-color-${color.slice(1).toLowerCase()}`} aria-label={`Color ${color}`} aria-pressed={appearance.color===color} onClick={()=>onAppearanceChange({...appearance,color})} className={cn("h-7 w-7 rounded-full border border-border-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",appearance.color===color&&"ring-2 ring-primary ring-offset-2")} style={{backgroundColor:color}}/>)}<label className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-border-subtle bg-muted text-muted-foreground"><span className="sr-only">Custom draw color</span><Palette className="h-4 w-4"/><input data-testid="board-draw-color-custom" aria-label="Custom draw color" type="color" value={appearance.color} onChange={event=>onAppearanceChange({...appearance,color:event.target.value.toUpperCase()})} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></label></div></fieldset>
      </div>
    </div>
  </section>;
}
