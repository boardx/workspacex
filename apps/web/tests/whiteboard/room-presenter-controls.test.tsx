import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RoomPresenterControls} from '@/components/whiteboard/room-presenter-controls';

const revokeRoom=vi.fn();
vi.mock('@/lib/live-whiteboard-room',()=>({createRoomPairing:vi.fn(),readPairingStatus:vi.fn(),revokeRoom:(...args:unknown[])=>revokeRoom(...args)}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.resetAllMocks();});

it('restores an active presenter session after reload and can revoke it',async()=>{
  const sessionId='11111111-1111-4111-8111-111111111111',boardId='22222222-2222-4222-8222-222222222222',onSession=vi.fn();
  sessionStorage.setItem(`wsx.board.presenter.${boardId}`,sessionId);revokeRoom.mockResolvedValue({ok:true});
  render(<RoomPresenterControls boardId={boardId} disabled={false} onSession={onSession}/>);
  await waitFor(()=>expect(onSession).toHaveBeenCalledWith(sessionId));
  fireEvent.click(screen.getByTestId('room-present-open'));expect(screen.getByTestId('room-connected')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'断开会议室'}));
  await waitFor(()=>expect(revokeRoom).toHaveBeenCalledWith(boardId,sessionId));
  expect(sessionStorage.getItem(`wsx.board.presenter.${boardId}`)).toBeNull();
});

it('keeps the presenter session when revoke fails in transport',async()=>{
  const sessionId='11111111-1111-4111-8111-111111111111',boardId='22222222-2222-4222-8222-222222222222';
  sessionStorage.setItem(`wsx.board.presenter.${boardId}`,sessionId);revokeRoom.mockRejectedValue(new TypeError('offline'));
  render(<RoomPresenterControls boardId={boardId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));fireEvent.click(screen.getByRole('button',{name:'断开会议室'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('暂时无法断开会议室'));
  expect(sessionStorage.getItem(`wsx.board.presenter.${boardId}`)).toBe(sessionId);
});
