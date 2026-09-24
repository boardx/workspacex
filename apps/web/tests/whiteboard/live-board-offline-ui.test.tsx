import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WhiteboardConnectionState } from '@/lib/whiteboard-provider';

const mocks=vi.hoisted(()=>({push:vi.fn(),getBoard:vi.fn(),requestRecovery:vi.fn(),discard:vi.fn(),callback:null as null|((state:WhiteboardConnectionState)=>void)}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/lib/live-whiteboard',()=>({getBoard:mocks.getBoard,requestQuarantineRecovery:mocks.requestRecovery}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({session:{userId:'user-1'}})}));
vi.mock('@/components/whiteboard/collaborative-editor',()=>({CollaborativeEditor:({status}:{status:string})=><div data-testid="editor-status">{status}</div>}));
vi.mock('@/components/whiteboard/workshop-panel',()=>({WorkshopPanel:()=>null}));
vi.mock('@/components/whiteboard/room-presenter-controls',()=>({RoomPresenterControls:()=>null}));
vi.mock('@/components/whiteboard/board-transfer-controls',()=>({BoardTransferControls:()=>null}));
vi.mock('@/lib/whiteboard-provider',()=>({WhiteboardProvider:class{constructor(_doc:unknown,_board:string,callback:(state:WhiteboardConnectionState)=>void){mocks.callback=callback;}close(){}awareness(){}discardQuarantine=mocks.discard;}}));

import { LiveBoard } from '@/components/whiteboard/live-board';

const base:WhiteboardConnectionState={phase:'online',pending:0,quarantined:0,quarantineReceipts:[],role:'owner',archived:false,peers:[],reason:null};
const receipt={boardId:'11111111-1111-4111-8111-111111111111',principalId:'user-1',sessionId:'a'.repeat(64),epoch:1,receiptId:'22222222-2222-4222-8222-222222222222',accessReceiptId:'44444444-4444-4444-8444-444444444444',reason:'ACCESS_DENIED',quarantinedAt:'2026-09-24T00:00:00.000Z',pendingCount:3,pendingBytes:12};

beforeEach(()=>{mocks.push.mockReset();mocks.getBoard.mockReset().mockResolvedValue({id:receipt.boardId,name:'Board',ownerId:'user-1',role:'owner',archived:false,createdAt:receipt.quarantinedAt,updatedAt:receipt.quarantinedAt});mocks.requestRecovery.mockReset().mockResolvedValue({requestId:'33333333-3333-4333-8333-333333333333',status:'pending-review',createdAt:receipt.quarantinedAt});mocks.discard.mockReset().mockResolvedValue(true);mocks.callback=null;});

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
