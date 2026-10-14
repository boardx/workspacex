'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { StandardWhiteboardExport, StandardWhiteboardExportDownload } from '@repo/contracts/whiteboard-import';
import { ApiError, apiRequest } from '@/lib/api-client';
import { renderCanonicalBoardImage } from './board-canonical-image';

/** Cache is owned by one authenticated library scope, never persisted or shared across accounts. */
export class BoardThumbnailQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  private cache = new Map<string, Blob | null>();
  constructor(readonly scope: string, readonly actorId: string) {}
  async load(boardId: string, signal: AbortSignal): Promise<Blob | null> {
    await new Promise<void>(resolve => {
      const start = () => { this.active++; resolve(); };
      if (this.active < 2) start(); else this.waiting.push(start);
    });
    try {
      signal.throwIfAborted();
      for (let attempt = 0; attempt < 2; attempt++) {
        // HEAD reauthorizes even cached previews. Never treat exported pixels as an authorization grant.
        const head = z.object({ epoch: z.number().int().positive(), seq: z.number().int().nonnegative() }).passthrough().parse(
          await apiRequest(`/whiteboards/${encodeURIComponent(boardId)}/head`, { method: 'GET', signal }),
        );
        signal.throwIfAborted();
        const key = JSON.stringify([this.scope, boardId, head.epoch, head.seq]);
        if (this.cache.has(key)) {
          const cached = this.cache.get(key)!; this.cache.delete(key); this.cache.set(key, cached); return cached;
        }
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
        digest[6] = (digest[6]! & 15) | 80; digest[8] = (digest[8]! & 63) | 128;
        const hex = Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
        const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        let exported;
        try {
          exported = StandardWhiteboardExport.parse(await apiRequest(`/whiteboards/${encodeURIComponent(boardId)}/imports/standard-export`, { method: 'POST', body: { requestId }, signal }));
        } catch (error) { if (attempt === 0 && error instanceof ApiError && error.status === 409) continue; throw error; }
        const expectedPath = `/whiteboards/${encodeURIComponent(boardId)}/imports/standard-export/${exported.exportId}`;
        if (exported.boardId !== boardId || exported.downloadPath !== expectedPath) throw new Error('BOARD_THUMBNAIL_SCOPE_MISMATCH');
        const downloaded = StandardWhiteboardExportDownload.parse(await apiRequest(expectedPath, { method: 'GET', signal }));
        for (const field of ['format', 'exportId', 'boardId', 'epoch', 'seq', 'sha256', 'sizeBytes', 'fileName', 'objectKey', 'downloadPath'] as const) {
          if (downloaded[field] !== exported[field]) throw new Error('BOARD_THUMBNAIL_INTEGRITY_FAILED');
        }
        const bytes = Uint8Array.from(atob(downloaded.contentBase64), character => character.charCodeAt(0));
        const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (bytes.length !== exported.sizeBytes || actualHash !== exported.sha256) throw new Error('BOARD_THUMBNAIL_INTEGRITY_FAILED');
        const content = z.object({ format: z.literal('workspacex.board.v1'), board: z.object({ id: z.string().uuid(), epoch: z.number().int().positive(), seq: z.number().int().nonnegative() }).strict(), objects: z.array(WhiteboardObject) }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        if (content.board.id !== boardId || content.board.epoch !== exported.epoch || content.board.seq !== exported.seq) throw new Error('BOARD_THUMBNAIL_SCOPE_MISMATCH');
        signal.throwIfAborted();
        const blob = content.objects.some(object => !object.hidden) ? (await renderCanonicalBoardImage({ boardId, objects: content.objects, maxWidth: 640, maxHeight: 360, padding: 24, signal })).blob : null;
        signal.throwIfAborted();
        // Export may race a newer update; bind pixels to its actual revision, never the earlier HEAD.
        this.cache.set(JSON.stringify([this.scope, boardId, exported.epoch, exported.seq]), blob);
        if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
        return blob;
      }
      throw new Error('BOARD_THUMBNAIL_REVISION_CONFLICT');
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
    {current ? <Image src={current} alt={`${name}的白板预览`} fill unoptimized sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw" className="object-contain" /> : <span data-testid={`board-thumbnail-empty-${boardId}`}>{!queue ? '预览尚未生成' : status === 'empty' ? '空白白板' : status === 'error' ? '预览暂时无法加载' : '正在生成预览…'}</span>}
  </div>;
}
