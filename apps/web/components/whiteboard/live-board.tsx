'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { getBoard, type Board } from '@/lib/live-whiteboard';
import { WhiteboardProvider, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { CollaborativeEditor } from './collaborative-editor';
import { useOptionalSession } from '@/components/session/session-provider';
import { Button } from '@/components/ui/button';
import { BoardImportPanel } from './board-import-panel';
const initial: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, epoch: null, peers: [], reason: null, retryAttempt: 0, duplicateAcks: 0, lastAckSequence: null, lastAckReceipt:null };
export function LiveBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const session = useOptionalSession();
  const providerRef = useRef<WhiteboardProvider | null>(null);
  const awareness = useCallback((cursor: {x:number;y:number}|null, selected:string[], editingObjectId: string | null,collaboration:{viewport:{centerX:number;centerY:number;zoom:number;revision:number};presenting:boolean;followingActorId:string|null}) => providerRef.current?.awareness(cursor,selected,editingObjectId,collaboration), []);
  const [board, setBoard] = useState<Board | null>(null), [doc, setDoc] = useState<Y.Doc | null>(null);
  const [state, setState] = useState(initial), [failed, setFailed] = useState(false);
  const [importOpen,setImportOpen]=useState(false);
  useEffect(() => {
    let active = true; const document = createWhiteboardDocument(); let provider: WhiteboardProvider | undefined;
    setDoc(null); setBoard(null); setFailed(false); setState(initial);
    void getBoard(boardId).then(resource => {
      if (!active) return; setBoard(resource); setDoc(document);
      provider = new WhiteboardProvider(document, boardId, value => { if (active) setState(value); });
      providerRef.current = provider;
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; provider?.close(); if(providerRef.current===provider)providerRef.current=null; document.destroy(); };
  }, [boardId]);
  const back = () => router.push('/studio/board');
  if (failed || state.phase === 'blocked') return <section data-testid="denied" className="p-6"><h1 className="text-20 font-semibold">无法继续访问白板</h1><p className="my-3 text-14">权限、会话或同步状态已改变。请返回列表确认后重新打开。未确认的修改不能视为已保存。</p><Button onClick={back}>返回白板列表</Button></section>;
  if (!doc || !board) return <p data-testid="loading" role="status" className="p-6">正在读取白板…</p>;
  const status = state.phase === 'connecting' ? '正在连接' : state.phase === 'offline' ? `连接中断 · 第 ${state.retryAttempt} 次重连 · ${state.pending} 项修改待确认` : state.pending ? `${state.pending} 项修改等待服务器确认` : `已同步${state.lastAckSequence === null ? '' : ` · 序列 ${state.lastAckSequence}`}`;
  return <div className="flex h-full min-h-0 flex-col"><div data-testid="board-sync-banner" className="flex items-center gap-3 border-b border-border bg-warning-tint px-3 py-1 text-12 text-warning-tint-foreground"><span>未确认修改会加密保存在此浏览器，并在刷新、关闭或重连后按原操作 ID 重放。在线成员 {state.peers.length}</span><Button data-testid="board-import-open" className="ml-auto" size="sm" variant="outline" disabled={!['owner','editor'].includes(state.role)||state.archived} onClick={()=>setImportOpen(true)}>导入 Miro / Mural</Button>{state.duplicateAcks ? <span data-testid="board-duplicate-ack">已忽略 {state.duplicateAcks} 个重复确认</span> : null}{state.phase === 'offline' ? <Button data-testid="board-retry-sync" onClick={() => providerRef.current?.retryNow()}>立即重连</Button> : null}</div>{importOpen&&<BoardImportPanel boardId={boardId} expectedEpoch={state.epoch??1} onClose={()=>setImportOpen(false)}/>}<div className="min-h-0 flex-1"><CollaborativeEditor boardId={boardId} clientId={`yjs-${doc.clientID.toString(36)}`} doc={doc} title={board.name} status={status} lastAckSequence={state.lastAckSequence} lastAckReceipt={state.lastAckReceipt} role={state.role} readOnly={state.phase === 'connecting' || !['owner','editor'].includes(state.role) || state.archived} onBack={back} currentUserId={session?.session?.userId} peers={state.peers} onAwareness={awareness}/></div></div>;
}
