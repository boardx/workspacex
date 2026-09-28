"use client";

import { Circle, Columns2, Grid2X2, LayoutGrid, RectangleHorizontal, Rows3, Square, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PanelMode } from "@repo/whiteboard-core";

export type BoardFrameChoice = "rectangle" | "rounded" | "circle" | "layout" | "blank" | "section" | "grid" | "timeline";
export type BoardFrameDimensions = Readonly<{ width: number; height: number; size: "s" | "m" | "l" | "custom" }>;

export const BOARD_FRAME_SIZES = {
  s: { width: 640, height: 480 }, m: { width: 960, height: 640 }, l: { width: 1280, height: 800 },
} as const;

const common = [
  {id:"rectangle",label:"Rectangle",icon:RectangleHorizontal,mode:"freeform"},
  {id:"rounded",label:"Rounded",icon:Square,mode:"freeform"},
  {id:"circle",label:"Circle",icon:Circle,mode:"freeform"},
  {id:"layout",label:"Layout",icon:LayoutGrid,mode:"grid"},
] as const;
const templates = [
  {id:"blank",label:"Blank",icon:Square,mode:"freeform"},
  {id:"section",label:"Section",icon:Columns2,mode:"flow"},
  {id:"grid",label:"Grid",icon:Grid2X2,mode:"grid"},
  {id:"timeline",label:"Timeline",icon:Rows3,mode:"flow"},
] as const;

function FrameChoiceButton({item,selected,onChoose}:{item:(typeof common)[number]|(typeof templates)[number];selected:boolean;onChoose:(choice:BoardFrameChoice,mode:PanelMode)=>void}){
  const Icon=item.icon;
  return <button type="button" data-testid={`board-frame-${item.id}`} aria-pressed={selected} onClick={()=>onChoose(item.id,item.mode)} className={cn("group flex min-w-0 flex-col items-center gap-1.5 text-10 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",selected&&"font-semibold text-foreground")}><span className={cn("grid h-14 w-full place-items-center rounded-lg border border-transparent bg-muted/50 group-hover:bg-accent",selected&&"border-primary bg-primary/5 ring-1 ring-primary")}><Icon className="h-7 w-7"/></span>{item.label}</button>;
}

export function BoardFrameToolPanel({choice,dimensions,readOnly,onChoiceChange,onDimensionsChange,onClose}:{choice:BoardFrameChoice;dimensions:BoardFrameDimensions;readOnly:boolean;onChoiceChange:(choice:BoardFrameChoice,mode:PanelMode)=>void;onDimensionsChange:(dimensions:BoardFrameDimensions)=>void;onClose:()=>void}){
  const [customOpen,setCustomOpen]=useState(dimensions.size==="custom");
  return <section data-testid="board-frame-tool-panel" aria-label="Frame tools" className="absolute bottom-24 left-1/2 z-40 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card/98 p-4 shadow-2xl backdrop-blur max-sm:bottom-20 max-sm:max-h-[70vh] max-sm:overflow-y-auto max-sm:rounded-b-none">
    <header className="flex items-center justify-between border-b border-border-subtle pb-3"><h2 className="text-14 font-semibold">Frame</h2><button type="button" aria-label="Close frame tools" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4"/></button></header>
    <fieldset disabled={readOnly} className="mt-3"><legend className="mb-2 text-11 font-medium">Common</legend><div className="grid grid-cols-4 gap-2">{common.map(item=><FrameChoiceButton key={item.id} item={item} selected={choice===item.id} onChoose={onChoiceChange}/>)}</div></fieldset>
    <fieldset disabled={readOnly} className="mt-4"><legend className="mb-2 text-11 font-medium">Templates</legend><div className="grid grid-cols-4 gap-2">{templates.map(item=><FrameChoiceButton key={item.id} item={item} selected={choice===item.id} onChoose={onChoiceChange}/>)}</div></fieldset>
    <fieldset disabled={readOnly} className="mt-4"><legend className="mb-2 text-11 font-medium">Sizes</legend><div className="grid grid-cols-4 gap-2">{(["s","m","l"] as const).map(size=><button key={size} type="button" data-testid={`board-frame-size-${size}`} aria-pressed={dimensions.size===size} onClick={()=>{setCustomOpen(false);onDimensionsChange({...BOARD_FRAME_SIZES[size],size});}} className={cn("h-10 rounded-lg bg-muted/50 text-11 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",dimensions.size===size&&"border border-primary bg-primary/5 ring-1 ring-primary")}>{size.toUpperCase()}</button>)}<button type="button" data-testid="board-frame-size-custom" aria-pressed={dimensions.size==="custom"} onClick={()=>setCustomOpen(true)} className={cn("h-10 rounded-lg bg-muted/50 px-2 text-11 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",dimensions.size==="custom"&&"border border-primary bg-primary/5 ring-1 ring-primary")}>Custom…</button></div></fieldset>
    {customOpen?<div className="mt-3 grid grid-cols-2 gap-2" data-testid="board-frame-custom-size"><label className="grid gap-1 text-10 text-muted-foreground">Width<input aria-label="Frame width" type="number" min={240} max={4000} value={dimensions.width} onChange={event=>onDimensionsChange({width:Math.max(240,Number(event.target.value)||240),height:dimensions.height,size:"custom"})} className="h-9 rounded-lg border border-border bg-background px-2 text-12 text-foreground"/></label><label className="grid gap-1 text-10 text-muted-foreground">Height<input aria-label="Frame height" type="number" min={180} max={4000} value={dimensions.height} onChange={event=>onDimensionsChange({width:dimensions.width,height:Math.max(180,Number(event.target.value)||180),size:"custom"})} className="h-9 rounded-lg border border-border bg-background px-2 text-12 text-foreground"/></label></div>:null}
  </section>;
}
