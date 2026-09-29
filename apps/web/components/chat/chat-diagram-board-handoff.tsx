'use client';
import * as React from 'react';
import type { DiagramModel } from '@repo/fabric-markdown/model';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { listBoards } from '@/lib/live-whiteboard';
import { insertRenderedArtifact, readBoardHead } from '@/lib/whiteboard-operation-client';
import { renderedDiagramLayout } from '@/lib/chat-board-diagram-layout';
export { renderedDiagramLayout } from '@/lib/chat-board-diagram-layout';

type Attempt = Parameters<typeof insertRenderedArtifact>[0];
export function ChatDiagramBoardHandoff({ model, artifactId, sourceRevision, orgId }: { model: DiagramModel | null; artifactId?: string; sourceRevision?: string; orgId?: string }) {
  const [open, setOpen] = React.useState(false), [boards, setBoards] = React.useState<{id:string;name:string}[]>([]);
  const [boardId, setBoardId] = React.useState(''), [x, setX] = React.useState('0'), [y, setY] = React.useState('0');
  const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState('');
  const attempt = React.useRef<{key:string;request:Attempt} | null>(null);
  const enabled = Boolean(model && artifactId && sourceRevision && orgId);
  const begin = async () => {
    setOpen(true);
    try { const values = await listBoards(); setBoards(values.items); setBoardId(values.items[0]?.id ?? ''); }
    catch { setNotice('无法读取白板列表，请重试。'); }
  };
  const submit = async () => {
    if (!model || !artifactId || !sourceRevision || !orgId || !boardId || busy) return;
    if (!x.trim() || !y.trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) { setNotice('请输入有效的世界坐标。'); return; }
    setBusy(true);
    try {
      const layout = renderedDiagramLayout(model, artifactId, orgId, sourceRevision);
      const offset = {x:Number(x),y:Number(y)};
      const key = JSON.stringify({boardId,layoutHash:layout.layoutHash,offset});
      if (attempt.current?.key !== key) {
        const head = await readBoardHead(boardId);
        attempt.current = {key,request:{layout,boardId,epoch:head.epoch,seq:head.seq,requestId:crypto.randomUUID(),offset}};
      }
      await insertRenderedArtifact(attempt.current.request);
      attempt.current = null; setNotice('已插入目标白板'); setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'BOARD_OPERATION_CONFLICT') { attempt.current = null; setNotice('白板已变化，请重新确认插入。'); }
      else if (message.includes('UNSUPPORTED')) setNotice('此图含暂不支持的类型或背景图片，尚未插入任何对象。');
      else setNotice('插入失败，请确认权限后重试；重试保留本次请求身份。');
    } finally { setBusy(false); }
  };
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!enabled} onClick={() => void begin()} data-testid="chat-diagram-insert-board">插入 Board</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogTitle>插入到 Board</DialogTitle><DialogDescription>选择目标白板和世界坐标；插入保持当前 Fabric 布局。</DialogDescription>
      <label>目标白板<select data-testid="chat-board-target" disabled={busy} value={boardId} onChange={event => setBoardId(event.target.value)}>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><Input aria-label="X 坐标" disabled={busy} value={x} onChange={event => setX(event.target.value)}/><Input aria-label="Y 坐标" disabled={busy} value={y} onChange={event => setY(event.target.value)}/></div>
      <Button data-testid="chat-board-handoff-confirm" disabled={busy || !boardId} onClick={() => void submit()}>{busy ? '插入中…' : '确认插入'}</Button>
    </DialogContent></Dialog>
    {notice ? <span role="status">{notice}</span> : null}
  </>;
}
