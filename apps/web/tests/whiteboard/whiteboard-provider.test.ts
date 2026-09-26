import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { WhiteboardProvider, bytesToBase64, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
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
  second.message({ type: 'ack', updateId: pending.updateId, seq: 1 }); expect(state?.pending).toBe(0);
  provider.close(); doc.destroy(); server.destroy();
});
it('permission rejection stops retry and clears visible document', () => {
  const doc = createWhiteboardDocument(); let state: WhiteboardConnectionState | undefined;
  doc.getMap('commentThreads').set('private-thread', { body: 'must disappear' });
  const provider = new WhiteboardProvider(doc, 'board-1', value => { state = value; });
  Socket.sockets[0]!.message({ type: 'error', code: 'ACCESS_DENIED' });
  expect(state?.phase).toBe('blocked'); expect(doc.getMap('objects').size).toBe(0); expect(doc.getMap('commentThreads').size).toBe(0);
  vi.advanceTimersByTime(60000); expect(Socket.sockets).toHaveLength(1); provider.close(); doc.destroy();
});
it('throttles awareness and sends the latest world cursor without client identity', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();
  const provider=new WhiteboardProvider(doc,'board-1',()=>{}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  provider.awareness({x:10,y:20},['a']); provider.awareness({x:30,y:40},['b']);
  expect(socket.sent).toHaveLength(0);vi.advanceTimersByTime(50);
  expect(JSON.parse(socket.sent[0]!)).toEqual({type:'awareness',cursor:{x:30,y:40},selected:['b'],editingObjectId:null});
  provider.close();doc.destroy();server.destroy();
});

it('reports duplicate ACKs, blocks unknown ACK conflicts, and never removes another pending update', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),socket=Socket.sockets[0]!;
  socket.message({type:'sync',epoch:1,seq:0,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  executeCommands(doc,[{type:'create',object:{id:'local',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1,rotation:0},text:'x',style:{},parentId:null,orderKey:''}}],'local');
  const updateId=JSON.parse(socket.sent[0]!).updateId;
  socket.message({type:'ack',updateId,seq:1}); expect(state.pending).toBe(0);
  socket.message({type:'ack',updateId,seq:1}); expect(state.duplicateAcks).toBe(1);
  socket.message({type:'ack',updateId:crypto.randomUUID(),seq:2}); expect(state).toMatchObject({phase:'blocked',reason:'ACK_CONFLICT'});
  provider.close();doc.destroy();server.destroy();
});

it('refreshes changed authentication, resumes the known head, and exposes bounded retry state', () => {
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument();let state!:WhiteboardConnectionState;
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;}),first=Socket.sockets[0]!;
  first.message({type:'sync',epoch:3,seq:7,update:bytesToBase64(Y.encodeStateAsUpdate(server)),role:'editor',archived:false});
  auth.token='refreshed-session';vi.advanceTimersByTime(1000);
  const second=Socket.sockets[1]!;expect(second.protocols.at(-1)).toContain('refreshed-session');second.onopen?.();
  expect(JSON.parse(second.sent[0]!)).toMatchObject({type:'hello',resume:{epoch:3,seq:7}});
  second.onclose?.({code:1006});expect(state).toMatchObject({phase:'offline',retryAttempt:1});
  provider.retryNow();expect(Socket.sockets).toHaveLength(3);
  provider.close();doc.destroy();server.destroy();
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
  expect(state).toMatchObject({phase:'blocked',reason:'PENDING_LIMIT',pending:0});
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
  const pending=JSON.parse(socket.sent[0]!); socket.message({type:'ack',updateId:pending.updateId,seq:3});
  executeCommands(server,[{type:'create',object:{id:'external-seq-2',kind:'sticky',schemaVersion:1,geometry:{x:1,y:0,width:1,height:1,rotation:0},text:'external',style:{},parentId:null,orderKey:''}}],{});
  socket.message({type:'update',epoch:1,seq:3,update:bytesToBase64(Y.encodeStateAsUpdate(server,Y.encodeStateVector(doc)))});
  expect(readObjects(doc).map(object=>object.id).sort()).toEqual(['external-seq-2','local-seq-3','seq-1']);
  provider.close();doc.destroy();server.destroy();
});
