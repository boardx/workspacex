'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { convertExternalBoardSnapshot } from '@repo/whiteboard-core';
import { whiteboardMigration as M, whiteboardMiro as MR, whiteboardTransfer as T } from '@repo/contracts';
import {
  disconnectMiro, exportBoardPackage, getMiroConnection, importBoardPackage,
  listMiroBoards, previewBoardImport, previewMiroBoard, startMiroOAuth,
} from '@/lib/live-whiteboard';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type ImportPreview = {
  server: T.ImportBoardPreview;
  external?: M.ExternalImportConversion['preview'];
};

function safeImportError(code?: string) {
  if (code && /(?:CAPACITY|LIMIT|TOO_LARGE|MAX_)/i.test(code)) return '文件内容超过白板导入上限，请减少对象数量后重试。';
  if (code && /(?:UNSUPPORTED|FORMAT|PROVIDER)/i.test(code)) return '暂不支持该文件格式。请选择 WorkspaceX、Miro 或 Mural 的 Board JSON 文件。';
  return '文件不是有效的 WorkspaceX、Miro 或 Mural Board JSON，无法导入。';
}

function safeMiroError(error: unknown) {
  const code = error instanceof ApiError ? error.reasonCode : null;
  if (code === 'NOT_CONNECTED' || code === 'REMOTE_UNAUTHORIZED') return 'Miro 连接已失效，请重新连接后再试。';
  if (code === 'REMOTE_RATE_LIMITED') return 'Miro 正在限流，请稍后重试。';
  if (code === 'REMOTE_TIMEOUT' || code === 'REMOTE_UNAVAILABLE') return '暂时无法连接 Miro，请检查网络后重试。';
  if (code === 'ITEM_LIMIT_EXCEEDED' || code === 'PAYLOAD_TOO_LARGE') return '这块 Miro Board 超过直接导入上限，请先减少对象数量。';
  if (code === 'REPEATED_CURSOR' || code === 'REMOTE_SCHEMA_CHANGED') return 'Miro 返回了无法继续分页的数据，请稍后重试或联系管理员。';
  return 'Miro 导入失败，请重试。';
}

function providerName(provider: 'miro' | 'mural') {
  return provider === 'miro' ? 'Miro' : 'Mural';
}

function externalFormat(input: unknown): string | undefined {
  return typeof input === 'object' && input !== null && 'format' in input && typeof input.format === 'string' ? input.format : undefined;
}

function lossCategories(losses: M.ExternalImportLoss[]) {
  const grouped = new Map<string, { count: number; messages: Set<string> }>();
  for (const loss of losses) {
    const category = grouped.get(loss.code) ?? { count: 0, messages: new Set<string>() };
    category.count += 1;
    category.messages.add(loss.message);
    grouped.set(loss.code, category);
  }
  return [...grouped].map(([code, value]) => ({ code, count: value.count, message: [...value.messages].join('；') }));
}

const qualityLabels: Array<[keyof T.ImportQualitySummary, string]> = [
  ['complete', '完整'], ['approximate', '近似'], ['degraded', '降级'], ['skipped', '跳过'],
];
function ImportQuality({ value }: { value: T.ImportQualitySummary }) {
  return <div data-testid="board-import-quality" className="grid grid-cols-2 gap-2 text-13">
    {qualityLabels.map(([key, label]) => <div key={key} data-quality={key} className="rounded-control border border-border px-2 py-1">
      <span className="font-medium">{label} {value[key].count}</span>
      {value[key].sampleSourceIds.length ? <p className="break-all text-muted-foreground">示例来源：{value[key].sampleSourceIds.join('、')}</p> : null}
    </div>)}
  </div>;
}

export function BoardTransferControls({ boardId, onImported, oauthNavigate = url => window.location.assign(url) }: {
  boardId: string;
  onImported: (boardId: string) => void;
  oauthNavigate?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<T.ImportBoardInput | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [source, setSource] = useState<'file' | 'miro'>('file');
  const [miroConnection, setMiroConnection] = useState<MR.MiroConnection | null>(null);
  const [miroPage, setMiroPage] = useState<MR.ListMiroBoardsResult | null>(null);
  const [miroLoading, setMiroLoading] = useState(false);
  const consumedOAuthReturn = useRef(false);

  const download = async () => {
    try {
      const bundle = await exportBoardPackage(boardId);
      const blob = new Blob([T.serializePortableBoardPackage(bundle)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${bundle.source.name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'board'}.workspacex-board.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('导出失败，请确认权限和网络后重试。');
      setOpen(true);
    }
  };

  const chooseImport = async (file: File | undefined) => {
    setSource('file');
    setError('');
    setPreview(null);
    setInput(null);
    if (!file) return;
    if (file.size > M.EXTERNAL_BOARD_IMPORT.maxBytes) {
      setError('文件超过 16 MB 导入上限，请选择更小的 Board JSON 文件。');
      setOpen(true);
      return;
    }
    try {
      const decoded: unknown = JSON.parse(await file.text());
      const portable = T.PortableBoardPackage.safeParse(decoded);
      let packageValue: T.PortableBoardPackage;
      let external: M.ExternalImportConversion['preview'] | undefined;
      if (portable.success) {
        packageValue = portable.data;
      } else {
        const format = externalFormat(decoded);
        if (format !== 'miro.rest.board-snapshot' && format !== 'mural.public-api.mural-snapshot') {
          setError(safeImportError('UNSUPPORTED_FORMAT'));
          setOpen(true);
          return;
        }
        const converted = convertExternalBoardSnapshot(decoded, { packageBoardId: crypto.randomUUID() });
        if (!converted.ok) {
          setError(safeImportError(converted.code));
          setOpen(true);
          return;
        }
        packageValue = converted.package;
        external = converted.preview;
      }
      const nextInput = T.ImportBoardInput.parse({ requestId: crypto.randomUUID(), package: packageValue });
      const server = await previewBoardImport(nextInput);
      setInput(nextInput);
      setPreview({ server, external });
      setOpen(true);
    } catch {
      setError(safeImportError());
      setOpen(true);
    }
  };

  const loadMiro = useCallback(async (offset = 0) => {
    setSource('miro');
    setOpen(true);
    setError('');
    setPreview(null);
    setInput(null);
    setMiroLoading(true);
    try {
      const connection = await getMiroConnection();
      setMiroConnection(connection);
      setMiroPage(connection.connected
        ? await listMiroBoards({ offset, limit: MR.MIRO_DIRECT_IMPORT.boardPageLimit })
        : null);
    } catch (loadError) {
      setError(safeMiroError(loadError));
    } finally {
      setMiroLoading(false);
    }
  }, []);

  const connectMiro = async () => {
    setMiroLoading(true);
    setError('');
    try {
      const result = await startMiroOAuth({ returnTo: window.location.pathname });
      oauthNavigate(result.authorizationUrl);
    } catch (connectError) {
      setError(safeMiroError(connectError));
      setMiroLoading(false);
    }
  };

  const chooseMiroBoard = async (sourceBoardId: string) => {
    setMiroLoading(true);
    setError('');
    try {
      const result = await previewMiroBoard({ boardId: sourceBoardId, packageBoardId: crypto.randomUUID() });
      setInput(result.input);
      setPreview({ server: result.preview, external: result.external });
    } catch (previewError) {
      setError(safeMiroError(previewError));
    } finally {
      setMiroLoading(false);
    }
  };

  const revokeMiro = async () => {
    setMiroLoading(true);
    setError('');
    try {
      await disconnectMiro();
      setMiroConnection({ connected: false, scopes: [], connectedAt: null });
      setMiroPage(null);
      setPreview(null);
      setInput(null);
    } catch (revokeError) {
      setError(safeMiroError(revokeError));
    } finally {
      setMiroLoading(false);
    }
  };

  useEffect(() => {
    if (consumedOAuthReturn.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('miro') !== 'connected') return;
    consumedOAuthReturn.current = true;
    url.searchParams.delete('miro');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    void loadMiro();
  }, [loadMiro]);

  const confirmImport = async () => {
    if (!input) return;
    setTransferring(true);
    setError('');
    try {
      const result = await importBoardPackage(input);
      setOpen(false);
      onImported(result.board.id);
    } catch {
      setError('导入未应用，原白板和现有内容均未改变。请检查文件后重试。');
    } finally {
      setTransferring(false);
    }
  };

  const external = preview?.external;
  const losses = external ? lossCategories(external.losses) : [];
  return (
    <>
      <Button data-testid="board-export" size="sm" variant="outline" className="ml-auto" onClick={() => void download()}>
        导出
      </Button>
      <label className="cursor-pointer rounded-control border border-border bg-background px-3 py-1 text-background-foreground">
        <span>导入副本</span>
        <input
          data-testid="board-import-file"
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={event => void chooseImport(event.target.files?.[0])}
        />
      </label>
      <Button data-testid="board-import-miro" size="sm" variant="outline" onClick={() => void loadMiro()}>
        从 Miro 导入
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>导入为新的白板副本</DialogTitle>
          {error ? (
            <>
              <DialogDescription role="alert">{error}</DialogDescription>
              {source === 'miro' ? <Button variant="outline" onClick={() => void loadMiro()}>重试</Button> : null}
            </>
          ) : preview ? (
            <>
          {external ? <section data-testid="vendor-import-preview" className="space-y-2">
            <DialogDescription>
              来自 {providerName(external.provider)} 的“{external.sourceName}”。将导入 {external.importedObjectCount} 个可编辑对象，跳过 {external.skippedObjectCount} 个对象，并始终创建新的 WorkspaceX 白板。
            </DialogDescription>
            <ImportQuality value={external.quality}/>
            <div className="text-13">
              <p className="font-medium">转换损失</p>
              {losses.length ? <ul data-testid="vendor-import-losses" className="list-disc space-y-1 pl-5">
                {losses.map(loss => <li key={loss.code}><span className="font-medium">{loss.code}</span>（{loss.count}）：{loss.message}</li>)}
              </ul> : <p data-testid="vendor-import-losses">无</p>}
            </div>
          </section> : <>
            <DialogDescription>将创建“{preview.server.destinationName}”，不会替换当前白板。全部 {preview.server.objectCount} 个对象会获得新身份，包括 {preview.server.frameCount} 个 Frame、{preview.server.groupCount} 个组和 {preview.server.connectorCount} 条连接。</DialogDescription>
            <ImportQuality value={preview.server.quality}/>
            <p className="text-13">内容损失：{preview.server.contentLosses.length ? preview.server.contentLosses.map(loss => loss.message).join('；') : '无'}</p>
          </>}
              <Button data-testid="board-import-confirm" disabled={transferring} onClick={() => void confirmImport()}>
                {transferring ? '正在导入…' : '确认创建副本'}
              </Button>
            </>
          ) : source === 'miro' ? (
            <section data-testid="miro-import-picker" className="space-y-3">
              {miroLoading ? (
                <DialogDescription role="status">正在读取 Miro…</DialogDescription>
              ) : miroConnection?.connected ? (
                <>
                  <DialogDescription>
                    已以只读权限连接 Miro。选择一块 Board 生成迁移预览，确认后只会创建新的 WorkspaceX 白板。
                  </DialogDescription>
                  <div className="max-h-72 space-y-2 overflow-auto">
                    {miroPage?.items.length ? miroPage.items.map(board => (
                      <button
                        key={board.id}
                        data-testid={`miro-board-${board.id}`}
                        className="flex w-full items-center justify-between rounded-control border border-border p-3 text-left"
                        onClick={() => void chooseMiroBoard(board.id)}
                      >
                        <span>{board.name}</span>
                        <span className="text-muted-foreground">预览</span>
                      </button>
                    )) : <p className="text-13 text-muted-foreground">当前页没有可访问的 Board。</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!miroPage || miroPage.offset === 0}
                      onClick={() => void loadMiro(Math.max(0, (miroPage?.offset ?? 0) - MR.MIRO_DIRECT_IMPORT.boardPageLimit))}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!miroPage?.hasMore}
                      onClick={() => void loadMiro((miroPage?.offset ?? 0) + MR.MIRO_DIRECT_IMPORT.boardPageLimit)}
                    >
                      下一页
                    </Button>
                    <Button data-testid="miro-disconnect" variant="outline" className="ml-auto" onClick={() => void revokeMiro()}>
                      断开 Miro
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <DialogDescription>连接 Miro 后，可用只读的 boards:read 权限选择并导入你能访问的 Board。</DialogDescription>
                  <Button data-testid="miro-connect" onClick={() => void connectMiro()}>连接 Miro</Button>
                </>
              )}
            </section>
          ) : (
            <DialogDescription>请选择受支持的 Board JSON 包。</DialogDescription>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
