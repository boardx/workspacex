"use client";
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowRight, Circle, Frame, Hand, Minus, MousePointer2, Plus, Redo2, Square, StickyNote, Trash2, Type, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { RESERVED_STATE_TESTID, type UiState } from '@/lib/ui-state';
import { initialDocument, makeObject, tones, toneLabels, type Kind, type Tone, type PreviewDocument } from './preview-model';

type Gesture = { pointer: number; id: string | null; sx: number; sy: number; x: number; y: number; before: PreviewDocument };
export function WhiteboardScreen({ state = 'default' }: { state?: UiState }) {
  const [doc, setDoc] = useState(() => initialDocument(state === 'empty'));
  const [past, setPast] = useState<PreviewDocument[]>([]), [future, setFuture] = useState<PreviewDocument[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'pan' | 'connect'>('select');
  const [zoom, setZoom] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 });
  const [title, setTitle] = useState('团队创意工作坊'), [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(false), [bulk, setBulk] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const surface = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), editing = useRef<PreviewDocument | null>(null);
  const object = doc.objects.find((o) => o.id === selected);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const resize = () => {
      if (element.clientWidth >= 1000 || state === 'empty') return;
      // Initial fixture bounds: fit the whole workshop on narrow screens.
      const initial = initialDocument(false).objects;
      const left = Math.min(...initial.map((o) => o.x)), top = Math.min(...initial.map((o) => o.y));
      const width = Math.max(...initial.map((o) => o.x + o.width)) - left;
      const height = Math.max(...initial.map((o) => o.y + o.height)) - top;
      const z = Math.max(0.1, Math.min(1, (element.clientWidth - 104) / width, (element.clientHeight - 100) / height));
      setZoom(z); setOffset({ x: 80 - left * z, y: 55 - top * z });
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [state]);
  function commit(next: PreviewDocument) { setPast((p) => [...p.slice(-99), doc]); setFuture([]); setDoc(next); }
  function add(kind: Kind) {
    const width = surface.current?.clientWidth || 800;
    const next = makeObject(kind, (width / 2 - offset.x) / zoom - 96, (180 - offset.y) / zoom);
    commit({ ...doc, objects: [...doc.objects, next] }); setSelected(next.id); setTool('select');
  }
  function begin(e: PointerEvent, id: string | null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (id && tool === 'connect') {
      if (selected && selected !== id) { commit({ ...doc, edges: [...doc.edges, { id: crypto.randomUUID(), from: selected, to: id }] }); setTool('select'); setNotice('已建立连接 · 本地预览'); }
      setSelected(id); return;
    }
    const item = tool === 'pan' ? undefined : doc.objects.find((o) => o.id === id);
    if (tool !== 'pan') setSelected(id);
    if (!item && tool !== 'pan') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointer: e.pointerId, id: item?.id ?? null, sx: e.clientX, sy: e.clientY, x: item?.x ?? offset.x, y: item?.y ?? offset.y, before: doc };
  }
  function move(e: PointerEvent) {
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (g.id) setDoc({ ...g.before, objects: g.before.objects.map((o) => o.id === g.id ? { ...o, x: g.x + dx / zoom, y: g.y + dy / zoom } : o) });
    else setOffset({ x: g.x + dx, y: g.y + dy });
  }
  function finish(e: PointerEvent, cancel = false) {
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    if (g.id) { if (cancel) setDoc(g.before); else if (g.sx !== e.clientX || g.sy !== e.clientY) { setPast((p) => [...p.slice(-99), g.before]); setFuture([]); } }
    gesture.current = null;
  }
  function zoomTo(value: number) {
    const z = Math.max(0.25, Math.min(2, value)), cx = (surface.current?.clientWidth || 800) / 2, cy = (surface.current?.clientHeight || 600) / 2;
    setOffset({ x: cx - (cx - offset.x) * z / zoom, y: cy - (cy - offset.y) * z / zoom }); setZoom(z);
  }
  function fit() {
    if (!doc.objects.length) return;
    const x = Math.min(...doc.objects.map((o) => o.x)), y = Math.min(...doc.objects.map((o) => o.y));
    const w = Math.max(...doc.objects.map((o) => o.x + o.width)) - x, h = Math.max(...doc.objects.map((o) => o.y + o.height)) - y;
    const sw = surface.current?.clientWidth || 800, sh = surface.current?.clientHeight || 600;
    const z = Math.max(0.1, Math.min(1, (sw - 120) / w, (sh - 100) / h));
    setZoom(z); setOffset({ x: (sw - w * z) / 2 - x * z, y: (sh - h * z) / 2 - y * z });
  }
  if (state === 'loading') return <div data-testid="loading" role="status" className="m-6 h-64 animate-pulse rounded-container bg-muted p-6">正在打开白板…</div>;
  if (state === 'denied' || state === 'dep-failed') return <section data-testid={RESERVED_STATE_TESTID[state]} role="alert" className="m-auto max-w-lg p-8"><h1 className="mb-3 text-20 font-semibold">{state === 'denied' ? '你还没有这块白板的访问权限' : '暂时无法连接白板'}</h1><p className="text-14 text-muted-foreground">{state === 'denied' ? '请联系白板所有者获取访问权限。' : '请检查网络后重新打开。这是失败状态示例，内容未保存。'}</p></section>;
  return <section data-testid="whiteboard-screen" className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-background-foreground">
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3"><Link href="/projects" data-testid="whiteboard-exit" className="rounded-control px-2 py-1 text-12 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">返回工作区</Link><span className="flex items-center gap-2 text-16 font-semibold"><StickyNote className="h-5 w-5 text-primary" />Board</span><Input data-testid="whiteboard-title" aria-label="白板名称" className="max-w-64 border-transparent font-medium" value={title} onChange={(e) => setTitle(e.target.value)} /><span className="ml-auto text-12 text-muted-foreground">{doc.objects.length} 个对象</span><Button className="lg:hidden" data-testid="whiteboard-panel-toggle" variant="outline" onClick={() => { setPanelOpen((v) => !v); setSelected(null); }}>对象</Button><Button data-testid="whiteboard-fit" variant="outline" onClick={fit}>适应内容</Button></header>
    <p data-testid="whiteboard-preview-notice" className="border-b border-border bg-warning-tint px-4 py-2 text-12 text-warning-tint-foreground">交互预览 · 改动未保存，刷新会重置。多人协作、Chat 导入和工作坊服务尚未接入。</p>
    {state === 'invalid' && <p data-testid="err-form" role="alert" className="bg-destructive p-3 text-destructive-foreground">无法插入：图表尚未生成完整，请等待生成完成。</p>}
    {state === 'success' && <p data-testid="saved" role="status" className="bg-muted p-3 text-13">成功状态示例：操作已应用到本地预览，尚未写入服务端。</p>}
    <div className="relative flex min-h-0 flex-1">
      <div ref={surface} data-testid="whiteboard-surface" aria-label="白板画布" className={cn('relative min-h-96 flex-1 overflow-hidden touch-none bg-panel-alt', tool === 'pan' && 'cursor-grab')} onPointerDown={(e) => begin(e, null)} onPointerMove={move} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)}>
        <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true"><defs><marker id="board-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs>{doc.edges.map((edge) => { const a = doc.objects.find((o) => o.id === edge.from), b = doc.objects.find((o) => o.id === edge.to); return a && b ? <line key={edge.id} x1={a.x + a.width} y1={a.y + a.height / 2} x2={b.x} y2={b.y + b.height / 2} stroke="currentColor" strokeWidth="2" markerEnd="url(#board-arrow)" /> : null; })}</svg>
          {[...doc.objects].sort((a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame')).map((o) => <button key={o.id} type="button" data-testid={`whiteboard-object-${o.id}`} aria-label={`图形：${o.text}`} aria-pressed={selected === o.id} onPointerDown={(e) => begin(e, o.id)} onClick={() => setSelected(o.id)} onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); const step = e.shiftKey ? 20 : 5; commit({ ...doc, objects: doc.objects.map((n) => n.id === o.id ? { ...n, x: n.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), y: n.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) } : n) }); } }} className={cn('absolute flex whitespace-pre-wrap break-words p-5 text-left text-16 leading-relaxed transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', o.kind === 'frame' ? 'items-start border-2 border-dashed border-border bg-transparent text-muted-foreground' : o.kind === 'text' ? 'bg-transparent text-background-foreground' : tones[o.tone], o.kind === 'ellipse' ? 'items-center justify-center rounded-full' : 'rounded-control', o.kind !== 'frame' && o.kind !== 'text' && 'shadow-sm', selected === o.id && 'ring-2 ring-ring ring-offset-2')} style={{ left: o.x, top: o.y, width: o.width, height: o.height }}>{o.text}</button>)}
        </div>
        {!doc.objects.length && <div data-testid="empty" className="pointer-events-none absolute inset-0 flex items-center justify-center p-20 text-center"><div><StickyNote className="mx-auto mb-4 h-10 w-10 text-primary" /><h2 className="text-20 font-semibold">从一个想法开始</h2><p className="mt-2 text-14 text-muted-foreground">点击左侧便利贴，把第一个想法放上来。</p></div></div>}
      </div>
      <nav aria-label="白板工具" className="absolute left-3 top-4 flex flex-col gap-1 rounded-container border border-border bg-card p-1.5 shadow-md">
        {([{ id: 'select', label: '选择', icon: MousePointer2 }, { id: 'pan', label: '移动画布', icon: Hand }, { id: 'connect', label: '连接两个对象', icon: ArrowRight }] as const).map((t) => <Button key={t.id} size="icon" title={t.label} aria-label={t.label} aria-pressed={tool === t.id} data-testid={`whiteboard-tool-${t.id}`} variant={tool === t.id ? 'primary' : 'ghost'} onClick={() => { setTool(t.id); if (t.id === 'connect') { setSelected(null); setNotice('依次选择两个对象来建立连接'); } }}><t.icon className="h-4 w-4" /></Button>)}
        <hr className="my-1 border-border" />
        {([{ id: 'sticky', label: '添加便利贴', icon: StickyNote }, { id: 'rectangle', label: '添加矩形', icon: Square }, { id: 'ellipse', label: '添加圆形', icon: Circle }, { id: 'text', label: '添加文字', icon: Type }, { id: 'frame', label: '添加 Frame', icon: Frame }] as const).map((t) => <Button key={t.id} size="icon" title={t.label} aria-label={t.label} data-testid={`whiteboard-add-${t.id}`} variant="ghost" onClick={() => add(t.id)}><t.icon className="h-4 w-4" /></Button>)}
        <Button size="icon" title="批量便签" aria-label="批量便签" data-testid="whiteboard-bulk-open" variant="ghost" onClick={() => setBulk('')}><Plus className="h-4 w-4" /></Button>
      </nav>
      <aside className={cn("absolute right-3 top-4 max-h-full w-56 overflow-auto rounded-container border border-border bg-card p-3 shadow-md max-lg:bottom-16 max-lg:top-auto max-lg:max-h-56", !panelOpen && !object && "max-lg:hidden")} aria-label="对象属性"><Button data-testid="whiteboard-panel-close" size="sm" variant="ghost" className="mb-2 lg:hidden" onClick={() => { setSelected(null); setPanelOpen(false); }}>收起属性</Button>
        {object ? <div className="space-y-3"><h2 className="text-13 font-semibold">编辑选中对象</h2><Textarea data-testid="whiteboard-object-text" aria-label="对象文字" value={object.text} onFocus={() => { editing.current = doc; }} onChange={(e) => { if (!editing.current) editing.current = doc; setDoc({ ...doc, objects: doc.objects.map((o) => o.id === selected ? { ...o, text: e.target.value } : o) }); }} onBlur={() => { if (editing.current && editing.current !== doc) { const before = editing.current; setPast((p) => [...p.slice(-99), before]); setFuture([]); } editing.current = null; }} /><div className="flex gap-1">{(Object.keys(tones) as Tone[]).map((tone) => <Button key={tone} data-testid={`whiteboard-tone-${tone}`} size="sm" variant={object.tone === tone ? 'primary' : 'outline'} onClick={() => commit({ ...doc, objects: doc.objects.map((o) => o.id === selected ? { ...o, tone } : o) })}>{toneLabels[tone]}</Button>)}</div><Button data-testid="whiteboard-delete" variant="outline" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" />删除对象</Button><p className="text-11 text-muted-foreground">拖动调整位置；聚焦对象后可用方向键微调。</p></div> : <div className="space-y-3"><h2 className="text-13 font-semibold">找到一个想法</h2><Input data-testid="whiteboard-search" aria-label="搜索白板对象" placeholder="搜索文字" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="space-y-1">{doc.objects.filter((o) => o.text.includes(search)).slice(0, 8).map((o) => <Button key={o.id} data-testid={`whiteboard-find-${o.id}`} className="w-full justify-start truncate" variant="ghost" onClick={() => { setSelected(o.id); setOffset({ x: 100 - o.x * zoom, y: 100 - o.y * zoom }); }}>{o.text.split('\n')[0]}</Button>)}</div><p className="text-11 text-muted-foreground">选中对象编辑文字，或从左侧添加内容。</p></div>}
      </aside>
      <div className="absolute bottom-4 left-3 flex items-center gap-1 rounded-container border border-border bg-card p-1 shadow-sm"><Button data-testid="whiteboard-undo" aria-label="撤销" size="icon" variant="ghost" disabled={!past.length} onClick={() => { const previous = past.at(-1); if (previous) { setFuture((f) => [doc, ...f]); setPast((p) => p.slice(0, -1)); setDoc(previous); setSelected(null); } }}><Undo2 className="h-4 w-4" /></Button><Button data-testid="whiteboard-redo" aria-label="重做" size="icon" variant="ghost" disabled={!future.length} onClick={() => { if (future[0]) { setPast((p) => [...p, doc]); setDoc(future[0]); setFuture((f) => f.slice(1)); setSelected(null); } }}><Redo2 className="h-4 w-4" /></Button><Button data-testid="whiteboard-zoom-out" aria-label="缩小" size="icon" variant="ghost" onClick={() => zoomTo(zoom - 0.1)}><Minus className="h-4 w-4" /></Button><span data-testid="whiteboard-zoom" className="w-12 text-center text-12">{Math.round(zoom * 100)}%</span><Button data-testid="whiteboard-zoom-in" aria-label="放大" size="icon" variant="ghost" onClick={() => zoomTo(zoom + 0.1)}><Plus className="h-4 w-4" /></Button></div>
    </div>
    <p role="status" data-testid="whiteboard-announcement" className="min-h-6 border-t border-border px-4 text-12 text-muted-foreground">{notice || '一张白板，一起把想法变清楚。'}</p>
    <Dialog open={deleting || bulk !== null} onOpenChange={(open) => { if (!open) { setDeleting(false); setBulk(null); } }}><DialogContent closeTestId="whiteboard-dialog-close">{deleting ? <><DialogTitle>删除这个对象？</DialogTitle><DialogDescription>它的连接线也会移除。本地预览中可以撤销。</DialogDescription><div className="flex gap-2"><Button data-testid="whiteboard-delete-cancel" onClick={() => setDeleting(false)}>取消</Button><Button data-testid="whiteboard-delete-confirm" variant="destructive" onClick={() => { commit({ objects: doc.objects.filter((o) => o.id !== selected), edges: doc.edges.filter((e) => e.from !== selected && e.to !== selected) }); setSelected(null); setDeleting(false); }}>确认删除</Button></div></> : <><DialogTitle>每一行，一个想法</DialogTitle><Textarea data-testid="whiteboard-bulk-text" aria-label="批量便签文字" value={bulk ?? ''} onChange={(e) => setBulk(e.target.value)} /><DialogDescription>单次最多 50 张，只应用到当前预览。</DialogDescription><div className="flex gap-2"><Button data-testid="whiteboard-bulk-cancel" onClick={() => setBulk(null)}>取消</Button><Button data-testid="whiteboard-bulk-apply" variant="primary" disabled={!bulk?.trim() || bulk.split('\n').filter((l) => l.trim()).length > 50} onClick={() => { const notes = (bulk ?? '').split('\n').filter((l) => l.trim()).map((text, i) => ({ ...makeObject('sticky', 100 + (i % 4) * 215, 100 + Math.floor(i / 4) * 180), text: text.trim() })); commit({ ...doc, objects: [...doc.objects, ...notes] }); setBulk(null); setNotice(`已添加 ${notes.length} 张便签 · 本地预览`); }}>添加便签</Button></div></>}</DialogContent></Dialog>
  </section>;
}
