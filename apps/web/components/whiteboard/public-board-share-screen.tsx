'use client';

import { useEffect, useMemo, useState } from 'react';
import { whiteboard as C } from '@repo/contracts';
import type { z } from 'zod';
import { apiUrl } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { BoardFabricSurface } from './fabric/board-fabric-surface';
import { toBoardFabricObjects } from './whiteboard-fabric-projection';

type Snapshot = z.infer<typeof C.PublicBoardShare>;
const noSelection = () => {};
const rejectTransform = () => false;
const pathFor = (template: string, token: string) => template.replace(':token', encodeURIComponent(token));

export function PublicBoardShareScreen({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0, fitRequest: 1 });
  const objects = useMemo(() => toBoardFabricObjects(snapshot?.objects ?? [], assetId => assetId
    ? apiUrl(pathFor(C.sharePaths.image, token).replace(':assetId', encodeURIComponent(assetId)))
    : undefined), [snapshot, token]);

  useEffect(() => {
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null);
    setError('');
    async function load() {
      const response = await fetch(apiUrl(pathFor(C.sharePaths.read, token)), {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 404) {
        setError('分享链接已失效，请联系白板所有者获取新链接。');
        return;
      }
      if (!response.ok) throw new Error('read failed');
      const board = C.PublicBoardShare.parse(await response.json());
      if (controller.signal.aborted) return;
      const expire = () => {
        setSnapshot(null);
        setError('分享链接已过期，请联系白板所有者获取新链接。');
      };
      const remaining = Date.parse(board.expiresAt) - Date.now();
      if (remaining <= 0) return expire();
      setSnapshot(board);
      expiry = setTimeout(expire, remaining);
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError('暂时无法加载白板，请重试。');
    });
    return () => { controller.abort(); clearTimeout(expiry); };
  }, [token, attempt]);

  return <main className="flex h-dvh flex-col bg-background">
    <header className="flex items-center justify-between gap-3 border-b border-border p-4">
      <div className="min-w-0">
        <h1 className="truncate text-20 font-semibold">{snapshot?.title ?? '共享白板'}</h1>
        <p className="text-13 text-muted-foreground">仅供查看</p>
      </div>
      {snapshot && <Button variant="outline" onClick={() => setViewport(current => ({ ...current, fitRequest: current.fitRequest + 1 }))}>适应画布</Button>}
    </header>
    {snapshot ? (
      <div className="relative min-h-0 flex-1">
        <BoardFabricSurface objects={objects} selectedObjectIds={[]} readOnly tool="hand" viewport={viewport}
          onViewportChange={setViewport} onSelectionChange={noSelection} onObjectTransform={rejectTransform}
          className="absolute inset-0 overflow-hidden bg-panel-alt" />
      </div>
    ) : error ? <div className="space-y-3 p-4"><p role="alert">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>重新加载</Button></div>
      : <p role="status" className="p-4">正在读取共享白板…</p>}
  </main>;
}
