import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RoomDisplay} from '@/components/whiteboard/room-display';
const joinRoom=vi.fn(),readRoom=vi.fn();
vi.mock('@/lib/whiteboard-room',()=>({joinRoom:(...args:unknown[])=>joinRoom(...args),readRoom:(...args:unknown[])=>readRoom(...args)}));
afterEach(()=>{cleanup();vi.clearAllMocks();sessionStorage.clear();});
it('joins as a read-only room viewer and lets the display leave presenter follow with Escape',async()=>{
  joinRoom.mockResolvedValue({orgId:'org-1',sessionId:'11111111-1111-4111-8111-111111111111',token:'t'.repeat(40),boardId:'22222222-2222-4222-8222-222222222222',boardName:'规划会',expiresAt:'2030-01-01T00:00:00.000Z',role:'room-viewer'});
  readRoom.mockResolvedValue({boardId:'22222222-2222-4222-8222-222222222222',boardName:'规划会',snapshot:'',epoch:0,seq:3,viewport:{x:10,y:20,zoom:1.2,revision:1},expiresAt:'2030-01-01T00:00:00.000Z'});
  render(<RoomDisplay/>);fireEvent.change(screen.getByTestId('room-join-payload'),{target:{value:'{"orgId":"org-1","pairingId":"p","code":"ABCDEFGH"}'}});fireEvent.click(screen.getByTestId('room-join'));
  await waitFor(()=>expect(screen.getByText(/会议室只读 · 3 次更新/)).toBeVisible());
  expect(screen.getByTestId('board-add-sticky')).toBeDisabled();expect(screen.getByText('正在跟随主持人')).toBeVisible();
  fireEvent.keyDown(window,{key:'Escape'});expect(screen.getByText('已退出跟随')).toBeVisible();
});
it('does not disclose whether an expired payload identified a board',async()=>{
  joinRoom.mockRejectedValue(new Error('secret database detail'));render(<RoomDisplay/>);fireEvent.change(screen.getByTestId('room-join-payload'),{target:{value:'{}'}});fireEvent.click(screen.getByTestId('room-join'));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对载荷无效、已过期或已经使用'));
  expect(screen.getByRole('alert')).not.toHaveTextContent('database');
});
