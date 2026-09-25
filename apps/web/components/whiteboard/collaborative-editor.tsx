'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import * as Y from 'yjs';
import type { WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { copyObjects, expandSelection, readObjects, selectionRoots, type WhiteboardObject, type WhiteboardCommand } from '@repo/whiteboard-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWhiteboardDocument, textSplice } from './use-whiteboard-document';
import { WhiteboardRenderer } from './whiteboard-renderer';
import { boardObjectLabel, nextBoardObject, type BoardDirection } from '@/lib/whiteboard-keyboard';
type Point = { x: number; y: number };
type Gesture = { mode: 'move' | 'box' | 'draw' | 'pan'; start: Point; current: Point; ids: string[]; points: Point[]; offset: Point };
export interface CollaborativeEditorProps { doc: Y.Doc; readOnly: boolean; title: string; status: string; onTitleChange?: (title: string) => void; onBack?: () => void; onSelectionChange?: (ids: string[]) => void; onAwareness?: (cursor: Point | null, ids: string[]) => void; peers?: WhiteboardConnectionState['peers']; currentUserId?: string; followViewport?: {x:number;y:number;zoom:number;revision:number}|null; onViewportChange?: (viewport:{x:number;y:number;zoom:number})=>void; initialViewport?: {x:number;y:number;zoom:number}|null; workshop?: ReactNode; auxiliaryPanelOpen?: boolean }
function make(kind: WhiteboardObject['kind'], x: number, y: number): WhiteboardObject {
  return { id: crypto.randomUUID(), schemaVersion: 1, kind, geometry: { x, y, width: kind === 'frame' ? 600 : 180, height: kind === 'frame' ? 400 : 140, rotation: 0 }, text: kind === 'frame' ? '讨论区' : kind === 'drawing' ? '' : '写下一个想法', style: {}, parentId: null, orderKey: '' };
}
export function CollaborativeEditor({ doc, readOnly, title, status, onTitleChange, onBack, onSelectionChange, onAwareness, peers = [], currentUserId, followViewport, onViewportChange, initialViewport, workshop, auxiliaryPanelOpen = false }: CollaborativeEditorProps) {
  const model = useWhiteboardDocument(doc, readOnly);
  const [selectedState, setSelected] = useState<string[]>([]), [tool, setTool] = useState<'select'|'connect'|'draw'|'pan'>('select');
  const [zoom, setZoom] = useState(() => initialViewport?.zoom ?? 1), [offset, setOffset] = useState<Point>(() => initialViewport ? { x: initialViewport.x, y: initialViewport.y } : { x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 720 });
  const [notice, setNotice] = useState(''), [gesture, setGesture] = useState<Gesture | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null), textEditor = useRef<HTMLTextAreaElement>(null), clipboard = useRef<WhiteboardObject[]>([]);
  const suppressCompositionChange = useRef<string | null>(null);
  const [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  const composition = useRef<{ id: string; before: string } | null>(null), [draft, setDraft] = useState<string | null>(null);
  const cursor = useRef<Point | null>(null);
  const selectableIds = new Set(model.objects.filter(item => item.kind !== 'connector').map(item => item.id));
  const selected = selectedState.filter(id => selectableIds.has(id));
  const effectiveActiveId = activeId && selectableIds.has(activeId) ? activeId : null;
  useEffect(()=>{if(followViewport){setOffset({x:followViewport.x,y:followViewport.y});setZoom(followViewport.zoom);}},[followViewport]);
  // Skip the very first run: it fires with this component's freshly-mounted default
  // viewport (zoom 1, offset 0,0), not a real pan/zoom the presenter made. Publishing
  // it unconditionally means every remount of the presenter's own editor - a page
  // reload, a hot navigation back into the board - broadcasts that default and silently
  // resets the viewport every meeting-room display is currently following, clobbering
  // whatever zoom/pan level was actually in effect a moment earlier. Only genuine
  // post-mount viewport changes (the presenter actually panning or zooming) should
  // reach the room.
  const skippedInitialViewportPublish=useRef(false);
  useEffect(()=>{if(!skippedInitialViewportPublish.current){skippedInitialViewportPublish.current=true;return;}onViewportChange?.({x:offset.x,y:offset.y,zoom});},[offset.x,offset.y,zoom,onViewportChange]);
  useEffect(() => {
    const currentIds = new Set(model.objects.filter(item => item.kind !== 'connector').map(item => item.id));
    const currentSelection = selectedState.filter(id => currentIds.has(id));
    onSelectionChange?.(currentSelection);
    onAwareness?.(cursor.current, currentSelection);
  }, [selectedState, model.objects, onSelectionChange, onAwareness]);
  useEffect(() => {
    const currentIds = new Set(model.objects.filter(item => item.kind !== 'connector').map(item => item.id));
    const currentSelection = selectedState.filter(id => currentIds.has(id));
    const selectionChanged = currentSelection.length !== selectedState.length;
    const activeWasRemoved = activeId !== null && !currentIds.has(activeId);
    if (!selectionChanged && !activeWasRemoved) return;
    if (selectionChanged) setSelected(currentSelection);
    if (activeWasRemoved) setActiveId(nextBoardObject(model.objects, null, 'ArrowRight')?.id ?? null);
    const removedCount = selectedState.length - currentSelection.length;
    setNotice(removedCount > 0 ? `协作者删除了 ${removedCount} 个已选对象。${currentSelection.length} 个已选对象` : '当前对象已由协作者删除。');
  }, [activeId, model.objects, selectedState]);
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const measure = () => setViewportSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    measure(); if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const object = model.objects.find(o => selected.length === 1 && o.id === selected[0]);
  function execute(commands: WhiteboardCommand[]) { if (readOnly) { setNotice('当前白板为只读，未应用修改。'); return false; } try { model.execute(commands); setNotice(''); return true; } catch { setNotice('操作未应用：请检查对象是否仍存在或内容是否超出限制。'); return false; } }
  const focusCanvas = () => surface.current?.focus({ preventScroll: true });
  const named = (id: string | null) => boardObjectLabel(model.objects.find(item => item.id === id));
  function choose(id: string, additive = false) {
    setActiveId(id);
    if (tool === 'connect') {
      if (readOnly) { setNotice('当前白板为只读，不能建立连接。'); return; }
      if (selected.length === 1 && selected[0] !== id) {
        const from = selected[0]!, connection = make('connector', 0, 0);
        connection.text = ''; connection.connector = { from, to: id };
        if (execute([{ type: 'create', object: connection }])) setNotice(`已建立连接：${named(from)} 到 ${named(id)}`);
        setTool('select'); setSelected([]); return;
      }
      setSelected([id]); setNotice(`连接起点：${named(id)}。请选择终点。`); return;
    }
    const next = additive ? selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] : [id];
    setSelected(next); setNotice(`${named(id)}，${next.length} 个已选对象`);
  }
  function undo() {
    if (readOnly) { setNotice('当前白板为只读，不能撤销。'); return; }
    const result = model.undo();
    setNotice(result === 'creation-requires-explicit-delete' ? '创建对象请使用删除；为保护其他人的修改，不撤销对象创建。'
      : result === 'empty' ? '没有可撤销的本地修改。'
      : result === 'conflict' ? '撤销失败：该修改与其他人的更改冲突，未能撤销。'
      : '已撤销本地修改');
    focusCanvas();
  }
  function deleteSelection() {
    if (readOnly || !selected.length) { if (readOnly) setNotice('当前白板为只读，不能删除。'); return; }
    const remaining = model.objects.filter(item => item.kind !== 'connector' && !selected.includes(item.id));
    const next = nextBoardObject(remaining, null, 'ArrowRight');
    if (execute(selected.map(id => ({ type: 'delete' as const, id })))) setNotice(`已删除 ${selected.length} 个对象`);
    setSelected([]); setActiveId(next?.id ?? null); focusCanvas();
  }
  function canvasKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    const direction = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) ? event.key as BoardDirection : null;
    if (direction && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (readOnly) { setNotice('当前白板为只读，不能移动对象。'); return; }
      if (!selected.length) { setNotice('请先选择要移动的对象。'); return; }
      const step = event.shiftKey ? 10 : 1;
      const delta = { x: direction === 'ArrowRight' ? step : direction === 'ArrowLeft' ? -step : 0, y: direction === 'ArrowDown' ? step : direction === 'ArrowUp' ? -step : 0 };
      if (execute(selectionRoots(doc, selected).map(id => ({ type: 'translate' as const, id, delta })))) setNotice(`已移动 ${selected.length} 个对象：水平 ${delta.x}，垂直 ${delta.y}`);
      return;
    }
    if (direction) {
      event.preventDefault(); const next = nextBoardObject(displayed, effectiveActiveId, direction);
      if (next) { setActiveId(next.id); setNotice(`当前对象：${boardObjectLabel(next)}`); }
      else setNotice('画布中没有可导航对象。');
      return;
    }
    if (event.key === 'Enter' && effectiveActiveId && selected.length === 1 && selected[0] === effectiveActiveId && object && !readOnly && !['connector','drawing'].includes(object.kind)) {
      event.preventDefault(); textEditor.current?.focus(); setNotice(`正在编辑${named(effectiveActiveId)}`); return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && effectiveActiveId) { event.preventDefault(); choose(effectiveActiveId, event.shiftKey && event.key === ' '); return; }
    if (event.key === 'Escape' && tool === 'connect') { event.preventDefault(); setTool('select'); setSelected([]); setNotice('已取消连接'); focusCanvas(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
    if ((event.ctrlKey || event.metaKey) && ['+','=','-'].includes(event.key)) {
      event.preventDefault(); const delta = event.key === '-' ? -.1 : .1;
      setZoom(value => { const next = Math.max(.2, Math.min(2, value + delta)); setNotice(`缩放 ${Math.round(next * 100)}%`); return next; });
    }
  }
  function point(e: PointerEvent): Point { const rect = surface.current!.getBoundingClientRect(); return { x: (e.clientX - rect.left - offset.x) / zoom, y: (e.clientY - rect.top - offset.y) / zoom }; }
  function wrapSelection(kind: 'group' | 'frame') {
    if (readOnly) return;
    const roots = selectionRoots(doc, selected), members = expandSelection(doc, roots).map(id => model.objects.find(item => item.id === id)).filter((item): item is WhiteboardObject => Boolean(item && item.kind !== 'connector'));
    const container = make(kind, (100-offset.x)/zoom, (100-offset.y)/zoom);
    if (members.length) {
      const padding = kind === 'frame' ? 40 : 24, left = Math.min(...members.map(item => item.geometry.x)), top = Math.min(...members.map(item => item.geometry.y));
      const right = Math.max(...members.map(item => item.geometry.x + item.geometry.width)), bottom = Math.max(...members.map(item => item.geometry.y + item.geometry.height));
      container.geometry = { x: left-padding, y: top-padding, width: right-left+padding*2, height: bottom-top+padding*2, rotation: 0 };
    }
    execute([{ type: kind, object: container, memberIds: roots }]); setSelected([container.id]);
  }
  function down(e: PointerEvent, id?: string) {
    if (e.button !== 0) return; e.stopPropagation();
    const p = point(e);
    if (id) setActiveId(id);
    if (tool === 'connect' && !readOnly && id) {
      if (selected.length === 1 && selected[0] !== id) { const from=selected[0]!, connection = make('connector', 0, 0); connection.text = ''; connection.connector = { from, to: id }; execute([{ type: 'create', object: connection }]); setNotice(`已建立连接：${named(from)} 到 ${named(id)}`); setTool('select'); setSelected([]); } else { setSelected([id]); setNotice(`连接起点：${named(id)}。请选择终点。`); } return;
    }
    const ids = id ? e.shiftKey ? selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id] : selected.includes(id) ? selected : [id] : [];
    if (tool !== 'pan') setSelected(ids);
    if (id && tool !== 'pan') setNotice(`${named(id)}，${ids.length} 个已选对象`);
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
    if (g.mode === 'move' && (dx || dy)) execute(selectionRoots(doc, g.ids).map(id => ({ type: 'translate', id, delta: { x: dx, y: dy } })));
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
  const movingIds = new Set(gesture?.mode === 'move' ? expandSelection(doc, gesture.ids) : []);
  const displayed = model.objects.map(o => gesture?.mode === 'move' && movingIds.has(o.id) ? { ...o, geometry: { ...o.geometry, x: o.geometry.x + gesture.current.x - gesture.start.x, y: o.geometry.y + gesture.current.y - gesture.start.y } } : o);
  const viewport = { x: -offset.x / zoom, y: -offset.y / zoom, width: viewportSize.width / zoom, height: viewportSize.height / zoom };
  return <section data-testid="collaborative-editor" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-background-foreground">
    <header data-testid="board-document-header" className="flex max-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border p-2 sm:max-h-24 sm:flex-wrap sm:p-3">{onBack && <Button className="shrink-0" onClick={onBack}>返回白板</Button>}<Input aria-label="白板名称" className="w-48 shrink-0 sm:max-w-64 sm:flex-1" value={title} disabled={readOnly || !onTitleChange} onChange={e => { if (!readOnly) onTitleChange?.(e.target.value); }} /><span className="shrink-0 text-12">{status}{readOnly ? ' · 只读' : ''}</span></header>
    <div role="toolbar" aria-label="白板工具" onFocus={e => { e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }} className="flex max-h-12 shrink-0 flex-nowrap gap-1 overflow-x-auto border-b border-border p-1 sm:max-h-28 sm:flex-wrap sm:overflow-y-auto sm:p-2">
      <Button onClick={() => { setTool('select'); setNotice('已切换到选择工具'); }} aria-pressed={tool==='select'}>选择</Button><Button onClick={() => { setTool('pan'); setNotice('已切换到平移工具'); }} aria-pressed={tool==='pan'}>平移</Button>
      {(['sticky','text','rectangle','ellipse'] as const).map((kind,i) => <Button key={kind} data-testid={`board-add-${kind}`} disabled={readOnly} onClick={() => { const o=make(kind,(100-offset.x)/zoom,(100-offset.y)/zoom); if(execute([{type:'create',object:o}])){setSelected([o.id]);setActiveId(o.id);setNotice(`已创建${boardObjectLabel(o)}`);focusCanvas();} }}>{['便利贴','文字','矩形','椭圆'][i]}</Button>)}
      <Button data-testid="board-group" disabled={readOnly || selectionRoots(doc, selected).length < 2} onClick={() => wrapSelection('group')}>Group</Button>
      <Button data-testid="board-ungroup" disabled={readOnly || !selected.some(id => model.objects.some(item => item.id === id && ['frame','group'].includes(item.kind)))} onClick={() => { execute(selected.flatMap(id => model.objects.some(item => item.id === id && ['frame','group'].includes(item.kind)) ? [{ type: 'ungroup' as const, id }] : [])); setSelected([]); }}>Ungroup</Button>
      <Button data-testid="board-add-frame" disabled={readOnly} onClick={() => wrapSelection('frame')}>创建 Frame</Button>
      <Button disabled={readOnly} aria-pressed={tool==='connect'} onClick={() => { setTool('connect'); setSelected([]); setNotice('连接工具：请选择起点对象'); focusCanvas(); }}>连接</Button><Button disabled={readOnly} aria-pressed={tool==='draw'} onClick={() => { setTool('draw'); setNotice('已切换到画笔工具'); }}>画笔</Button>
      <Button disabled={readOnly} onClick={undo}>撤销</Button><Button disabled={readOnly} onClick={() => { const applied=model.redo(); setNotice(applied?'已重做本地修改':'没有可重做的本地修改。'); }}>重做</Button>
      <Button disabled={!selected.length} onClick={() => { clipboard.current=copyObjects(doc,selected,()=>crypto.randomUUID()); setNotice('已复制到当前白板剪贴板'); }}>复制</Button><Button disabled={readOnly} onClick={() => { const ids=new Map(clipboard.current.map(o=>[o.id,crypto.randomUUID()])); const copied=clipboard.current.map(o=>({...o,id:ids.get(o.id)!,parentId:o.parentId?ids.get(o.parentId)??null:null,connector:o.connector?{from:ids.get(o.connector.from)!,to:ids.get(o.connector.to)!}:undefined,geometry:{...o.geometry,x:o.geometry.x+30,y:o.geometry.y+30}})); execute(copied.map(object=>({type:'create',object}))); setSelected(copied.map(o=>o.id)); }}>粘贴</Button>
      <Button disabled={readOnly || !selected.length} onClick={deleteSelection}>删除选中</Button>
      <Button onClick={()=>setZoom(z=>{const next=Math.max(.2,z-.1);setNotice(`缩放 ${Math.round(next*100)}%`);return next;})}>缩小</Button><span aria-hidden="true" className="p-2 text-12">{Math.round(zoom*100)}%</span><Button onClick={()=>setZoom(z=>{const next=Math.min(2,z+.1);setNotice(`缩放 ${Math.round(next*100)}%`);return next;})}>放大</Button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={surface} tabIndex={0} role="application" aria-label="白板画布。使用方向键导航对象，Enter 或空格选择，Shift 加空格多选，Control 或 Command 加方向键移动。" aria-activedescendant={effectiveActiveId ? `board-a11y-object-${effectiveActiveId}` : undefined} data-testid="board-live-surface" className="absolute inset-0 touch-auto overflow-hidden bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onFocus={() => { const next=nextBoardObject(displayed,effectiveActiveId,'ArrowRight');if(next&&!effectiveActiveId){setActiveId(next.id);setNotice(`当前对象：${boardObjectLabel(next)}`);} }} onKeyDown={canvasKeyDown} onPointerDown={e=>down(e)} onPointerMove={move} onPointerLeave={() => { cursor.current=null; onAwareness?.(null,selected); }} onPointerUp={finish} onPointerCancel={()=>setGesture(null)}>
        <div className="absolute inset-0 origin-top-left" style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${zoom})`}}>
          <WhiteboardRenderer objects={displayed} selected={selected} activeId={effectiveActiveId} viewport={viewport} onPointerDown={down}/>
          {peers.filter(peer=>peer.actorId!==currentUserId).map(peer=><div key={peer.actorId} className="pointer-events-none">
            {peer.selected.map(id=>{const selectedObject=model.objects.find(item=>item.id===id);if(!selectedObject)return null;const g=selectedObject.geometry;return <div key={id} data-testid={`peer-selection-${peer.actorId}-${id}`} className="absolute rounded-control border-2 border-dashed border-primary" style={{left:g.x,top:g.y,width:g.width,height:g.height,transform:`rotate(${g.rotation}deg)`}}/>;})}
            {peer.cursor&&<div data-testid={`peer-cursor-${peer.actorId}`} className="absolute text-primary" style={{left:peer.cursor.x,top:peer.cursor.y}}><span aria-hidden="true">↖</span><span className="rounded-control bg-primary px-1 text-11 text-primary-foreground">{peer.actorId}</span></div>}
          </div>)}
          {gesture?.mode==='draw' && <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"><polyline points={gesture.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/></svg>}
          {gesture?.mode==='box' && <div className="pointer-events-none absolute border border-primary bg-muted opacity-50" style={{left:Math.min(gesture.start.x,gesture.current.x),top:Math.min(gesture.start.y,gesture.current.y),width:Math.abs(gesture.current.x-gesture.start.x),height:Math.abs(gesture.current.y-gesture.start.y)}}/>}
        </div>
      </div>
    {workshop && <div data-testid="board-workshop-overlay" className="absolute inset-x-3 top-3 max-h-[calc(100%-1.5rem)] overflow-y-auto sm:left-auto sm:w-80">{workshop}</div>}
    {object && !auxiliaryPanelOpen && <aside data-testid="board-object-inspector" className="absolute bottom-3 right-3 max-h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] max-w-56 overflow-y-auto rounded-container border border-border bg-card p-3"><label className="text-13">对象文字<Textarea ref={textEditor} key={object.id} aria-label="对象文字" disabled={readOnly} value={draft ?? object.text} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();surface.current?.focus({preventScroll:true});}}} onChange={e=>changeText(e.target.value)} onCompositionStart={()=>{composition.current={id:object.id,before:object.text};setDraft(object.text);}} onCompositionEnd={e=>{const pending=composition.current;composition.current=null;suppressCompositionChange.current=e.currentTarget.value;const current=readObjects(doc).find(o=>o.id===pending?.id);if(current && current.text===pending?.before){execute([{type:'text',id:current.id,...textSplice(current.text,e.currentTarget.value)}]);setDraft(null);}else {setConflictedDraft(e.currentTarget.value);setDraft(null);setNotice('输入期间对象已由其他人修改。已保留此次输入草稿，请核对后重新输入。');}}}/></label>{conflictedDraft !== null && <label className="text-12">未应用的输入草稿<Textarea aria-label="未应用的输入草稿" readOnly value={conflictedDraft}/><Button onClick={()=>setConflictedDraft(null)}>关闭草稿</Button></label>}<p className="mt-2 text-11 text-muted-foreground">Shift+Space 或 Shift 点击多选；Esc 返回画布。</p></aside>}
    </div><p role="status" aria-live="polite" aria-atomic="true" aria-label={`${status}。${notice || `${selected.length} 个已选对象`}`} data-testid="board-live-announcer" className="min-h-6 border-t border-border px-3 text-12">{notice || `${selected.length} 个已选对象`}</p>
  </section>;
}
