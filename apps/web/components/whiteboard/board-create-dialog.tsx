'use client';
import { useRef, useState } from 'react';
import { whiteboard as C } from '@repo/contracts';
import { Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as api from '@/lib/live-whiteboard';
import { ApiError } from '@/lib/api-client';

type Props = { open: boolean; tags: api.BoardTag[]; tagsUnavailable: boolean; onRetryTags(): void; onTag(tag: api.BoardTag): void; onClose(notice: string): void; onCreated(board: api.Board): void; onRestoreFocus(): void };
const definite = (cause: unknown) => cause instanceof ApiError && [400, 401, 403, 404, 409, 412].includes(cause.status);
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));

/** Keep uncertain requests across closing/reopening; a retry must never create another board. */
export function BoardCreateDialog({ open, tags, tagsUnavailable, onRetryTags, onTag, onClose, onCreated, onRestoreFocus }: Props) {
  const [name, setName] = useState('未命名白板'), [selected, setSelected] = useState<string[]>([]), [search, setSearch] = useState('');
  const [pending, setPending] = useState<api.CreateBoardInput | null>(null), [created, setCreated] = useState<api.Board | null>(null);
  const [pendingTag, setPendingTag] = useState<{ requestId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), nameInput = useRef<HTMLInputElement>(null), confirmButton = useRef<HTMLButtonElement>(null);
  const frozen = !!pending || !!created;
  const close = () => {
    if (inFlight.current) return;
    onClose(created ? '白板已创建并保留，标签尚未保存。再次打开新建窗口可继续。' : pending ? '创建结果尚未确认，再次打开新建窗口可安全重试。' : '');
    if (!pending && !created && !pendingTag) { setName('未命名白板'); setSelected([]); setSearch(''); setError(''); }
  };
  const addTag = async () => {
    if (inFlight.current || frozen) return;
    const input = pendingTag ?? { requestId: crypto.randomUUID(), name: search.trim() };
    if (!C.BoardTagName.safeParse(input.name).success) { setError('请输入 1–40 字的标签名称。'); return; }
    inFlight.current = true; setBusy(true); setError(''); setPendingTag(input);
    try { const tag = await api.createBoardTag(input); onTag(tag); setSelected(value => [...new Set([...value, tag.id])]); setPendingTag(null); setSearch(''); }
    catch (cause) { if (definite(cause)) setPendingTag(null); setError('标签未能创建，请重试。重试不会重复创建标签。'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const submit = async () => {
    if (inFlight.current || pendingTag) return;
    if (!frozen && search.trim()) { setError('标签输入尚未完成。请先选择或添加标签，或清空搜索后创建白板。'); return; }
    if (!C.Board.shape.name.safeParse(name.trim()).success) { setError('请输入 1–200 字的白板名称。'); return; }
    inFlight.current = true; setBusy(true); setError('');
    let board = created;
    try {
      if (!board) {
        const input = pending ?? { requestId: crypto.randomUUID(), name: name.trim() }; setPending(input);
        try { board = await api.createBoard(input); setCreated(board); setPending(null); }
        catch (cause) { if (definite(cause)) setPending(null); throw cause; }
      } else {
        // An earlier PATCH may have committed despite a lost response. Read before retrying.
        const current = await api.getBoard(board.id);
        if (!sameTags(current.tagIds, selected) && current.tagsRevision !== board.tagsRevision) {
          setError('白板标签已由其他协作者更新。请返回列表查看，当前操作不会覆盖他们的修改。'); return;
        }
        board = current;
      }
      if (selected.length && !sameTags(board.tagIds, selected)) board = await api.updateBoard(board.id, { tagIds: selected, expectedTagsRevision: board.tagsRevision });
      onCreated(board);
    } catch { setError(board ? '白板已创建，但标签尚未确认保存。重试只会继续保存标签，不会新建白板。' : '暂时无法确认创建结果，请重试。'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent data-testid="board-create-dialog" className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto motion-reduce:transition-none sm:max-w-lg" onOpenAutoFocus={event => { event.preventDefault(); if (frozen) confirmButton.current?.focus(); else { nameInput.current?.focus(); nameInput.current?.select(); } }} onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>新建白板</DialogTitle><DialogDescription>给想法一个空间。标签可帮助团队快速找到它，也可以稍后添加。</DialogDescription></DialogHeader>
    <form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="space-y-2"><label htmlFor="new-board-name" className="text-14 font-medium">白板名称</label><Input id="new-board-name" ref={nameInput} data-testid="board-create-name" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={busy || frozen} className="min-h-11" /></div>
      <fieldset disabled={busy || frozen || !!pendingTag} className="space-y-3"><legend className="mb-2 flex items-center gap-2 text-14 font-medium"><Tag className="size-4" aria-hidden />标签 <span className="font-normal text-muted-foreground">可选 · 最多 20 个</span></legend>
        {tagsUnavailable && <div role="status" className="text-13">标签暂时无法加载。<Button type="button" variant="ghost" onClick={onRetryTags}>重试加载</Button></div>}
        <Input aria-label="搜索或添加标签" placeholder="搜索或添加标签" maxLength={40} value={pendingTag?.name ?? search} disabled={!!pendingTag || busy || frozen} onChange={event => setSearch(event.target.value)} />
        <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">{tags.filter(tag => tag.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(tag => <label key={tag.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-border px-3 text-14"><input type="checkbox" checked={selected.includes(tag.id)} disabled={!selected.includes(tag.id) && selected.length >= 20} onChange={event => { setSelected(value => event.target.checked ? [...value, tag.id] : value.filter(id => id !== tag.id)); setSearch(''); }} />{tag.name}</label>)}</div>
        {(!pendingTag && search.trim() && !tags.some(tag => tag.name === search.trim())) && <Button type="button" variant="outline" className="min-h-11" disabled={busy || frozen || selected.length >= 20} onClick={() => void addTag()}><Plus className="mr-1 size-4" aria-hidden />{`添加标签“${search.trim()}”`}</Button>}
        <p className="text-12 text-muted-foreground">已选 {selected.length} 个标签。新添加的标签会保留在组织标签中。</p>
      </fieldset>
      {pendingTag && <div className="space-y-2 rounded-control border border-border p-3 text-13"><p>标签“{pendingTag.name}”的创建结果尚未确认。可以重试确认，或不关联该标签继续；组织中可能已保留该标签。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void addTag()}>重试添加标签</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setPendingTag(null); setSearch(''); setError(''); }}>不关联此标签，继续</Button></div></div>}
      {error && <p role="alert" data-testid="board-create-error" className="rounded-control border border-destructive p-3 text-13">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>{created ? '返回列表，保留白板' : '取消'}</Button><Button ref={confirmButton} type="submit" className="min-h-11" variant="primary" data-testid="board-create-confirm" disabled={busy || !!pendingTag}>{busy ? '正在保存…' : created ? '重试保存并打开' : pending ? '重试创建并打开' : '创建并打开'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
