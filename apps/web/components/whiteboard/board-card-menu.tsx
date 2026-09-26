'use client';
import { Archive, Copy, MoreHorizontal, Pencil, RotateCcw, Tags, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import type { Board } from '@/lib/live-whiteboard';

export type BoardCardAction = 'rename' | 'tags' | 'duplicate' | 'archive' | 'restore' | 'delete';

export function BoardCardMenu({ board, disabled, onAction }: { board: Board; disabled: boolean; onAction: (action: BoardCardAction, trigger: HTMLElement) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const choose = (action: BoardCardAction) => (event: Event) => {
    event.stopPropagation();
    if (triggerRef.current) onAction(action, triggerRef.current);
  };
  return <Menu>
    <MenuTrigger asChild><Button ref={triggerRef} type="button" size="icon" variant="ghost" disabled={disabled} aria-label={`${board.name} 更多操作`} data-testid={`board-menu-${board.id}`} onClick={event => event.stopPropagation()}><MoreHorizontal className="size-5" aria-hidden /></Button></MenuTrigger>
    <MenuContent align="end" onClick={event => event.stopPropagation()}>
      {board.role === 'owner' && <MenuItem data-testid={`board-action-rename-${board.id}`} onSelect={choose('rename')}><Pencil className="mr-2 size-4" aria-hidden />重命名</MenuItem>}
      {board.role === 'owner' && <MenuItem data-testid={`board-action-tags-${board.id}`} onSelect={choose('tags')}><Tags className="mr-2 size-4" aria-hidden />管理标签</MenuItem>}
      {board.role !== 'viewer' && <MenuItem data-testid={`board-action-duplicate-${board.id}`} onSelect={choose('duplicate')}><Copy className="mr-2 size-4" aria-hidden />创建副本</MenuItem>}
      {board.role === 'owner' && <><MenuSeparator />{board.archived
        ? <MenuItem data-testid={`board-action-restore-${board.id}`} onSelect={choose('restore')}><RotateCcw className="mr-2 size-4" aria-hidden />恢复</MenuItem>
        : <MenuItem data-testid={`board-action-archive-${board.id}`} onSelect={choose('archive')}><Archive className="mr-2 size-4" aria-hidden />归档</MenuItem>}
      {board.archived && <MenuItem className="text-destructive data-[highlighted]:text-destructive" data-testid={`board-action-delete-${board.id}`} onSelect={choose('delete')}><Trash2 className="mr-2 size-4" aria-hidden />永久删除</MenuItem>}</>}
    </MenuContent>
  </Menu>;
}
