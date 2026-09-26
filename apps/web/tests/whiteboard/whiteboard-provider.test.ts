import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { WhiteboardProvider, bytesToBase64, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
vi.mock('@/lib/api-client', () => ({ getStoredSessionToken: () => 'test-session', apiWebSocketUrl: (path: string) => `ws://localhost${path}` }));
class Socket {
  static OPEN = 1; static sockets: Socket[] = [];
  readyState = 1; sent: string[] = [];
  onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: (event: { code: number }) => void; onerror?: () => void;
  constructor(readonly url: string, readonly protocols: string[]) { Socket.sockets.push(this); }
  send(data: string) { this.sent.push(data); } close() { this.readyState = 3; }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const sticky = (id: string) => ({ id, kind: 'sticky' as const, schemaVersion: 1 as const, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: '' });
const messages = (socket: Socket) => socket.sent.map(value => JSON.parse(value) as { type: string; updateId?: string });
const updates = (socket: Socket) => messages(socket).filter((value): value is { type: 'update'; updateId: string } => value.type === 'update' && typeof value.updateId === 'string');
const sync = (socket: Socket, server: Y.Doc, epoch = 1, seq = 0) => socket.message({ type: 'sync', epoch, seq, update: bytesToBase64(Y.encodeStateAsUpdate(server)), role: 'editor', archived: false });
const burst = (doc: Y.Doc, count: number) => { for (let index = 0; index < count; index++) executeCommands(doc, [{ type: 'create', object: sticky(`note-${index}`) }], 'local'); };
beforeEach(() => { vi.useFakeTimers(); Socket.sockets = []; vi.stubGlobal('WebSocket', Socket); });
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
  second.message({ type: 'ack', updateId: pending.updateId, seq: 1 }); expect(state?.pending).toBe(0);
  provider.close(); doc.destroy(); server.destroy();
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
  expect(JSON.parse(socket.sent[0]!)).toEqual({type:'awareness',cursor:{x:30,y:40},selected:['b']});
  provider.close();doc.destroy();server.destroy();
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
  const pending=JSON.parse(socket.sent[0]!); socket.message({type:'ack',updateId:pending.updateId,seq:3});
  executeCommands(server,[{type:'create',object:{id:'external-seq-2',kind:'sticky',schemaVersion:1,geometry:{x:1,y:0,width:1,height:1,rotation:0},text:'external',style:{},parentId:null,orderKey:''}}],{});
  socket.message({type:'update',epoch:1,seq:3,update:bytesToBase64(Y.encodeStateAsUpdate(server,Y.encodeStateVector(doc)))});
  expect(readObjects(doc).map(object=>object.id).sort()).toEqual(['external-seq-2','local-seq-3','seq-1']);
  provider.close();doc.destroy();server.destroy();
});

it('keeps forty burst updates pending while draining no more than eight unacknowledged frames', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  sync(socket,server);burst(doc,40);
  expect(state?.pending).toBe(40);expect(updates(socket)).toHaveLength(8);
  socket.message({type:'ack',updateId:crypto.randomUUID(),seq:1});expect(state?.pending).toBe(40);
  const acknowledged=new Set<string>();
  while(acknowledged.size<40){
    const outstanding=updates(socket).filter(message=>!acknowledged.has(message.updateId));
    expect(outstanding.length).toBeGreaterThan(0);expect(outstanding.length).toBeLessThanOrEqual(8);
    const next=outstanding[0]!;acknowledged.add(next.updateId);
    socket.message({type:'ack',updateId:next.updateId,seq:acknowledged.size});
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
  for(let index=0;index<3;index++) first.message({type:'ack',updateId:initial[index]!.updateId,seq:index+1});
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
    acknowledged.add(next.updateId);socket.message({type:'ack',updateId:next.updateId,seq:acknowledged.size});
  }
  vi.advanceTimersByTime(50);
  expect(messages(socket).filter(message=>message.type==='awareness')).toEqual([{type:'awareness',cursor:{x:19,y:20},selected:['note-19']}]);
  provider.close();doc.destroy();server.destroy();
});

it('keeps every unacknowledged update visible in pending state when a protocol error blocks the board', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state:WhiteboardConnectionState|undefined;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  sync(socket,server);burst(doc,10);
  const first=updates(socket);socket.message({type:'ack',updateId:first[0]!.updateId,seq:1});socket.message({type:'ack',updateId:first[1]!.updateId,seq:2});
  expect(state?.pending).toBe(8);
  socket.message({type:'error',code:'PROTOCOL_LIMIT'});
  expect(state).toMatchObject({phase:'blocked',pending:8,reason:'PROTOCOL_LIMIT'});expect(readObjects(doc)).toEqual([]);
  vi.advanceTimersByTime(60000);expect(Socket.sockets).toHaveLength(1);
  provider.close();doc.destroy();server.destroy();
});
