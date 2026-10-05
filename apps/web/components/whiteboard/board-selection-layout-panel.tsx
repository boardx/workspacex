"use client";

import { AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, RectangleHorizontal, RectangleVertical, Square, Grid2X2, Rows3, Columns3, Sparkles, type LucideIcon } from "lucide-react";
import type { WhiteboardLayoutKind } from "@repo/whiteboard-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type BoardSmartLayout = "grid" | "cards" | "cluster" | "journey" | "mind-map" | "flow" | "timeline";
export interface BoardSelectionLayoutPanelProps {
  disabled: boolean; selectedCount: number; gap: number; columns: number;
  onGapChange: (gap: number) => void; onColumnsChange: (columns: number) => void;
  onArrange: (kind: WhiteboardLayoutKind) => void; onPreview: (kind: BoardSmartLayout) => void;
}
const alignments: readonly [WhiteboardLayoutKind, string, LucideIcon][] = [
  ["align-left", "左对齐", AlignStartVertical], ["align-center", "水平居中", AlignCenterVertical], ["align-right", "右对齐", AlignEndVertical],
  ["align-top", "顶对齐", AlignStartHorizontal], ["align-middle", "垂直居中", AlignCenterHorizontal], ["align-bottom", "底对齐", AlignEndHorizontal],
];
const distribution: readonly [WhiteboardLayoutKind, string, LucideIcon][] = [["distribute-horizontal", "水平分布", AlignHorizontalSpaceAround], ["distribute-vertical", "垂直分布", AlignVerticalSpaceAround]];
const sizes: readonly [WhiteboardLayoutKind, string, LucideIcon][] = [["equal-width", "等宽", RectangleHorizontal], ["equal-height", "等高", RectangleVertical], ["equal-size", "等尺寸", Square]];
const arrangements: readonly [WhiteboardLayoutKind, string, LucideIcon][] = [["grid", "网格", Grid2X2], ["row", "横排", Columns3], ["column", "竖排", Rows3], ["tidy-up", "整理", Sparkles]];
const smart: readonly [BoardSmartLayout, string][] = [["grid", "网格"], ["cards", "卡片"], ["cluster", "聚类"], ["journey", "旅程"], ["mind-map", "思维导图"], ["flow", "流程"], ["timeline", "时间线"]];

/** Schematic previews describe arrangement, without changing the canonical layout algorithms. */
function LayoutPreview({ kind }: { kind: BoardSmartLayout }) {
  const positions: Record<BoardSmartLayout, readonly [number, number][]> = {
    grid: [[8, 8], [32, 8], [8, 30], [32, 30]], cards: [[5, 12], [24, 12], [43, 12]],
    cluster: [[8, 8], [20, 24], [40, 10], [44, 32]], journey: [[3, 30], [22, 20], [43, 8]],
    "mind-map": [[4, 22], [40, 4], [40, 22], [40, 40]], flow: [[3, 20], [24, 20], [45, 20]], timeline: [[3, 8], [24, 30], [45, 8]],
  };
  return <svg viewBox="0 0 64 60" className="h-12 w-16 text-muted-foreground" aria-hidden="true">
    {["journey", "mind-map", "flow", "timeline"].includes(kind) && <path d={kind === "mind-map" ? "M17 29H32V11H40M32 29H40M32 29V47H40" : kind === "journey" ? "M10 37L29 27L50 15" : kind === "timeline" ? "M3 29H61" : "M8 27H56"} fill="none" stroke="currentColor" strokeWidth="1.5" />}
    {positions[kind].map(([x, y], i) => <rect key={i} x={x} y={y} width={kind === "cards" ? 14 : 13} height={kind === "cards" ? 32 : 14} rx="2" fill="currentColor" opacity="0.65" />)}
  </svg>;
}

export function BoardSelectionLayoutPanel(props: BoardSelectionLayoutPanelProps) {
  const { disabled, selectedCount, onArrange, onPreview } = props;
  const controls = (entries: readonly [WhiteboardLayoutKind, string, LucideIcon][]) => entries.map(([kind, label, Icon]) => <Button key={kind} variant="ghost" size="icon" data-testid={`board-layout-${kind}`} disabled={disabled || (kind.startsWith("distribute-") && selectedCount < 3)} aria-label={label} title={kind.startsWith("distribute-") && selectedCount < 3 ? `${label}（至少选择 3 个对象）` : label} onClick={() => onArrange(kind)}><Icon className="h-5 w-5" /></Button>);
  return <Tabs defaultValue="align" data-testid="board-selection-layout-panel">
    <TabsList aria-label="布局分类" className="grid w-full grid-cols-3">
      <TabsTrigger value="align" data-testid="board-layout-tab-align">对齐</TabsTrigger>
      <TabsTrigger value="arrange" data-testid="board-layout-tab-arrange">排列</TabsTrigger>
      <TabsTrigger value="smart" data-testid="board-layout-tab-smart">智能布局</TabsTrigger>
    </TabsList>
    <TabsContent value="align"><div className="space-y-2">
      <div role="group" aria-label="对象对齐" className="grid grid-cols-6 gap-1">{controls(alignments)}</div>
      <div className="flex items-center justify-between border-t border-border pt-2"><div role="group" aria-label="对象分布" className="flex gap-1">{controls(distribution)}</div><div role="group" aria-label="统一尺寸" className="flex gap-1">{controls(sizes)}</div></div>
    </div></TabsContent>
    <TabsContent value="arrange"><div className="grid grid-cols-4 gap-2">{arrangements.map(([kind, label, Icon]) => <Button key={kind} variant="outline" className="h-16" data-testid={`board-layout-${kind}`} aria-label={label} title={label} disabled={disabled} onClick={() => onArrange(kind)}><Icon className="h-7 w-7" /></Button>)}</div></TabsContent>
    <TabsContent value="smart"><div className="grid grid-cols-3 gap-2">{smart.map(([kind, label]) => <Button key={kind} variant="outline" className="h-20" data-testid={`board-smart-${kind}`} aria-label={`${label}预览`} title={`${label}预览`} disabled={disabled} onClick={() => onPreview(kind)}><LayoutPreview kind={kind} /></Button>)}</div><Button variant="ghost" className="mt-2 w-full" data-testid="board-layout-smart-preview" aria-label="智能布局预览" title="智能布局预览" disabled={disabled} onClick={() => onPreview("grid")}><Sparkles className="h-5 w-5" /></Button></TabsContent>
    <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
      <label className="flex flex-1 items-center gap-2 text-12">间距<Input data-testid="board-layout-gap" aria-label="布局间距" className="w-16" type="number" min={0} max={400} value={props.gap} disabled={disabled} onChange={e => props.onGapChange(Math.max(0, Math.min(400, Number(e.target.value) || 0)))} /></label>
      <label className="flex flex-1 items-center gap-2 text-12">列数<Input data-testid="board-layout-columns" aria-label="网格列数" className="w-16" type="number" min={1} max={20} value={props.columns} disabled={disabled} onChange={e => props.onColumnsChange(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
    </div>
  </Tabs>;
}
