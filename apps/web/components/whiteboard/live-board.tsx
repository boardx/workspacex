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
import { DiscussionPanel } from './discussion-panel';
import { BoardTransferControls } from './board-transfer-controls';
import { RoomPresenterControls } from './room-presenter-controls';
import { publishRoomViewport } from '@/lib/live-whiteboard-room';
const initial: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, peers: [], reason: null };
export function LiveBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const session = useOptionalSession();
  const providerRef = useRef<WhiteboardProvider | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const awareness = useCallback((cursor: {x:number;y:number}|null, selected:string[]) => providerRef.current?.awareness(cursor,selected), []);
  const [board, setBoard] = useState<Board | null>(null), [doc, setDoc] = useState<Y.Doc | null>(null);
  const [state, setState] = useState(initial), [failed, setFailed] = useState(false);
  const [roomSession,setRoomSession]=useState<string|null>(null);
  const roomSessionRef=useRef<string|null>(null), viewportTimer=useRef<number|null>(null);
  const setActiveRoom=useCallback((value:string|null)=>{roomSessionRef.current=value;setRoomSession(value);},[]);
  const viewport=useCallback((value:{x:number;y:number;zoom:number})=>{const active=roomSessionRef.current;if(!active)return;if(viewportTimer.current)window.clearTimeout(viewportTimer.current);viewportTimer.current=window.setTimeout(()=>{void publishRoomViewport(boardId,active,value).catch(()=>setActiveRoom(null));},120);},[boardId,setActiveRoom]);
  useEffect(() => {
    let active = true; const document = createWhiteboardDocument(); let provider: WhiteboardProvider | undefined;
    setSelection([]); setDoc(null); setBoard(null); setFailed(false); setState(initial);
    void getBoard(boardId).then(resource => {
      if (!active) return; setBoard(resource); setDoc(document);
      provider = new WhiteboardProvider(document, boardId, value => { if (active) setState(value); });
      providerRef.current = provider;
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; provider?.close(); if(providerRef.current===provider)providerRef.current=null; document.destroy(); };
  }, [boardId]);
  useEffect(() => {
    if (!state.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.pending]);
  const back = () => { if (!state.pending || window.confirm('仍有未确认保存的修改，离开会丢失这些修改。确定离开？')) router.push('/studio/board'); };
  if (failed || state.phase === 'blocked') return <section data-testid="denied" className="p-6"><h1 className="text-20 font-semibold">无法继续访问白板</h1><p className="my-3 text-14">权限、会话或同步状态已改变。请返回列表确认后重新打开。未确认的修改不能视为已保存。</p><Button onClick={back}>返回白板列表</Button></section>;
  if (!doc || !board) return <p data-testid="loading" role="status" className="p-6">正在读取白板…</p>;
  const status = state.phase === 'connecting' ? '正在连接' : state.phase === 'offline' ? `连接中断 · ${state.pending} 项修改待保存` : state.pending ? `${state.pending} 项修改待保存` : '已同步';
  const selectedObject=selection.length===1?(()=>{const value=(doc.getMap('objects').get(selection[0]!) as {get?:(key:string)=>unknown}|undefined);return value?{id:selection[0]!,label:String(value.get?.('text')||'未命名对象').slice(0,200)}:null;})():null;
  const readOnly=state.phase === 'connecting' || state.role === 'viewer' || state.archived;
  return <div className="relative flex h-full min-h-0 flex-col"><div className="flex items-center gap-2 border-b border-border bg-warning-tint px-3 py-1 text-12 text-warning-tint-foreground"><p className="flex-1">未确认保存的修改仅保存在当前页面，关闭或刷新后会丢失。在线成员 {state.peers.length}{roomSession?' · 会议室正在跟随':''}</p><RoomPresenterControls boardId={boardId} disabled={readOnly} onSession={setActiveRoom}/><BoardTransferControls boardId={boardId} onImported={importedId=>router.push(`/studio/board/${importedId}`)}/></div><div className="min-h-0 flex-1"><CollaborativeEditor doc={doc} title={board.name} status={status} readOnly={readOnly} onBack={back} currentUserId={session?.session?.userId} peers={state.peers} onSelectionChange={setSelection} onAwareness={awareness} onViewportChange={viewport} workshop={state.phase === 'online' && <WorkshopPanel boardId={boardId} role={state.archived ? 'viewer' : state.role} selectedObjectId={selection.length===1?selection[0]:undefined} currentUserId={session?.session?.userId}/>}/></div><DiscussionPanel boardId={boardId} selectedObject={selectedObject} readOnly={readOnly}/></div>;
}
