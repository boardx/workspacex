"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { BoardShapeVariant } from "./board-content-adapter";
import { BOARD_SHAPE_CATEGORIES } from "./board-shape-catalog";
import { ShapeToolPreview } from "./board-tool-preview";
import { cn } from "@/lib/utils";

export function BoardShapePicker({ variant, readOnly, onVariantChange }: {
  variant: BoardShapeVariant;
  readOnly: boolean;
  onVariantChange: (variant: BoardShapeVariant) => void;
}) {
  const [categoryIndex, setCategoryIndex] = useState(() => Math.max(0, BOARD_SHAPE_CATEGORIES.findIndex(category => category.shapes.some(shape => shape.variant === variant))));
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const category = BOARD_SHAPE_CATEGORIES[categoryIndex]!;
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % BOARD_SHAPE_CATEGORIES.length;
    else if (event.key === "ArrowLeft") next = (index + BOARD_SHAPE_CATEGORIES.length - 1) % BOARD_SHAPE_CATEGORIES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = BOARD_SHAPE_CATEGORIES.length - 1;
    else return;
    event.preventDefault();
    setCategoryIndex(next);
    tabs.current[next]?.focus();
  }
  return <div data-testid="board-shape-picker" className="w-full min-w-0">
    <div role="tablist" aria-label="形状分类" className="mb-2 flex gap-1 border-b border-border-subtle pb-2">
      {BOARD_SHAPE_CATEGORIES.map((item, index) => <button key={item.id} ref={node => { tabs.current[index] = node; }} type="button" role="tab"
        id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`} aria-selected={index === categoryIndex} tabIndex={index === categoryIndex ? 0 : -1}
        onKeyDown={event => moveTab(event, index)} onClick={() => setCategoryIndex(index)}
        className={cn("flex-1 rounded-lg px-3 py-2 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", index === categoryIndex ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent")}>{item.label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-${category.id}`} aria-labelledby={`${id}-tab-${category.id}`} className="grid grid-cols-4 gap-1.5">
      {category.shapes.map(shape => <button key={shape.variant} type="button" data-testid={`board-shape-${shape.variant}`} data-board-create-tool="shape"
        aria-label={shape.label} title={shape.label} aria-pressed={variant === shape.variant} disabled={readOnly} draggable={!readOnly}
        onClick={() => onVariantChange(shape.variant)}
        onDragStart={event => { if (!readOnly) event.dataTransfer.setData("application/x-workspacex-board-tool", JSON.stringify({ kind: "shape", variant: shape.variant })); }}
        className={cn("flex aspect-square min-h-12 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground", variant === shape.variant ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
        <ShapeToolPreview variant={shape.variant}/>
      </button>)}
    </div>
  </div>;
}
