'use client';

import { useRef, useState } from 'react';
import { convertExternalBoardSnapshot } from '@repo/whiteboard-core';
import { whiteboardMigration as M, whiteboardTransfer as T } from '@repo/contracts';
import { exportBoardPackage, importBoardPackage, previewBoardImport } from '@/lib/live-whiteboard';
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

export function BoardTransferControls({ boardId, onImported }: { boardId: string; onImported: (boardId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<T.ImportBoardInput | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

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
  return <>
    <Button ref={exportTrigger} data-testid="board-export" size="sm" variant="outline" className="ml-auto" onClick={() => { returnFocus.current=exportTrigger.current; void download(); }}>导出</Button>
    <Button ref={importTrigger} data-testid="board-import-trigger" size="sm" variant="outline" onClick={() => {
      returnFocus.current=importTrigger.current;
      importInput.current?.click();
    }}>导入副本</Button>
    <input ref={importInput} aria-label="导入白板副本文件" data-testid="board-import-file" className="hidden" tabIndex={-1} type="file" accept="application/json,.json" onChange={event => void chooseImport(event.target.files?.[0])}/>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onCloseAutoFocus={event=>{event.preventDefault();returnFocus.current?.focus();}}>
        <DialogTitle>导入为新的白板副本</DialogTitle>
        {error ? <DialogDescription role="alert">{error}</DialogDescription> : preview ? <>
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
          <Button data-testid="board-import-confirm" disabled={transferring} onClick={() => void confirmImport()}>{transferring ? '正在导入…' : '确认创建副本'}</Button>
        </> : <DialogDescription>请选择受支持的 Board JSON 包。</DialogDescription>}
      </DialogContent>
    </Dialog>
  </>;
}
