import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardViewportStorageKey, readBoardViewport, saveBoardViewport, useBoardPersistedViewport } from '@/components/whiteboard/use-board-persisted-viewport';

const moved = { zoom: 2, panX: -340, panY: 175, fitRequest: 9, fitMode: 'selection' as const };
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it('restores only numeric viewport state for the same user and board, without replaying fit', () => {
 const key = boardViewportStorageKey('board-a', 'user-a');saveBoardViewport(key, moved);
 expect(readBoardViewport(key)).toEqual({ ...moved, fitRequest: 0, fitMode: 'board' });
 expect(readBoardViewport(boardViewportStorageKey('board-b', 'user-a')).zoom).toBe(1);
 expect(readBoardViewport(boardViewportStorageKey('board-a', 'user-b')).zoom).toBe(1);
 expect(boardViewportStorageKey('board-a')).toBeNull();
 expect(boardViewportStorageKey('a:b', 'c')).not.toBe(boardViewportStorageKey('b', 'c:a'));
});
it('falls back for malformed, unsupported, nonfinite or out-of-range data and unavailable storage', () => {
 const key = boardViewportStorageKey('board-a', 'user-a')!;
 for (const raw of ['bad', 'null', JSON.stringify({version:2,...moved}), JSON.stringify({version:1,...moved,zoom:0}), JSON.stringify({version:1,...moved,zoom:9}), JSON.stringify({version:1,...moved,panX:'340'}), '{"version":1,"zoom":1,"panX":1e999,"panY":0}']) {
  localStorage.setItem(key, raw);expect(readBoardViewport(key)).toMatchObject({zoom:1,panX:0,panY:0});
 }
 const unavailable = {getItem:vi.fn(()=>{throw new Error('blocked');}),setItem:vi.fn(()=>{throw new Error('quota');})};
 expect(readBoardViewport(key, unavailable).zoom).toBe(1);expect(()=>saveBoardViewport(key,moved,unavailable)).not.toThrow();
});
it('does not replace a stored view with initial defaults or followed viewport updates', () => {
 const key = boardViewportStorageKey('board-a','user-a')!;saveBoardViewport(key,moved);
 const view = renderHook(()=>useBoardPersistedViewport('board-a','user-a'));
 expect(view.result.current.viewport).toEqual({...moved,fitRequest:0,fitMode:'board'});
 act(()=>view.result.current.setViewport({...moved,zoom:3,panX:700}));
 expect(readBoardViewport(key).zoom).toBe(2);
 act(()=>view.result.current.persistViewport(view.result.current.viewport));
 view.unmount();
 const reopened=renderHook(()=>useBoardPersistedViewport('board-a','user-a'));
 expect(reopened.result.current.viewport).toMatchObject({zoom:3,panX:700,fitRequest:0});
});
it('restores late identity and switched scopes without saving the previous board or user view', () => {
 saveBoardViewport(boardViewportStorageKey('board-a','user-a'),moved);
 const view=renderHook(({board,user}:{board:string;user?:string})=>useBoardPersistedViewport(board,user),{initialProps:{board:'board-a',user:undefined as string|undefined}});
 expect(view.result.current.viewport.zoom).toBe(1);
 view.rerender({board:'board-a',user:'user-a'});expect(view.result.current.viewport.zoom).toBe(2);
 view.rerender({board:'board-b',user:'user-a'});expect(view.result.current.viewport.zoom).toBe(1);
 view.rerender({board:'board-a',user:'user-b'});expect(view.result.current.viewport.zoom).toBe(1);
 expect(readBoardViewport(boardViewportStorageKey('board-a','user-a')).zoom).toBe(2);
});
