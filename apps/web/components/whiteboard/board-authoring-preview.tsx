'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Hand, MousePointer2, Plus, Redo2, StickyNote, Trash2, Type, Undo2, X } from 'lucide-react';

type PreviewState = 'default' | 'loading' | 'empty' | 'validation' | 'dependency-failed' | 'denied' | 'success';
type Note = { id: number; text: string; color: string; x: number; y: number; shape: 'square' | 'rectangle' | 'circle'; kind?: 'sticky' | 'text' };
const palette = ['#ffe68a', '#ffbfdb', '#bdd7ff', '#bdeeda', '#dbcbff', '#ffd1ac'] as const;
const initialNotes: Note[] = [
  { id: 1, text: '更好的想法\n从这里开始', color: palette[0], x: 15, y: 28, shape: 'square' },
  { id: 2, text: 'AI 与人一起思考', color: palette[2], x: 40, y: 28, shape: 'square' },
  { id: 3, text: '把想法连成下一步', color: palette[1], x: 65, y: 28, shape: 'circle' },
];
function seedNotes() {
  if (typeof window === 'undefined') return initialNotes;
  const narrowStep = (144 + 24) * 100 / window.innerHeight;
  const positions = window.innerWidth < 600
    ? [{ x: 12, y: 20 }, { x: 12, y: 20 + narrowStep }, { x: 12, y: 20 + narrowStep * 2 }]
    : window.innerWidth < 900
      ? [{ x: 4, y: 28 }, { x: 36, y: 28 }, { x: 68, y: 28 }]
      : [{ x: 15, y: 28 }, { x: 40, y: 28 }, { x: 65, y: 28 }];
  return initialNotes.map((note, index) => ({ ...note, ...positions[index] }));
}
const states: { key: PreviewState; label: string }[] = [
  { key: 'default', label: '默认' }, { key: 'loading', label: '加载' }, { key: 'empty', label: '空白' },
  { key: 'validation', label: '校验失败' }, { key: 'dependency-failed', label: '保存失败' },
  { key: 'denied', label: '只读' }, { key: 'success', label: '已保存' },
];

export function BoardAuthoringPreview() {
  const [previewState, setPreviewState] = useState<PreviewState>('default');
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [selectedId, setSelectedId] = useState<number | null>(2);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [panel, setPanel] = useState<'note' | 'bulk' | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [history, setHistory] = useState<Note[][]>([]);
  const [future, setFuture] = useState<Note[][]>([]);
  const [panY, setPanY] = useState(0);
  const editor = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const nextId = useRef(4);
  const readonly = previewState === 'denied';
  const selected = notes.find(note => note.id === selectedId);
  const bulkLines = bulkText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  useEffect(() => {
    setNotes(seedNotes());
    const value = new URLSearchParams(window.location.search).get('state');
    if (states.some(state => state.key === value)) chooseState(value as PreviewState);
  }, []);
  useEffect(() => { if (editingId !== null) editor.current?.focus(); }, [editingId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); addNote(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function chooseState(value: PreviewState) {
    setPreviewState(value);
    setNotes(value === 'empty' ? [] : seedNotes());
    setPanY(0);
    setSelectedId(value === 'empty' || value === 'loading' ? null : 2);
    setEditingId(null);
    setPanel(value === 'validation' ? 'bulk' : null);
    setBulkText(value === 'validation' ? Array.from({ length: 501 }, (_, index) => `想法 ${index + 1}`).join('\n') : '');
  }
  function commit(updated: Note[]) { setHistory(old => [...old, notes]); setFuture([]); setNotes(updated); }
  function nextPosition(previous?: Note) {
    if (!previous || typeof window === 'undefined') return { x: 12, y: 24 };
    const width = window.innerWidth;
    const height = window.innerHeight;
    const size = width < 900 ? 144 : 208;
    const stepX = (size + 24) * 100 / width;
    const stepY = (size + 24) * 100 / height;
    const collides = (x: number, y: number) => notes.some(note =>
      Math.abs((note.x - x) * width / 100) < size + 24 &&
      Math.abs((note.y - y) * height / 100) < size + 24,
    );
    const right = previous.x + stepX;
    let position = right + size * 100 / width < 98 && !collides(right, previous.y)
      ? { x: right, y: previous.y }
      : { x: previous.x, y: previous.y + stepY };
    while (collides(position.x, position.y)) position = { x: position.x, y: position.y + stepY };
    if (position.y - panY > 62) setPanY(Math.max(0, position.y - 42));
    return position;
  }
  function addNote() {
    if (readonly || previewState === 'loading' || previewState === 'dependency-failed') return;
    const previous = notes.find(note => note.id === editingId) ?? notes.find(note => note.id === selectedId);
    const created: Note = { id: nextId.current++, text: '', color: palette[0], ...nextPosition(previous), shape: 'square' };
    commit([...notes, created]); setSelectedId(created.id); setEditingId(created.id); setPanel(null);
  }
  function addText() {
    if (readonly || previewState === 'loading' || previewState === 'dependency-failed') return;
    const created: Note = { id: nextId.current++, text: '', color: '#ffffff', x: 38, y: 60, shape: 'rectangle', kind: 'text' };
    commit([...notes, created]); setSelectedId(created.id); setEditingId(created.id);
  }
  function updateNote(id: number, change: Partial<Note>) { setNotes(old => old.map(note => note.id === id ? { ...note, ...change } : note)); }
  function duplicate() {
    if (!selected || readonly) return;
    const duplicateNote = { ...selected, id: nextId.current++, x: Math.min(selected.x + 4, 80), y: Math.min(selected.y + 4, 70) };
    commit([...notes, duplicateNote]); setSelectedId(duplicateNote.id);
  }
  function remove() { if (selected && !readonly) { commit(notes.filter(note => note.id !== selected.id)); setSelectedId(null); setEditingId(null); } setShowDelete(false); }
  function undo() { const before = history.at(-1); if (!before) return; setFuture(old => [...old, notes]); setNotes(before); setHistory(old => old.slice(0, -1)); }
  function redo() { const after = future.at(-1); if (!after) return; setHistory(old => [...old, notes]); setNotes(after); setFuture(old => old.slice(0, -1)); }
  function applyBulk() {
    if (readonly || bulkLines.length < 1 || bulkLines.length > 500) return;
    const created = bulkLines.map((text, index): Note => ({ id: nextId.current++, text, color: palette[index % palette.length] ?? palette[0], x: 13 + (index % 5) * 17, y: 12 + Math.floor(index / 5) * 18, shape: 'square' }));
    commit([...notes, ...created]); setSelectedId(created[0]?.id ?? null); setPanel(null);
  }
  return <main className="wx-light fixed inset-0 overflow-hidden bg-background text-background-foreground" data-testid="board-authoring-preview">
    <style>{`.authoring-grid{background-image:radial-gradient(hsl(var(--border)) 0.7px,transparent 0.7px);background-size:24px 24px}.authoring-note{transition:transform .18s ease,box-shadow .18s ease}.authoring-note:hover{transform:translateY(-3px)}@media(prefers-reduced-motion:reduce){.authoring-note{transition:none}.authoring-note:hover{transform:none}}`}</style>
    <header className="absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 shadow-sm" data-testid="board-authoring-header">
      <div className="flex items-center gap-3"><button type="button" aria-label="返回白板列表" className="rounded-lg p-2 transition-colors hover:bg-accent" data-testid="board-authoring-back"><ArrowLeft size={20} /></button><span className="font-bold tracking-tight">WorkspaceX</span><span className="hidden border-l pl-3 text-sm text-muted-foreground sm:inline">团队脑暴</span><ChevronDown size={15} className="hidden sm:block" /><span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex"><Check size={14} /> 设计预览 · 不保存</span></div>
      <div className="flex items-center gap-2 text-sm"><button type="button" onClick={undo} disabled={!history.length} aria-label="撤销" data-testid="board-authoring-undo" className="rounded-lg p-2 transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground"><Undo2 size={18} /></button><button type="button" onClick={redo} disabled={!future.length} aria-label="重做" data-testid="board-authoring-redo" className="rounded-lg p-2 transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground"><Redo2 size={18} /></button><span className="hidden rounded-full bg-ai-tint px-3 py-1 text-ai-tint-foreground sm:inline">设计签核预览</span></div>
    </header>
    <section className="authoring-grid absolute inset-0 pt-16" aria-label="白板预览画布" data-testid="board-authoring-canvas" onDoubleClick={event => { if (event.target === event.currentTarget) addNote(); }}>
      {previewState === 'loading' ? <div className="mx-auto mt-40 max-w-sm animate-pulse rounded-2xl bg-background p-8 text-center shadow-md" data-testid="board-authoring-loading">正在打开白板…</div> : null}
      {previewState === 'empty' && notes.length === 0 ? <div className="mx-auto mt-36 max-w-sm rounded-2xl bg-background p-8 text-center shadow-md" data-testid="board-authoring-empty"><StickyNote className="mx-auto mb-4 text-ai" size={40} /><h2 className="text-xl font-semibold">放下第一个想法</h2><p className="mt-2 text-sm text-muted-foreground">双击空白处，或按 N 创建便利贴。</p><button type="button" onClick={addNote} className="mt-5 rounded-xl bg-primary px-4 py-3 text-primary-foreground" data-testid="board-authoring-empty-create">创建便利贴</button></div> : null}
      {previewState !== 'loading' && notes.map(note => <article key={note.id} data-testid={`board-authoring-note-${note.id}`} onClick={() => setSelectedId(note.id)} onDoubleClick={event => { event.stopPropagation(); if (!readonly) { setSelectedId(note.id); setEditingId(note.id); } }} className={`authoring-note absolute flex w-36 cursor-pointer items-center justify-center p-4 text-left lg:w-52 lg:p-5 ${note.kind === 'text' ? 'h-28 bg-transparent shadow-none' : `aspect-square shadow-md ${note.shape === 'circle' ? 'rounded-full' : note.shape === 'rectangle' ? 'rounded-md' : 'rounded-sm'}`} ${selectedId === note.id ? 'ring-2 ring-ai' : ''}`} style={{ left: `${note.x}%`, top: `${note.y - panY}%`, backgroundColor: note.kind === 'text' ? 'transparent' : note.color }}>
        {editingId === note.id ? <div ref={editor} role="textbox" aria-label="编辑便利贴内容" aria-multiline="true" contentEditable suppressContentEditableWarning data-testid="board-authoring-inline-editor" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Tab' && !composing.current) { event.preventDefault(); const text = event.currentTarget.textContent ?? ''; const current = notes.map(item => item.id === note.id ? { ...item, text } : item); const created: Note = { id: nextId.current++, text: '', color: palette[0], ...nextPosition(note), shape: 'square' }; commit([...current, created]); setSelectedId(created.id); setEditingId(created.id); } if (event.key === 'Escape') { event.preventDefault(); setEditingId(null); } }} onBlur={event => { updateNote(note.id, { text: event.currentTarget.textContent ?? '' }); setEditingId(id => id === note.id ? null : id); }} className="h-full w-full cursor-text overflow-auto whitespace-pre-wrap break-words bg-transparent text-lg leading-relaxed caret-ai focus:outline-transparent lg:text-xl" dir="auto">{note.text}</div> : <p className="w-full whitespace-pre-wrap break-words text-lg leading-relaxed lg:text-xl" dir="auto">{note.text || '输入想法…'}</p>}
      </article>)}
      {selected && editingId === null && previewState !== 'loading' && <div className="absolute left-1/2 top-24 z-20 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-2xl border bg-background p-2 shadow-lg" data-testid="board-authoring-floating-toolbar">
        <button type="button" aria-label="便利贴颜色" onClick={() => setPanel(panel === 'note' ? null : 'note')} className="rounded-lg p-2 transition-colors hover:bg-accent" data-testid="board-authoring-color"><span className="block h-5 w-5 rounded-full border" style={{ backgroundColor: selected.color }} /></button><button type="button" onClick={() => setEditingId(selected.id)} disabled={readonly} className="rounded-lg p-2 transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground" aria-label="编辑文字" data-testid="board-authoring-edit"><Type size={19} /></button><button type="button" onClick={duplicate} disabled={readonly} className="rounded-lg p-2 transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground" aria-label="复制便利贴" data-testid="board-authoring-duplicate"><Copy size={18} /></button><button type="button" onClick={() => setShowDelete(true)} disabled={readonly} className="rounded-lg p-2 transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground" aria-label="删除便利贴" data-testid="board-authoring-delete"><Trash2 size={18} /></button>
      </div>}
      {panel === 'note' && selected && <aside className="absolute bottom-28 left-1/2 z-20 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border bg-background p-5 shadow-xl" data-testid="board-authoring-note-menu"><div className="flex items-center justify-between"><h2 className="font-semibold">便利贴</h2><button type="button" onClick={() => setPanel(null)} aria-label="关闭便利贴菜单"><X size={18} /></button></div><p className="mt-4 text-xs text-muted-foreground">颜色</p><div className="mt-2 flex gap-3">{palette.map((color, index) => <button key={color} type="button" disabled={readonly} onClick={() => updateNote(selected.id, { color })} aria-label={`颜色 ${index + 1}`} aria-pressed={selected.color === color} data-testid={`board-authoring-palette-${index}`} className="h-10 w-10 rounded-lg border-2 disabled:bg-disabled disabled:text-disabled-foreground" style={{ background: color, borderColor: selected.color === color ? 'hsl(var(--ai))' : 'transparent' }} />)}</div><p className="mt-4 text-xs text-muted-foreground">形状</p><div className="mt-2 flex gap-2">{(['square', 'rectangle', 'circle'] as const).map(shape => <button key={shape} type="button" disabled={readonly} aria-pressed={selected.shape === shape} onClick={() => updateNote(selected.id, { shape })} className={`flex-1 rounded-lg border p-3 text-sm ${selected.shape === shape ? 'border-ai bg-ai-tint' : ''}`}>{shape === 'square' ? '方形' : shape === 'rectangle' ? '矩形' : '圆形'}</button>)}</div></aside>}
      {previewState === 'dependency-failed' && <aside role="alert" className="absolute left-1/2 top-28 z-20 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-destructive/40 bg-background p-4 shadow-lg" data-testid="board-authoring-dependency-failed"><strong>暂时无法保存</strong><p className="mt-1 text-sm text-muted-foreground">想法仍在本页草稿中。恢复连接后重试。</p><button type="button" onClick={() => setPreviewState('success')} className="mt-3 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" data-testid="board-authoring-retry">重试预览</button></aside>}
      {readonly && <aside className="absolute left-1/2 top-28 z-20 -translate-x-1/2 rounded-full border bg-background px-4 py-2 text-sm shadow-md" data-testid="board-authoring-denied">只读访问 · 可以浏览，不能修改</aside>}
      {previewState === 'success' && <aside className="absolute right-6 top-24 z-20 rounded-full border bg-background px-4 py-2 text-sm shadow-md" data-testid="board-authoring-success">✓ 已保存（预览状态）</aside>}
    </section>
    <div className="absolute bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-background/95 p-2 shadow-md" data-testid="board-authoring-state-switcher"><span className="mr-2 text-xs text-muted-foreground">状态预览</span><select value={previewState} onChange={event => chooseState(event.target.value as PreviewState)} aria-label="切换预览状态" className="rounded p-2 text-xs" data-testid="board-authoring-state-select">{states.map(state => <option key={state.key} value={state.key}>{state.label}</option>)}</select></div>
    <nav className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border bg-background p-2 shadow-xl" aria-label="白板工具" data-testid="board-authoring-dock"><button type="button" className="rounded-xl bg-primary p-3 text-primary-foreground" aria-label="选择"><MousePointer2 size={20} /></button><button type="button" className="rounded-xl p-3 transition-colors hover:bg-accent" aria-label="移动画布"><Hand size={20} /></button><span className="mx-1 h-8 border-l" /><button type="button" disabled={readonly || previewState === 'loading'} onClick={addNote} className="flex min-w-14 flex-col items-center rounded-xl px-2 py-1 text-xs transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground" data-testid="board-authoring-add-note"><StickyNote size={24} fill={palette[0]} strokeWidth={1.5} />便利贴</button><button type="button" disabled={readonly} onClick={() => setPanel('bulk')} className="flex min-w-14 flex-col items-center rounded-xl px-2 py-1 text-xs transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground" data-testid="board-authoring-bulk-open"><Plus size={24} />批量</button><button type="button" disabled={readonly} onClick={addText} className="flex min-w-14 flex-col items-center rounded-xl px-2 py-1 text-xs transition-colors hover:bg-accent disabled:bg-disabled disabled:text-disabled-foreground" data-testid="board-authoring-add-text"><Type size={24} />文字</button></nav>
    {panel === 'bulk' && <div className="absolute inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true" aria-label="批量创建便利贴" data-testid="board-authoring-bulk-dialog"><div className="w-full max-w-xl rounded-2xl bg-background p-6 shadow-2xl"><div className="flex justify-between"><div><h2 className="text-xl font-semibold">一次放下所有想法</h2><p className="mt-1 text-sm text-muted-foreground">每行一张便利贴，最多 500 张。此处只演示视觉与本地交互。</p></div><button type="button" onClick={() => setPanel(null)} aria-label="关闭批量创建"><X /></button></div><textarea aria-label="批量便利贴内容" data-testid="board-authoring-bulk-text" value={bulkText} onChange={event => setBulkText(event.target.value)} className="mt-5 h-40 w-full resize-none rounded-xl border p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="访谈发现一\n访谈发现二\n下一步…" /><div className="mt-3 text-sm" data-testid="board-authoring-bulk-count">将创建 {bulkLines.length} 张便利贴</div>{(bulkLines.length > 500 || (previewState === 'validation' && bulkLines.length === 0)) && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="board-authoring-validation">{bulkLines.length > 500 ? '超过 500 张上限，请先缩减内容；原文会保留。' : '请先输入至少一行内容。'}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPanel(null)} className="rounded-lg border px-4 py-2">取消</button><button type="button" onClick={applyBulk} disabled={bulkLines.length < 1 || bulkLines.length > 500} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:bg-disabled disabled:text-disabled-foreground" data-testid="board-authoring-bulk-apply">生成便利贴</button></div></div></div>}
    {showDelete && <div className="absolute inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true" aria-label="删除便利贴" data-testid="board-authoring-delete-dialog"><div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-2xl"><h2 className="text-lg font-semibold">删除这张便利贴？</h2><p className="mt-2 text-sm text-muted-foreground">这只会删除预览中的对象，可以使用撤销恢复。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowDelete(false)} className="rounded-lg border px-4 py-2">取消</button><button type="button" onClick={remove} className="rounded-lg bg-destructive px-4 py-2 text-destructive-foreground" data-testid="board-authoring-confirm-delete">删除</button></div></div></div>}
  </main>;
}
