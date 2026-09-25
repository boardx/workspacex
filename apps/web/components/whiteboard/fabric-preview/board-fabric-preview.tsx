"use client";

import * as React from "react";
import Link from "next/link";
import { Circle, Frame, Hand, LocateFixed, Minus, MousePointer2, Plus, RectangleHorizontal, Redo2, RotateCcw, StickyNote, Type, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BoardFabricSurface, type BoardPreviewTool, type PreviewBoardObject } from "./board-fabric-surface";

const TOOLS: ReadonlyArray<{ id: BoardPreviewTool; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "hand", label: "移动画布", icon: Hand },
  { id: "sticky", label: "便利贴", icon: StickyNote },
  { id: "text", label: "文字", icon: Type },
  { id: "rectangle", label: "矩形", icon: RectangleHorizontal },
  { id: "ellipse", label: "椭圆", icon: Circle },
];

export function BoardFabricPreview() {
  const [tool, setTool] = React.useState<BoardPreviewTool>("select");
  const [zoom, setZoom] = React.useState(1);
  const [fitSignal, setFitSignal] = React.useState(0);
  const [selection, setSelection] = React.useState<PreviewBoardObject | null>(null);
  const [objects, setObjects] = React.useState<readonly PreviewBoardObject[]>([]);
  const updateObjects = React.useCallback((next: readonly PreviewBoardObject[]) => setObjects(next), []);
  const updateSelection = React.useCallback((next: PreviewBoardObject | null) => setSelection(next), []);
  const updateZoom = React.useCallback((next: number) => setZoom(next), []);

  return (
    <main className="relative h-screen min-h-[36rem] overflow-hidden bg-background text-foreground" data-testid="board-fabric-preview">
      <header className="absolute inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/studio" className="text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="board-preview-back">返回 Studio</Link>
          <span className="h-5 w-px bg-border" aria-hidden />
          <Frame className="h-5 w-5" aria-hidden />
          <strong className="truncate text-sm">团队创意工作坊</strong>
          <span className="rounded-full border border-border bg-muted px-2 py-1 text-11 text-muted-foreground" data-testid="board-preview-badge">Preview · 本地 mock</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"><Users className="h-4 w-4" aria-hidden />3 位演示成员</span>
          <Button size="sm" data-testid="board-preview-share" className="transition-colors">分享</Button>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 top-14">
        <BoardFabricSurface tool={tool} zoom={zoom} onZoomChange={updateZoom} onSelectionChange={updateSelection} onObjectsChange={updateObjects} fitSignal={fitSignal} />

        <nav className="absolute left-4 top-4 z-20 flex flex-col gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg" aria-label="白板工具" data-testid="board-fabric-toolbar">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <Button key={id} variant={tool === id ? "primary" : "ghost"} size="icon" aria-label={label} aria-pressed={tool === id} data-testid={`board-tool-${id}`} onClick={() => setTool(id)} className="transition-colors">
              <Icon className="h-4 w-4" aria-hidden />
            </Button>
          ))}
        </nav>

        <section className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card px-2 py-1.5 shadow-lg" aria-label="编辑操作" data-testid="board-floating-toolbar">
          <Button variant="ghost" size="icon" aria-label="撤销" data-testid="board-action-undo" className="transition-colors"><RotateCcw className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="重做" data-testid="board-action-redo" className="transition-colors"><Redo2 className="h-4 w-4" /></Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <span className="max-w-48 truncate px-2 text-xs text-muted-foreground">{selection ? `已选择：${selection.label}` : "选择对象以编辑"}</span>
        </section>

        <aside className="absolute bottom-4 right-4 top-4 z-20 hidden w-72 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl lg:flex" data-testid="board-properties-panel">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">属性</h2>
            <p className="mt-1 text-xs text-muted-foreground">{selection ? "移动、缩放或旋转所选对象" : "在画布上选择一个对象"}</p>
          </div>
          <div className="p-4">
            {selection ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-sm" data-testid="board-selection-properties">
                <div><dt className="text-xs text-muted-foreground">类型</dt><dd className="mt-1">{selection.kind}</dd></div>
                <div><dt className="text-xs text-muted-foreground">颜色</dt><dd className="mt-1 flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-border" style={{ background: selection.fill }} />{selection.fill}</dd></div>
                <div><dt className="text-xs text-muted-foreground">X / Y</dt><dd className="mt-1">{selection.x} / {selection.y}</dd></div>
                <div><dt className="text-xs text-muted-foreground">尺寸</dt><dd className="mt-1">{selection.width} × {selection.height}</dd></div>
              </dl>
            ) : <p className="text-sm text-muted-foreground">对象级编辑会在这里出现。Fabric 控点负责画布内直接操作。</p>}
          </div>
          <div className="mt-auto border-t border-border p-4">
            <h3 className="text-sm font-medium">无障碍对象列表</h3>
            <p className="mt-1 text-xs text-muted-foreground">Canvas 的同步语义视图，可用键盘浏览。</p>
            <ul className="mt-3 max-h-56 space-y-1 overflow-auto" data-testid="board-a11y-object-list" aria-label="白板对象">
              {objects.map((object) => <li key={object.id}><Button variant="ghost" size="sm" className="w-full justify-start truncate transition-colors" data-testid={`board-a11y-object-${object.id}`} onClick={() => setSelection(object)}>{object.label}</Button></li>)}
            </ul>
          </div>
        </aside>

        <div className="absolute bottom-4 left-4 z-20 flex items-center rounded-xl border border-border bg-card p-1 shadow-lg" data-testid="board-zoom-controls">
          <Button variant="ghost" size="icon" aria-label="缩小" data-testid="board-zoom-out" onClick={() => setZoom((value) => Math.max(.05, value / 1.2))} className="transition-colors"><Minus className="h-4 w-4" /></Button>
          <span className="w-16 text-center text-xs tabular-nums" data-testid="board-zoom-value">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="放大" data-testid="board-zoom-in" onClick={() => setZoom((value) => Math.min(8, value * 1.2))} className="transition-colors"><Plus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="适应内容" data-testid="board-zoom-fit" onClick={() => setFitSignal((value) => value + 1)} className="transition-colors"><LocateFixed className="h-4 w-4" /></Button>
        </div>

        <p className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-11 text-muted-foreground shadow-sm" data-testid="board-preview-disclosure">真实 Fabric.js 7.4.0 渲染 · 纯前端预览 · 未连接 Yjs 或服务端</p>
      </div>
    </main>
  );
}
