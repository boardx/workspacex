'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Grid2X2, List, Plus, Search, Tag, X } from 'lucide-react';
import { whiteboard as C } from '@repo/contracts';
import { BoardCardAction, BoardCardMenu } from './board-card-menu';
import { BoardTagManager } from './board-tag-manager';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import * as api from '@/lib/live-whiteboard';
import { RESERVED_STATE_TESTID } from '@/lib/ui-state';

type Failure = { kind: 'denied' | 'dep-failed' | 'invalid'; message: string };
type BoardDialog = { action: Exclude<BoardCardAction, 'tags' | 'archive' | 'restore'>; board: api.Board } | null;
const EDITOR_PATH = (id: string) => `/studio/board/${encodeURIComponent(id)}`;
function failure(error: unknown): Failure {
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return { kind: 'denied', message: '无法访问这块白板。请确认当前账号、组织与授权后刷新。' };
  if (error instanceof ApiError && [400, 409, 412].includes(error.status)) return { kind: 'invalid', message: '提交内容已过期或未通过校验，请刷新后重试。' };
  return { kind: 'dep-failed', message: '暂时无法完成请求，请稍后重试。' };
}

export function WhiteboardLibrary() {
  const router = useRouter();
  const [items, setItems] = useState<api.Board[]>([]), [tags, setTags] = useState<api.BoardTag[]>([]);
  const [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState(''), [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived'>('active'), [view, setView] = useState<'grid' | 'list'>('grid');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [newName, setNewName] = useState(''), [dialogName, setDialogName] = useState(''), [tagName, setTagName] = useState('');
  const [tagEdits, setTagEdits] = useState<Record<string, string>>({}), [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BoardDialog>(null), [tagBoard, setTagBoard] = useState<api.Board | null>(null), [showTagCatalog, setShowTagCatalog] = useState(false);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState<Failure | null>(null), [notice, setNotice] = useState('');
  const pendingCreate = useRef<api.CreateBoardInput | null>(null), pendingMutation = useRef<{ key: string; requestId: string } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null), createInput = useRef<HTMLInputElement>(null);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250); return () => window.clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [result, catalog] = await Promise.all([api.listBoards({ query: debouncedQuery || undefined, tagIds: selectedTags, archived: archiveFilter, limit: 30 }), api.listBoardTags()]);
      setItems(result.items); setNextCursor(result.nextCursor); setTags(catalog); setLoaded(true);
    } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  }, [archiveFilter, debouncedQuery, selectedTags]);
  useEffect(() => { void load(); }, [load]);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null); setNotice('');
    try { await work(); } catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  }, [busy]);
  const restoreFocus = () => window.requestAnimationFrame(() => (returnFocus.current?.isConnected ? returnFocus.current : createInput.current)?.focus());
  const closeDialog = () => {
    setDialog(null); setTagBoard(null); setShowTagCatalog(false); setDialogName('');
    restoreFocus();
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!C.Board.shape.name.safeParse(newName).success) return setError({ kind: 'invalid', message: '请输入 1–200 字的白板名称。' });
    if (!pendingCreate.current) pendingCreate.current = { requestId: crypto.randomUUID(), name: newName.trim() };
    void run(async () => {
      try {
        const board = await api.createBoard(pendingCreate.current!);
        pendingCreate.current = null; router.push(EDITOR_PATH(board.id));
      } catch (cause) { if (cause instanceof ApiError && cause.status === 400) pendingCreate.current = null; throw cause; }
    });
  };
  const loadMore = () => void run(async () => {
    if (!nextCursor) return;
    const result = await api.listBoards({ query: debouncedQuery || undefined, tagIds: selectedTags, archived: archiveFilter, limit: 30, cursor: nextCursor });
    setItems(value => [...value, ...result.items]); setNextCursor(result.nextCursor);
  });
  const updateLocal = (board: api.Board) => setItems(value => value.map(item => item.id === board.id ? board : item));
  const immediate = (board: api.Board, action: 'archive' | 'restore', trigger: HTMLElement) => {
    returnFocus.current = trigger;
    void run(async () => { await api.updateBoard(board.id, { archived: action === 'archive' }); setNotice(action === 'archive' ? '白板已归档。' : '白板已恢复。'); await load(); restoreFocus(); });
  };
  const openAction = (board: api.Board, action: BoardCardAction, trigger: HTMLElement) => {
    if (action === 'archive' || action === 'restore') return immediate(board, action, trigger);
    returnFocus.current = trigger;
    if (action === 'tags') setTagBoard(board);
    else { setDialog({ action, board }); setDialogName(action === 'duplicate' ? `${board.name} 副本` : board.name); }
  };
  const mutateBoard = () => {
    if (!dialog) return;
    const { action, board } = dialog;
    if (action !== 'delete' && !C.Board.shape.name.safeParse(dialogName).success) return setError({ kind: 'invalid', message: '请输入 1–200 字的白板名称。' });
    void run(async () => {
      if (action === 'rename') updateLocal(await api.updateBoard(board.id, { name: dialogName.trim() }));
      if (action === 'duplicate') {
        const key = `duplicate:${board.id}:${dialogName.trim()}`;
        if (pendingMutation.current?.key !== key) pendingMutation.current = { key, requestId: crypto.randomUUID() };
        await api.duplicateBoard(board.id, { requestId: pendingMutation.current.requestId, targetName: dialogName.trim() }); pendingMutation.current = null;
      }
      if (action === 'delete') {
        const key = `delete:${board.id}`;
        if (pendingMutation.current?.key !== key) pendingMutation.current = { key, requestId: crypto.randomUUID() };
        await api.deleteBoard(board.id, { requestId: pendingMutation.current.requestId, confirmation: 'PERMANENTLY_DELETE' }); pendingMutation.current = null;
      }
      setNotice(action === 'duplicate' ? '副本已创建。' : action === 'delete' ? '白板已永久删除。' : '白板名称已更新。'); closeDialog(); await load(); restoreFocus();
    });
  };
  const saveTags = (board: api.Board, tagIds: string[]) => void run(async () => {
    updateLocal(await api.updateBoard(board.id, { tagIds, expectedTagsRevision: board.tagsRevision })); setNotice('白板标签已保存。'); closeDialog();
  });
  const createTag = (event: FormEvent) => {
    event.preventDefault(); if (!C.BoardTagName.safeParse(tagName).success) return setError({ kind: 'invalid', message: '请输入 1–40 字的标签名称。' });
    void run(async () => { const tag = await api.createBoardTag({ requestId: crypto.randomUUID(), name: tagName.trim() }); setTags(value => [...value, tag].sort((a, b) => a.name.localeCompare(b.name))); setTagName(''); setNotice('标签已创建。'); });
  };
  const saveTagName = (tag: api.BoardTag) => {
    const name = (tagEdits[tag.id] ?? tag.name).trim();
    if (!C.BoardTagName.safeParse(name).success) return setError({ kind: 'invalid', message: '请输入 1–40 字的标签名称。' });
    void run(async () => { const next = await api.renameBoardTag(tag.id, { requestId: crypto.randomUUID(), name, expectedRevision: tag.revision }); setTags(value => value.map(item => item.id === next.id ? next : item)); setNotice('标签名称已更新。'); });
  };
  const removeTag = (tag: api.BoardTag) => {
    if (deletingTagId !== tag.id) { setDeletingTagId(tag.id); return; }
    void run(async () => { await api.deleteBoardTag(tag.id, { requestId: crypto.randomUUID(), expectedRevision: tag.revision }); setTags(value => value.filter(item => item.id !== tag.id)); setSelectedTags(value => value.filter(id => id !== tag.id)); setDeletingTagId(null); setNotice('标签已删除并从白板解绑。'); });
  };

  return <main data-testid="whiteboard-library" className="min-h-full bg-background px-4 py-8 md:px-8 lg:px-12">
    <div className="mx-auto w-full max-w-7xl space-y-7">
      <header className="flex flex-wrap items-end gap-4"><div className="min-w-0 flex-1"><p className="mb-1 text-12 font-medium uppercase tracking-[0.16em] text-muted-foreground">Visual workspace</p><h1 className="text-32 font-semibold tracking-tight">Board</h1><p className="mt-1 text-14 text-muted-foreground">把想法、关系和团队协作放在同一个无限画布。</p></div><form className="flex min-w-72 gap-2" onSubmit={create}><Input ref={createInput} data-testid="board-create-name" value={newName} onChange={event => setNewName(event.target.value)} placeholder="新白板名称" maxLength={200} disabled={busy} /><Button type="submit" data-testid="board-create" disabled={busy}><Plus className="mr-1 size-4" aria-hidden />新建并打开</Button></form></header>
      {error && <div data-testid={error.kind === 'invalid' ? 'err-board-form' : RESERVED_STATE_TESTID[error.kind]} role="alert" className="flex items-center justify-between rounded-control bg-destructive p-3 text-13 text-destructive-foreground"><span>{error.message}</span><Button size="icon" variant="ghost" aria-label="关闭错误" onClick={() => setError(null)}><X className="size-4" /></Button></div>}
      {notice && <p data-testid={RESERVED_STATE_TESTID.success} role="status" className="rounded-control bg-success-tint px-3 py-2 text-13 text-success-tint-foreground">{notice}</p>}
      <section aria-label="白板筛选" className="rounded-container border border-border bg-card p-3 shadow-sm"><div className="flex flex-wrap items-center gap-2"><label className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><span className="sr-only">搜索白板</span><Input data-testid="board-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索白板" className="pl-9" /></label><div className="flex rounded-control border border-border p-1"><Button data-testid="board-filter-active" size="sm" variant={archiveFilter === 'active' ? 'primary' : 'ghost'} onClick={() => setArchiveFilter('active')}>使用中</Button><Button data-testid="board-filter-archived" size="sm" variant={archiveFilter === 'archived' ? 'primary' : 'ghost'} onClick={() => setArchiveFilter('archived')}><Archive className="mr-1 size-4" aria-hidden />已归档</Button></div><Button variant="outline" data-testid="board-tag-catalog" onClick={event => { returnFocus.current = event.currentTarget; setShowTagCatalog(true); }}><Tag className="mr-1 size-4" aria-hidden />标签管理</Button><div className="flex rounded-control border border-border p-1"><Button size="icon" variant={view === 'grid' ? 'primary' : 'ghost'} aria-label="网格视图" onClick={() => setView('grid')}><Grid2X2 className="size-4" /></Button><Button size="icon" variant={view === 'list' ? 'primary' : 'ghost'} aria-label="列表视图" onClick={() => setView('list')}><List className="size-4" /></Button></div></div>
        {tags.length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label="按标签筛选">{tags.map(tag => { const active = selectedTags.includes(tag.id); return <Button key={tag.id} size="sm" variant={active ? 'primary' : 'outline'} aria-pressed={active} data-testid={`board-filter-tag-${tag.id}`} onClick={() => setSelectedTags(value => active ? value.filter(id => id !== tag.id) : [...value, tag.id])}>{tag.name}</Button>; })}{selectedTags.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedTags([])}>清除标签</Button>}</div>}
      </section>
      {busy && <p data-testid={RESERVED_STATE_TESTID.loading} role="status" className="py-10 text-center text-14 text-muted-foreground">正在同步白板…</p>}
      {loaded && !busy && items.length === 0 && <section data-testid={RESERVED_STATE_TESTID.empty} className="rounded-container border border-dashed border-border py-20 text-center"><h2 className="text-20 font-semibold">{archiveFilter === 'archived' ? '没有已归档的白板' : '从第一块白板开始'}</h2><p className="mt-2 text-14 text-muted-foreground">{query || selectedTags.length ? '调整搜索或标签筛选以查看其他结果。' : '新建后会直接进入全屏编辑器。'}</p></section>}
      {!busy && items.length > 0 && <div className={view === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'grid gap-3'}>{items.map(board => <article key={board.id} data-testid={`board-card-${board.id}`} className="group relative min-w-0 rounded-container border border-border bg-card p-4 shadow-sm transition-all duration-base hover:-translate-y-0.5 hover:border-ring hover:shadow-md focus-within:border-ring">
        <div className="flex items-start gap-3"><Link href={EDITOR_PATH(board.id)} data-testid={`board-open-${board.id}`} className="min-w-0 flex-1 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="mb-8 aspect-[16/8] rounded-control bg-gradient-to-br from-muted via-background to-accent p-4"><div className="grid h-full grid-cols-3 gap-2 opacity-70"><span className="rounded bg-warning-tint"/><span className="rounded bg-info-tint"/><span className="rounded bg-success-tint"/></div></div><h2 className="truncate text-16 font-semibold">{board.name}</h2><p className="mt-1 text-12 text-muted-foreground">{board.archived ? '已归档' : '使用中'} · {board.role === 'owner' ? '所有者' : board.role === 'editor' ? '编辑者' : '查看者'}</p></Link><BoardCardMenu board={board} disabled={busy} onAction={(action, trigger) => openAction(board, action, trigger)} /></div>
        {board.tagIds.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{board.tagIds.map(id => <span key={id} className="rounded-full bg-muted px-2 py-1 text-11 text-muted-foreground">{tags.find(tag => tag.id === id)?.name ?? '未知标签'}</span>)}</div>}
      </article>)}</div>}
      {!busy && nextCursor && <div className="flex justify-center"><Button variant="outline" data-testid="board-load-more" onClick={loadMore}>加载更多</Button></div>}
    </div>
    {tagBoard && <BoardTagManager board={tagBoard} tags={tags} busy={busy} onClose={closeDialog} onSave={tagIds => saveTags(tagBoard, tagIds)} />}
    {dialog && <Dialog open onOpenChange={open => { if (!open && !busy) closeDialog(); }}><DialogContent data-testid={`board-${dialog.action}-dialog`}><DialogHeader><DialogTitle>{dialog.action === 'rename' ? '重命名白板' : dialog.action === 'duplicate' ? '创建白板副本' : '永久删除白板'}</DialogTitle><DialogDescription>{dialog.action === 'delete' ? '此操作无法撤销。画布内容、协作记录与关联数据将永久删除。' : dialog.action === 'duplicate' ? '副本拥有独立内容，之后的修改不会影响原白板。' : '新名称会对有权限的协作者显示。'}</DialogDescription></DialogHeader>{dialog.action !== 'delete' && <Input autoFocus data-testid="board-dialog-name" value={dialogName} maxLength={200} disabled={busy} onChange={event => setDialogName(event.target.value)} />}<DialogFooter><Button variant="outline" disabled={busy} onClick={closeDialog}>取消</Button><Button data-testid="board-dialog-confirm" variant={dialog.action === 'delete' ? 'destructive' : 'primary'} disabled={busy} onClick={mutateBoard}>{dialog.action === 'delete' ? '永久删除' : dialog.action === 'duplicate' ? '创建副本' : '保存'}</Button></DialogFooter></DialogContent></Dialog>}
    {showTagCatalog && <Dialog open onOpenChange={open => { if (!open && !busy) closeDialog(); }}><DialogContent data-testid="board-tag-catalog-dialog"><DialogHeader><DialogTitle>组织标签</DialogTitle><DialogDescription>创建稳定标签，用于跨白板管理与筛选。删除会从所有白板解绑。</DialogDescription></DialogHeader><form className="flex gap-2" onSubmit={createTag}><Input data-testid="board-tag-name" value={tagName} maxLength={40} disabled={busy} onChange={event => setTagName(event.target.value)} placeholder="标签名称"/><Button type="submit" data-testid="board-tag-create" disabled={busy}>创建</Button></form><ul className="max-h-64 space-y-2 overflow-auto">{tags.map(tag => <li key={tag.id} className="flex min-h-11 flex-wrap items-center gap-2 rounded-control border border-border p-2"><Input aria-label={`${tag.name} 标签名称`} value={tagEdits[tag.id] ?? tag.name} maxLength={40} disabled={busy} onChange={event => setTagEdits(value => ({ ...value, [tag.id]: event.target.value }))}/><Button size="sm" variant="outline" disabled={busy || (tagEdits[tag.id] ?? tag.name).trim() === tag.name} onClick={() => saveTagName(tag)}>重命名</Button><Button size="sm" variant={deletingTagId === tag.id ? 'destructive' : 'ghost'} disabled={busy} onClick={() => removeTag(tag)}>{deletingTagId === tag.id ? '确认删除' : '删除'}</Button></li>)}</ul><DialogFooter><Button onClick={closeDialog}>完成</Button></DialogFooter></DialogContent></Dialog>}
  </main>;
}
