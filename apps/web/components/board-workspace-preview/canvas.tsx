'use client';
import { useEffect, useRef } from 'react';
import { previewViewport } from './viewport';
import { Canvas, Rect, Circle, Textbox, Line, PencilBrush } from 'fabric';
export type Tool = 'select' | 'sticky' | 'shape' | 'draw' | 'connector';
export type Options = { tool: Tool; color: string; shape: string; width: number; readonly: boolean };
export function WorkspaceCanvas({ options, seeded = true }: { options: Options; seeded?: boolean }) {
  const element = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<Canvas | null>(null);
  const current = useRef(options); current.current = options;
  useEffect(() => {
    if (!element.current || !host.current) return;
    const c = new Canvas(element.current, { selection: true, backgroundColor: '#fafafa' }); canvas.current = c;
    const resize = () => { if (host.current) { c.setDimensions({ width: host.current.clientWidth, height: host.current.clientHeight }); c.setViewportTransform(previewViewport(host.current.clientWidth, host.current.clientHeight)); c.requestRenderAll(); } };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    if (seeded) c.add(new Rect({ left: 100, top: 130, width: 210, height: 190, fill: '#fff1a8', rx: 4, ry: 4 }), new Textbox('让每个想法\n都被看见', { left: 120, top: 165, width: 165, fontSize: 24, fill: '#292929', editable: true }), new Rect({ left: 385, top: 210, width: 210, height: 190, fill: '#d8e8ff', rx: 4, ry: 4 }), new Textbox('一起画出\n下一步', { left: 405, top: 245, width: 165, fontSize: 24, fill: '#292929' }));
    let start: { x: number; y: number } | null = null;
    c.on('mouse:down', event => {
      const o = current.current; if (o.readonly || o.tool === 'select' || o.tool === 'draw') return;
      const p = c.getScenePoint(event.e);
      if (o.tool === 'connector') { start = p; return; }
      if (o.tool === 'sticky') { c.add(new Rect({ left: p.x, top: p.y, width: 180, height: 160, fill: o.color, rx: 4, ry: 4 })); const text = new Textbox('写下一个想法', { left: p.x + 16, top: p.y + 25, width: 148, fontSize: 22, fill: '#292929' }); c.add(text); c.setActiveObject(text); }
      if (o.tool === 'shape') c.add(o.shape === 'circle' ? new Circle({ left: p.x, top: p.y, radius: 65, fill: o.color }) : new Rect({ left: p.x, top: p.y, width: 160, height: 110, fill: o.color, rx: o.shape === 'rounded' ? 25 : 0, ry: o.shape === 'rounded' ? 25 : 0 }));
      c.requestRenderAll();
    });
    c.on('mouse:up', event => { if (!start || current.current.readonly) return; const p = c.getScenePoint(event.e); c.add(new Line([start.x, start.y, p.x, p.y], { stroke: current.current.color, strokeWidth: current.current.width, strokeDashArray: current.current.shape === 'dashed' ? [10, 6] : undefined })); start = null; c.requestRenderAll(); });
    return () => { observer.disconnect(); canvas.current = null; void c.dispose(); };
  }, [seeded]);
  useEffect(() => { const c = canvas.current; if (!c) return; c.isDrawingMode = options.tool === 'draw' && !options.readonly; c.selection = options.tool === 'select' && !options.readonly; c.skipTargetFind = options.tool !== 'select' || options.readonly; c.getObjects().forEach(object => object.set({ selectable: !options.readonly, evented: !options.readonly })); const brush = new PencilBrush(c); brush.color = options.color; brush.width = options.width; c.freeDrawingBrush = brush; c.requestRenderAll(); }, [options]);
  return <div ref={host} className="absolute inset-0 touch-none" data-testid="workspace-fabric-surface" tabIndex={0} role="application" aria-label="白板画布。按 Enter 在中央添加当前工具对象，Delete 删除选中对象。" onKeyDown={event => {
    const c = canvas.current; if (!c || options.readonly || c.getActiveObject() instanceof Textbox && (c.getActiveObject() as Textbox).isEditing) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); c.getActiveObjects().forEach(object => c.remove(object)); c.discardActiveObject(); c.requestRenderAll(); }
    if (event.key === 'Enter' && options.tool !== 'select') { event.preventDefault(); const transform = c.viewportTransform; const x = (c.width / 2 - transform[4]) / c.getZoom() - 70; const y = (c.height / 2 - transform[5]) / c.getZoom() - 50;
      if (options.tool === 'sticky') c.add(new Textbox('写下一个想法', { left: x, top: y, width: 160, padding: 20, fontSize: 22, backgroundColor: options.color }));
      else if (options.tool === 'shape') c.add(options.shape === 'circle' ? new Circle({ left: x, top: y, radius: 60, fill: options.color }) : new Rect({ left: x, top: y, width: 160, height: 100, fill: options.color }));
      else c.add(new Line([x, y, x + 140, y + 70], { stroke: options.color, strokeWidth: options.width })); c.requestRenderAll();
    }
  }}><canvas ref={element} aria-label="白板绘图区：使用底部工具创建便利贴、图形、手绘和连线" /></div>;
}
