'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { makeSticky, PreviewSticky, adjacentSticky, stickyTextColor } from './sticky';
import { previewViewport, documentBounds } from './viewport';
import { Canvas, Rect, Circle, Textbox, Line, PencilBrush } from 'fabric';
export type Tool = 'select' | 'sticky' | 'shape' | 'draw' | 'connector';
export type Options = { tool: Tool; color: string; shape: string; width: number; readonly: boolean };
export function WorkspaceCanvas({ options, seeded = true, draft, onDraft }: { options: Options; seeded?: boolean; draft?: string; onDraft: (draft: string) => void }) {
  const [selected, setSelected] = useState<PreviewSticky | null>(null);
  const [, refresh] = useState(0);
  const element = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<Canvas | null>(null);
  const saveDraft = useRef(onDraft); saveDraft.current = onDraft;
  const initialDraft = useRef(draft);
  const activateSticky = useCallback(function activate(c: Canvas, sticky: PreviewSticky) {
    if (current.current.readonly) return;
    sticky.onNextSticky = () => { if (current.current.readonly) return; sticky.exitEditing(); activate(c, adjacentSticky(sticky)); };
    c.add(sticky); c.skipTargetFind = false; c.setActiveObject(sticky); setSelected(sticky);
    const bounds = sticky.getBoundingRect(); const zoom = c.getZoom(); const view = [...c.viewportTransform] as typeof c.viewportTransform;
    // Keep rapid-entry notes reachable above the bottom dock without changing zoom.
    const right = (bounds.left + bounds.width) * zoom + view[4];
    const bottom = (bounds.top + bounds.height) * zoom + view[5];
    if (right > c.width - 24) view[4] -= right - c.width + 24;
    if (bottom > c.height - 150) view[5] -= bottom - c.height + 150;
    if (bounds.left * zoom + view[4] < 24) view[4] = 24 - bounds.left * zoom;
    c.setViewportTransform(view);
    sticky.enterEditing(); sticky.selectAll(); c.requestRenderAll();
  }, []);
  const createSticky = useCallback((c: Canvas, x: number, y: number) => activateSticky(c, makeSticky(x, y, current.current.color)), [activateSticky]);
  const updateSticky = (values: Partial<Pick<PreviewSticky, 'backgroundColor' | 'fontSize' | 'textAlign'>>) => {
    if (!selected || current.current.readonly) return;
    selected.set({ ...values, ...(values.backgroundColor ? { fill: stickyTextColor(values.backgroundColor) } : {}) }); selected.initDimensions(); selected.setCoords(); canvas.current?.requestRenderAll(); refresh(value => value + 1);
  };
  const current = useRef(options); current.current = options;
  useEffect(() => {
    if (!element.current || !host.current) return;
    const c = new Canvas(element.current, { selection: true, backgroundColor: '#fafafa' }); canvas.current = c;
    const resize = () => { if (host.current) { c.setDimensions({ width: host.current.clientWidth, height: host.current.clientHeight }); c.setViewportTransform(previewViewport(host.current.clientWidth, host.current.clientHeight, documentBounds(c.getObjects().map(object => object.getBoundingRect())))); c.requestRenderAll(); } };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    let loaded = !initialDraft.current;
    if (!initialDraft.current && seeded) c.add(makeSticky(100, 130, '#fff1a8', '让每个想法\n都被看见'), makeSticky(385, 210, '#d8e8ff', '一起画出\n下一步'));
    if (initialDraft.current) void c.loadFromJSON(initialDraft.current).then(() => { if (canvas.current === c) { loaded = true; c.getObjects().forEach(object => object.set({ selectable: !current.current.readonly, evented: !current.current.readonly })); resize(); } });
    resize();
    const selectionChanged = () => {
      const object = c.getActiveObject();
      const sticky = object instanceof PreviewSticky ? object : null;
      if (sticky) sticky.onNextSticky = () => { if (current.current.readonly) return; sticky.exitEditing(); activateSticky(c, adjacentSticky(sticky)); };
      setSelected(sticky);
    };
    c.on('selection:created', selectionChanged); c.on('selection:updated', selectionChanged); c.on('selection:cleared', selectionChanged);
    c.on('mouse:dblclick', event => { if (!event.target && !current.current.readonly && current.current.tool === 'select') { const p = c.getScenePoint(event.e); createSticky(c, p.x, p.y); } });
    let start: { x: number; y: number } | null = null;
    c.on('mouse:down', event => {
      const o = current.current; if (c.getActiveObject() instanceof Textbox && (c.getActiveObject() as Textbox).isEditing) return; if (o.readonly || o.tool === 'select' || o.tool === 'draw') return;
      const p = c.getScenePoint(event.e);
      if (o.tool === 'connector') { start = p; return; }
      if (o.tool === 'sticky') createSticky(c, p.x, p.y);
      if (o.tool === 'shape') c.add(o.shape === 'circle' ? new Circle({ originX: 'left', originY: 'top', left: p.x, top: p.y, radius: 65, fill: o.color }) : new Rect({ originX: 'left', originY: 'top', left: p.x, top: p.y, width: 160, height: 110, fill: o.color, rx: o.shape === 'rounded' ? 25 : 0, ry: o.shape === 'rounded' ? 25 : 0 }));
      c.requestRenderAll();
    });
    c.on('mouse:up', event => { if (!start || current.current.readonly) return; const p = c.getScenePoint(event.e); c.add(new Line([start.x, start.y, p.x, p.y], { stroke: current.current.color, strokeWidth: current.current.width, strokeDashArray: current.current.shape === 'dashed' ? [10, 6] : undefined })); start = null; c.requestRenderAll(); });
    return () => { if (loaded) saveDraft.current(JSON.stringify(c.toJSON())); observer.disconnect(); canvas.current = null; void c.dispose(); };
  }, [seeded, activateSticky, createSticky]);
  useEffect(() => { const c = canvas.current; if (!c) return; if (options.readonly) { const active = c.getActiveObject(); if (active instanceof Textbox && active.isEditing) active.exitEditing(); c.discardActiveObject(); } c.isDrawingMode = options.tool === 'draw' && !options.readonly; c.selection = options.tool === 'select' && !options.readonly; c.skipTargetFind = options.tool !== 'select' || options.readonly; c.getObjects().forEach(object => object.set({ selectable: !options.readonly, evented: !options.readonly })); const brush = new PencilBrush(c); brush.color = options.color; brush.width = options.width; c.freeDrawingBrush = brush; c.requestRenderAll(); }, [options]);
  return <div ref={host} className="absolute inset-0 touch-none" data-testid="workspace-fabric-surface" tabIndex={0} role="application" aria-label={options.readonly ? "只读白板画布，无法编辑对象。" : "白板画布。空白处双击创建便利贴；Tab 连续创建；Enter 添加当前工具对象；Delete 删除选中对象。"} onKeyDown={event => {
    const c = canvas.current; if (!c || options.readonly || (event.target instanceof HTMLElement && event.target.closest('[data-sticky-controls]')) || c.getActiveObject() instanceof Textbox && (c.getActiveObject() as Textbox).isEditing) return;
    if (event.key === 'Tab' && !event.shiftKey && c.getActiveObject() instanceof PreviewSticky) { event.preventDefault(); activateSticky(c, adjacentSticky(c.getActiveObject() as PreviewSticky)); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); c.getActiveObjects().forEach(object => c.remove(object)); c.discardActiveObject(); c.requestRenderAll(); }
    if (event.key === 'Enter' && options.tool !== 'select') { event.preventDefault(); const transform = c.viewportTransform; const x = (c.width / 2 - transform[4]) / c.getZoom() - 70; const y = (c.height / 2 - transform[5]) / c.getZoom() - 50;
      if (options.tool === 'sticky') createSticky(c, x, y);
      else if (options.tool === 'shape') c.add(options.shape === 'circle' ? new Circle({ originX: 'left', originY: 'top', left: x, top: y, radius: 60, fill: options.color }) : new Rect({ originX: 'left', originY: 'top', left: x, top: y, width: 160, height: 100, fill: options.color }));
      else c.add(new Line([x, y, x + 140, y + 70], { stroke: options.color, strokeWidth: options.width })); c.requestRenderAll();
    }
  }}>{selected && !options.readonly && <div data-sticky-controls role="group" aria-label="便利贴样式" data-testid="sticky-context-controls" className="absolute left-1/2 top-24 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-background p-2 shadow-lg">
    {['#fff1a8', '#d8e8ff', '#f9d5e5', '#d6efcf'].map((color, index) => <button key={color} type="button" data-testid={`sticky-color-${index}`} aria-label={`便利贴颜色：${['黄', '蓝', '粉', '绿'][index]}`} aria-pressed={selected.backgroundColor === color} className="min-h-12 min-w-12 rounded-lg border-2 border-border focus-visible:outline focus-visible:outline-2" style={{ backgroundColor: color }} onClick={() => updateSticky({ backgroundColor: color })}>{selected.backgroundColor === color ? '✓' : ''}</button>)}
    <label className="text-sm">字号<select aria-label="便利贴字号" data-testid="sticky-font-size" className="min-h-12 min-w-12 bg-background" value={selected.fontSize} onChange={event => updateSticky({ fontSize: Number(event.target.value) })}>{[16, 22, 28, 36].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
    <label className="text-sm">对齐<select aria-label="便利贴对齐" data-testid="sticky-alignment" className="min-h-12 min-w-12 bg-background" value={selected.textAlign} onChange={event => updateSticky({ textAlign: event.target.value as PreviewSticky['textAlign'] })}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
    <button type="button" data-testid="sticky-duplicate" className="min-h-12 min-w-12 rounded-lg border border-border px-3 text-sm" onClick={() => { if (canvas.current && !current.current.readonly) { selected.exitEditing(); activateSticky(canvas.current, adjacentSticky(selected, true)); } }}>复制</button>
  </div>}<canvas ref={element} aria-label={options.readonly ? "只读白板绘图区" : "白板绘图区：使用底部工具创建便利贴、图形、手绘和连线"} /></div>;
}
