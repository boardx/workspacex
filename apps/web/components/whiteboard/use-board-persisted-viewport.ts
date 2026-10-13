"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { BOARD_ZOOM_MIN, BOARD_ZOOM_MAX, type BoardViewport } from './fabric/board-fabric-object';

const initialViewport = (): BoardViewport => ({ zoom: 1, panX: 0, panY: 0, fitRequest: 0, fitMode: 'board' });
type ViewportStorage = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): ViewportStorage | undefined => {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
};
export const boardViewportStorageKey = (boardId: string, userId?: string) =>
  boardId && userId ? `workspacex-board-viewport-v1:${encodeURIComponent(userId)}:${encodeURIComponent(boardId)}` : null;

export function readBoardViewport(key: string | null, storage = browserStorage()): BoardViewport {
  if (!key || !storage) return initialViewport();
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 1024) return initialViewport();
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || value.version !== 1 || typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom < BOARD_ZOOM_MIN || value.zoom > BOARD_ZOOM_MAX || typeof value.panX !== 'number' || !Number.isFinite(value.panX) || typeof value.panY !== 'number' || !Number.isFinite(value.panY)) return initialViewport();
    return { ...initialViewport(), zoom: value.zoom, panX: value.panX, panY: value.panY };
  } catch { return initialViewport(); }
}

export function saveBoardViewport(key: string | null, viewport: BoardViewport, storage = browserStorage()): void {
  if (!key || !storage || !Number.isFinite(viewport.zoom) || viewport.zoom < BOARD_ZOOM_MIN || viewport.zoom > BOARD_ZOOM_MAX || !Number.isFinite(viewport.panX) || !Number.isFinite(viewport.panY)) return;
  try { storage.setItem(key, JSON.stringify({ version: 1, zoom: viewport.zoom, panX: viewport.panX, panY: viewport.panY })); } catch { /* Navigation remains usable without local storage. */ }
}

/** Only explicit local navigation saves. Following a presenter uses setViewport
 * directly, preserving the user's own last view for the next board opening. */
export function useBoardPersistedViewport(boardId: string, userId?: string) {
  const key = boardViewportStorageKey(boardId, userId);
  const [state, setState] = useState(() => ({ key, viewport: initialViewport() }));
  const restoredKey = useRef<string | null | undefined>(undefined);
  useEffect(() => { restoredKey.current = key; setState({ key, viewport: readBoardViewport(key) }); }, [key]);
  const viewport = state.key === key ? state.viewport : initialViewport();
  const setViewport = useCallback((next: BoardViewport | ((current: BoardViewport) => BoardViewport)) => {
    setState(current => {
      const previous = current.key === key ? current.viewport : readBoardViewport(key);
      return { key, viewport: typeof next === 'function' ? next(previous) : next };
    });
  }, [key]);
  const persistViewport = useCallback((next: BoardViewport) => {
    if (restoredKey.current === key) saveBoardViewport(key, next);
  }, [key]);
  return { viewport, setViewport, persistViewport };
}
