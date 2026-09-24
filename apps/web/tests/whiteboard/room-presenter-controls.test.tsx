import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RoomPresenterControls} from '@/components/whiteboard/room-presenter-controls';
import {ApiError} from '@/lib/api-client';

const createRoomPairing=vi.fn(),readPairingStatus=vi.fn(),revokeRoom=vi.fn();
vi.mock('@/lib/live-whiteboard-room',()=>({createRoomPairing:(...args:unknown[])=>createRoomPairing(...args),readPairingStatus:(...args:unknown[])=>readPairingStatus(...args),revokeRoom:(...args:unknown[])=>revokeRoom(...args)}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.resetAllMocks();});
const orgId='org-1',userId='user-1';
const stored=(boardId:string,sessionId:string,user=userId)=>sessionStorage.setItem('wsx.board.presenter.active',JSON.stringify({boardId,orgId,userId:user,sessionId}));

it('restores an active presenter session after reload and can revoke it',async()=>{
  const sessionId='11111111-1111-4111-8111-111111111111',boardId='22222222-2222-4222-8222-222222222222',onSession=vi.fn();
  stored(boardId,sessionId);revokeRoom.mockResolvedValue({ok:true});
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={onSession}/>);
  await waitFor(()=>expect(onSession).toHaveBeenCalledWith(sessionId));
  fireEvent.click(screen.getByTestId('room-present-open'));expect(screen.getByTestId('room-connected')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'断开会议室'}));
  await waitFor(()=>expect(revokeRoom).toHaveBeenCalledWith(boardId,sessionId));
  expect(sessionStorage.getItem('wsx.board.presenter.active')).toBeNull();
});

it('keeps the presenter session when revoke fails in transport',async()=>{
  const sessionId='11111111-1111-4111-8111-111111111111',boardId='22222222-2222-4222-8222-222222222222';
  stored(boardId,sessionId);revokeRoom.mockRejectedValue(new TypeError('offline'));
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);await waitFor(()=>expect(screen.getByTestId('room-present-open')).not.toBeDisabled());fireEvent.click(screen.getByTestId('room-present-open'));fireEvent.click(screen.getByRole('button',{name:'断开会议室'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('暂时无法断开会议室'));
  expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionId);
});

it('keeps a pairing across transient offline status and clears the error after recovery',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',pairingId='33333333-3333-4333-8333-333333333333',sessionId='11111111-1111-4111-8111-111111111111';
  createRoomPairing.mockResolvedValue({id:pairingId,boardId,code:'ABCDEFGH',payload:'{}',expiresAt:'2030-01-01T00:00:00.000Z'});
  readPairingStatus.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({sessionId,joined:true,expiresAt:'2030-01-01T00:00:00.000Z'});
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('正在恢复配对'));
  expect(screen.getByTestId('room-pairing-payload')).toBeVisible();
  await waitFor(()=>expect(screen.getByTestId('room-connected')).toBeVisible(),{timeout:3_000});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(readPairingStatus).toHaveBeenCalledTimes(2);
});

it('does not restore or publish a previous principal session after a same-tab user switch',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',sessionId='11111111-1111-4111-8111-111111111111',onSession=vi.fn();stored(boardId,sessionId);
  const view=render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={onSession}/>);
  await waitFor(()=>expect(onSession).toHaveBeenCalledWith(sessionId));onSession.mockClear();
  view.rerender(<RoomPresenterControls boardId={boardId} orgId={orgId} userId="user-2" disabled={false} onSession={onSession}/>);
  await waitFor(()=>expect(onSession).toHaveBeenCalledWith(null));expect(onSession).not.toHaveBeenCalledWith(sessionId);expect(sessionStorage.getItem('wsx.board.presenter.active')).toBeNull();
  view.rerender(<RoomPresenterControls boardId={boardId} orgId={orgId} userId="user-2" disabled onSession={onSession}/>);
  expect(screen.getByTestId('room-present-open')).toBeDisabled();expect(revokeRoom).not.toHaveBeenCalled();
});

it('ignores principal-A create completion after switching to principal B',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',pairingId='33333333-3333-4333-8333-333333333333';let resolveCreate:(value:unknown)=>void=()=>undefined;const pending=new Promise(resolve=>{resolveCreate=resolve;});
  createRoomPairing.mockReturnValue(pending);const view=render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));
  view.rerender(<RoomPresenterControls boardId={boardId} orgId={orgId} userId="user-2" disabled={false} onSession={vi.fn()}/>);await act(async()=>{resolveCreate({id:pairingId,boardId,code:'ABCDEFGH',payload:'{}',expiresAt:'2030-01-01T00:00:00.000Z'});await pending;});
  expect(createRoomPairing).toHaveBeenCalledTimes(1);expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();expect(readPairingStatus).not.toHaveBeenCalled();
});

it('clears the exact owned presenter record on logout',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',sessionId='11111111-1111-4111-8111-111111111111',onSession=vi.fn();stored(boardId,sessionId);
  const view=render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={onSession}/>);await waitFor(()=>expect(onSession).toHaveBeenCalledWith(sessionId));
  view.rerender(<RoomPresenterControls boardId={boardId} orgId={null} userId={null} disabled onSession={onSession}/>);await waitFor(()=>expect(sessionStorage.getItem('wsx.board.presenter.active')).toBeNull());expect(onSession).toHaveBeenLastCalledWith(null);
});

it('does not let a late principal-A revoke delete principal-B storage',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',sessionA='11111111-1111-4111-8111-111111111111',sessionB='33333333-3333-4333-8333-333333333333';let resolveRevoke:(value:unknown)=>void=()=>undefined;const pending=new Promise(resolve=>{resolveRevoke=resolve;});stored(boardId,sessionA);revokeRoom.mockReturnValue(pending);
  const view=render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);await waitFor(()=>expect(screen.getByTestId('room-present-open')).not.toBeDisabled());fireEvent.click(screen.getByTestId('room-present-open'));fireEvent.click(screen.getByRole('button',{name:'断开会议室'}));
  stored(boardId,sessionB,'user-2');view.rerender(<RoomPresenterControls boardId={boardId} orgId={orgId} userId="user-2" disabled={false} onSession={vi.fn()}/>);await act(async()=>{resolveRevoke({ok:true});await pending;});expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionB);
});

it('expires and clears a pairing locally even while status stays offline',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222';createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:'{}',expiresAt:new Date(Date.now()+100).toISOString()});readPairingStatus.mockRejectedValue(new TypeError('offline'));
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'),{timeout:1_000});expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();const calls=readPairingStatus.mock.calls.length;await new Promise(resolve=>setTimeout(resolve,200));expect(readPairingStatus).toHaveBeenCalledTimes(calls);
});

it.each([400,401,403,404,410,422])('treats authoritative pairing status %i as terminal',async status=>{
  const boardId='22222222-2222-4222-8222-222222222222';createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:'{}',expiresAt:'2030-01-01T00:00:00.000Z'});readPairingStatus.mockRejectedValue(new ApiError(status,null,null));
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'));expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();
});
