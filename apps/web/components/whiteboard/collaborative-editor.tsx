'use client';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import * as Y from 'yjs';
import type { WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { copyObjects, readObjects, type WhiteboardObject, type WhiteboardCommand } from '@repo/whiteboard-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWhiteboardDocument, textSplice } from './use-whiteboard-document';
import { WhiteboardRenderer } from './whiteboard-renderer';
type Point = { x: number; y: number };
type Gesture = { mode: 'move' | 'box' | 'draw' | 'pan'; start: Point; current: Point; ids: string[]; points: Point[]; offset: Point };
export interface CollaborativeEditorProps { doc: Y.Doc; readOnly: boolean; title: string; status: string; onTitleChange?: (title: string) => void; onBack?: () => void; onSelectionChange?: (ids: string[]) => void; onAwareness?: (cursor: Point | null, ids: string[]) => void; peers?: WhiteboardConnectionState['peers']; currentUserId?: string; followViewport?: {x:number;y:number;zoom:number;revision:number}|null; onViewportChange?: (viewport:{x:number;y:number;zoom:number})=>void; workshop?: ReactNode }
function make(kind: WhiteboardObject['kind'], x: number, y: number): WhiteboardObject {
  return { id: crypto.randomUUID(), schemaVersion: 1, kind, geometry: { x, y, width: kind === 'frame' ? 600 : 180, height: kind === 'frame' ? 400 : 140, rotation: 0 }, text: kind === 'frame' ? '讨论区' : kind === 'drawing' ? '' : '写下一个想法', style: {}, parentId: null, orderKey: '' };
}
export function CollaborativeEditor({ doc, readOnly, title, status, onTitleChange, onBack, onSelectionChange, onAwareness, peers = [], currentUserId, followViewport, onViewportChange, workshop }: CollaborativeEditorProps) {
  const model = useWhiteboardDocument(doc, readOnly);
  const [selected, setSelected] = useState<string[]>([]), [tool, setTool] = useState<'select'|'connect'|'draw'|'pan'>('select');
  const [zoom, setZoom] = useState(1), [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 720 });
  const [notice, setNotice] = useState(''), [gesture, setGesture] = useState<Gesture | null>(null);
  const surface = useRef<HTMLDivElement>(null), clipboard = useRef<WhiteboardObject[]>([]);
  const suppressCompositionChange = useRef<string | null>(null);
  const [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  const composition = useRef<{ id: string; before: string } | null>(null), [draft, setDraft] = useState<string | null>(null);
  const cursor = useRef<Point | null>(null);
  useEffect(()=>{if(followViewport){setOffset({x:followViewport.x,y:followViewport.y});setZoom(followViewport.zoom);}},[followViewport]);
  useEffect(()=>{onViewportChange?.({x:offset.x,y:offset.y,zoom});},[offset.x,offset.y,zoom,onViewportChange]);
  useEffect(() => { onSelectionChange?.(selected); onAwareness?.(cursor.current, selected); }, [selected, onSelectionChange, onAwareness]);
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const measure = () => setViewportSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    measure(); if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const object = model.objects.find(o => selected.length === 1 && o.id === selected[0]);
  function execute(commands: WhiteboardCommand[]) { if (readOnly) return; try { model.execute(commands); setNotice(''); } catch { setNotice('操作未应用：请检查对象是否仍存在或内容是否超出限制。'); } }
  function point(e: PointerEvent): Point { const rect = surface.current!.getBoundingClientRect(); return { x: (e.clientX - rect.left - offset.x) / zoom, y: (e.clientY - rect.top - offset.y) / zoom }; }
  function down(e: PointerEvent, id?: string) {
    if (e.button !== 0) return; e.stopPropagation();
    const p = point(e);
    if (tool === 'connect' && !readOnly && id) {
      if (selected.length === 1 && selected[0] !== id) { const connection = make('connector', 0, 0); connection.text = ''; connection.connector = { from: selected[0]!, to: id }; execute([{ type: 'create', object: connection }]); setTool('select'); setSelected([]); } else setSelected([id]); return;
    }
    const ids = id ? e.shiftKey ? selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id] : selected.includes(id) ? selected : [id] : [];
    if (tool !== 'pan') setSelected(ids);
    if (id && readOnly && tool !== 'pan') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setGesture({ mode: tool === 'pan' ? 'pan' : tool === 'draw' && !readOnly ? 'draw' : id ? 'move' : 'box', start: p, current: p, ids, points: [p], offset });
  }
  function move(e: PointerEvent) { cursor.current = point(e); onAwareness?.(cursor.current, selected); if (!gesture) return; const p = point(e); setGesture({ ...gesture, current: p, points: gesture.mode === 'draw' && gesture.points.length < 300 ? [...gesture.points, p] : gesture.points }); }
  function finish() {
    if (!gesture) return; const g = gesture, dx = g.current.x - g.start.x, dy = g.current.y - g.start.y; setGesture(null);
    if (g.mode === 'pan') { setOffset({ x: g.offset.x + dx * zoom, y: g.offset.y + dy * zoom }); return; }
    if (g.mode === 'box') { setSelected(model.objects.filter(o => o.kind !== 'connector' && o.geometry.x >= Math.min(g.start.x,g.current.x) && o.geometry.y >= Math.min(g.start.y,g.current.y) && o.geometry.x + o.geometry.width <= Math.max(g.start.x,g.current.x) && o.geometry.y + o.geometry.height <= Math.max(g.start.y,g.current.y)).map(o => o.id)); return; }
    if (readOnly) return;
    if (g.mode === 'move' && (dx || dy)) execute(readObjects(doc).filter(o => g.ids.includes(o.id)).map(o => ({ type: 'geometry', id: o.id, geometry: { ...o.geometry, x: o.geometry.x + dx, y: o.geometry.y + dy } })));
    if (g.mode === 'draw' && g.points.length > 1) {
      const x = Math.min(...g.points.map(p => p.x)), y = Math.min(...g.points.map(p => p.y)); const o = make('drawing', x, y);
      o.geometry.width = Math.max(1, Math.max(...g.points.map(p => p.x)) - x); o.geometry.height = Math.max(1, Math.max(...g.points.map(p => p.y)) - y);
      o.extensionData = { points: g.points.map(p => [p.x-x,p.y-y]) }; execute([{ type: 'create', object: o }]); setSelected([o.id]);
    }
  }
  function changeText(next: string) {
    if (!object || readOnly) return;
    if (suppressCompositionChange.current === next) { suppressCompositionChange.current = null; return; }
    suppressCompositionChange.current = null;
    if (composition.current) { setDraft(next); return; }
    const current = readObjects(doc).find(o => o.id === object.id); if (current) execute([{ type: 'text', id: current.id, ...textSplice(current.text, next) }]);
  }
  const displayed = model.objects.map(o => gesture?.mode === 'move' && gesture.ids.includes(o.id) ? { ...o, geometry: { ...o.geometry, x: o.geometry.x + gesture.current.x - gesture.start.x, y: o.geometry.y + gesture.current.y - gesture.start.y } } : o);
  const viewport = { x: -offset.x / zoom, y: -offset.y / zoom, width: viewportSize.width / zoom, height: viewportSize.height / zoom };
  return <section data-testid="collaborative-editor" className="flex h-full min-h-0 flex-col bg-background text-background-foreground">
    <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">{onBack && <Button onClick={onBack}>返回白板</Button>}<Input aria-label="白板名称" className="max-w-64" value={title} disabled={readOnly || !onTitleChange} onChange={e => { if (!readOnly) onTitleChange?.(e.target.value); }} /><span role="status" className="text-12">{status}{readOnly ? ' · 只读' : ''}</span></header>
    <div className="flex flex-wrap gap-1 border-b border-border p-2">
      <Button onClick={() => setTool('select')} aria-pressed={tool==='select'}>选择</Button><Button onClick={() => setTool('pan')} aria-pressed={tool==='pan'}>平移</Button>
      {(['sticky','text','rectangle','ellipse','frame'] as const).map((kind,i) => <Button key={kind} data-testid={`board-add-${kind}`} disabled={readOnly} onClick={() => { const o=make(kind,(100-offset.x)/zoom,(100-offset.y)/zoom); execute([{type:'create',object:o}]); setSelected([o.id]); }}>{['便利贴','文字','矩形','椭圆','Frame'][i]}</Button>)}
      <Button disabled={readOnly} onClick={() => { setTool('connect'); setSelected([]); setNotice('依次选择两个对象建立连接'); }}>连接</Button><Button disabled={readOnly} onClick={() => setTool('draw')}>画笔</Button>
      <Button disabled={readOnly} onClick={() => { const result=model.undo(); setNotice(result==='creation-requires-explicit-delete'?'创建对象请使用删除；为保护其他人的修改，不撤销对象创建。':result==='empty'?'没有可撤销的本地修改。':'已撤销本地修改'); }}>撤销</Button><Button disabled={readOnly} onClick={() => { model.redo(); }}>重做</Button>
      <Button disabled={!selected.length} onClick={() => { clipboard.current=copyObjects(doc,selected,()=>crypto.randomUUID()); setNotice('已复制到当前白板剪贴板'); }}>复制</Button><Button disabled={readOnly} onClick={() => { const ids=new Map(clipboard.current.map(o=>[o.id,crypto.randomUUID()])); const copied=clipboard.current.map(o=>({...o,id:ids.get(o.id)!,parentId:o.parentId?ids.get(o.parentId)??null:null,connector:o.connector?{from:ids.get(o.connector.from)!,to:ids.get(o.connector.to)!}:undefined,geometry:{...o.geometry,x:o.geometry.x+30,y:o.geometry.y+30}})); execute(copied.map(object=>({type:'create',object}))); setSelected(copied.map(o=>o.id)); }}>粘贴</Button>
      <Button disabled={readOnly || !selected.length} onClick={() => { execute(selected.map(id=>({type:'delete',id}))); setSelected([]); }}>删除选中</Button>
      <Button onClick={()=>setZoom(z=>Math.max(.2,z-.1))}>缩小</Button><span className="p-2 text-12">{Math.round(zoom*100)}%</span><Button onClick={()=>setZoom(z=>Math.min(2,z+.1))}>放大</Button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={surface} data-testid="board-live-surface" className="absolute inset-0 touch-none overflow-hidden bg-panel-alt" onPointerDown={e=>down(e)} onPointerMove={move} onPointerLeave={() => { cursor.current=null; onAwareness?.(null,selected); }} onPointerUp={finish} onPointerCancel={()=>setGesture(null)}>
        <div className="absolute inset-0 origin-top-left" style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${zoom})`}}>
          <WhiteboardRenderer objects={displayed} selected={selected} viewport={viewport} onPointerDown={down}/>
          {peers.filter(peer=>peer.actorId!==currentUserId).map(peer=><div key={peer.actorId} className="pointer-events-none">
            {peer.selected.map(id=>{const selectedObject=model.objects.find(item=>item.id===id);if(!selectedObject)return null;const g=selectedObject.geometry;return <div key={id} data-testid={`peer-selection-${peer.actorId}-${id}`} className="absolute rounded-control border-2 border-dashed border-primary" style={{left:g.x,top:g.y,width:g.width,height:g.height,transform:`rotate(${g.rotation}deg)`}}/>;})}
            {peer.cursor&&<div data-testid={`peer-cursor-${peer.actorId}`} className="absolute text-primary" style={{left:peer.cursor.x,top:peer.cursor.y}}><span aria-hidden="true">↖</span><span className="rounded-control bg-primary px-1 text-11 text-primary-foreground">{peer.actorId}</span></div>}
          </div>)}
          {gesture?.mode==='draw' && <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"><polyline points={gesture.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/></svg>}
          {gesture?.mode==='box' && <div className="pointer-events-none absolute border border-primary bg-muted opacity-50" style={{left:Math.min(gesture.start.x,gesture.current.x),top:Math.min(gesture.start.y,gesture.current.y),width:Math.abs(gesture.current.x-gesture.start.x),height:Math.abs(gesture.current.y-gesture.start.y)}}/>}
        </div>
      </div>
    {workshop && <div className="absolute right-3 top-3 max-w-[calc(100%-1.5rem)]">{workshop}</div>}
    {object && <aside className="absolute bottom-3 right-3 w-56 rounded-container border border-border bg-card p-3"><label className="text-13">对象文字<Textarea key={object.id} aria-label="对象文字" disabled={readOnly} value={draft ?? object.text} onChange={e=>changeText(e.target.value)} onCompositionStart={()=>{composition.current={id:object.id,before:object.text};setDraft(object.text);}} onCompositionEnd={e=>{const pending=composition.current;composition.current=null;suppressCompositionChange.current=e.currentTarget.value;const current=readObjects(doc).find(o=>o.id===pending?.id);if(current && current.text===pending?.before){execute([{type:'text',id:current.id,...textSplice(current.text,e.currentTarget.value)}]);setDraft(null);}else {setConflictedDraft(e.currentTarget.value);setDraft(null);setNotice('输入期间对象已由其他人修改。已保留此次输入草稿，请核对后重新输入。');}}}/></label>{conflictedDraft !== null && <label className="text-12">未应用的输入草稿<Textarea aria-label="未应用的输入草稿" readOnly value={conflictedDraft}/><Button onClick={()=>setConflictedDraft(null)}>关闭草稿</Button></label>}<p className="mt-2 text-11 text-muted-foreground">Shift 点击多选；空白处拖动框选。Frame 当前为视觉分区。</p></aside>}
    </div><p role="status" className="min-h-6 border-t border-border px-3 text-12">{notice || `${selected.length} 个已选对象`}</p>
  </section>;
}
