import {expect,it,vi} from 'vitest';
import {spatialFrameMetadata,createSpatialWsMetadataRecorder,nativeSocketErrorCode,installNativeSocketCloseObserver} from '../../e2e/support/board-spatial-ws-metadata';
it('retains only bounded receipt metadata including UUID gesture identity',()=>{
 const updateId='00000000-0000-0000-0000-000000000001',gestureId='00000000-0000-0000-0000-000000000002';
 expect(spatialFrameMetadata(JSON.stringify({type:'ack',seq:7,updateId,gestureId,token:'not-retained',update:'not-retained',url:'not-retained',text:'not-retained'}))).toEqual({type:'ack',updateId,gestureId,seq:7});
});
it('rejects unbounded or nonUUID gesture IDs and never exports error text',()=>{
 for(const gestureId of ['private-value','x'.repeat(4096),'00000000-0000-0000-0000-000000000002/private'])expect(spatialFrameMetadata(JSON.stringify({type:'error',code:'ACK_CONFLICT',gestureId,message:'not-retained'}))).toEqual({type:'error',code:'ACK_CONFLICT'});
});
it('retains positive safe update epochs without inventing ACK epoch fields',()=>{
 expect(spatialFrameMetadata(JSON.stringify({type:'update',epoch:3,token:'not-retained'}))).toEqual({type:'update',epoch:3});
 for(const epoch of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'3',null])expect(spatialFrameMetadata(JSON.stringify({type:'update',epoch}))).toEqual({type:'update'});
 expect(spatialFrameMetadata(JSON.stringify({type:'ack',epoch:3}))).toEqual({type:'ack'});
});

it('native observer preserves constructor arguments newTarget subclass static and original exceptions',()=>{
 const calls:unknown[][]=[],error=new Error('private constructor failure'),binding=vi.fn().mockResolvedValue(undefined);
 class NativeSocket{
  static OPEN=1;url:string;listeners=new Map<string,EventListener>();
  constructor(...args:unknown[]){if(args[0]==='throw')throw error;calls.push([new.target,...args]);this.url=String(args[0]);}
  addEventListener(type:string,listener:EventListener){this.listeners.set(type,listener);}
  removeEventListener(type:string){this.listeners.delete(type);}
 }
 vi.stubGlobal('WebSocket',NativeSocket);vi.stubGlobal('__nativeClose',binding);
 try{
  installNativeSocketCloseObserver({binding:'__nativeClose',stateKey:'__socketState'});
  const ProxySocket=globalThis.WebSocket,protocols=['actual-protocol'];
  class Derived extends ProxySocket{}
  const socket=new Derived('ws://localhost/whiteboards/private-id/sync',protocols) as unknown as NativeSocket;
  expect(calls[0]).toEqual([Derived,'ws://localhost/whiteboards/private-id/sync',protocols]);
  expect(ProxySocket.prototype).toBe(NativeSocket.prototype);expect(ProxySocket.OPEN).toBe(NativeSocket.OPEN);
  expect(socket instanceof Derived).toBe(true);expect(socket instanceof ProxySocket).toBe(true);expect(socket instanceof NativeSocket).toBe(true);
  let caught;try{new ProxySocket('throw');}catch(value){caught=value;}expect(caught).toBe(error);
  // A diagnostic-only URL read failure must not replace a native constructor's return.
  expect(()=>new ProxySocket('not-a-url')).not.toThrow();
  socket.listeners.get('close')!({isTrusted:false,code:1000,wasClean:true} as unknown as Event);expect(binding).not.toHaveBeenCalled();
  socket.listeners.get('close')!({isTrusted:true,code:1006,wasClean:false,reason:'private reason',url:'private url'} as unknown as Event);
  expect(binding).toHaveBeenCalledTimes(1);expect(binding).toHaveBeenCalledWith({socketOrdinal:1,code:1006,wasClean:false});
 }finally{delete (globalThis as unknown as Record<string,unknown>).__socketState;vi.unstubAllGlobals();}
});
it('fixed error and native close metadata never export private text URLs or accessors',()=>{
 expect(nativeSocketErrorCode('private url net::ERR_NETWORK_IO_SUSPENDED')).toBe('ERR_NETWORK_IO_SUSPENDED');
 for(const value of ['private cause','PRIVATE_ERR_FAILED_SUFFIX','ERR_FAILED ERR_ABORTED','x'.repeat(8193)+' ERR_FAILED',null,{}])expect(nativeSocketErrorCode(value)).toBe('UNKNOWN');
 const recorder=createSpatialWsMetadataRecorder();recorder.nativeClose('original',{socketOrdinal:1,code:1006,wasClean:false});
 let reads=0;const accessor={socketOrdinal:1,code:1000,wasClean:true};Object.defineProperty(accessor,'code',{enumerable:true,get(){reads++;return 1000;}});
 for(const value of [accessor,{socketOrdinal:0,code:1000,wasClean:true},{socketOrdinal:1,code:-1,wasClean:true},{socketOrdinal:1,code:1000,wasClean:'true'},{socketOrdinal:1,code:1000,wasClean:true,reason:'private'}])recorder.nativeClose('original',value);
 expect(reads).toBe(0);expect(recorder.snapshot().events).toHaveLength(1);expect(recorder.snapshot().events[0]).toMatchObject({direction:'nativeclose',socketOrdinal:1,code:1006,wasClean:false});
 expect(JSON.stringify(recorder.snapshot())).not.toContain('private');
});
it('CDP observations filter actual board sockets and remove only owned listeners',()=>{
 const handlers=new Map<string,(value:unknown)=>void>(),off:unknown[]=[];
 const session={on:(name:string,handler:(value:unknown)=>void)=>handlers.set(name,handler),off:(...args:unknown[])=>off.push(args)};
 const recorder=createSpatialWsMetadataRecorder(),stop=recorder.observeCdp(session as never,'original');
 expect(()=>handlers.get('Network.webSocketCreated')!({requestId:'invalid',url:'not-a-url'})).not.toThrow();
 handlers.get('Network.webSocketCreated')!({requestId:'oversized',url:'ws://localhost/whiteboards/'+'x'.repeat(8193)+'/sync'});
 handlers.get('Network.webSocketFrameError')!({requestId:'oversized',errorMessage:'ERR_FAILED'});
 handlers.get('Network.webSocketCreated')!({requestId:'private-request',url:'ws://private-host/whiteboards/private-board/sync?private-query'});
 handlers.get('Network.webSocketFrameError')!({requestId:'private-request',errorMessage:'private url net::ERR_CONNECTION_RESET'});
 handlers.get('Network.webSocketClosed')!({requestId:'private-request'});
 handlers.get('Network.webSocketFrameError')!({requestId:'foreign-request',errorMessage:'private'});stop();
 expect(off).toHaveLength(3);expect(recorder.snapshot().events.map(({elapsedMs,...event})=>event)).toEqual([{client:'original',socketOrdinal:1,direction:'cdp-socketerror',code:'ERR_CONNECTION_RESET'},{client:'original',socketOrdinal:1,direction:'cdp-close'}]);
 expect(JSON.stringify(recorder.snapshot())).not.toContain('private');
});

it('diagnostic removal attempts every owned listener before reporting a fixed cleanup failure',()=>{
 const attempts:string[]=[],session={on:()=>undefined,off:(name:string)=>{attempts.push(name);if(name==='Network.webSocketCreated')throw new Error('private removal failure');}};
 const stop=createSpatialWsMetadataRecorder().observeCdp(session as never,'original');
 expect(stop).toThrow('SOCKET_DIAGNOSTIC_STOP_FAILED');expect(attempts).toEqual(['Network.webSocketCreated','Network.webSocketFrameError','Network.webSocketClosed']);
});
