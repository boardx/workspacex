import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import {ApiError} from '@/lib/api-client';

const mocks=vi.hoisted(()=>({push:vi.fn(),getBoard:vi.fn(),requestRecovery:vi.fn(),discard:vi.fn(),publishViewport:vi.fn(),callback:null as null|((state:WhiteboardConnectionState)=>void),roomOnSession:null as null|((sessionId:string|null)=>void),viewport:null as null|((value:{x:number;y:number;zoom:number})=>void),session:{userId:'user-1',currentOrgId:'org-one'}}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/lib/live-whiteboard',()=>({getBoard:mocks.getBoard,requestQuarantineRecovery:mocks.requestRecovery}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({session:mocks.session})}));
vi.mock('@/components/whiteboard/collaborative-editor',()=>({CollaborativeEditor:({status,onViewportChange}:{status:string;onViewportChange?:(value:{x:number;y:number;zoom:number})=>void})=>{mocks.viewport=onViewportChange??null;return <div data-testid="editor-status">{status}</div>;}}));
vi.mock('@/components/whiteboard/workshop-panel',()=>({WorkshopPanel:()=>null}));
vi.mock('@/components/whiteboard/room-presenter-controls',()=>({RoomPresenterControls:({onSession}:{onSession:(sessionId:string|null)=>void})=>{mocks.roomOnSession=onSession;return null;}}));
vi.mock('@/components/whiteboard/board-transfer-controls',()=>({BoardTransferControls:()=>null}));
vi.mock('@/lib/live-whiteboard-room',()=>({publishRoomViewport:mocks.publishViewport}));
vi.mock('@/lib/whiteboard-provider',()=>({WhiteboardProvider:class{constructor(_doc:unknown,_board:string,callback:(state:WhiteboardConnectionState)=>void){mocks.callback=callback;}close(){}awareness(){}discardQuarantine=mocks.discard;}}));

import { LiveBoard } from '@/components/whiteboard/live-board';

const base:WhiteboardConnectionState={phase:'online',pending:0,quarantined:0,quarantineReceipts:[],role:'owner',archived:false,peers:[],reason:null};
const receipt={boardId:'11111111-1111-4111-8111-111111111111',orgId:'org-one',principalId:'user-1',sessionId:'a'.repeat(64),epoch:1,receiptId:'22222222-2222-4222-8222-222222222222',accessReceiptId:'44444444-4444-4444-8444-444444444444',reason:'ACCESS_DENIED',quarantinedAt:'2026-09-24T00:00:00.000Z',pendingCount:3,pendingBytes:12};

beforeEach(()=>{mocks.push.mockReset();mocks.getBoard.mockReset().mockResolvedValue({id:receipt.boardId,name:'Board',ownerId:'user-1',role:'owner',archived:false,createdAt:receipt.quarantinedAt,updatedAt:receipt.quarantinedAt});mocks.requestRecovery.mockReset().mockResolvedValue({requestId:'33333333-3333-4333-8333-333333333333',status:'pending-review',createdAt:receipt.quarantinedAt});mocks.discard.mockReset().mockResolvedValue(true);mocks.publishViewport.mockReset();mocks.callback=null;mocks.roomOnSession=null;mocks.viewport=null;mocks.session={userId:'user-1',currentOrgId:'org-one'};sessionStorage.clear();});

it('arms beforeunload as soon as provider reports an in-memory pending edit',async()=>{
  render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.callback).not.toBeNull());
  act(()=>mocks.callback?.({...base,pending:1}));await screen.findByText('1 项修改待保存');
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
});

it('submits auditable recovery metadata and can permanently discard the principal-owned receipt',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.callback).not.toBeNull());
  act(()=>mocks.callback?.({...base,phase:'blocked',quarantined:3,quarantineReceipts:[receipt],reason:'ACCESS_DENIED'}));
    fireEvent.click(await screen.findByRole('button',{name:'申请组织恢复'}));await waitFor(()=>expect(mocks.requestRecovery).toHaveBeenCalledWith(receipt.boardId,expect.objectContaining({receiptId:receipt.receiptId,accessReceiptId:receipt.accessReceiptId,sessionFingerprint:receipt.sessionId,pendingCount:3,reason:'ACCESS_DENIED'})));
  expect(await screen.findByText(/恢复申请已提交/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'永久丢弃'}));await waitFor(()=>expect(mocks.discard).toHaveBeenCalledWith(receipt.receiptId));
});

it('shows the same non-enumerating refusal when recovery policy rejects the receipt',async()=>{
  mocks.requestRecovery.mockRejectedValueOnce(new Error('forbidden'));render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.callback).not.toBeNull());
  act(()=>mocks.callback?.({...base,phase:'blocked',quarantined:3,quarantineReceipts:[receipt],reason:'ACCESS_DENIED'}));
  fireEvent.click(await screen.findByRole('button',{name:'申请组织恢复'}));
  expect(await screen.findByText('组织策略拒绝了恢复申请，或当前会话已失效。')).toBeVisible();
});

it('keeps legacy quarantine data discard-only when no server access proof exists',async()=>{
  const {accessReceiptId:_,...legacyReceipt}=receipt;
  render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.callback).not.toBeNull());
  act(()=>mocks.callback?.({...base,phase:'blocked',quarantined:3,quarantineReceipts:[legacyReceipt],reason:'ACCESS_DENIED'}));
  expect(await screen.findByText('此数据来自旧版离线存储，无法验证访问凭证，只能永久丢弃。')).toBeVisible();
  expect(screen.queryByRole('button',{name:'申请组织恢复'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'永久丢弃'})).toBeVisible();
});

it('does not let a late principal-A publish failure clear principal-B room storage',async()=>{
  let rejectPublish:(reason:unknown)=>void=()=>undefined;const pending=new Promise((_resolve,reject)=>{rejectPublish=reject;});mocks.publishViewport.mockReturnValueOnce(pending);
  const view=render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.roomOnSession).not.toBeNull());act(()=>mocks.callback?.(base));
  const sessionA='11111111-1111-4111-8111-111111111111',sessionB='33333333-3333-4333-8333-333333333333';act(()=>mocks.roomOnSession?.(sessionA));await waitFor(()=>expect(mocks.viewport).not.toBeNull());act(()=>mocks.viewport?.({x:1,y:2,zoom:1.1}));await waitFor(()=>expect(mocks.publishViewport).toHaveBeenCalledWith(receipt.boardId,sessionA,{x:1,y:2,zoom:1.1}));
  mocks.session={userId:'user-2',currentOrgId:'org-one'};view.rerender(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.roomOnSession).not.toBeNull());act(()=>mocks.roomOnSession?.(sessionB));sessionStorage.setItem('wsx.board.presenter.active',JSON.stringify({boardId:receipt.boardId,orgId:'org-one',userId:'user-2',sessionId:sessionB}));
  rejectPublish(new ApiError(404,null,null));await act(async()=>{await pending.catch(()=>undefined);});
  expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionB);
});

it('lets only the latest same-session viewport operation handle an authoritative failure',async()=>{
  let rejectFirst:(reason:unknown)=>void=()=>undefined,rejectSecond:(reason:unknown)=>void=()=>undefined;
  const first=new Promise((_resolve,reject)=>{rejectFirst=reject;}),second=new Promise((_resolve,reject)=>{rejectSecond=reject;});mocks.publishViewport.mockReturnValueOnce(first).mockReturnValueOnce(second);
  render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.roomOnSession).not.toBeNull());act(()=>mocks.callback?.(base));
  const sessionId='11111111-1111-4111-8111-111111111111';sessionStorage.setItem('wsx.board.presenter.active',JSON.stringify({boardId:receipt.boardId,orgId:'org-one',userId:'user-1',sessionId}));act(()=>mocks.roomOnSession?.(sessionId));await waitFor(()=>expect(mocks.viewport).not.toBeNull());
  act(()=>mocks.viewport?.({x:1,y:2,zoom:1.1}));await waitFor(()=>expect(mocks.publishViewport).toHaveBeenCalledTimes(1));act(()=>mocks.viewport?.({x:3,y:4,zoom:1.2}));await waitFor(()=>expect(mocks.publishViewport).toHaveBeenCalledTimes(2));
  rejectFirst(new ApiError(404,null,null));await act(async()=>{await first.catch(()=>undefined);});expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionId);
  rejectSecond(new ApiError(404,null,null));await act(async()=>{await second.catch(()=>undefined);});await waitFor(()=>expect(sessionStorage.getItem('wsx.board.presenter.active')).toBeNull());
});

it('cancels a queued viewport publish when the board unmounts',async()=>{
  const view=render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.roomOnSession).not.toBeNull());act(()=>mocks.callback?.(base));act(()=>mocks.roomOnSession?.('11111111-1111-4111-8111-111111111111'));await waitFor(()=>expect(mocks.viewport).not.toBeNull());
  act(()=>mocks.viewport?.({x:1,y:2,zoom:1.1}));view.unmount();await new Promise(resolve=>setTimeout(resolve,180));expect(mocks.publishViewport).not.toHaveBeenCalled();
});

it('ignores an in-flight publish rejection after the board unmounts',async()=>{
  let rejectPublish:(reason:unknown)=>void=()=>undefined;const pending=new Promise((_resolve,reject)=>{rejectPublish=reject;});mocks.publishViewport.mockReturnValueOnce(pending);
  const view=render(<LiveBoard boardId={receipt.boardId}/>);await waitFor(()=>expect(mocks.roomOnSession).not.toBeNull());act(()=>mocks.callback?.(base));
  const sessionId='11111111-1111-4111-8111-111111111111';sessionStorage.setItem('wsx.board.presenter.active',JSON.stringify({boardId:receipt.boardId,orgId:'org-one',userId:'user-1',sessionId}));act(()=>mocks.roomOnSession?.(sessionId));await waitFor(()=>expect(mocks.viewport).not.toBeNull());act(()=>mocks.viewport?.({x:1,y:2,zoom:1.1}));await waitFor(()=>expect(mocks.publishViewport).toHaveBeenCalledTimes(1));
  view.unmount();rejectPublish(new ApiError(404,null,null));await act(async()=>{await pending.catch(()=>undefined);});expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionId);
});
