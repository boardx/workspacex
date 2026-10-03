import {expect,it,vi} from 'vitest';
import {sharedOutboxProof} from '../../e2e/support/board-shared-outbox-proof';
import {spatialFrameMetadata,createSpatialWsMetadataRecorder,nativeSocketErrorCode,nativeSocketMessageClass,installNativeSocketCloseObserver} from '../../e2e/support/board-spatial-ws-metadata';
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
 expect(off).toHaveLength(3);expect(recorder.snapshot().events.map(({elapsedMs,...event})=>event)).toEqual([{client:'original',socketOrdinal:1,direction:'cdp-socketerror',code:'ERR_CONNECTION_RESET',messageClass:'UNKNOWN'},{client:'original',socketOrdinal:1,direction:'cdp-close'}]);
 expect(JSON.stringify(recorder.snapshot())).not.toContain('private');
});

it('diagnostic removal attempts every owned listener before reporting a fixed cleanup failure',()=>{
 const attempts:string[]=[],session={on:()=>undefined,off:(name:string)=>{attempts.push(name);if(name==='Network.webSocketCreated')throw new Error('private removal failure');}};
 const stop=createSpatialWsMetadataRecorder().observeCdp(session as never,'original');
 expect(stop).toThrow('SOCKET_DIAGNOSTIC_STOP_FAILED');expect(attempts).toEqual(['Network.webSocketCreated','Network.webSocketFrameError','Network.webSocketClosed']);
});
const fixedMessageClasses=[
 ['Could not decode a text frame as UTF-8.','UTF8_DECODE_FAILED'],
 ['Message size is too large.','MESSAGE_TOO_LARGE'],
 ['Received unexpected continuation frame.','UNEXPECTED_CONTINUATION'],
 ['Received start of new message but previous message is unfinished.','UNFINISHED_MESSAGE'],
] as const;
it('classifies only exact pinned reasons or actual empty strings without inferring a net error',()=>{
 for(const [message,classification] of fixedMessageClasses){expect(nativeSocketMessageClass(message)).toBe(classification);expect(nativeSocketErrorCode(message)).toBe('UNKNOWN');}
 expect(nativeSocketMessageClass('')).toBe('EMPTY');
 for(const value of [null,undefined,{},new String(''),' ','ERR_FAILED','private credential https://private.invalid/path','x'.repeat(8193),...fixedMessageClasses.flatMap(([message])=>[message+' private','private '+message,message+'\n'])])expect(nativeSocketMessageClass(value)).toBe('UNKNOWN');
 let reads=0;const accessor={get errorMessage(){reads++;return '';},toString(){reads++;return '';}};
 expect(nativeSocketMessageClass(accessor)).toBe('UNKNOWN');expect(reads).toBe(0);
});
it('retains fixed CDP classes without changing native close metadata or the TRANSPORT_ERROR proof',()=>{
 const handlers=new Map<string,(value:unknown)=>void>(),socketHandlers=new Map<string,()=>void>();
 const recorder=createSpatialWsMetadataRecorder();
 recorder.observe({on:(_name:string,listener:(socket:unknown)=>void)=>listener({url:()=> 'ws://localhost/whiteboards/owned/sync',on:(name:string,handler:()=>void)=>socketHandlers.set(name,handler)})} as never,'original');
 const stop=recorder.observeCdp({on:(name:string,handler:(value:unknown)=>void)=>handlers.set(name,handler),off:()=>undefined} as never,'original');
 handlers.get('Network.webSocketCreated')!({requestId:'owned',url:'ws://localhost/whiteboards/owned/sync'});
 for(const [errorMessage] of fixedMessageClasses)handlers.get('Network.webSocketFrameError')!({requestId:'owned',errorMessage});
 handlers.get('Network.webSocketFrameError')!({requestId:'owned',errorMessage:''});
 handlers.get('Network.webSocketFrameError')!({requestId:'owned',errorMessage:'private credential https://private.invalid/path'});
 let reads=0;handlers.get('Network.webSocketFrameError')!({requestId:'owned',get errorMessage(){reads++;return 'private';}});expect(reads).toBe(0);
 recorder.nativeClose('original',{socketOrdinal:1,code:1006,wasClean:false});socketHandlers.get('socketerror')!();stop();
 const events=recorder.snapshot().events;
 expect(events.filter(event=>event.direction==='cdp-socketerror').map(({code,messageClass})=>({code,messageClass}))).toEqual([...fixedMessageClasses.map(([,messageClass])=>({code:'UNKNOWN',messageClass})),{code:'UNKNOWN',messageClass:'EMPTY'},{code:'UNKNOWN',messageClass:'UNKNOWN'},{code:'UNKNOWN',messageClass:'UNKNOWN'}]);
 expect(events.find(event=>event.direction==='nativeclose')).toEqual({elapsedMs:expect.any(Number),client:'original',socketOrdinal:1,direction:'nativeclose',code:1006,wasClean:false});
 expect(events.every(event=>!Object.hasOwn(event,'errorMessage')&&!Object.hasOwn(event,'url'))).toBe(true);expect(JSON.stringify(events)).not.toContain('private');
 const valid=[{client:'original',direction:'sent',type:'update',updateId:'one'},{client:'peer',direction:'sent',type:'update',updateId:'one'},{client:'original',direction:'received',type:'ack',updateId:'one',seq:1},{client:'peer',direction:'received',type:'ack',updateId:'one',seq:1}];
 expect(sharedOutboxProof(valid,0,1)).toEqual([]);expect(sharedOutboxProof([...valid,...events],0,1)).toEqual(['TRANSPORT_ERROR']);
});
