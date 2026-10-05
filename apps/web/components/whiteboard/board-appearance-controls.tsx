"use client";

import type { CSSProperties } from "react";
import { Check, MessageCircle } from "lucide-react";
import { BOARD_INK_COLORS } from "./board-color-palette";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Object fill and text controls share the canonical board palette.
export const BOARD_APPEARANCE_COLORS = BOARD_INK_COLORS;

export function BoardColorSwatches({ label, value, disabled, onChange, testId, colors = BOARD_APPEARANCE_COLORS }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void; testId?: string; colors?: readonly string[] }) {
  return <div role="group" aria-label={label} data-testid={testId} className="flex flex-wrap gap-1">
    {colors.map((color) => <Button key={color} type="button" size="icon" variant="ghost" disabled={disabled} title={`${label} ${color}`} aria-label={`${label} ${color}`} aria-pressed={value.toUpperCase() === color.toUpperCase()} onClick={() => onChange(color)} className="h-9 w-9 rounded-lg"><span className={cn("relative grid h-6 w-6 place-items-center rounded-full border border-border shadow-sm", value.toUpperCase() === color.toUpperCase() && "ring-2 ring-foreground ring-offset-2 ring-offset-card")} style={{ backgroundColor: color }}>{value.toUpperCase() === color.toUpperCase() ? <Check className="h-3 w-3 text-foreground" style={{ color: color === BOARD_APPEARANCE_COLORS[0] ? "hsl(var(--primary-foreground))" : undefined }} /> : null}</span></Button>)}
    <label className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border transition-colors hover:bg-accent" title={`${label}自定义`}><span className="sr-only">{label}自定义</span><input type="color" aria-label={`${label}自定义`} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-6 w-6 cursor-pointer overflow-hidden rounded-full border-0 bg-transparent p-0" /></label>
  </div>;
}

export function BoardStrokePresets({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <div role="group" aria-label={label} className="flex gap-1">{[0, 1, 2, 4, 8, 12].map((width) => <Button key={width} type="button" size="icon" variant="ghost" disabled={disabled} aria-label={`${label} ${width}px`} title={`${width}px`} aria-pressed={value === width} onClick={() => onChange(width)} className={cn("h-9 flex-1 rounded-lg border border-transparent", value === width && "border-border bg-accent")}><svg aria-hidden="true" viewBox="0 0 28 16" className="h-4 w-7"><line x1="3" x2="25" y1="8" y2="8" stroke="currentColor" strokeWidth={Math.max(1, width)} strokeLinecap="round" strokeDasharray={width === 0 ? "2 3" : undefined} /></svg></Button>)}</div>;
}

export function BoardRadiusPresets({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <div role="group" aria-label={label} className="flex gap-1">{[0, 8, 20, 48].map((radius) => <Button key={radius} type="button" size="icon" variant="ghost" disabled={disabled} aria-label={`${label} ${radius}px`} title={`${radius}px`} aria-pressed={value === radius} onClick={() => onChange(radius)} className={cn("h-9 flex-1 rounded-lg border border-transparent", value === radius && "border-border bg-accent")}><svg aria-hidden="true" viewBox="0 0 28 24" className="h-5 w-6"><rect x="3" y="3" width="22" height="18" rx={Math.min(9, radius / 3)} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></Button>)}</div>;
}

export function BoardCommentIndicator({ objectId, label, count, onClick, style }: { objectId: string; label: string; count: number; onClick: () => void; style: CSSProperties }) {
  return <button type="button" aria-label={`${label}有 ${count} 条评论`} data-testid={`board-comment-indicator-${objectId}`} onClick={onClick} style={style} className="pointer-events-auto absolute z-10 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border border-border bg-card px-2 text-11 font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MessageCircle aria-hidden="true" className="h-3.5 w-3.5" /><span>{count}</span></button>;
}
