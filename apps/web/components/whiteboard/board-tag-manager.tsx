'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Board, BoardTag } from '@/lib/live-whiteboard';

export function BoardTagManager({ board, tags, busy, onClose, onSave }: { board: Board; tags: BoardTag[]; busy: boolean; onClose: () => void; onSave: (tagIds: string[]) => void }) {
  const [selected, setSelected] = useState(board.tagIds);
  useEffect(() => setSelected(board.tagIds), [board]);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent data-testid="board-tags-dialog">
    <DialogHeader><DialogTitle>管理“{board.name}”的标签</DialogTitle><DialogDescription>标签可用于跨白板筛选。多个筛选标签采用同时满足。</DialogDescription></DialogHeader>
    <div className="grid max-h-64 gap-2 overflow-auto py-1">{tags.length === 0 ? <p className="text-13 text-muted-foreground">还没有组织标签。请先在标签管理中创建。</p> : tags.map(tag => <label key={tag.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-border px-3 text-14 transition-colors duration-base hover:bg-muted"><input type="checkbox" checked={selected.includes(tag.id)} disabled={busy} onChange={() => setSelected(value => value.includes(tag.id) ? value.filter(id => id !== tag.id) : [...value, tag.id])} />{tag.name}</label>)}</div>
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="button" data-testid="board-tags-save" disabled={busy} onClick={() => onSave(selected)}>保存标签</Button></DialogFooter>
  </DialogContent></Dialog>;
}
