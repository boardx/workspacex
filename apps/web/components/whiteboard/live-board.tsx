'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { getBoard, type Board } from '@/lib/live-whiteboard';
import { WhiteboardProvider, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { CollaborativeEditor } from './collaborative-editor';
import { WorkshopPanel } from './workshop-panel';
import { useOptionalSession } from '@/components/session/session-provider';
import { Button } from '@/components/ui/button';
const initial: WhiteboardConnectionState = { phase: 'connecting', pending: 0, quarantined: 0, role: 'viewer', archived: false, peers: [], reason: null };
export function LiveBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const session = useOptionalSession();
  const providerRef = useRef<WhiteboardProvider | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const awareness = useCallback((cursor: {x:number;y:number}|null, selected:string[]) => providerRef.current?.awareness(cursor,selected), []);
  const [board, setBoard] = useState<Board | null>(null), [doc, setDoc] = useState<Y.Doc | null>(null);
  const [state, setState] = useState(initial), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; const document = createWhiteboardDocument(); let provider: WhiteboardProvider | undefined;
    setSelection([]); setDoc(null); setBoard(null); setFailed(false); setState(initial);
    void getBoard(boardId).then(resource => {
      if (!active) return; setBoard(resource); setDoc(document);
      const principalId = session?.session?.userId;
      if (!principalId) { setFailed(true); return; }
      provider = new WhiteboardProvider(document, boardId, value => { if (active) setState(value); }, { principalId });
      providerRef.current = provider;
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; provider?.close(); if(providerRef.current===provider)providerRef.current=null; document.destroy(); };
  }, [boardId, session?.session?.userId]);
  useEffect(() => {
    if (!state.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.pending]);
  const back = () => { if (!state.pending || window.confirm('仍有未确认保存的修改。离开后，它们会在下次打开此白板时继续同步。确定离开？')) router.push('/studio/board'); };
  if (failed || state.phase === 'blocked') return <section data-testid="denied" className="p-6"><h1 className="text-20 font-semibold">无法继续访问白板</h1><p className="my-3 text-14">权限、会话或同步状态已改变。请返回列表确认后重新打开。{state.quarantined ? `${state.quarantined} 项未确认修改已隔离，不能重放或导出。` : '未确认的修改不能视为已保存。'}</p><Button onClick={back}>返回白板列表</Button></section>;
  if (!doc || !board) return <p data-testid="loading" role="status" className="p-6">正在读取白板…</p>;
  const status = state.phase === 'connecting' ? '正在连接' : state.phase === 'offline' ? `连接中断 · ${state.pending} 项修改待保存` : state.pending ? `${state.pending} 项修改待保存` : '已同步';
  return <div className="flex h-full min-h-0 flex-col"><p className="border-b border-border bg-warning-tint px-3 py-1 text-12 text-warning-tint-foreground">未确认保存的修改已加密保存在此设备，恢复连接后会继续同步。在线成员 {state.peers.length}</p><div className="min-h-0 flex-1"><CollaborativeEditor doc={doc} title={board.name} status={status} readOnly={state.phase === 'connecting' || state.role === 'viewer' || state.archived} onBack={back} currentUserId={session?.session?.userId} peers={state.peers} onSelectionChange={setSelection} onAwareness={awareness} workshop={state.phase === 'online' && <WorkshopPanel boardId={boardId} role={state.archived ? 'viewer' : state.role} selectedObjectId={selection.length===1?selection[0]:undefined} currentUserId={session?.session?.userId}/>}/></div></div>;
}
