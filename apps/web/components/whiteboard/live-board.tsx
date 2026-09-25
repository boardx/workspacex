'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type * as Y from 'yjs';
import { createWhiteboardDocument, readObjects } from '@repo/whiteboard-core';
import { getBoard, requestQuarantineRecovery, type Board } from '@/lib/live-whiteboard';
import { WhiteboardProvider, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { CollaborativeEditor } from './collaborative-editor';
import { WorkshopPanel } from './workshop-panel';
import { useOptionalSession } from '@/components/session/session-provider';
import { Button } from '@/components/ui/button';
import { DiscussionPanel } from './discussion-panel';
import { BoardTransferControls } from './board-transfer-controls';
import { RoomPresenterControls } from './room-presenter-controls';
import { publishRoomViewport } from '@/lib/live-whiteboard-room';
import {clearPresenterSession,isAuthoritativeRoomEnd,persistBoardViewport,restoreBoardViewport} from '@/lib/whiteboard-room-session';
import { whiteboard as WhiteboardContract } from '@repo/contracts';
const initial: WhiteboardConnectionState = { phase: 'connecting', pending: 0, quarantined: 0, quarantineReceipts: [], role: 'viewer', archived: false, peers: [], reason: null, clientNonce: '', connectionId: null,seq:0 };
const liveBoardRoots=new WeakMap<HTMLElement,number>();
export function retainLiveBoardZoomScope(root:HTMLElement):()=>void{
  liveBoardRoots.set(root,(liveBoardRoots.get(root)??0)+1);root.dataset.liveBoardMounted='true';let retained=true;
  return()=>{if(!retained)return;retained=false;const remaining=(liveBoardRoots.get(root)??1)-1;if(remaining>0){liveBoardRoots.set(root,remaining);return;}liveBoardRoots.delete(root);delete root.dataset.liveBoardMounted;};
}
export function LiveBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const session = useOptionalSession();
  const providerRef = useRef<WhiteboardProvider | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const awareness = useCallback((cursor: {x:number;y:number}|null, selected:string[]) => providerRef.current?.awareness(cursor,selected), []);
  const [board, setBoard] = useState<Board | null>(null), [doc, setDoc] = useState<Y.Doc | null>(null);
  const [state, setState] = useState(initial), [failed, setFailed] = useState(false);
  const [recoveryMessage,setRecoveryMessage]=useState<string|null>(null),[recoveryBusy,setRecoveryBusy]=useState(false);
  const [roomSession,setRoomSession]=useState<string|null>(null);
  const [openPanel,setOpenPanel]=useState<'workshop'|'discussion'|null>(null);
  const deniedRef=useRef<HTMLElement|null>(null);
  const denied=failed||state.phase==='blocked';
  useEffect(() => {
    return retainLiveBoardZoomScope(document.documentElement);
  },[]);
  // JSX `autoFocus` only auto-focuses recognized form elements (button/input/select/
  // textarea) in React's host config; for an arbitrary host element like this <section>
  // React just forwards the `autofocus` DOM attribute, which browsers only honor for
  // elements inserted while the document is being parsed - not for one that appears via
  // a later re-render/state transition. So focus never actually lands here without an
  // explicit imperative call once the element exists in the DOM.
  useEffect(() => {
    if (denied) deniedRef.current?.focus();
  }, [denied]);
  type QueuedViewport={value:{x:number;y:number;zoom:number};session:{id:string;epoch:number};scope:{boardId:string;orgId:string;userId:string};operation:number};
  const roomSessionRef=useRef<{id:string;epoch:number}|null>(null),roomSessionEpoch=useRef(0),viewportOperation=useRef(0),viewportTimer=useRef<number|null>(null),viewportInFlight=useRef(false),queuedViewport=useRef<QueuedViewport|null>(null),mounted=useRef(true);
  const setActiveRoom=useCallback((value:string|null)=>{viewportOperation.current+=1;queuedViewport.current=null;if(viewportTimer.current){window.clearTimeout(viewportTimer.current);viewportTimer.current=null;}if(value===null){roomSessionRef.current=null;setRoomSession(null);return;}roomSessionRef.current={id:value,epoch:++roomSessionEpoch.current};setRoomSession(value);},[]);
  const presenterScope=useMemo(()=>session?.session?.currentOrgId&&session.session.userId?{boardId,orgId:session.session.currentOrgId,userId:session.session.userId}:null,[boardId,session?.session?.currentOrgId,session?.session?.userId]);
  const presenterScopeRef=useRef(presenterScope);presenterScopeRef.current=presenterScope;
  const drainViewport=useRef<()=>void>(()=>undefined);
  drainViewport.current=()=>{if(viewportInFlight.current)return;const queued=queuedViewport.current;if(!queued)return;queuedViewport.current=null;const {value,session:active,scope,operation}=queued;if(!mounted.current||roomSessionRef.current!==active||presenterScopeRef.current!==scope)return;viewportInFlight.current=true;void publishRoomViewport(boardId,active.id,value).catch(cause=>{if(!mounted.current||roomSessionRef.current!==active||presenterScopeRef.current!==scope)return;
      // A newer transform queued while this request was in flight must get one chance to
      // reach the server. Otherwise an older response can terminate the restored session
      // before the latest presenter viewport is published.
      if(isAuthoritativeRoomEnd(cause)&&!queuedViewport.current&&viewportOperation.current===operation){clearPresenterSession(scope,active.id);setActiveRoom(null);}
    }).finally(()=>{viewportInFlight.current=false;if(mounted.current)drainViewport.current();});};
  const viewport=useCallback((value:{x:number;y:number;zoom:number})=>{persistBoardViewport(boardId,value);const active=roomSessionRef.current;if(!active||!presenterScope)return;const operation=++viewportOperation.current;if(viewportTimer.current)window.clearTimeout(viewportTimer.current);viewportTimer.current=window.setTimeout(()=>{viewportTimer.current=null;if(!mounted.current||viewportOperation.current!==operation||roomSessionRef.current!==active||presenterScopeRef.current!==presenterScope)return;queuedViewport.current={value,session:active,scope:presenterScope,operation};drainViewport.current();},120);},[boardId,presenterScope]);
  // The owner's own pan/zoom is plain component state in CollaborativeEditor, so it
  // resets on every remount (a reload, navigating away and back). Restoring the last
  // value this board saw keeps a reload from silently re-broadcasting a default
  // viewport to a meeting-room display that is already following a real one.
  const initialViewport=useMemo(()=>restoreBoardViewport(boardId),[boardId]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;viewportOperation.current+=1;queuedViewport.current=null;if(viewportTimer.current){window.clearTimeout(viewportTimer.current);viewportTimer.current=null;}roomSessionRef.current=null;};},[]);
  useEffect(() => {
    let active = true; const document = createWhiteboardDocument(); let provider: WhiteboardProvider | undefined;
    setSelection([]); setDoc(null); setBoard(null); setFailed(false); setState(initial);
    void getBoard(boardId).then(resource => {
      if (!active) return; setBoard(resource); setDoc(document);
      const principalId = session?.session?.userId;
      const orgId = session?.session?.currentOrgId;
      if (!principalId || !orgId) { setFailed(true); return; }
      provider = new WhiteboardProvider(document, boardId, value => { if (active) setState(value); }, { orgId, principalId });
      providerRef.current = provider;
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; provider?.close(); if(providerRef.current===provider)providerRef.current=null; document.destroy(); };
  }, [boardId, session?.session?.currentOrgId, session?.session?.userId]);
  useEffect(() => {
    if (!state.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.pending]);
  useEffect(() => {
    if (!doc || sessionStorage.getItem('__WORKSPACEX_WHITEBOARD_SOAK__') !== '1') return;
    const diagnostics = window as typeof window & { __WORKSPACEX_WHITEBOARD_DOCUMENT__?: () => { objects: ReturnType<typeof readObjects>; binding: { clientNonce: string; connectionId: string | null; role: WhiteboardConnectionState['role']; runId: string | null; challenge: string | null;seq:number } } };
    diagnostics.__WORKSPACEX_WHITEBOARD_DOCUMENT__ = () => ({ objects: readObjects(doc), binding: { clientNonce: state.clientNonce, connectionId: state.connectionId, role: state.role, runId: state.soakRunId ?? null, challenge: state.soakChallenge ?? null,seq:state.seq } });
    return () => { delete diagnostics.__WORKSPACEX_WHITEBOARD_DOCUMENT__; };
  }, [doc, state.clientNonce, state.connectionId, state.role, state.soakRunId, state.soakChallenge,state.seq]);
  const back = () => { if (!state.pending || window.confirm('仍有未确认保存的修改。离开后，它们会在下次打开此白板时继续同步。确定离开？')) router.push('/studio/board'); };
  const receipt=state.quarantineReceipts?.[0];
  const requestRecovery=async()=>{if(!receipt?.accessReceiptId)return;const reason=WhiteboardContract.QuarantineRecoveryReason.safeParse(receipt.reason);if(!reason.success){setRecoveryMessage('当前隔离原因不允许申请恢复。');return;}setRecoveryBusy(true);try{const result=await requestQuarantineRecovery(boardId,{requestId:crypto.randomUUID(),receiptId:receipt.receiptId,accessReceiptId:receipt.accessReceiptId,sessionFingerprint:receipt.sessionId,epoch:receipt.epoch,pendingCount:receipt.pendingCount,pendingBytes:receipt.pendingBytes,reason:reason.data});setRecoveryMessage(result.status==='pending-review'?`恢复申请已提交：${result.requestId}`:'组织策略拒绝了恢复申请。');}catch{setRecoveryMessage('组织策略拒绝了恢复申请，或当前会话已失效。');}finally{setRecoveryBusy(false);}};
  const discard=async()=>{if(!receipt||!window.confirm('确定永久丢弃这些隔离修改？此操作无法撤销。'))return;setRecoveryBusy(true);try{const removed=await providerRef.current?.discardQuarantine(receipt.receiptId);setRecoveryMessage(removed?'隔离修改已从此设备删除。':'隔离数据已不存在或不属于当前会话。');}finally{setRecoveryBusy(false);}};
  const quarantineActions=receipt?<div data-testid="whiteboard-quarantine-actions" className="mt-4 flex flex-wrap items-center gap-2">{receipt.accessReceiptId?<Button disabled={recoveryBusy} onClick={()=>void requestRecovery()}>申请组织恢复</Button>:<p className="w-full text-12">此数据来自旧版离线存储，无法验证访问凭证，只能永久丢弃。</p>}<Button disabled={recoveryBusy} variant="outline" onClick={()=>void discard()}>永久丢弃</Button>{recoveryMessage&&<p role="status" className="w-full text-12">{recoveryMessage}</p>}</div>:null;
  // The discussion toggle/panel (`DiscussionPanel`) is a sibling of `board-primary-controls`,
  // not nested inside it, specifically so it stays interactive (not `inert`) while the
  // canvas/toolbar/transfer-bar subtree is inert with the panel open. That means its
  // `absolute` positioning is anchored to this whole-page `relative` root, so a plain
  // `sm:top-3` landed it directly on top of the transfer-bar's right-aligned export/import
  // buttons at >=640px viewports (both anchor to the page's top-right corner) - a real,
  // z-20 visual/hit-test occlusion (e2e/whiteboard-live-reflow.spec.ts's assertReachable
  // caught `document.elementFromPoint` on the import trigger landing on this toggle
  // instead). The toggle needs to clear every chrome row above the canvas - this
  // transfer-bar plus CollaborativeEditor's own document-header and toolbar rows, none of
  // which this component has refs into - so `--board-canvas-offset` is measured as the
  // live gap between the layout root and the canvas surface itself (`board-live-surface`)
  // rather than any one row's height, and re-measured on layout size changes (peer count,
  // the quarantine banner, reflow) via ResizeObserver. Kept above the `denied`/loading early
  // returns below so the hook order stays stable across renders.
  const layoutRef=useRef<HTMLDivElement|null>(null);
  const [canvasOffset,setCanvasOffset]=useState(0);
  useEffect(()=>{
    const root=layoutRef.current;if(!root)return;
    const measure=()=>{
      const canvas=root.querySelector('[data-testid="board-live-surface"]');
      if(!canvas){setCanvasOffset(0);return;}
      setCanvasOffset(canvas.getBoundingClientRect().top-root.getBoundingClientRect().top);
    };
    measure();
    window.addEventListener('resize',measure);
    // jsdom (unit tests) has no ResizeObserver; `measure()` above already ran once and a
    // plain resize listener still covers viewport-driven reflow there.
    if(typeof ResizeObserver==='undefined')return()=>window.removeEventListener('resize',measure);
    // `ResizeObserver` on the root only fires when the root's own box changes size, not
    // when a sibling row's height shifts the canvas's position without changing the root's
    // overall size (e.g. the peer count growing a line, or the viewport reflowing at a
    // breakpoint) - so also watch the actual chrome rows above the canvas.
    const chromeRows=root.querySelectorAll('[data-testid="board-transfer-bar"], [data-testid="board-document-header"], [role="toolbar"]');
    const observer=new ResizeObserver(measure);observer.observe(root);chromeRows.forEach(row=>observer.observe(row));
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[doc,board,state.peers.length,state.quarantined,roomSession,state.phase]);
  if (denied) return <section ref={deniedRef} data-testid="denied" role="alert" aria-live="assertive" tabIndex={-1} className="p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><h1 className="text-20 font-semibold">无法继续访问白板</h1><p className="my-3 text-14">权限、会话或同步状态已改变。请返回列表确认后重新打开。{state.quarantined ? `${state.quarantined} 项未确认修改已隔离，不能重放或导出。` : '未确认的修改不能视为已保存。'}</p>{quarantineActions}<div className="mt-4"><Button onClick={back}>返回白板列表</Button></div></section>;
  if (!doc || !board) return <p data-testid="loading" role="status" className="p-6">正在读取白板…</p>;
  const status = state.phase === 'connecting' ? '正在连接' : state.phase === 'offline' ? `连接中断 · ${state.pending} 项修改待保存` : state.pending ? `${state.pending} 项修改待保存` : '已同步';
  const selectedObject=selection.length===1?(()=>{const value=(doc.getMap('objects').get(selection[0]!) as {get?:(key:string)=>unknown}|undefined);return value?{id:selection[0]!,label:String(value.get?.('text')||'未命名对象').slice(0,200)}:null;})():null;
  const readOnly=state.phase === 'connecting' || state.role === 'viewer' || state.archived;
  return <div ref={layoutRef} data-testid="live-board-layout" className="relative flex min-h-full min-w-0 flex-col overflow-hidden sm:h-full sm:min-h-0" style={{'--board-canvas-offset':`${canvasOffset}px`} as CSSProperties}><div data-testid="board-primary-controls" {...(openPanel==='discussion'?({inert:''} as unknown as {inert?:boolean}):{})} aria-hidden={openPanel==='discussion'} className="flex min-h-0 min-w-0 flex-1 flex-col"><div data-testid="board-transfer-bar" onFocus={e=>{e.target.scrollIntoView?.({block:'nearest',inline:'nearest'});}} className="flex max-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-warning-tint px-3 py-1 text-12 text-warning-tint-foreground sm:max-h-28 sm:flex-wrap sm:overflow-y-auto"><div className="min-w-48 flex-1 shrink-0 sm:min-w-0"><p>未确认保存的修改已加密保存在此设备，恢复连接后会继续同步。在线成员 {state.peers.length}{roomSession?' · 会议室正在跟随':''}</p>{state.quarantined>0&&quarantineActions}</div><RoomPresenterControls boardId={boardId} orgId={session?.session?.currentOrgId??null} userId={session?.session?.userId??null} disabled={readOnly} onSession={setActiveRoom}/><BoardTransferControls boardId={boardId} onImported={importedId=>router.push(`/studio/board/${importedId}`)}/></div><div className="min-h-0 min-w-0 flex-1"><CollaborativeEditor doc={doc} title={board.name} status={status} readOnly={readOnly} onBack={back} currentUserId={session?.session?.userId} peers={state.peers} onSelectionChange={setSelection} onAwareness={awareness} onViewportChange={viewport} initialViewport={initialViewport} auxiliaryPanelOpen={openPanel!==null} workshop={state.phase === 'online' && <WorkshopPanel boardId={boardId} role={state.archived ? 'viewer' : state.role} selectedObjectId={selection.length===1?selection[0]:undefined} currentUserId={session?.session?.userId} expanded={openPanel==='workshop'} onExpandedChange={expanded=>setOpenPanel(expanded?'workshop':null)}/>}/></div></div><DiscussionPanel boardId={boardId} selectedObject={selectedObject} readOnly={readOnly} expanded={openPanel==='discussion'} onExpandedChange={expanded=>setOpenPanel(expanded?'discussion':null)}/></div>;
}
