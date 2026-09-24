import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {RoomPresenterControls} from '@/components/whiteboard/room-presenter-controls';
import {ApiError} from '@/lib/api-client';

const createRoomPairing=vi.fn(),readPairingStatus=vi.fn(),revokeRoom=vi.fn();
vi.mock('@/lib/live-whiteboard-room',()=>({createRoomPairing:(...args:unknown[])=>createRoomPairing(...args),readPairingStatus:(...args:unknown[])=>readPairingStatus(...args),revokeRoom:(...args:unknown[])=>revokeRoom(...args)}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();vi.resetAllMocks();});
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

it('disables begin while pending and lets only the latest same-scope create operation win',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',firstId='33333333-3333-4333-8333-333333333333',secondId='44444444-4444-4444-8444-444444444444';
  let resolveFirst:(value:unknown)=>void=()=>undefined,resolveSecond:(value:unknown)=>void=()=>undefined;
  const first=new Promise(resolve=>{resolveFirst=resolve;}),second=new Promise(resolve=>{resolveSecond=resolve;});
  createRoomPairing.mockReturnValueOnce(first).mockReturnValueOnce(second);readPairingStatus.mockReturnValue(new Promise(()=>undefined));
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);
  const button=screen.getByTestId('room-present-open');
  // Counterproof for two browser events already queued before React commits the pending state.
  act(()=>{button.click();button.click();});expect(button).toBeDisabled();expect(createRoomPairing).toHaveBeenCalledTimes(2);
  await act(async()=>{resolveSecond({id:secondId,boardId,code:'SECOND22',payload:'second-payload',expiresAt:'2030-01-01T00:00:00.000Z'});await second;});
  expect(screen.getByTestId('room-pairing-payload')).toHaveValue('second-payload');await waitFor(()=>expect(readPairingStatus).toHaveBeenCalledWith(boardId,secondId,expect.any(AbortSignal)));
  await act(async()=>{resolveFirst({id:firstId,boardId,code:'FIRST111',payload:'first-payload',expiresAt:'2030-01-01T00:00:00.000Z'});await first;});
  expect(screen.getByTestId('room-pairing-payload')).toHaveValue('second-payload');expect(readPairingStatus).not.toHaveBeenCalledWith(boardId,firstId,expect.anything());
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

it('does not let an unmounted stop completion clear a replacement with the same session id',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',sessionId='11111111-1111-4111-8111-111111111111';let resolveRevoke:(value:unknown)=>void=()=>undefined;const pending=new Promise(resolve=>{resolveRevoke=resolve;});stored(boardId,sessionId);revokeRoom.mockReturnValue(pending);
  const first=render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);await waitFor(()=>expect(screen.getByTestId('room-present-open')).not.toBeDisabled());fireEvent.click(screen.getByTestId('room-present-open'));fireEvent.click(screen.getByRole('button',{name:'断开会议室'}));
  first.unmount();stored(boardId,sessionId);render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);await waitFor(()=>expect(screen.getByTestId('room-present-open')).not.toBeDisabled());
  await act(async()=>{resolveRevoke({ok:true});await pending;});expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionId);
});

it('lets only the latest same-session stop operation mutate presenter state',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',sessionId='11111111-1111-4111-8111-111111111111';let resolveFirst:(value:unknown)=>void=()=>undefined,rejectSecond:(reason:unknown)=>void=()=>undefined;
  const first=new Promise(resolve=>{resolveFirst=resolve;}),second=new Promise((_resolve,reject)=>{rejectSecond=reject;});stored(boardId,sessionId);revokeRoom.mockReturnValueOnce(first).mockReturnValueOnce(second);
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);await waitFor(()=>expect(screen.getByTestId('room-present-open')).not.toBeDisabled());fireEvent.click(screen.getByTestId('room-present-open'));
  const stop=screen.getByRole('button',{name:'断开会议室'});act(()=>{stop.click();stop.click();});expect(revokeRoom).toHaveBeenCalledTimes(2);
  rejectSecond(new TypeError('offline'));await act(async()=>{await second.catch(()=>undefined);});expect(screen.getByRole('alert')).toHaveTextContent('暂时无法断开会议室');
  await act(async()=>{resolveFirst({ok:true});await first;});expect(JSON.parse(sessionStorage.getItem('wsx.board.presenter.active')!).sessionId).toBe(sessionId);expect(screen.getByTestId('room-connected')).toBeVisible();
});

it('expires and clears a pairing locally even while status stays offline',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222';createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:'{}',expiresAt:new Date(Date.now()+100).toISOString()});readPairingStatus.mockRejectedValue(new TypeError('offline'));
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'),{timeout:1_000});expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();const calls=readPairingStatus.mock.calls.length;await new Promise(resolve=>setTimeout(resolve,200));expect(readPairingStatus).toHaveBeenCalledTimes(calls);
});

it('aborts a hung pairing read at the local TTL and never revives the payload',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222';let signal:AbortSignal|undefined;
  createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:'secret-payload',expiresAt:new Date(Date.now()+100).toISOString()});
  readPairingStatus.mockImplementation((_board:string,_pairing:string,nextSignal:AbortSignal)=>{signal=nextSignal;return new Promise((_resolve,reject)=>nextSignal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));});
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));
  await waitFor(()=>expect(readPairingStatus).toHaveBeenCalled());expect(screen.getByTestId('room-pairing-payload')).toHaveValue('secret-payload');
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'),{timeout:1_000});expect(signal?.aborted).toBe(true);expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();
  await new Promise(resolve=>setTimeout(resolve,150));expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();expect(readPairingStatus).toHaveBeenCalledTimes(1);
});

it.each([{offset:-60*60*1_000,label:'backward'},{offset:60*60*1_000,label:'forward'}])('keeps a valid pairing on its monotonic TTL when the wall clock jumps $label',async({offset,label})=>{
  const boardId='22222222-2222-4222-8222-222222222222',actualNow=Date.now.bind(Date);let wallOffset=0;vi.spyOn(Date,'now').mockImplementation(()=>actualNow()+wallOffset);const signals:AbortSignal[]=[];
  createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:`${label}-payload`,expiresAt:new Date(actualNow()+250).toISOString()});
  readPairingStatus.mockImplementation((_board:string,_pairing:string,signal:AbortSignal)=>{signals.push(signal);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));});
  render(<StrictMode><RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/></StrictMode>);fireEvent.click(screen.getByTestId('room-present-open'));
  await waitFor(()=>expect(screen.getByTestId('room-pairing-payload')).toHaveValue(`${label}-payload`));wallOffset=offset;
  await new Promise(resolve=>setTimeout(resolve,60));expect(screen.getByTestId('room-pairing-payload')).toHaveValue(`${label}-payload`);
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'),{timeout:1_000});expect(signals.at(-1)?.aborted).toBe(true);expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();
});

it('expires a throttled background pairing immediately when the page becomes visible',async()=>{
  const boardId='22222222-2222-4222-8222-222222222222',actualNow=Date.now.bind(Date),actualPerformanceNow=performance.now.bind(performance);let elapsed=0,signal:AbortSignal|undefined;
  vi.spyOn(performance,'now').mockImplementation(()=>actualPerformanceNow()+elapsed);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');const add=vi.spyOn(document,'addEventListener'),remove=vi.spyOn(document,'removeEventListener');
  createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:'five-minute-payload',expiresAt:new Date(actualNow()+5*60*1_000).toISOString()});
  readPairingStatus.mockImplementation((_board:string,_pairing:string,nextSignal:AbortSignal)=>{signal=nextSignal;return new Promise((_resolve,reject)=>nextSignal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));});
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));await waitFor(()=>expect(screen.getByTestId('room-pairing-payload')).toHaveValue('five-minute-payload'));
  const wake=add.mock.calls.find(([type])=>type==='visibilitychange')?.[1];expect(wake).toBeDefined();elapsed=60*1_000;act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(screen.getByTestId('room-pairing-payload')).toHaveValue('five-minute-payload');
  elapsed=5*60*1_000+1;act(()=>document.dispatchEvent(new Event('visibilitychange')));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'));expect(signal?.aborted).toBe(true);expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();await waitFor(()=>expect(remove).toHaveBeenCalledWith('visibilitychange',wake));
});

it.each([400,401,403,404,410,422])('treats authoritative pairing status %i as terminal',async status=>{
  const boardId='22222222-2222-4222-8222-222222222222';createRoomPairing.mockResolvedValue({id:'33333333-3333-4333-8333-333333333333',boardId,code:'ABCDEFGH',payload:'{}',expiresAt:'2030-01-01T00:00:00.000Z'});readPairingStatus.mockRejectedValue(new ApiError(status,null,null));
  render(<RoomPresenterControls boardId={boardId} orgId={orgId} userId={userId} disabled={false} onSession={vi.fn()}/>);fireEvent.click(screen.getByTestId('room-present-open'));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('配对已过期'));expect(screen.queryByTestId('room-pairing-payload')).not.toBeInTheDocument();
});
