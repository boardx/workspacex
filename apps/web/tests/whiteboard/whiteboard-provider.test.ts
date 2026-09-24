import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands } from '@repo/whiteboard-core';
import { WhiteboardProvider, bytesToBase64, type WhiteboardConnectionState } from '@/lib/whiteboard-provider';
import { WhiteboardOutboxLimitError, type PendingWhiteboardUpdate, type WhiteboardOutboxContext, type WhiteboardOutboxPort, type WhiteboardOutboxScope, type WhiteboardQuarantineReceipt } from '@/lib/whiteboard-outbox';

let token = 'test-session';
vi.mock('@/lib/api-client', () => ({ getStoredSessionToken: () => token, apiWebSocketUrl: (path: string) => `ws://localhost${path}` }));

class Socket {
  static OPEN = 1; static sockets: Socket[] = [];
  readyState = 1; sent: string[] = [];
  onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: (event: { code: number }) => void; onerror?: () => void;
  constructor(readonly url: string, readonly protocols: string[]) { Socket.sockets.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

const id = (scope: WhiteboardOutboxScope) => JSON.stringify([scope.boardId, scope.principalId, scope.sessionId, scope.epoch]);
const ACCESS_RECEIPT='11111111-1111-4111-8111-111111111111';
class FakeOutbox implements WhiteboardOutboxPort {
  active = new Map<string, PendingWhiteboardUpdate[]>();
  receipts: WhiteboardQuarantineReceipt[] = [];
  max = 200;
  async load(scope: WhiteboardOutboxScope) { return [...(this.active.get(id(scope)) ?? [])]; }
  async summarize(context: WhiteboardOutboxContext) {
    const updates=[...this.active].filter(([key])=>{const [boardId,principalId,sessionId]=JSON.parse(key) as [string,string,string];return boardId===context.boardId&&principalId===context.principalId&&sessionId===context.sessionId;}).flatMap(([,items])=>items);
    return {pendingCount:updates.length,pendingBytes:updates.reduce((sum,item)=>sum+item.update.length,0)};
  }
  async put(scope: WhiteboardOutboxScope, update: PendingWhiteboardUpdate) {
    const current = this.active.get(id(scope)) ?? [];
    if (current.length >= this.max) throw new WhiteboardOutboxLimitError();
    this.active.set(id(scope), [...current, update]);
  }
  async ack(scope: WhiteboardOutboxScope, updateId: string) {
    const next = (this.active.get(id(scope)) ?? []).filter(item => item.updateId !== updateId);
    if (next.length) this.active.set(id(scope), next); else this.active.delete(id(scope));
  }
  async quarantineExcept(context: WhiteboardOutboxContext, keepEpoch: number | null, reason: string) {
    const receipts: WhiteboardQuarantineReceipt[] = [];
    for (const [key, updates] of this.active) {
      const [boardId, principalId, sessionId, epoch] = JSON.parse(key) as [string, string, string, number];
      if (boardId !== context.boardId || principalId !== context.principalId || sessionId !== context.sessionId || epoch === keepEpoch) continue;
      const receipt = { boardId, principalId, sessionId, epoch, accessReceiptId:ACCESS_RECEIPT, receiptId: crypto.randomUUID(), reason, quarantinedAt: new Date().toISOString(), pendingCount: updates.length, pendingBytes: updates.reduce((sum, update) => sum + update.update.length, 0) };
      receipts.push(receipt); this.receipts.push(receipt); this.active.delete(key);
    }
    return receipts;
  }
  async quarantineSession(identity: Pick<WhiteboardOutboxContext, 'principalId' | 'sessionId'>, reason: string) {
    const receipts: WhiteboardQuarantineReceipt[] = [];
    for (const [key, updates] of this.active) {
      const [boardId, principalId, sessionId, epoch] = JSON.parse(key) as [string, string, string, number];
      if (principalId !== identity.principalId || sessionId !== identity.sessionId) continue;
      const receipt = { boardId, principalId, sessionId, epoch, accessReceiptId:ACCESS_RECEIPT, receiptId: crypto.randomUUID(), reason, quarantinedAt: new Date().toISOString(), pendingCount: updates.length, pendingBytes: updates.reduce((sum, update) => sum + update.update.length, 0) };
      receipts.push(receipt); this.receipts.push(receipt); this.active.delete(key);
    }
    return receipts;
  }
  async listQuarantine(identity:Pick<WhiteboardOutboxContext,'principalId'>,boardId?:string){return this.receipts.filter(receipt=>receipt.principalId===identity.principalId&&(!boardId||receipt.boardId===boardId));}
  async discardQuarantine(identity:Pick<WhiteboardOutboxContext,'principalId'>,receiptId:string){const index=this.receipts.findIndex(receipt=>receipt.receiptId===receiptId&&receipt.principalId===identity.principalId);if(index<0)return false;this.receipts.splice(index,1);return true;}
  async purgeSession(identity:Pick<WhiteboardOutboxContext,'principalId'|'sessionId'>){for(const key of [...this.active.keys()]){const [,principalId,sessionId]=JSON.parse(key) as [string,string,string];if(principalId===identity.principalId&&sessionId===identity.sessionId)this.active.delete(key);}}
}

const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const sync = (socket: Socket, server: Y.Doc, overrides: Partial<{ epoch: number; role: 'owner' | 'editor' | 'viewer'; archived: boolean }> = {}) => socket.message({ type: 'sync', epoch: overrides.epoch ?? 1, seq: 0, update: bytesToBase64(Y.encodeStateAsUpdate(server)), role: overrides.role ?? 'owner', archived: overrides.archived ?? false, accessReceiptId:ACCESS_RECEIPT });
const options = (outbox: WhiteboardOutboxPort, principalId = 'user-1', sessionId = 'session-1') => ({ outbox, principalId, sessionId });

beforeEach(() => { token = 'test-session'; vi.useFakeTimers(); Socket.sockets = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('persists before send, only ACK deletes, and reconnect replays the same updateId', async () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(), outbox = new FakeOutbox(); let state: WhiteboardConnectionState | undefined;
  const provider = new WhiteboardProvider(doc, 'board-1', value => { state = value; }, options(outbox));
  await flush();
  const first = Socket.sockets[0]!; first.onopen?.(); expect(JSON.parse(first.sent[0]!).type).toBe('hello');
  sync(first, server); await flush();
  executeCommands(doc, [{ type: 'create', object: { id: 'one', kind: 'sticky', schemaVersion: 1, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: 'hello', style: {}, parentId: null, orderKey: '' } }], 'local');
  await flush();
  const pending = JSON.parse(first.sent[1]!); expect(state?.pending).toBe(1); expect(outbox.active.get(id({ boardId: 'board-1', principalId: 'user-1', sessionId: 'session-1', epoch: 1, accessReceiptId:ACCESS_RECEIPT }))).toHaveLength(1);
  first.onclose?.({ code: 1006 }); vi.advanceTimersByTime(500);
  const second = Socket.sockets[1]!; second.onopen?.(); expect(second.sent).toHaveLength(1);
  sync(second, server); await flush();
  expect(JSON.parse(second.sent[1]!)).toEqual(pending);
  second.message({ type: 'ack', updateId: pending.updateId, seq: 1 }); await flush();
  expect(state?.pending).toBe(0); expect(outbox.active.size).toBe(0);
  provider.close(); doc.destroy(); server.destroy();
});

it('publishes pending synchronously before IndexedDB persistence resolves', async()=>{
  const doc=createWhiteboardDocument(),server=createWhiteboardDocument(),outbox=new FakeOutbox();let state:WhiteboardConnectionState|undefined;
  let release!:()=>void;const original=outbox.put.bind(outbox);outbox.put=vi.fn((scope,update)=>new Promise<void>(resolve=>{release=()=>void original(scope,update).then(resolve);}));
  const provider=new WhiteboardProvider(doc,'board-1',value=>{state=value;},options(outbox));await flush();sync(Socket.sockets[0]!,server);await flush();
  executeCommands(doc,[{type:'create',object:{id:'instant',kind:'sticky',schemaVersion:1,geometry:{x:0,y:0,width:180,height:140,rotation:0},text:'instant',style:{},parentId:null,orderKey:''}}],'local');
  expect(state?.pending).toBe(1);expect(outbox.active.size).toBe(0);expect(Socket.sockets[0]!.sent).toHaveLength(0);
  await Promise.resolve();release();await flush();expect(outbox.active.size).toBe(1);expect(Socket.sockets[0]!.sent).toHaveLength(1);
  provider.close();doc.destroy();server.destroy();
});

it('restores durable updates after reload and applies them to the fresh document', async () => {
  const outbox = new FakeOutbox(), server = createWhiteboardDocument(), firstDoc = createWhiteboardDocument();
  const first = new WhiteboardProvider(firstDoc, 'board-1', () => {}, options(outbox));
  await flush();
  sync(Socket.sockets[0]!, server); await flush();
  executeCommands(firstDoc, [{ type: 'create', object: { id: 'offline', kind: 'sticky', schemaVersion: 1, geometry: { x: 1, y: 2, width: 180, height: 140, rotation: 0 }, text: 'durable', style: {}, parentId: null, orderKey: '' } }], 'local');
  await flush(); first.close(); firstDoc.destroy(); Socket.sockets = [];
  const restored = createWhiteboardDocument(); const second = new WhiteboardProvider(restored, 'board-1', () => {}, options(outbox));await flush();
  sync(Socket.sockets[0]!, server); await flush();
  expect(restored.getMap('objects').has('offline')).toBe(true);
  const persisted = outbox.active.values().next().value;
  expect(persisted).toBeDefined();
  expect(JSON.parse(Socket.sockets[0]!.sent[0]!).updateId).toBe(persisted![0]!.updateId);
  second.close(); restored.destroy(); server.destroy();
});

it('survives 60 seconds and 100 offline edits, reports restart pending, then converges on reconnect',async()=>{
  const outbox=new FakeOutbox(),server=createWhiteboardDocument(),firstDoc=createWhiteboardDocument();let firstState:WhiteboardConnectionState|undefined;
  const first=new WhiteboardProvider(firstDoc,'board-1',value=>{firstState=value;},options(outbox));await flush();sync(Socket.sockets[0]!,server);await flush();
  Socket.sockets[0]!.onclose?.({code:1006});vi.advanceTimersByTime(60_000);
  for(let index=0;index<100;index++)executeCommands(firstDoc,[{type:'create',object:{id:`offline-${index}`,kind:'sticky',schemaVersion:1,geometry:{x:index,y:index,width:180,height:140,rotation:0},text:`edit ${index}`,style:{},parentId:null,orderKey:String(index)}}],'local');
  expect(firstState?.pending).toBe(100);for(let index=0;index<700;index++)await Promise.resolve();expect(outbox.active.values().next().value).toHaveLength(100);
  first.close();firstDoc.destroy();Socket.sockets=[];
  const restarted=createWhiteboardDocument();let restartedState:WhiteboardConnectionState|undefined;const second=new WhiteboardProvider(restarted,'board-1',value=>{restartedState=value;},options(outbox));
  await flush();expect(restartedState).toMatchObject({phase:'offline',pending:100});
  sync(Socket.sockets[0]!,server);await flush();expect(restarted.getMap('objects').size).toBe(100);expect(Socket.sockets[0]!.sent).toHaveLength(100);
  for(const encoded of Socket.sockets[0]!.sent){const message=JSON.parse(encoded) as PendingWhiteboardUpdate;Y.applyUpdate(server,Uint8Array.from(atob(message.update),character=>character.charCodeAt(0)));Socket.sockets[0]!.message({type:'ack',updateId:message.updateId,seq:1});}
  for(let index=0;index<700;index++)await Promise.resolve();expect(server.getMap('objects').size).toBe(100);expect(restartedState?.pending).toBe(0);expect(outbox.active.size).toBe(0);
  second.close();restarted.destroy();server.destroy();
});

it('never crosses principal, session, or epoch boundaries and quarantines stale epochs', async () => {
  const outbox = new FakeOutbox();
  const update = { type: 'update', epoch: 1, updateId: crypto.randomUUID(), update: bytesToBase64(new Uint8Array([1, 2, 3])) } as const;
  await outbox.put({ boardId: 'board-1', principalId: 'other-user', sessionId: 'session-1', epoch: 2, accessReceiptId:ACCESS_RECEIPT }, { ...update, epoch: 2 });
  await outbox.put({ boardId: 'board-1', principalId: 'user-1', sessionId: 'other-session', epoch: 2, accessReceiptId:ACCESS_RECEIPT }, { ...update, epoch: 2, updateId: crypto.randomUUID() });
  await outbox.put({ boardId: 'board-1', principalId: 'user-1', sessionId: 'session-1', epoch: 1, accessReceiptId:ACCESS_RECEIPT }, update);
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(); const provider = new WhiteboardProvider(doc, 'board-1', () => {}, options(outbox));await flush();
  sync(Socket.sockets[0]!, server, { epoch: 2 }); await flush();
  expect(outbox.receipts).toHaveLength(1); expect(outbox.receipts[0]).toMatchObject({ principalId: 'user-1', sessionId: 'session-1', epoch: 1 });
  expect(Socket.sockets[0]!.sent).toHaveLength(0);
  expect(outbox.active.size).toBe(2);
  provider.close(); doc.destroy(); server.destroy();
});

it('permission rejection quarantines pending updates and keeps only an inaccessible receipt', async () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(), outbox = new FakeOutbox(); let state: WhiteboardConnectionState | undefined;
  const provider = new WhiteboardProvider(doc, 'board-1', value => { state = value; }, options(outbox));
  await flush();
  sync(Socket.sockets[0]!, server); await flush();
  executeCommands(doc, [{ type: 'create', object: { id: 'private', kind: 'sticky', schemaVersion: 1, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: 'secret', style: {}, parentId: null, orderKey: '' } }], 'local');
  await flush(); Socket.sockets[0]!.message({ type: 'error', code: 'ACCESS_DENIED' }); await flush();
  expect(state).toMatchObject({ phase: 'blocked', quarantined: 1 }); expect(doc.getMap('objects').size).toBe(0);
  expect(outbox.active.size).toBe(0); expect(outbox.receipts[0]).toMatchObject({ reason: 'ACCESS_DENIED', pendingCount: 1 });
  vi.advanceTimersByTime(60000); expect(Socket.sockets).toHaveLength(1); doc.destroy(); server.destroy();
});

it('deletes the decrypt path when logout unmounts the provider before the session timer fires', async () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(), outbox = new FakeOutbox();
  const provider = new WhiteboardProvider(doc, 'board-1', () => {}, options(outbox));
  await flush();
  sync(Socket.sockets[0]!, server); await flush();
  executeCommands(doc, [{ type: 'create', object: { id: 'logout', kind: 'sticky', schemaVersion: 1, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: 'private', style: {}, parentId: null, orderKey: '' } }], 'local');
  await flush();
  const otherBoardScope = { boardId: 'board-2', principalId: 'user-1', sessionId: 'session-1', epoch: 3, accessReceiptId:ACCESS_RECEIPT };
  await outbox.put(otherBoardScope, { type: 'update', epoch: 3, updateId: crypto.randomUUID(), update: 'AA==' });
  token = '';
  provider.close(); await flush();
  expect(outbox.active.size).toBe(0); expect(outbox.receipts).toHaveLength(2);
  expect(outbox.receipts).toEqual(expect.arrayContaining([expect.objectContaining({ boardId: 'board-2', reason: 'SESSION_CHANGED', pendingCount: 1 })]));
  doc.destroy(); server.destroy();
});

it('enforces the durable queue limit without silently dropping an earlier update', async () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument(), outbox = new FakeOutbox(); outbox.max = 1; let state: WhiteboardConnectionState | undefined;
  new WhiteboardProvider(doc, 'board-1', value => { state = value; }, options(outbox)); await flush(); sync(Socket.sockets[0]!, server); await flush();
  for (const objectId of ['one', 'two']) executeCommands(doc, [{ type: 'create', object: { id: objectId, kind: 'sticky', schemaVersion: 1, geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 }, text: objectId, style: {}, parentId: null, orderKey: '' } }], 'local');
  await flush(); await flush();
  expect(state?.phase).toBe('blocked'); expect(outbox.receipts[0]?.pendingCount).toBe(1);
  doc.destroy(); server.destroy();
});

it('throttles awareness and sends the latest world cursor without client identity', async () => {
  const doc = createWhiteboardDocument(), server = createWhiteboardDocument();
  const provider = new WhiteboardProvider(doc, 'board-1', () => {}, options(new FakeOutbox()));
  await flush();const socket = Socket.sockets[0]!;
  sync(socket, server, { role: 'editor' }); await flush();
  provider.awareness({ x: 10, y: 20 }, ['a']); provider.awareness({ x: 30, y: 40 }, ['b']);
  expect(socket.sent).toHaveLength(0); vi.advanceTimersByTime(50);
  expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'awareness', cursor: { x: 30, y: 40 }, selected: ['b'] });
  provider.close(); doc.destroy(); server.destroy();
});
