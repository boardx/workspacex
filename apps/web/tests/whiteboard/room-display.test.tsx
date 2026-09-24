import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import * as Y from 'yjs';
import {createWhiteboardDocument,executeCommands} from '@repo/whiteboard-core';
import {RoomDisplay} from '@/components/whiteboard/room-display';
const joinRoom=vi.fn(),readRoom=vi.fn();
vi.mock('@/lib/live-whiteboard-room',()=>({joinRoom:(...args:unknown[])=>joinRoom(...args),readRoom:(...args:unknown[])=>readRoom(...args)}));
afterEach(()=>{cleanup();vi.resetAllMocks();sessionStorage.clear();});
function snapshot(id:string,text:string){const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:{id,schemaVersion:1,kind:'sticky',geometry:{x:20,y:20,width:180,height:140,rotation:0},text,style:{},parentId:null,orderKey:''}}],{});const encoded=Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');doc.destroy();return encoded;}
const grant=(sessionId:string,boardId:string,boardName:string)=>({orgId:'org-1',sessionId,token:'t'.repeat(40),boardId,boardName,expiresAt:'2030-01-01T00:00:00.000Z',role:'room-viewer'});
const roomState=(boardId:string,boardName:string,encoded:string)=>({boardId,boardName,snapshot:encoded,epoch:0,seq:3,viewport:null,expiresAt:'2030-01-01T00:00:00.000Z'});
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
it('destroys revoked Board state before the display pairs with another Board',async()=>{
  const sessionA='11111111-1111-4111-8111-111111111111',sessionB='33333333-3333-4333-8333-333333333333';
  const boardA='22222222-2222-4222-8222-222222222222',boardB='44444444-4444-4444-8444-444444444444';
  joinRoom.mockResolvedValueOnce(grant(sessionA,boardA,'会议 A')).mockResolvedValueOnce(grant(sessionB,boardB,'会议 B'));
  readRoom.mockResolvedValueOnce(roomState(boardA,'会议 A',snapshot('note-a','只属于会议 A'))).mockRejectedValueOnce(new Error('revoked')).mockResolvedValue(roomState(boardB,'会议 B',snapshot('note-b','只属于会议 B')));
  render(<RoomDisplay/>);
  fireEvent.change(screen.getByTestId('room-join-payload'),{target:{value:'{"pairingId":"a"}'}});fireEvent.click(screen.getByTestId('room-join'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'图形：只属于会议 A'})).toBeVisible());
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('会议室连接已过期或被主持人断开'),{timeout:3_000});
  expect(screen.queryByRole('button',{name:'图形：只属于会议 A'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId('room-join-payload'),{target:{value:'{"pairingId":"b"}'}});fireEvent.click(screen.getByTestId('room-join'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'图形：只属于会议 B'})).toBeVisible());
  expect(screen.queryByRole('button',{name:'图形：只属于会议 A'})).not.toBeInTheDocument();
});
