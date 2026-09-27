'use client';
import {BoardOrganizeControls} from './board-organize-controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import type {WhiteboardAIProposal,WhiteboardPresentationState} from '@repo/contracts/whiteboard-operation';
import type * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { getBoard, type Board } from '@/lib/live-whiteboard';
import { WhiteboardProvider, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { CollaborativeEditor } from './collaborative-editor';
import { useOptionalSession } from '@/components/session/session-provider';
import { Button } from '@/components/ui/button';
import {BoardAIProposalPanel} from './board-ai-proposal-panel';import{BoardPresentationControls}from'./board-presentation-controls';import{cancelAIProposal,confirmAIProposal,joinBoardRoom,readAIProposal,readPresentation,recordBoardUndoReceipt,updatePresentation}from'@/lib/whiteboard-operation-client';
const initial: WhiteboardConnectionState = { phase: 'connecting', pending: 0, role: 'viewer', archived: false, peers: [], reason: null };
export function LiveBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const search=useSearchParams();
  const session = useOptionalSession();
  const providerRef = useRef<WhiteboardProvider | null>(null);
  const [proposalError,setProposalError]=useState('');
  const [selectedIds,setSelectedIds]=useState<string[]>([]),[aiUndo,setAIUndo]=useState<{proposal:WhiteboardAIProposal;revision:{epoch:number;seq:number}}|null>(null);
  const [board, setBoard] = useState<Board | null>(null), [doc, setDoc] = useState<Y.Doc | null>(null);
  const [state, setState] = useState(initial), [failed, setFailed] = useState(false);
  const [proposal,setProposal]=useState<WhiteboardAIProposal|null>(null),[proposalBusy,setProposalBusy]=useState(false),[presentation,setPresentation]=useState<WhiteboardPresentationState|null>(null),[roomActorId,setRoomActorId]=useState<string|null>(null),[roomReconnectToken,setRoomReconnectToken]=useState<string|null>(null);
  const presentationRef=useRef<WhiteboardPresentationState|null>(null),dispatchTail=useRef(Promise.resolve()),viewportTimer=useRef<ReturnType<typeof setTimeout>|null>(null),pendingViewport=useRef<{x:number;y:number;zoom:number}|null>(null);
  const roomId=search.get('room')??'default',proposalId=search.get('proposal'),deviceId=search.get('device');
  useEffect(()=>{let active=true;if(proposalId)void readAIProposal(boardId,proposalId).then(value=>{if(active)setProposal(value)}).catch(()=>{});return()=>{active=false};},[boardId,proposalId]);
  useEffect(()=>{let active=true;const refresh=()=>void readPresentation(boardId,roomId).then(value=>{if(active)setPresentation(value)}).catch(()=>{});refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)};},[boardId,roomId]);
  useEffect(()=>{let active=true;if(!deviceId){setRoomReconnectToken(null);return;}const key=`board-room:${boardId}:${roomId}:${deviceId}`,reconnectToken=sessionStorage.getItem(key)??undefined;void joinBoardRoom(boardId,{roomId,deviceId,deviceKind:'meeting-display',...(reconnectToken?{reconnectToken}:{})}).then(identity=>{if(!active)return;sessionStorage.setItem(key,identity.reconnectToken);setRoomActorId(identity.actorId);setRoomReconnectToken(identity.reconnectToken)}).catch(()=>{if(active){setRoomActorId(null);setRoomReconnectToken(null)}});return()=>{active=false};},[boardId,roomId,deviceId]);
  useEffect(() => {
    let active = true; const document = createWhiteboardDocument(); let provider: WhiteboardProvider | undefined;
    setDoc(null); setBoard(null); setFailed(false); setState(initial); setAIUndo(null); setSelectedIds([]); setProposal(null); setProposalError('');
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
  useEffect(()=>{presentationRef.current=presentation;},[presentation]);
  const actorId=roomActorId??session?.session?.userId??'',displayActorId=`room:${roomId}:meeting-room-display`;
  const dispatchPresentation=useCallback((command:Record<string,unknown>)=>{dispatchTail.current=dispatchTail.current.then(async()=>{let current=presentationRef.current;if(!current||!actorId)return;try{const next=await updatePresentation(boardId,roomId,{...command,actorId,expectedRevision:current.revision},roomReconnectToken);presentationRef.current=next;setPresentation(next);}catch{current=await readPresentation(boardId,roomId);presentationRef.current=current;setPresentation(current);const next=await updatePresentation(boardId,roomId,{...command,actorId,expectedRevision:current.revision},roomReconnectToken);presentationRef.current=next;setPresentation(next);}}).catch(()=>undefined);},[actorId,boardId,roomId,roomReconnectToken]);
  const observeViewport=useCallback((viewport:{x:number;y:number;zoom:number})=>{if(presentationRef.current?.presenterId!==actorId)return;pendingViewport.current=viewport;if(viewportTimer.current)return;viewportTimer.current=setTimeout(()=>{viewportTimer.current=null;const next=pendingViewport.current;pendingViewport.current=null;if(next)dispatchPresentation({type:'viewport',viewport:next});},100);},[actorId,dispatchPresentation]);
  useEffect(()=>()=>{if(viewportTimer.current)clearTimeout(viewportTimer.current);},[]);
  const applyProposal=async()=>{if(!proposal)return;setProposalBusy(true);try{const receipt=await confirmAIProposal(proposal,crypto.randomUUID());recordBoardUndoReceipt(receipt);setAIUndo({proposal,revision:receipt.undoReceipt.expectedRevision});setProposal(null);setProposalError('');}catch(error){setProposalError(error instanceof Error&&error.message==='BOARD_OPERATION_CONFLICT'?'白板已变化，未应用 AI 修改，请重新生成。':'AI 修改尚未确认，请重试。');}finally{setProposalBusy(false);}};const rejectProposal=async()=>{if(!proposal)return;setProposalBusy(true);try{await cancelAIProposal(proposal);setProposal(null);setProposalError('');}catch{setProposalError('取消尚未确认，请重试。');}finally{setProposalBusy(false);}};
  return <div className="flex h-full min-h-0 flex-col"><p className="border-b border-border bg-warning-tint px-3 py-1 text-12 text-warning-tint-foreground">未确认保存的修改仅保存在当前页面，关闭或刷新后会丢失。在线成员 {state.peers.length}</p><div className="min-h-0 flex-1"><CollaborativeEditor boardId={boardId} clientId={`yjs-${doc.clientID.toString(36)}`} doc={doc} onSelectionChange={setSelectedIds} title={board.name} status={status} readOnly={state.phase === 'connecting' || state.role === 'viewer' || state.archived} onBack={back} currentUserId={actorId} peers={state.peers} onAwareness={(cursor,ids,pointer)=>providerRef.current?.awareness(cursor,ids,pointer)} followViewport={presentation?.followers.includes(actorId)?presentation.viewport:null} onViewportObserved={observeViewport}/></div><BoardOrganizeControls boardId={boardId} selectedIds={selectedIds} readOnly={state.phase!=='online' || !['owner','editor'].includes(state.role) || state.archived} onProposal={setProposal} undo={aiUndo} onUndone={()=>setAIUndo(null)}/>{proposalError?<p role="alert" className="fixed right-4 top-12 z-50 rounded-lg bg-card p-2">{proposalError}</p>:null}{proposal?<BoardAIProposalPanel proposal={proposal} busy={proposalBusy} onConfirm={()=>void applyProposal()} onCancel={()=>void rejectProposal()}/>:null}{presentation?<BoardPresentationControls state={presentation} actorId={actorId} canPresent={state.role!=='viewer'} handoffTargetActorId={deviceId?undefined:displayActorId} onClaim={()=>void dispatchPresentation({type:'claim-presenter'})} onRelease={()=>void dispatchPresentation({type:'release-presenter'})} onFollow={()=>void dispatchPresentation({type:'follow'})} onLeave={()=>void dispatchPresentation({type:'leave-follow'})} onHandoff={toActorId=>void dispatchPresentation({type:'handoff',toActorId})}/>:null}</div>;
}
