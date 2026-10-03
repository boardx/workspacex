import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, prepareWhiteboardUpdate, readObjects, WhiteboardUndo } from '@repo/whiteboard-core';
import { WhiteboardProvider, bytesToBase64, base64ToBytes, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import type { WhiteboardDurableOutbox } from '@/lib/whiteboard-outbox';
import {IndexedDbEncryptedWhiteboardOutbox} from '@/lib/whiteboard-outbox';
import {IDBFactory} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
const auth = vi.hoisted(() => ({ token: 'test-session' as string | null }));
vi.mock('@/lib/api-client', () => ({ getStoredSessionToken: () => auth.token, apiWebSocketUrl: (path: string) => `ws://localhost${path}` }));
class Socket {
  static OPEN = 1; static sockets: Socket[] = [];
  readyState = 1; sent: string[] = [];
  onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: (event: { code: number }) => void; onerror?: () => void;
  constructor(readonly url: string, readonly protocols: string[]) { Socket.sockets.push(this); }
  send(data: string) { this.sent.push(data); } close() { this.readyState = 3; }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
class DurableMemoryOutbox implements WhiteboardDurableOutbox {
  updates=new Map<string,any[]>();revoked=new Set<string>();closed=false;
  async restore(token:string){return{revoked:this.revoked.has(token),updates:structuredClone(this.updates.get(token)??[])};}
  async persist(token:string,update:any){const list=this.updates.get(token)??[];if(!list.some(item=>item.updateId===update.updateId))list.push(structuredClone(update));this.updates.set(token,list);}
  async acknowledge(token:string,id:string){this.updates.set(token,(this.updates.get(token)??[]).filter(item=>item.updateId!==id));}
  async rebind(from:string,to:string){this.updates.set(to,this.updates.get(from)??[]);this.updates.delete(from);}
  async revoke(token:string){this.revoked.add(token);this.updates.delete(token);}
  close(){this.closed=true;}
}
class DeferredRebindOutbox extends DurableMemoryOutbox {
  private start!:()=>void;private release!:()=>void;
  readonly started=new Promise<void>(resolve=>{this.start=resolve;});
  private readonly gate=new Promise<void>(resolve=>{this.release=resolve;});
  finish(){this.release();}
  override async rebind(from:string,to:string){this.start();await this.gate;await super.rebind(from,to);}
}
class GatedClaimOutbox extends DurableMemoryOutbox {
  calls:string[]=[];
  notify:()=>void=()=>{};
  subscribe(_token:string,listener:()=>void){this.notify=listener;return()=>{this.notify=()=>{};};}
  gates=new Map<number,(claimed:boolean)=>void>();
  async claim(_token:string,id:string){
    this.calls.push(id);
    return new Promise<boolean>(resolve=>this.gates.set(this.calls.length,resolve));
  }
  async releaseClaims(){}
  release(index:number,claimed=true){const resolve=this.gates.get(index);expect(resolve).toBeDefined();resolve!(claimed);}
}
const flushClaims=async()=>{for(let index=0;index<60;index++)await Promise.resolve();};
it('keeps real Yjs causal order when an ACK splices pending during the next claim',async()=>{
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),outbox=new GatedClaimOutbox();
  const provider=new WhiteboardProvider(doc,'claim-order',()=>{},outbox);
  try{
    await flushClaims();const socket=Socket.sockets[0]!;sync(socket,server);
    executeCommands(doc,[{type:'create',object:sticky('causal')}],'local');
    for(let index=0;index<3;index++)executeCommands(doc,[{type:'text',id:'causal',index,deleteCount:0,insert:String(index)}],'local');
    await flushClaims();const original=[...(outbox.updates.get('test-session')??[])];
    outbox.release(1);await flushClaims();
    const first=updates(socket)[0]!;socket.message({type:'ack',updateId:first.updateId,gestureId:first.gestureId,seq:1});
    for(let index=2;index<=4;index++){outbox.release(index);await flushClaims();}
    expect(updates(socket).map(item=>item.updateId)).toEqual(original.map(item=>item.updateId));
    for(const frame of socket.sent.map(value=>JSON.parse(value)).filter(frame=>frame.type==='update'))Y.applyUpdate(server,prepareWhiteboardUpdate(server,base64ToBytes(frame.update)));
    expect(readObjects(server)[0]?.text).toBe('012causal');
  }finally{provider.close();doc.destroy();server.destroy();}
});
it.each([true,false])('drains a newly persisted batch after the active snapshot finishes (claim granted=%s)',async granted=>{
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),outbox=new GatedClaimOutbox(),provider=new WhiteboardProvider(doc,'new-batch',()=>{},outbox);
  try{
    await flushClaims();const socket=Socket.sockets[0]!;sync(socket,server);burst(doc,1);await flushClaims();
    executeCommands(doc,[{type:'create',object:sticky('next-batch')}],'local');await flushClaims();
    outbox.release(1);await flushClaims();expect(outbox.calls).toHaveLength(2);
    outbox.release(2,granted);await flushClaims();expect(outbox.calls).toHaveLength(2);expect(updates(socket)).toHaveLength(granted?2:1);
  }finally{provider.close();doc.destroy();server.destroy();}
});
it('does not resend a message removed by a shared durable ACK while its claim awaits',async()=>{
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),outbox=new GatedClaimOutbox();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'peer-acked-claim',value=>{state=value;},outbox);
  try{
    await flushClaims();const socket=Socket.sockets[0]!;sync(socket,server);burst(doc,1);await flushClaims();
    const id=outbox.calls[0]!;await outbox.acknowledge('test-session',id);outbox.notify();await flushClaims();
    expect(state.pending).toBe(0);outbox.release(1);await flushClaims();
    expect(updates(socket)).toEqual([]);expect(state.lastAckReceipt).toBeNull();expect(state.lastAckSequence).toBeNull();expect(outbox.calls).toHaveLength(1);
  }finally{provider.close();doc.destroy();server.destroy();}
});
it.each(['socket','epoch'] as const)('fences an outstanding claim after its %s changes',async scope=>{
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),outbox=new GatedClaimOutbox(),provider=new WhiteboardProvider(doc,'stale-claim',()=>{},outbox);
  try{
    await flushClaims();const old=Socket.sockets[0]!;sync(old,server);burst(doc,1);await flushClaims();
    if(scope==='socket'){provider.retryNow();sync(Socket.sockets.at(-1)!,server);}else sync(old,server,2);
    outbox.release(1);await flushClaims();expect(updates(old)).toEqual([]);
  }finally{provider.close();doc.destroy();server.destroy();}
});
const sticky = (id: string) => ({ id, kind: 'sticky' as const, schemaVersion: 1 as const, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: '' });
const messages = (socket: Socket) => socket.sent.map(value => JSON.parse(value) as { type: string; updateId?: string; gestureId?: string });
const updates = (socket: Socket) => messages(socket).filter((value): value is { type: 'update'; updateId: string; gestureId: string } => value.type === 'update' && typeof value.updateId === 'string');
const sync = (socket: Socket, server: Y.Doc, epoch = 1, seq = 0) => socket.message({ type: 'sync', epoch, seq, update: bytesToBase64(Y.encodeStateAsUpdate(server)), role: 'editor', archived: false });
const burst = (doc: Y.Doc, count: number) => { for (let index = 0; index < count; index++) executeCommands(doc, [{ type: 'create', object: sticky(`note-${index}`) }], 'local'); };
// Real IDB/BroadcastChannel remain active; only delivery of peer wakeups is controlled.
it.each(['notification','timer'] as const)('offline origin without a claim permits peer takeover by %s before close',async wake=>{
  vi.useRealTimers();vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('window',new EventTarget());
  const intervals:Array<()=>void>=[],realInterval=globalThis.setInterval;
  vi.spyOn(globalThis,'setInterval').mockImplementation(((callback:()=>void,ms?:number,...args:unknown[])=>{
    if(ms===2000){intervals.push(callback);return realInterval(callback,2147483647);}
    return realInterval(callback,ms,...args);
  }) as typeof setInterval);
  const a=new IndexedDbEncryptedWhiteboardOutbox('board-1'),b=new IndexedDbEncryptedWhiteboardOutbox('board-1'),inspect=new IndexedDbEncryptedWhiteboardOutbox('board-1');
  let notification:(()=>void)|undefined,received=false,deliver=false;
  const subscribe=b.subscribe.bind(b);
  vi.spyOn(b,'subscribe').mockImplementation((token,listener)=>subscribe(token,()=>{received=true;notification=listener;if(deliver)listener();}));
  const origin=createWhiteboardDocument(),peer=createWhiteboardDocument(),server=createWhiteboardDocument();
  let peerState!:WhiteboardConnectionState;
  const first=new WhiteboardProvider(origin,'board-1',()=>{},a),second=new WhiteboardProvider(peer,'board-1',state=>{peerState=state;},b);
  try{
    await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(2));const originSocket=Socket.sockets[0]!,peerSocket=Socket.sockets[1]!;
    sync(originSocket,server);sync(peerSocket,server);originSocket.onclose?.({code:1006});
    executeCommands(origin,[{type:'create',object:sticky('closed-origin-one')}],'local');executeCommands(origin,[{type:'create',object:sticky('closed-origin-two')}],'local');
    await vi.waitFor(async()=>expect((await inspect.restore('test-session')).updates).toHaveLength(2));
    await vi.waitFor(()=>expect(received).toBe(true));expect(peerState.pending).toBe(0);expect(updates(peerSocket)).toEqual([]);
    // The origin remains open but offline and has no lease. Either real notification
    // delivery or the existing 2s timer is a legitimate takeover wakeup.
    if(wake==='notification'){deliver=true;expect(notification).toBeDefined();notification?.();}else{expect(intervals).toHaveLength(2);intervals[1]!();}
    await vi.waitFor(()=>expect(updates(peerSocket)).toHaveLength(2));
    expect(Socket.sockets).toHaveLength(2);expect(readObjects(peer).map(item=>item.id).sort()).toEqual(['closed-origin-one','closed-origin-two']);
    const sent=updates(peerSocket);expect(new Set(sent.map(item=>item.updateId)).size).toBe(2);
    for(const [index,item] of sent.entries())peerSocket.message({type:'ack',updateId:item.updateId,gestureId:item.gestureId,seq:index+1});
    await vi.waitFor(async()=>expect((await inspect.restore('test-session')).updates).toEqual([]));expect(peerState.pending).toBe(0);
  }finally{first.close();second.close();inspect.close();origin.destroy();peer.destroy();server.destroy();vi.restoreAllMocks();}
});
it('already-open peer waits for the actual origin claim then drains after close releases it without reload',async()=>{
  vi.useRealTimers();vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('window',new EventTarget());
  const intervals:Array<()=>void>=[],realInterval=globalThis.setInterval;
  vi.spyOn(globalThis,'setInterval').mockImplementation(((callback:()=>void,ms?:number,...args:unknown[])=>{
    if(ms===2000){intervals.push(callback);return realInterval(callback,2147483647);}
    return realInterval(callback,ms,...args);
  }) as typeof setInterval);
  const a=new IndexedDbEncryptedWhiteboardOutbox('board-1'),b=new IndexedDbEncryptedWhiteboardOutbox('board-1'),inspect=new IndexedDbEncryptedWhiteboardOutbox('board-1');
  const origin=createWhiteboardDocument(),peer=createWhiteboardDocument(),server=createWhiteboardDocument();let peerState!:WhiteboardConnectionState;
  let peerDenied=false;const claim=b.claim.bind(b);vi.spyOn(b,'claim').mockImplementation(async(...args)=>{const granted=await claim(...args);if(!granted)peerDenied=true;return granted;});
  const first=new WhiteboardProvider(origin,'board-1',()=>{},a);let second:WhiteboardProvider|undefined;
  try{
    await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(1));const originSocket=Socket.sockets[0]!;sync(originSocket,server);
    executeCommands(origin,[{type:'create',object:sticky('closed-origin-one')}],'local');executeCommands(origin,[{type:'create',object:sticky('closed-origin-two')}],'local');
    await vi.waitFor(()=>expect(updates(originSocket)).toHaveLength(2)); // send follows actual durable claim
    const denied=await inspect.claim('test-session',updates(originSocket)[0]!.updateId,'independent-counterproof',10000);expect(denied).toBe(false);
    second=new WhiteboardProvider(peer,'board-1',state=>{peerState=state;},b);
    await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(2));const peerSocket=Socket.sockets[1]!;sync(peerSocket,server);
    await vi.waitFor(()=>expect(peerState.pending).toBe(2));await vi.waitFor(()=>expect(peerDenied).toBe(true));expect(updates(peerSocket)).toEqual([]);
    first.close();
    // close queues durable lease release; drive the existing timer until that real
    // asynchronous operation completes, without waiting for lease expiry.
    await vi.waitFor(()=>{intervals[1]!();expect(updates(peerSocket)).toHaveLength(2);});
    expect(Socket.sockets).toHaveLength(2);expect(readObjects(peer).map(item=>item.id).sort()).toEqual(['closed-origin-one','closed-origin-two']);
    const sent=updates(peerSocket);expect(new Set(sent.map(item=>item.updateId)).size).toBe(2);
    for(const [index,item] of sent.entries())peerSocket.message({type:'ack',updateId:item.updateId,gestureId:item.gestureId,seq:index+1});
    await vi.waitFor(async()=>expect((await inspect.restore('test-session')).updates).toEqual([]));expect(peerState.pending).toBe(0);
  }finally{first.close();second?.close();inspect.close();origin.destroy();peer.destroy();server.destroy();vi.restoreAllMocks();}
});
it.each(['current','replacement','reauthorized'] as const)('attributes a delayed original ACK only on its %s socket after shared durable peer drain',async socketScope=>{
  vi.useRealTimers();vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);
  const a=new IndexedDbEncryptedWhiteboardOutbox('board-1'),b=new IndexedDbEncryptedWhiteboardOutbox('board-1'),inspect=new IndexedDbEncryptedWhiteboardOutbox('board-1');
  const origin=createWhiteboardDocument(),peer=createWhiteboardDocument(),server=createWhiteboardDocument();
  let originState!:WhiteboardConnectionState,peerState!:WhiteboardConnectionState;
  const first=new WhiteboardProvider(origin,'board-1',state=>{originState=state;},a);
  let second:WhiteboardProvider|undefined;
  try{
    await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(1));const original=Socket.sockets[0]!;sync(original,server);
    executeCommands(origin,[{type:'create',object:sticky('held-receipt')}],'local');
    await vi.waitFor(()=>expect(updates(original)).toHaveLength(1));const sent=updates(original)[0]!;
    // Model a suspended origin: no renewal mutates its real durable lease.
    vi.spyOn(a,'claim').mockResolvedValue(true);
    const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+11000);
    second=new WhiteboardProvider(peer,'board-1',state=>{peerState=state;},b);
    await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(2));const replay=Socket.sockets[1]!;sync(replay,server);
    await vi.waitFor(()=>expect(updates(replay)).toHaveLength(1));expect(updates(replay)[0]).toEqual(sent);
    replay.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});
    await vi.waitFor(async()=>expect((await inspect.restore('test-session')).updates).toEqual([]));expect(peerState.pending).toBe(0);
    await vi.waitFor(()=>expect(originState.pending).toBe(0),{timeout:3500});
    expect(originState.lastAckReceipt).toBeNull();expect(originState.lastAckSequence).toBeNull();
    const deleteOrigin=vi.spyOn(a,'acknowledge');
    if(socketScope==='reauthorized'){
      sync(original,server,1,1);
      original.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});
      expect(originState.reason).toBe('ACK_CONFLICT');expect(deleteOrigin).not.toHaveBeenCalled();return;
    }
    if(socketScope==='replacement'){
      first.retryNow();await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(3));const fresh=Socket.sockets[2]!;sync(fresh,server,1,1);
      original.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});
      expect(originState.phase).toBe('online');expect(originState.lastAckReceipt).toBeNull();
      fresh.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});
      expect(originState.reason).toBe('ACK_CONFLICT');expect(deleteOrigin).not.toHaveBeenCalled();return;
    }
    original.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});
    expect(originState.phase).toBe('online');expect(originState.lastAckReceipt).toEqual({updateId:sent.updateId,gestureId:sent.gestureId,seq:1});
    expect(Socket.sockets.flatMap(updates)).toHaveLength(2);expect(deleteOrigin).not.toHaveBeenCalled();
    original.message({type:'ack',updateId:sent.updateId,gestureId:crypto.randomUUID(),seq:1});
    expect(originState.reason).toBe('ACK_CONFLICT');
  }finally{first.close();second?.close();inspect.close();origin.destroy();peer.destroy();server.destroy();vi.restoreAllMocks();}
});
it('two independent IndexedDB peers submit each recovered update once and only durable ACK deletes it',async()=>{
  vi.useRealTimers();vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);
  const seed=new IndexedDbEncryptedWhiteboardOutbox('board-1'),a=new IndexedDbEncryptedWhiteboardOutbox('board-1'),b=new IndexedDbEncryptedWhiteboardOutbox('board-1');
  const source=createWhiteboardDocument(),firstDoc=createWhiteboardDocument(),secondDoc=createWhiteboardDocument(),server=createWhiteboardDocument();
  const expected=[];
  for(const id of ['first','second']){
    const vector=Y.encodeStateVector(source);executeCommands(source,[{type:'create',object:sticky(id)}],'local');
    const message={type:'update' as const,epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:bytesToBase64(Y.encodeStateAsUpdate(source,vector))};
    expected.push(message);await seed.persist('test-session',message);
  }
  let firstState!:WhiteboardConnectionState,secondState!:WhiteboardConnectionState;
  const first=new WhiteboardProvider(firstDoc,'board-1',state=>{firstState=state;},a),second=new WhiteboardProvider(secondDoc,'board-1',state=>{secondState=state;},b);
  try{
    await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(2));for(const socket of Socket.sockets)sync(socket,server);
    await vi.waitFor(()=>expect(Socket.sockets.flatMap(updates)).toHaveLength(2));
    const sent=Socket.sockets.flatMap(updates);expect(sent.map(item=>item.updateId).sort()).toEqual(expected.map(item=>item.updateId).sort());
    expect((await seed.restore('test-session')).updates).toHaveLength(2);
    for(const [index,item] of sent.entries())Socket.sockets.find(socket=>updates(socket).some(value=>value.updateId===item.updateId))!.message({type:'ack',updateId:item.updateId,gestureId:item.gestureId,seq:index+1});
    await vi.waitFor(async()=>expect((await seed.restore('test-session')).updates).toEqual([]));
    first.retryNow();second.retryNow();await vi.waitFor(()=>expect(Socket.sockets).toHaveLength(4));
    for(const socket of Socket.sockets.slice(2))sync(socket,server,1,2);
    await vi.waitFor(()=>{expect(firstState.pending).toBe(0);expect(secondState.pending).toBe(0);});
    expect(Socket.sockets.flatMap(updates)).toHaveLength(2);
  }finally{first.close();second.close();seed.close();source.destroy();firstDoc.destroy();secondDoc.destroy();server.destroy();}
});
it('recovers another closed tab pending write in an already-open authenticated peer without peer reload',async()=>{
  const outbox=new DurableMemoryOutbox(),origin=createWhiteboardDocument(),peer=createWhiteboardDocument(),server=createWhiteboardDocument();
  let peerState!:WhiteboardConnectionState;
  const first=new WhiteboardProvider(origin,'board-1',()=>{},outbox),second=new WhiteboardProvider(peer,'board-1',value=>{peerState=value;},outbox);
  try{
    await vi.advanceTimersByTimeAsync(0);
    const originSocket=Socket.sockets[0]!,peerSocket=Socket.sockets[1]!;
    sync(originSocket,server);sync(peerSocket,server);
    originSocket.onclose?.({code:1006});
    executeCommands(origin,[{type:'create',object:sticky('origin-pending')}],{gestureId:'origin-gesture'});
    executeCommands(origin,[{type:'create',object:sticky('origin-second-pending')}],{gestureId:'origin-second-gesture'});
    await vi.advanceTimersByTimeAsync(0);
    const persisted=structuredClone(outbox.updates.get('test-session')!);
    expect(persisted).toHaveLength(2);
    expect(new Set(persisted.map(item=>item.updateId)).size).toBe(2);
    expect(peerState.pending).toBe(0);expect(updates(peerSocket)).toEqual([]);
    first.close();
    second.retryNow();await vi.advanceTimersByTimeAsync(0);
    const recovered=Socket.sockets.at(-1)!;sync(recovered,server);await vi.advanceTimersByTimeAsync(0);
    expect(updates(recovered).map(item=>item.updateId).sort()).toEqual(persisted.map(item=>item.updateId).sort());
    expect(peerState.pending).toBe(2);
    for(const [index,item] of persisted.entries())recovered.message({type:'ack',updateId:item.updateId,gestureId:item.gestureId,seq:index+1});
    await vi.advanceTimersByTimeAsync(0);
    expect(peerState.pending).toBe(0);expect(outbox.updates.get('test-session')).toEqual([]);
    second.retryNow();await vi.advanceTimersByTimeAsync(0);const after=Socket.sockets.at(-1)!;sync(after,server,1,2);
    expect(updates(after)).toEqual([]);
  }finally{first.close();second.close();origin.destroy();peer.destroy();server.destroy();}
});
it.each(['viewer','revoked','other-session'] as const)('never replays shared durable writes into %s scope',async scenario=>{
  const outbox=new DurableMemoryOutbox(),doc=createWhiteboardDocument(),server=createWhiteboardDocument(),source=createWhiteboardDocument();
  executeCommands(source,[{type:'create',object:sticky('protected-origin-write')}],'fixture');
  const update={type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:bytesToBase64(Y.encodeStateAsUpdate(source))};
  await outbox.persist('test-session',update);
  if(scenario==='revoked')outbox.revoked.add('test-session');
  if(scenario==='other-session')auth.token='other-session';
  const provider=new WhiteboardProvider(doc,'board-1',()=>{},outbox);
  try{
    await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;
    socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:scenario==='viewer'?'viewer':'editor',archived:false});
    await vi.advanceTimersByTimeAsync(0);
    expect(updates(socket)).toEqual([]);expect(readObjects(doc)).toEqual([]);
  }finally{provider.close();doc.destroy();server.destroy();source.destroy();}
});
it('a readonly live peer does not claim or render later durable writes, and close removes its listener',async()=>{
  const outbox=new DurableMemoryOutbox(),claim=vi.fn(async()=>true),unsubscribe=vi.fn();let notify!:()=>void;
  const subscribed=Object.assign(outbox,{claim,subscribe:(_token:string,listener:()=>void)=>{notify=listener;return unsubscribe;}});
  const doc=createWhiteboardDocument(),source=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},subscribed);
  try{
    await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;
    socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'viewer',archived:false});
    expect(state.phase).toBe('online');expect(state.role).toBe('viewer');
    executeCommands(source,[{type:'create',object:sticky('inaccessible-pending')}],'local');
    await outbox.persist('test-session',{type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:bytesToBase64(Y.encodeStateAsUpdate(source))});
    notify();await vi.advanceTimersByTimeAsync(2000);
    expect(claim).not.toHaveBeenCalled();expect(updates(socket)).toEqual([]);expect(readObjects(doc)).toEqual([]);expect(state.pending).toBe(0);
    provider.close();expect(unsubscribe).toHaveBeenCalledOnce();notify();await vi.advanceTimersByTimeAsync(4000);
    expect(claim).not.toHaveBeenCalled();expect(Socket.sockets).toHaveLength(1);
  }finally{provider.close();doc.destroy();source.destroy();server.destroy();}
});
it('offline cancels owned claims without deleting pending writes or allowing notification to send',async()=>{
  const events=new EventTarget();vi.stubGlobal('window',events);
  const outbox=new DurableMemoryOutbox(),claim=vi.fn(async()=>true),releaseClaims=vi.fn(async()=>{});let notify!:()=>void;
  const subscribed=Object.assign(outbox,{claim,releaseClaims,subscribe:(_token:string,listener:()=>void)=>{notify=listener;return()=>{};}});
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();const provider=new WhiteboardProvider(doc,'board-1',()=>{},subscribed);
  try{
    await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;sync(socket,server);
    executeCommands(doc,[{type:'create',object:sticky('offline-pending')}],'local');await vi.advanceTimersByTimeAsync(0);expect(updates(socket)).toHaveLength(1);
    events.dispatchEvent(new Event('offline'));notify();await vi.advanceTimersByTimeAsync(4000);
    expect(releaseClaims).toHaveBeenCalledOnce();expect(updates(socket)).toHaveLength(1);expect(outbox.updates.get('test-session')).toHaveLength(1);
  }finally{provider.close();await vi.advanceTimersByTimeAsync(0);doc.destroy();server.destroy();}
});
it('lost lease fences the old socket and cannot delete a new owner claim through a late ACK',async()=>{
  const outbox=new DurableMemoryOutbox(),claim=vi.fn(async()=>true),releaseClaims=vi.fn(async()=>{});
  const durable=Object.assign(outbox,{claim,releaseClaims}),doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},durable);
  try{
    await vi.advanceTimersByTimeAsync(0);const old=Socket.sockets[0]!;sync(old,server);
    executeCommands(doc,[{type:'create',object:sticky('lease-transfer')}],'local');await vi.advanceTimersByTimeAsync(0);
    const sent=updates(old)[0]!;expect(updates(old)).toHaveLength(1);
    claim.mockResolvedValue(false);await vi.advanceTimersByTimeAsync(2000);
    expect(old.readyState).toBe(3);expect(Socket.sockets).toHaveLength(2);expect(state.reason).toBe('OUTBOX_CLAIM_LOST');
    old.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});await vi.advanceTimersByTimeAsync(0);
    expect(outbox.updates.get('test-session')).toHaveLength(1);expect(releaseClaims).not.toHaveBeenCalled();
    const fresh=Socket.sockets[1]!;sync(fresh,server);await vi.advanceTimersByTimeAsync(0);expect(updates(fresh)).toEqual([]);
    await outbox.acknowledge('test-session',sent.updateId);await vi.advanceTimersByTimeAsync(2000);
    expect(state.pending).toBe(0);expect(Socket.sockets.flatMap(updates)).toHaveLength(1);
  }finally{provider.close();await vi.advanceTimersByTimeAsync(0);doc.destroy();server.destroy();}
});
it('late stale notification cannot resurrect an acknowledged receipt as pending or resend it',async()=>{
  const outbox=new DurableMemoryOutbox();let notify!:()=>void;
  const durable=Object.assign(outbox,{subscribe:(_token:string,listener:()=>void)=>{notify=listener;return()=>{};}});
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},durable);
  try{
    await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;sync(socket,server);
    executeCommands(doc,[{type:'create',object:sticky('acked-notify')}],'local');await vi.advanceTimersByTimeAsync(0);
    const persisted=structuredClone(outbox.updates.get('test-session')!),sent=updates(socket)[0]!;
    socket.message({type:'ack',updateId:sent.updateId,gestureId:sent.gestureId,seq:1});await vi.advanceTimersByTimeAsync(0);
    expect(outbox.updates.get('test-session')).toEqual([]);
    vi.spyOn(outbox,'restore').mockResolvedValue({revoked:false,updates:persisted});
    notify();await vi.advanceTimersByTimeAsync(0);expect(state.pending).toBe(0);expect(updates(socket)).toHaveLength(1);expect(readObjects(doc)).toHaveLength(1);
  }finally{provider.close();doc.destroy();server.destroy();}
});
it('coalesces notification bursts but reconciles a notification received during the current snapshot',async()=>{
  const outbox=new DurableMemoryOutbox();let notify!:()=>void;
  const durable=Object.assign(outbox,{subscribe:(_token:string,listener:()=>void)=>{notify=listener;return()=>{};}});
  const doc=createWhiteboardDocument(),source=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},durable);
  try{
    await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;sync(socket,server);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),restore=outbox.restore.bind(outbox);
    const snapshots=vi.spyOn(outbox,'restore').mockImplementationOnce(async token=>{const captured=await restore(token);await gate;return captured;});
    for(let index=0;index<20;index++)notify();await vi.advanceTimersByTimeAsync(0);expect(snapshots).toHaveBeenCalledTimes(1);
    executeCommands(source,[{type:'create',object:sticky('during-snapshot')}],'local');
    await outbox.persist('test-session',{type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:bytesToBase64(Y.encodeStateAsUpdate(source))});
    for(let index=0;index<20;index++)notify();release();await vi.advanceTimersByTimeAsync(0);
    expect(snapshots).toHaveBeenCalledTimes(2);expect(state.pending).toBe(1);expect(updates(socket)).toHaveLength(1);expect(readObjects(doc).map(item=>item.id)).toEqual(['during-snapshot']);
  }finally{provider.close();doc.destroy();source.destroy();server.destroy();}
});
it('socket disconnect and a failed reconnect preserve the same durable receipt until a real ACK',async()=>{
  const outbox=new DurableMemoryOutbox(),doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},outbox);
  try{
    await vi.advanceTimersByTimeAsync(0);const first=Socket.sockets[0]!;sync(first,server);
    executeCommands(doc,[{type:'create',object:sticky('disconnect-pending')}],'local');await vi.advanceTimersByTimeAsync(0);
    const expected=structuredClone(outbox.updates.get('test-session')!),receipt=updates(first)[0]!;expect(expected).toHaveLength(1);
    first.onclose?.({code:1006});expect(state.phase).toBe('offline');expect(state.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(500);const failed=Socket.sockets[1]!;failed.onclose?.({code:1006});
    expect(state.phase).toBe('offline');expect(state.pending).toBe(1);expect(updates(failed)).toEqual([]);expect(outbox.updates.get('test-session')).toEqual(expected);
    await vi.advanceTimersByTimeAsync(1000);const recovered=Socket.sockets[2]!;sync(recovered,server);await vi.advanceTimersByTimeAsync(0);
    expect(updates(recovered)).toEqual([receipt]);expect(state.pending).toBe(1);expect(outbox.updates.get('test-session')).toEqual(expected);
    recovered.message({type:'ack',updateId:receipt.updateId,gestureId:receipt.gestureId,seq:1});await vi.advanceTimersByTimeAsync(0);
    expect(state.phase).toBe('online');expect(state.pending).toBe(0);expect(outbox.updates.get('test-session')).toEqual([]);expect(readObjects(doc).map(item=>item.id)).toEqual(['disconnect-pending']);
  }finally{provider.close();doc.destroy();server.destroy();}
});
it.each(['unmount','revoke'] as const)('%s fences a late asynchronous sender before it can submit',async mode=>{
  const outbox=new DurableMemoryOutbox();let release!:()=>void,start!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{start=resolve;});
  const claim=vi.fn(async()=>{start();await gate;return true;}),releaseClaims=vi.fn(async()=>{});
  const durable=Object.assign(outbox,{claim,releaseClaims}),doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},durable);
  try{
    await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;sync(socket,server);
    executeCommands(doc,[{type:'create',object:sticky('late-sender')}],'local');await vi.advanceTimersByTimeAsync(0);await started;
    if(mode==='unmount')provider.close();else socket.message({type:'recovery',disposition:'access-revoked',code:'ACCESS_REVOKED'});
    release();await vi.advanceTimersByTimeAsync(0);
    expect(updates(socket)).toEqual([]);expect(socket.readyState).toBe(3);expect(releaseClaims).toHaveBeenCalled();
    if(mode==='revoke'){expect(state.phase).toBe('blocked');expect(state.role).toBe('viewer');expect(readObjects(doc)).toEqual([]);expect(outbox.updates.get('test-session')).toBeUndefined();}
    else expect(outbox.updates.get('test-session')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10000);expect(Socket.sockets).toHaveLength(1);expect(updates(socket)).toEqual([]);
  }finally{release();provider.close();await vi.advanceTimersByTimeAsync(0);doc.destroy();server.destroy();}
});
beforeEach(() => { vi.useFakeTimers(); Socket.sockets = []; auth.token = 'test-session'; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('handshakes before writes, only ACK clears pending, and reconnect replays same updateId', () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(); let state: WhiteboardConnectionState | undefined;
  const provider = new WhiteboardProvider(doc, 'board-1', value => { state = value; });
  const first = Socket.sockets[0]!; first.onopen?.(); expect(JSON.parse(first.sent[0]!).type).toBe('hello');
  first.message({ type: 'sync', epoch: 1, seq: 0, update: bytesToBase64(Y.encodeStateAsUpdate(server)), role: 'owner', archived: false });
  executeCommands(doc, [{ type: 'create', object: { id: 'one', kind: 'sticky', schemaVersion: 1, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: 'hello', style: {}, parentId: null, orderKey: '' } }], 'local');
  const pending = JSON.parse(first.sent[1]!); expect(state?.pending).toBe(1);
  first.onclose?.({ code: 1006 }); vi.advanceTimersByTime(500);
  const second = Socket.sockets[1]!; second.onopen?.(); expect(second.sent).toHaveLength(1);
  second.message({ type: 'sync', epoch: 1, seq: 0, update: bytesToBase64(Y.encodeStateAsUpdate(server)), role: 'owner', archived: false });
  expect(JSON.parse(second.sent[1]!)).toEqual(pending);
  second.message({ type: 'ack', updateId: pending.updateId, gestureId:pending.gestureId, seq: 1 }); expect(state?.pending).toBe(0);
  provider.close(); doc.destroy(); server.destroy();
});

it('temporary validator failure keeps the exact pending intent until an ACK on the replacement socket', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'recover-board',value=>{state=value;}),first=Socket.sockets[0]!;
  sync(first,server);burst(doc,1);const intent=updates(first)[0]!;
  first.message({type:'error',code:'VALIDATOR_UNAVAILABLE',recoverable:true});
  expect(state).toMatchObject({phase:'offline',pending:1,reason:'VALIDATOR_UNAVAILABLE'});
  first.onclose?.({code:1006});provider.retryNow();const replacement=Socket.sockets.at(-1)!;
  first.message({type:'ack',updateId:intent.updateId,gestureId:intent.gestureId,seq:1});expect(state.pending).toBe(1);
  sync(replacement,server);expect(updates(replacement)).toEqual([intent]);expect(state.pending).toBe(1);
  replacement.message({type:'ack',updateId:intent.updateId,gestureId:intent.gestureId,seq:1});expect(state.pending).toBe(0);
  const last={...state};provider.close();replacement.message({type:'sync',epoch:1,seq:2,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'owner',archived:false});
  expect(state).toEqual(last);doc.destroy();server.destroy();
});

it('an older duplicate ACK never regresses the displayed acknowledged sequence', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'sequence-board',value=>{state=value;}),socket=Socket.sockets[0]!;
  sync(socket,server);burst(doc,2);const [one,two]=updates(socket);
  socket.message({type:'ack',updateId:one!.updateId,gestureId:one!.gestureId,seq:1});
  socket.message({type:'ack',updateId:two!.updateId,gestureId:two!.gestureId,seq:2});
  socket.message({type:'ack',updateId:one!.updateId,gestureId:one!.gestureId,seq:1});
  expect(state).toMatchObject({pending:0,duplicateAcks:1,lastAckSequence:2,lastAckReceipt:{seq:2}});
  provider.close();doc.destroy();server.destroy();
});
it('permission rejection stops retry and clears visible document', () => {
  const doc = createWhiteboardDocument(); let state: WhiteboardConnectionState | undefined;
  const provider = new WhiteboardProvider(doc, 'board-1', value => { state = value; });
  Socket.sockets[0]!.message({ type: 'error', code: 'ACCESS_DENIED' });
  expect(state?.phase).toBe('blocked'); expect(doc.getMap('objects').size).toBe(0);
  vi.advanceTimersByTime(60000); expect(Socket.sockets).toHaveLength(1); provider.close(); doc.destroy();
});
it('throttles awareness and sends the latest world cursor without client identity', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();
  const provider=new WhiteboardProvider(doc,'board-1',()=>{}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  provider.awareness({x:10,y:20},['a']); provider.awareness({x:30,y:40},['b']);
  expect(socket.sent).toHaveLength(0);vi.advanceTimersByTime(50);
  expect(JSON.parse(socket.sent[0]!)).toEqual({type:'awareness',pointer:null,cursor:{x:30,y:40},selected:['b'],editingObjectId:null,viewport:null,presenting:false,followingActorId:null});
  provider.close();doc.destroy();server.destroy();
});

it('reports duplicate ACKs, blocks unknown ACK conflicts, and never removes another pending update', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(doc,[{type:'create',object:{id:'local',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'x',style:{},parentId:null,orderKey:''}}],'local');
  const pending=JSON.parse(socket.sent[0]!),updateId=pending.updateId;
  socket.message({type:'ack',updateId,gestureId:pending.gestureId,seq:1}); expect(state.pending).toBe(0);
  socket.message({type:'ack',updateId,gestureId:pending.gestureId,seq:1}); expect(state.duplicateAcks).toBe(1);
  socket.message({type:'ack',updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),seq:2}); expect(state).toMatchObject({phase:'blocked',reason:'ACK_CONFLICT'});
  provider.close();doc.destroy();server.destroy();
});
it('rejects an ACK that reuses the update id for a different gesture receipt',()=>{
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(doc,[{type:'create',object:{id:'receipt',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'x',style:{},parentId:null,orderKey:''}}],{gestureId:'gesture-a'});
  const pending=JSON.parse(socket.sent[0]!);socket.message({type:'ack',updateId:pending.updateId,gestureId:'gesture-b',seq:1});
  expect(state).toMatchObject({phase:'blocked',reason:'ACK_CONFLICT'});provider.close();doc.destroy();server.destroy();
});

it('refreshes changed authentication, resumes the known head, and exposes bounded retry state', async () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),first=Socket.sockets[0]!;
  first.message({type:'sync',epoch:3,seq:7,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  auth.token='refreshed-session';await vi.advanceTimersByTimeAsync(1000);await vi.advanceTimersByTimeAsync(0);
  const second=Socket.sockets[1]!;expect(second.protocols.at(-1)).toContain('refreshed-session');second.onopen?.();
  expect(JSON.parse(second.sent[0]!)).toMatchObject({type:'hello',resume:{epoch:3,seq:7}});
  second.onclose?.({code:1006});expect(state).toMatchObject({phase:'offline',retryAttempt:1});
  provider.retryNow();expect(Socket.sockets).toHaveLength(3);
  provider.close();doc.destroy();server.destroy();
});

it('serializes refresh rebind with concurrent persistence and restart without recreating the old token generation',async()=>{
  const outbox=new DeferredRebindOutbox(),doc=createWhiteboardDocument(),server=createWhiteboardDocument();
  const provider=new WhiteboardProvider(doc,'board-1',()=>{},outbox);await vi.advanceTimersByTimeAsync(0);const first=Socket.sockets[0]!;
  first.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(doc,[{type:'create',object:{id:'before-refresh',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'before',style:{},parentId:null,orderKey:''}}],{gestureId:'before-refresh'});
  await vi.advanceTimersByTimeAsync(0);expect(outbox.updates.get('test-session')).toHaveLength(1);
  auth.token='refreshed-session';await vi.advanceTimersByTimeAsync(1000);await outbox.started;
  executeCommands(doc,[{type:'create',object:{id:'during-refresh',kind:'sticky',schemaVersion:1,geometry:{x:2,y:0,width:1,height:1,rotation:0},text:'during',style:{},parentId:null,orderKey:''}}],{gestureId:'during-refresh'});
  expect(outbox.updates.get('test-session')).toHaveLength(1);
  outbox.finish();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(0);
  expect(outbox.updates.has('test-session')).toBe(false);
  expect(outbox.updates.get('refreshed-session')?.map(item=>item.gestureId)).toEqual(['before-refresh','during-refresh']);
  provider.close();doc.destroy();
  const restored=createWhiteboardDocument(),restarted=new WhiteboardProvider(restored,'board-1',()=>{},outbox);await vi.advanceTimersByTimeAsync(0);
  expect(readObjects(restored)).toEqual([]);sync(Socket.sockets.at(-1)!,server);
  expect(readObjects(restored).map(item=>item.id).sort()).toEqual(['before-refresh','during-refresh']);
  restarted.close();restored.destroy();server.destroy();
});

it('distinguishes retryable recovery from access revocation', () => {
  const doc=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),first=Socket.sockets[0]!;
  first.message({type:'recovery',code:'DEPENDENCY_UNAVAILABLE',disposition:'retry-later'});
  expect(state).toMatchObject({phase:'offline',reason:'DEPENDENCY_UNAVAILABLE'});
  first.onclose?.({code:4403});
  vi.advanceTimersByTime(500);const second=Socket.sockets[1]!;
  second.message({type:'recovery',code:'ACCESS_REVOKED',disposition:'access-revoked'});
  expect(state).toMatchObject({phase:'blocked',reason:'ACCESS_REVOKED'});
  provider.close();doc.destroy();
});

it('fails closed when the in-page offline replay queue reaches its bounded update count', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  socket.onclose?.({code:1006});
  for(let index=0;index<201 && state.phase!=='blocked';index++) executeCommands(doc,[{type:'create',object:{id:`n-${index}`,kind:'sticky',schemaVersion:1,geometry:{x:index,y:0,width:1,height:1,rotation:0},text:'x',style:{},parentId:null,orderKey:String(index)}}],`offline-${index}`);
  expect(state).toMatchObject({phase:'blocked',reason:'PENDING_LIMIT',pending:200});
  expect(readObjects(doc)).toEqual([]);provider.close();doc.destroy();server.destroy();
});
it('ignores a replayed peer update without regressing sequence, then accepts a newer update', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),stale=createWhiteboardDocument(),provider=new WhiteboardProvider(doc,'board-1',()=>{}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:5,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(stale,[{type:'create',object:{id:'stale',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:180,height:140,rotation:0},text:'stale',style:{},parentId:null,orderKey:''}}],{});
  socket.message({type:'update',epoch:1,seq:4,update:bytesToBase64(Y.encodeStateAsUpdate(stale))});
  expect(readObjects(doc)).toEqual([]);
  executeCommands(server,[{type:'create',object:{id:'fresh',kind:'sticky',schemaVersion:1,geometry:{x:200,y:0,width:180,height:140,rotation:0},text:'fresh',style:{},parentId:null,orderKey:''}}],{});
  socket.message({type:'update',epoch:1,seq:6,update:bytesToBase64(Y.encodeStateAsUpdate(server))});
  expect(readObjects(doc).map(object=>object.id)).toEqual(['fresh']);
  provider.close();doc.destroy();server.destroy();stale.destroy();
});
it('does not let an ACK skip document sequences that still need to arrive', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),provider=new WhiteboardProvider(doc,'board-1',()=>{}),socket=Socket.sockets[0]!;
  executeCommands(server,[{type:'create',object:{id:'seq-1',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'one',style:{},parentId:null,orderKey:''}}],{});
  socket.message({type:'sync',epoch:1,seq:1,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(doc,[{type:'create',object:{id:'local-seq-3',kind:'sticky',schemaVersion:1,geometry:{x:2,y:0,width:1,height:1,rotation:0},text:'local',style:{},parentId:null,orderKey:''}}],{});
  const pending=JSON.parse(socket.sent[0]!); socket.message({type:'ack',updateId:pending.updateId,gestureId:pending.gestureId,seq:3});
  executeCommands(server,[{type:'create',object:{id:'external-seq-2',kind:'sticky',schemaVersion:1,geometry:{x:1,y:0,width:1,height:1,rotation:0},text:'external',style:{},parentId:null,orderKey:''}}],{});
  socket.message({type:'update',epoch:1,seq:3,update:bytesToBase64(Y.encodeStateAsUpdate(server,Y.encodeStateVector(doc)))});
  expect(readObjects(doc).map(object=>object.id).sort()).toEqual(['external-seq-2','local-seq-3','seq-1']);
  provider.close();doc.destroy();server.destroy();
});
it('restores encrypted-durable outbox semantics across provider recreation and replays the same id until ACK',async()=>{
  const outbox=new DurableMemoryOutbox(),server=createWhiteboardDocument(),firstDoc=createWhiteboardDocument();
  const firstProvider=new WhiteboardProvider(firstDoc,'board-1',()=>{},outbox);await vi.advanceTimersByTimeAsync(0);const first=Socket.sockets[0]!;
  first.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(firstDoc,[{type:'create',object:{id:'durable',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'kept',style:{},parentId:null,orderKey:''}}],'local');await vi.advanceTimersByTimeAsync(0);
  const update=JSON.parse(first.sent[0]!);expect(outbox.updates.get('test-session')).toHaveLength(1);firstProvider.close();firstDoc.destroy();
  const restoredDoc=createWhiteboardDocument(),secondProvider=new WhiteboardProvider(restoredDoc,'board-1',()=>{},outbox);await vi.advanceTimersByTimeAsync(0);const second=Socket.sockets[1]!;
  expect(readObjects(restoredDoc)).toEqual([]);second.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});expect(readObjects(restoredDoc).map(item=>item.id)).toEqual(['durable']);expect(JSON.parse(second.sent[0]!).updateId).toBe(update.updateId);
  second.message({type:'ack',updateId:update.updateId,gestureId:update.gestureId,seq:1});await vi.advanceTimersByTimeAsync(0);expect(outbox.updates.get('test-session')).toEqual([]);secondProvider.close();restoredDoc.destroy();server.destroy();
});
it('persists an authentication tombstone and refuses stale document restore after revocation',async()=>{
  const outbox=new DurableMemoryOutbox(),doc=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},outbox);await vi.advanceTimersByTimeAsync(0);Socket.sockets[0]!.message({type:'error',code:'ACCESS_REVOKED',recoverable:false});await vi.advanceTimersByTimeAsync(0);
  expect(outbox.revoked.has('test-session')).toBe(true);expect(state).toMatchObject({phase:'blocked',reason:'ACCESS_REVOKED'});provider.close();doc.destroy();
  const stale=createWhiteboardDocument();let restored!:WhiteboardConnectionState;const restarted=new WhiteboardProvider(stale,'board-1',value=>{restored=value;},outbox);await vi.advanceTimersByTimeAsync(0);expect(restored.phase).toBe('connecting');expect(readObjects(stale)).toEqual([]);expect(Socket.sockets).toHaveLength(2);Socket.sockets[1]!.message({type:'error',code:'ACCESS_REVOKED',recoverable:false});expect(restored).toMatchObject({phase:'blocked',reason:'ACCESS_REVOKED'});restarted.close();stale.destroy();
});

it('keeps forty burst updates pending while draining no more than eight unacknowledged frames', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  sync(socket,server);burst(doc,40);
  expect(state?.pending).toBe(40);expect(updates(socket)).toHaveLength(8);

  const acknowledged=new Set<string>();
  while(acknowledged.size<40){
    const outstanding=updates(socket).filter(message=>!acknowledged.has(message.updateId));
    expect(outstanding.length).toBeGreaterThan(0);expect(outstanding.length).toBeLessThanOrEqual(8);
    const next=outstanding[0]!;acknowledged.add(next.updateId);
    socket.message({type:'ack',updateId:next.updateId,gestureId:next.gestureId,seq:acknowledged.size});
  }
  expect(updates(socket)).toHaveLength(40);expect(new Set(updates(socket).map(message=>message.updateId)).size).toBe(40);
  expect(state?.pending).toBe(0);
  provider.close();doc.destroy();server.destroy();
});

it('reconnects by replaying only unacknowledged updates with their original IDs and FIFO order', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),first=Socket.sockets[0]!;
  sync(first,server);burst(doc,12);
  const initial=updates(first);expect(initial).toHaveLength(8);
  for(let index=0;index<3;index++) first.message({type:'ack',updateId:initial[index]!.updateId,gestureId:initial[index]!.gestureId,seq:index+1});
  const beforeDisconnect=updates(first);expect(beforeDisconnect).toHaveLength(11);expect(state?.pending).toBe(9);
  first.onclose?.({code:1006});vi.advanceTimersByTime(500);
  const second=Socket.sockets[1]!;second.onopen?.();sync(second,server,1,3);
  const replayed=updates(second);expect(replayed).toHaveLength(8);
  expect(replayed.map(message=>message.updateId)).toEqual(beforeDisconnect.slice(3,11).map(message=>message.updateId));
  expect(state?.pending).toBe(9);
  provider.close();doc.destroy();server.destroy();
});

it('holds latest awareness behind durable writes so presence cannot consume the protocol window', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();
  const provider=new WhiteboardProvider(doc,'board-1',()=>{}),socket=Socket.sockets[0]!;
  sync(socket,server);burst(doc,40);
  for(let index=0;index<20;index++) provider.awareness({x:index,y:index+1},[`note-${index}`]);
  vi.advanceTimersByTime(50);expect(messages(socket).filter(message=>message.type==='awareness')).toEqual([]);
  const acknowledged=new Set<string>();
  while(acknowledged.size<40){
    const next=updates(socket).find(message=>!acknowledged.has(message.updateId))!;
    acknowledged.add(next.updateId);socket.message({type:'ack',updateId:next.updateId,gestureId:next.gestureId,seq:acknowledged.size});
  }
  vi.advanceTimersByTime(50);
  expect(messages(socket).filter(message=>message.type==='awareness')).toEqual([{type:'awareness',pointer:null,cursor:{x:19,y:20},selected:['note-19'],editingObjectId:null,viewport:null,presenting:false,followingActorId:null}]);
  provider.close();doc.destroy();server.destroy();
});

it('keeps every unacknowledged update visible in pending state when a protocol error blocks the board', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  sync(socket,server);burst(doc,10);
  const first=updates(socket);socket.message({type:'ack',updateId:first[0]!.updateId,gestureId:first[0]!.gestureId,seq:1});socket.message({type:'ack',updateId:first[1]!.updateId,gestureId:first[1]!.gestureId,seq:2});
  expect(state?.pending).toBe(8);
  socket.message({type:'error',code:'PROTOCOL_LIMIT',recoverable:false});
  expect(state).toMatchObject({phase:'blocked',pending:8,reason:'PROTOCOL_LIMIT'});expect(readObjects(doc)).toEqual([]);
  vi.advanceTimersByTime(60000);expect(Socket.sockets).toHaveLength(1);
  provider.close();doc.destroy();server.destroy();
});

it('rejects an unsolicited ACK instead of allowing it to drain unsent work', () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(); let state!: WhiteboardConnectionState;
  const provider = new WhiteboardProvider(doc, 'board-1', value => {state = value;}), socket = Socket.sockets[0]!;
  sync(socket, server); burst(doc, 12);
  expect(updates(socket)).toHaveLength(8);
  socket.message({type: 'ack', updateId: crypto.randomUUID(), gestureId: crypto.randomUUID(), seq: 1});
  expect(state).toMatchObject({phase: 'blocked', reason: 'ACK_CONFLICT', pending: 12});
  expect(updates(socket)).toHaveLength(8);
  provider.close(); doc.destroy(); server.destroy();
});

it('browser offline detaches a still-open socket and online replays pending changes', () => {
  const browserEvents = new EventTarget(); vi.stubGlobal('window', browserEvents);
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument();
  let state: WhiteboardConnectionState | undefined;
  const provider = new WhiteboardProvider(doc, 'offline-events', value => { state = value; }, null);
  const first = Socket.sockets[0]!; first.onopen?.(); sync(first, server);
  browserEvents.dispatchEvent(new Event('offline'));
  expect(state?.phase).toBe('offline'); expect(first.readyState).toBe(3);
  burst(doc, 1); expect(state?.pending).toBe(1); expect(updates(first)).toHaveLength(0);
  // Late close from the detached socket must not create a competing connection.
  first.onclose?.({code:1006}); vi.advanceTimersByTime(15000); expect(Socket.sockets).toHaveLength(1);
  browserEvents.dispatchEvent(new Event('online'));
  const second = Socket.sockets[1]!; second.onopen?.(); sync(second, server);
  const pending = updates(second)[0]!; expect(pending).toBeDefined();
  second.message({type:'ack',updateId:pending.updateId,gestureId:pending.gestureId,seq:1});
  expect(state?.pending).toBe(0); expect(state?.phase).toBe('online');
  provider.close(); browserEvents.dispatchEvent(new Event('online')); expect(Socket.sockets).toHaveLength(2);
  doc.destroy(); server.destroy();
});

it('reauthorizes an empty revoked provider only after fresh sync and discards all retired writes',async()=>{
 const outbox=new DurableMemoryOutbox();outbox.revoked.add('test-session');
 const old=createWhiteboardDocument();executeCommands(old,[{type:'create',object:sticky('retired-secret')}],{});
 outbox.updates.set('test-session',[{type:'update',epoch:1,updateId:crypto.randomUUID(),gestureId:crypto.randomUUID(),update:bytesToBase64(Y.encodeStateAsUpdate(old))}]);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const reauthorize=vi.fn(async()=>{await gate;outbox.updates.set('test-session',[]);});
 const durable:WhiteboardDurableOutbox=Object.assign(outbox,{reauthorize});
 const doc=createWhiteboardDocument(),server=createWhiteboardDocument();executeCommands(server,[{type:'create',object:sticky('fresh-server-object')}],{});
 let state!:WhiteboardConnectionState;const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},durable);await vi.advanceTimersByTimeAsync(0);
 const socket=Socket.sockets[0]!;socket.onopen?.();expect(messages(socket).map(value=>value.type)).toEqual(['hello']);expect(readObjects(doc)).toEqual([]);expect(reauthorize).not.toHaveBeenCalled();
 socket.message({type:'sync',epoch:1,seq:2,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'commenter',archived:false});await vi.advanceTimersByTimeAsync(0);
 expect(reauthorize).toHaveBeenCalledOnce();expect(readObjects(doc)).toEqual([]);expect(state.phase).toBe('connecting');expect(updates(socket)).toEqual([]);
 release();await vi.advanceTimersByTimeAsync(0);expect(state).toMatchObject({phase:'online',role:'commenter',pending:0});expect(readObjects(doc).map(value=>value.id)).toEqual(['fresh-server-object']);expect(updates(socket)).toEqual([]);
 provider.close();old.destroy();doc.destroy();server.destroy();
});
it('does not publish fresh sync when another tab wins reauthorization CAS',async()=>{
 const outbox=new DurableMemoryOutbox();outbox.revoked.add('test-session');const reauthorize=vi.fn(async()=>{throw new Error('OUTBOX_GENERATION_CHANGED');});
 const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
 const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},Object.assign(outbox,{reauthorize}));await vi.advanceTimersByTimeAsync(0);sync(Socket.sockets[0]!,server);await vi.advanceTimersByTimeAsync(0);
 expect(state).toMatchObject({phase:'blocked',reason:'OUTBOX_REAUTHORIZATION_FAILED'});expect(readObjects(doc)).toEqual([]);expect(updates(Socket.sockets[0]!)).toEqual([]);provider.close();doc.destroy();server.destroy();
});
it.each(['error','recovery'])('handles terminal %s immediately while reauthorization is pending',async(kind)=>{
 const outbox=new DurableMemoryOutbox();outbox.revoked.add('test-session');let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const reauthorize=vi.fn(()=>gate);
 const doc=createWhiteboardDocument(),server=createWhiteboardDocument();executeCommands(server,[{type:'create',object:sticky('must-never-display')}],{});const states:WhiteboardConnectionState[]=[];
 const provider=new WhiteboardProvider(doc,'board-1',state=>states.push(state),Object.assign(outbox,{reauthorize}));await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;sync(socket,server);await vi.advanceTimersByTimeAsync(0);
 socket.message(kind==='error'?{type:'error',code:'ACCESS_REVOKED',recoverable:false}:{type:'recovery',code:'ACCESS_REVOKED',disposition:'access-revoked'});
 expect(states.at(-1)?.phase).toBe('blocked');expect(readObjects(doc)).toEqual([]);release();await vi.advanceTimersByTimeAsync(0);expect(states.some(state=>state.phase==='online')).toBe(false);expect(readObjects(doc)).toEqual([]);provider.close();doc.destroy();server.destroy();
});
it('ignores stale socket open/close without sending hello or clearing the new handshake',()=>{
 const doc=createWhiteboardDocument(),provider=new WhiteboardProvider(doc,'board-1',()=>{},null),old=Socket.sockets[0]!;provider.retryNow();const current=Socket.sockets[1]!;
 old.onopen?.();old.onclose?.({code:1000});expect(current.sent).toEqual([]);vi.advanceTimersByTime(10000);expect(current.readyState).toBe(3);provider.close();doc.destroy();
});
it.each(['oversized','aggregate','malformed'])('rejects %s inbound data before deferred queue admission',async(mode)=>{
 const outbox=new DurableMemoryOutbox();outbox.revoked.add('test-session');let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
 const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},Object.assign(outbox,{reauthorize:()=>gate}));await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets[0]!;sync(socket,server);await vi.advanceTimersByTimeAsync(0);
 if(mode==='oversized')socket.onmessage?.({data:'x'.repeat(48*1024*1024+1)});
 else if(mode==='malformed')socket.onmessage?.({data:'{"type":"not-a-message"}'});
 else{const frame={type:'sync',epoch:1,seq:0,update:'AAAA'.repeat(1200000),role:'editor',archived:false};socket.message(frame);socket.message(frame);}
 expect(state).toMatchObject({phase:'blocked',reason:'PROTOCOL_ERROR'});release();await vi.advanceTimersByTimeAsync(0);expect(readObjects(doc)).toEqual([]);provider.close();doc.destroy();server.destroy();
});

it('orders offline original-ID Undo intent after delete ACK and before subsequent edits',async()=>{
 const server=createWhiteboardDocument();executeCommands(server,[{type:'create',object:sticky('undo-proof')}],{});
 const doc=createWhiteboardDocument(),outbox=new DurableMemoryOutbox();let state:WhiteboardConnectionState|undefined;
 const provider=new WhiteboardProvider(doc,'undo-proof-board',value=>{state=value;},outbox);await vi.advanceTimersByTimeAsync(0);const first=Socket.sockets[0]!;sync(first,server);
 first.onclose?.({code:1006});
 const origin={gestureId:'delete-proof'},undo=new WhiteboardUndo(doc,origin);
 undo.execute([{type:'delete',id:'undo-proof'}]);expect(undo.undo('restore-proof')).toBe('undone');
 executeCommands(doc,[{type:'text',id:'undo-proof',index:0,deleteCount:0,insert:'after '}],{gestureId:'after-proof'});
 await vi.advanceTimersByTimeAsync(0);expect(outbox.updates.get('test-session')?.map(item=>item.type)).toEqual(['update','restore-deletion','update']);
 const saved=outbox.updates.get('test-session')!;expect(saved[1]).toMatchObject({deleteGestureId:'delete-proof',gestureId:'restore-proof',objectIds:['undo-proof']});expect(saved[1]).not.toHaveProperty('update');
 await vi.advanceTimersByTimeAsync(500);const second=Socket.sockets[1]!;sync(second,server);
 expect(messages(second).map(item=>item.type)).toEqual(['update']);
 second.message({type:'ack',updateId:saved[0].updateId,gestureId:saved[0].gestureId,seq:1});
 expect(messages(second).map(item=>item.type)).toEqual(['update','restore-deletion']);
 second.message({type:'ack',updateId:saved[1].updateId,gestureId:saved[1].gestureId,seq:2});
 expect(state?.lastAckReceipt).toMatchObject({gestureId:'restore-proof',seq:2});expect(messages(second).map(item=>item.type)).toEqual(['update','restore-deletion','update']);
 second.message({type:'ack',updateId:saved[2].updateId,gestureId:saved[2].gestureId,seq:3});await vi.advanceTimersByTimeAsync(0);
 expect(outbox.updates.get('test-session')).toEqual([]);expect(readObjects(doc)[0]).toMatchObject({id:'undo-proof',text:'after undo-proof'});
 provider.close();undo.destroy();doc.destroy();server.destroy();
});
it('reopened provider restores queued same-ID intent from the authoritative tombstoned snapshot',async()=>{
 const server=createWhiteboardDocument();executeCommands(server,[{type:'create',object:sticky('restored-after-crash')},{type:'delete',id:'restored-after-crash'}],{});
 const preview=createWhiteboardDocument();Y.applyUpdate(preview,Y.encodeStateAsUpdate(server));const vector=Y.encodeStateVector(preview);executeCommands(preview,[{type:'restore',id:'restored-after-crash'}],{});
 const intent={inverseUpdate:bytesToBase64(Y.encodeStateAsUpdate(preview,vector)),type:'restore-deletion' as const,epoch:1,updateId:crypto.randomUUID(),gestureId:'undo-after-crash',deleteGestureId:'already-acked-delete',objectIds:['restored-after-crash']};
 const outbox=new DurableMemoryOutbox();outbox.updates.set('test-session',[intent]);
 const doc=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;const provider=new WhiteboardProvider(doc,'reopen',value=>{state=value;},outbox);await vi.advanceTimersByTimeAsync(0);
 expect(readObjects(doc)).toEqual([]);const socket=Socket.sockets[0]!;sync(socket,server,1,9);
 expect(readObjects(doc)[0]?.id).toBe('restored-after-crash');expect(JSON.parse(socket.sent[0]!)).toEqual(intent);
 socket.message({type:'ack',updateId:intent.updateId,gestureId:intent.gestureId,seq:10});await vi.advanceTimersByTimeAsync(0);expect(state?.phase).toBe('online');expect(state?.lastAckReceipt?.gestureId).toBe('undo-after-crash');expect(outbox.updates.get('test-session')).toEqual([]);
 provider.close();doc.destroy();server.destroy();
});

it.each([false,true])('replays delete undo redo in durable order after restart (server already accepted redo: %s)',async accepted=>{
 const server=createWhiteboardDocument();executeCommands(server,[{type:'create',object:sticky('cycle')}],{});
 const doc=createWhiteboardDocument(),outbox=new DurableMemoryOutbox();
 const provider=new WhiteboardProvider(doc,'cycle-board',()=>{},outbox);await vi.advanceTimersByTimeAsync(0);const socket=Socket.sockets.at(-1)!;sync(socket,server);socket.onclose?.({code:1006});
 const undo=new WhiteboardUndo(doc,{gestureId:'delete-cycle'});
 undo.execute([{type:'delete',id:'cycle'}]);expect(undo.undo('undo-cycle')).toBe('undone');expect(undo.redo('redo-cycle')).toBe(true);
 await vi.advanceTimersByTimeAsync(0);const saved=structuredClone(outbox.updates.get('test-session')!);
 expect(saved.map(item=>item.type)).toEqual(['update','restore-deletion','update']);expect(saved[1].inverseUpdate).toEqual(expect.any(String));
 if(accepted)for(const item of saved)Y.applyUpdate(server,Uint8Array.from(Buffer.from(item.update??item.inverseUpdate,'base64')));
 provider.close();const restartedDoc=createWhiteboardDocument();let state!:WhiteboardConnectionState;
 const restarted=new WhiteboardProvider(restartedDoc,'cycle-board',value=>{state=value;},outbox);await vi.advanceTimersByTimeAsync(0);const restartedSocket=Socket.sockets.at(-1)!;
 expect(readObjects(restartedDoc)).toEqual([]);sync(restartedSocket,server,1,accepted?3:0);
 expect(state.phase).toBe('online');expect(readObjects(restartedDoc)).toEqual([]);expect(restartedDoc.getMap('deletedObjects').get('cycle')).toBe(true);
 // Commit/replay the same durable sequence and simulate transport ACK ordering.
 for(let index=0;index<saved.length;index++){
   const item=saved[index];Y.applyUpdate(server,Uint8Array.from(Buffer.from(item.update??item.inverseUpdate,'base64')));
   restartedSocket.message({type:'ack',updateId:item.updateId,gestureId:item.gestureId,seq:index+1});
 }
 Y.applyUpdate(restartedDoc,Y.encodeStateAsUpdate(server));
 expect(readObjects(restartedDoc)).toEqual(readObjects(server));expect(restartedDoc.getMap('deletedObjects').get('cycle')).toBe(true);
 await vi.advanceTimersByTimeAsync(0);expect(state.pending).toBe(0);
 restarted.close();undo.destroy();doc.destroy();restartedDoc.destroy();server.destroy();
});

it.each(['throw','reject'] as const)('private receipt observer %s cannot break sync or export private fields',async(mode)=>{
 const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;const receipts:unknown[]=[];
 const provider=new WhiteboardProvider(doc,'observer-private-board',value=>{state=value;},null,receipt=>{receipts.push(receipt);if(mode==='reject')return Promise.reject(new Error('private diagnostic failure'));throw new Error('private diagnostic failure');});
 try{
  const socket=Socket.sockets[0]!;sync(socket,server);executeCommands(doc,[{type:'create',object:sticky('observer')}],'local');
  const frame=updates(socket)[0]!;socket.message({type:'ack',updateId:frame.updateId,gestureId:frame.gestureId,seq:1});await Promise.resolve();
  expect(state?.phase).toBe('online');expect(state?.pending).toBe(0);expect(receipts).toHaveLength(1);
  const receipt=receipts[0] as Record<string,unknown>;expect(Object.keys(receipt).sort()).toEqual(['gestureId','providerInstance','seq','socketGeneration','updateId']);expect(receipt).toMatchObject({socketGeneration:1,updateId:frame.updateId,gestureId:frame.gestureId,seq:1});expect(Object.isFrozen(receipt)).toBe(true);
  expect(JSON.stringify(receipt)).not.toContain('test-session');expect(JSON.stringify(receipt)).not.toContain('observer-private-board');
 }finally{provider.close();doc.destroy();server.destroy();}
});
it('private observer ignores stale socket ACKs and identifies actual reconnect receipt generation',async()=>{
 const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),receipts:Record<string,unknown>[]=[];
 const provider=new WhiteboardProvider(doc,'observer-reconnect',()=>{},null,receipt=>{receipts.push(receipt);});
 try{
  const old=Socket.sockets[0]!;sync(old,server);executeCommands(doc,[{type:'create',object:sticky('reconnect-observer')}],'local');const first=updates(old)[0]!;
  old.onclose?.({code:1000});await vi.advanceTimersByTimeAsync(500);const current=Socket.sockets[1]!;sync(current,server);
  old.message({type:'ack',updateId:first.updateId,gestureId:first.gestureId,seq:1});expect(receipts).toEqual([]);
  current.message({type:'ack',updateId:first.updateId,gestureId:first.gestureId,seq:1});expect(receipts).toHaveLength(1);expect(receipts[0]).toMatchObject({socketGeneration:2,updateId:first.updateId,seq:1});
 }finally{provider.close();doc.destroy();server.destroy();}
});
it('private observer cannot turn mismatched gesture ACK into an accepted receipt',()=>{
 const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),observe=vi.fn();let state:WhiteboardConnectionState|undefined;
 const provider=new WhiteboardProvider(doc,'observer-guard',value=>{state=value;},null,observe);
 try{const socket=Socket.sockets[0]!;sync(socket,server);executeCommands(doc,[{type:'create',object:sticky('guard-observer')}],'local');const frame=updates(socket)[0]!;socket.message({type:'ack',updateId:frame.updateId,gestureId:crypto.randomUUID(),seq:1});expect(observe).not.toHaveBeenCalled();expect(state?.phase).toBe('blocked');expect(state?.reason).toBe('ACK_CONFLICT');}finally{provider.close();doc.destroy();server.destroy();}
});
