'use client';
import { useEffect, useRef, useState } from 'react';
import { WhiteboardObjectsSnapshot } from '@repo/contracts/whiteboard-operation';
import { apiRequest } from '@/lib/api-client';
import { renderCanonicalBoardImage } from './board-canonical-image';

/** Cache is owned by one authenticated library scope, never persisted or shared across accounts. */
export class BoardThumbnailQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  private cache = new Map<string, Blob>();
  constructor(readonly scope: string, readonly actorId: string) {}
  async load(boardId: string, signal: AbortSignal): Promise<Blob | null> {
    await new Promise<void>(resolve => {
      const start = () => { this.active++; resolve(); };
      if (this.active < 2) start(); else this.waiting.push(start);
    });
    try {
      signal.throwIfAborted();
      // Always reauthorize and read the canonical revision before consulting pixel cache.
      const snapshot = WhiteboardObjectsSnapshot.parse(await apiRequest(
        `/v1/whiteboards/${encodeURIComponent(boardId)}/objects?actorId=${encodeURIComponent(this.actorId)}`,
        { method: 'GET', signal },
      ));
      signal.throwIfAborted();
      if (snapshot.boardId !== boardId) throw new Error('BOARD_THUMBNAIL_SCOPE_MISMATCH');
      if (!snapshot.objects.some(object => !object.hidden)) return null;
      const key = JSON.stringify([this.scope, boardId, snapshot.revision.epoch, snapshot.revision.seq]);
      const cached = this.cache.get(key);
      if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
      const { blob } = await renderCanonicalBoardImage({ boardId, objects: snapshot.objects, maxWidth: 640, maxHeight: 360, padding: 24, signal });
      signal.throwIfAborted();
      this.cache.set(key, blob);
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      return blob;
    } finally { this.active--; this.waiting.shift()?.(); }
  }
}

export function BoardThumbnail({ boardId, name, revisionHint, queue }: {
  boardId: string; name: string; revisionHint: string; queue: BoardThumbnailQueue | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<{ queue: BoardThumbnailQueue; boardId: string; revisionHint: string; url: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'empty' | 'error'>('loading');
  useEffect(() => {
    if (!host.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '100px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !queue) return;
    const controller = new AbortController(); let inFlight = false; let objectUrl: string | null = null;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const blob = await queue.load(boardId, controller.signal);
        if (controller.signal.aborted) return;
        const next = blob ? URL.createObjectURL(blob) : null;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = next; setPreview(next ? { queue, boardId, revisionHint, url: next } : null); setStatus(blob ? 'loading' : 'empty');
      } catch {
        if (!controller.signal.aborted) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = null; setPreview(null); setStatus('error');
        }
      } finally { inFlight = false; }
    };
    setStatus('loading'); void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 30_000);
    const onFocus = () => void refresh(); window.addEventListener('focus', onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [boardId, queue, revisionHint, visible]);
  const current = visible && preview?.queue === queue && preview.boardId === boardId && preview.revisionHint === revisionHint ? preview.url : null;
  return <div ref={host} data-testid={`board-thumbnail-${boardId}`} className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-muted/50 text-12 text-muted-foreground">
    {current ? <img src={current} alt={`${name}的白板预览`} className="h-full w-full object-contain" /> : <span data-testid={`board-thumbnail-empty-${boardId}`}>{!queue ? '预览尚未生成' : status === 'empty' ? '空白白板' : status === 'error' ? '预览暂时无法加载' : '正在生成预览…'}</span>}
  </div>;
}
