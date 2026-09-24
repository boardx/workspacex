import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { WHITEBOARD_SYNC, WhiteboardServerMessage, type WhiteboardClientMessage } from '@repo/contracts/whiteboard-sync';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgWhiteboardRepository } from '../../src/infrastructure/whiteboard/pg-whiteboard-repository';
import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { attachWhiteboardGateway } from '../../src/interface/ws/whiteboard.gateway';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

type Message = ReturnType<typeof WhiteboardServerMessage.parse>;
const orgId = toOrgId('wb-ws-collaboration-a'), otherOrg = toOrgId('wb-ws-collaboration-b');
const owner: Principal = { orgId, userId: 'wb-ws-owner' };
const editor: Principal = { orgId, userId: 'wb-ws-editor' };
const viewer: Principal = { orgId, userId: 'wb-ws-viewer' };
const outsider: Principal = { orgId: otherOrg, userId: owner.userId };
// Resolver is the sole test seam: DB ACL, Yjs, workers, persistence and sockets are real.
// Session token verification is tested by the existing HTTP/session integration lane.
const identities = new Map([['owner-token', owner], ['editor-token', editor], ['viewer-token', viewer], ['outsider-token', outsider]]);
let db: PgDatabase, repo: PgWhiteboardRepository, store: PgWhiteboardCollaborationStore, server: Server, baseUrl: string,maintenanceCalls=0;
const sockets = new Set<WebSocket>();
const soakKeys=generateKeyPairSync('ed25519'),soakPrivateKey=soakKeys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64');
class Peer {
  initialSync:Extract<Message,{type:'sync'}>|null=null;
  readonly doc = createWhiteboardDocument();
  private readonly messages: Message[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly onMessage = (bytes: RawData) => {
    const message = WhiteboardServerMessage.parse(JSON.parse(bytes.toString()));
    if (message.type === 'sync' || message.type === 'update') Y.applyUpdate(this.doc, new Uint8Array(Buffer.from(message.update, 'base64')));
    this.messages.push(message); for (const listener of [...this.listeners]) listener();
  };
  constructor(readonly ws: WebSocket) {
    ws.on('message', this.onMessage);
    ws.on('error', () => undefined);
  }
  send(message: WhiteboardClientMessage) { this.ws.send(JSON.stringify(message)); }
  async wait(predicate: (message: Message) => boolean, timeoutMs = 10000): Promise<Message> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        const index = this.messages.findIndex(predicate);
        if (index === -1) return;
        const message = this.messages.splice(index, 1)[0]!;
        clearTimeout(timer); this.listeners.delete(check); resolve(message);
      };
      timer = setTimeout(() => { this.listeners.delete(check); reject(new Error('Expected whiteboard WS message did not arrive')); }, timeoutMs);
      this.listeners.add(check); check();
    });
  }
  async close(): Promise<void> {
    if (this.ws.readyState !== WebSocket.CLOSED) {
      const closed = closeEvent(this.ws);
      this.ws.close(); await closed;
    }
    this.ws.off('message', this.onMessage); this.doc.destroy(); sockets.delete(this.ws);
  }
}
function closeEvent(ws: WebSocket, timeoutMs = 5000): Promise<{ code: number; at: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('close', closed); reject(new Error('Expected socket close did not arrive')); }, timeoutMs);
    const closed = (code: number) => { clearTimeout(timer); resolve({ code, at: performance.now() }); };
    ws.once('close', closed);
  });
}
async function connect(boardId: string, token: string, soakRun?:{runId:string;exactSha:string;environmentFingerprint:string;purpose:'initial'|'fresh'|'server';requiredDurationMs:number;requiredOfflineMs:number;expectedClients:number;expectedWriters:number;expectedReconnects:number}): Promise<Peer> {
  const ws = new WebSocket(`${baseUrl}/whiteboards/${boardId}/sync`, [WHITEBOARD_SYNC.protocol, `${WHITEBOARD_SYNC.bearerSubprotocolPrefix}${token}`]);
  sockets.add(ws); const peer = new Peer(ws);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS open timed out')), 5000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const clientNonce = randomUUID();
  peer.send({ type: 'hello', stateVector: b64(Y.encodeStateVector(peer.doc)), clientNonce, ...(soakRun?{soakRun}:{}) });
  const sync = await peer.wait(message => message.type === 'sync');
  expect(sync).toMatchObject({ type: 'sync', clientNonce });
  if (sync.type !== 'sync') throw new Error('Expected initial whiteboard sync');
  peer.initialSync=sync;
  expect(sync.connectionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return peer;
}
async function rejectedUpgrade(boardId: string, token?: string): Promise<number> {
  const protocols = token ? [WHITEBOARD_SYNC.protocol, `${WHITEBOARD_SYNC.bearerSubprotocolPrefix}${token}`] : [WHITEBOARD_SYNC.protocol];
  const ws = new WebSocket(`${baseUrl}/whiteboards/${boardId}/sync`, protocols); sockets.add(ws);
  ws.on('error', () => undefined);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Expected handshake rejection')); }, 5000);
    ws.once('unexpected-response', (_request, response) => { clearTimeout(timer); response.resume(); ws.terminate(); sockets.delete(ws); resolve(response.statusCode!); });
    ws.once('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('Unauthorized handshake opened')); });
  });
}
async function seedBoard(): Promise<string> {
  const board = await repo.create(owner, { name: '真实协作', requestId: randomUUID() });
  await repo.putMember(owner, board.id, { userId: editor.userId, role: 'editor' });
  await repo.putMember(owner, board.id, { userId: viewer.userId, role: 'viewer' });
  await store.writeCommands(owner, board.id, { epoch: 1, requestId: randomUUID(), commands: [{ type: 'create', object: { id: 'note', schemaVersion: 1, kind: 'sticky', text: '开始', style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 200, height: 150, rotation: 0 } } }] });
  return board.id;
}
function appendText(peer: Peer, text: string): Uint8Array {
  const vector = Y.encodeStateVector(peer.doc);
  executeCommands(peer.doc, [{ type: 'text', id: 'note', index: 2, deleteCount: 0, insert: text }], {});
  return Y.encodeStateAsUpdate(peer.doc, vector);
}
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(orgId, otherOrg);
  await seedOrg({ orgId, projectId: 'wb-ws-project-a' }); await seedOrg({ orgId: otherOrg, projectId: 'wb-ws-project-b' });
  for (const principal of [owner, editor, viewer, outsider]) await addOrgMember(principal.orgId, principal.userId, 'consultant', null);
  db = new PgDatabase(appConfig()); repo = new PgWhiteboardRepository(db,{ensureScheduled:async()=>{maintenanceCalls++;}}); store = new PgWhiteboardCollaborationStore(db);
  server = createServer((_request, response) => { response.statusCode = 404; response.end(); });
  attachWhiteboardGateway(server, { boards: repo, store, soakLedgerPrivateKey:soakPrivateKey,principals: { resolve: async headers => identities.get(String(headers.authorization ?? '').replace(/^Bearer /, '')) ?? null } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const ws of sockets) ws.terminate(); sockets.clear();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db?.close(); await resetOrgs(orgId, otherOrg);
});
describe('real WebSocket whiteboard collaboration', () => {
  it('admits 50 concurrent hellos with the production five-connection pool',async()=>{
    const boardId=await seedBoard();
    const peers=await Promise.all(Array.from({length:50},()=>connect(boardId,'owner-token')));
    try{expect(peers).toHaveLength(50);expect(peers.every(peer=>peer.initialSync?.type==='sync')).toBe(true);expect(maintenanceCalls).toBe(1);}
    finally{await Promise.all(peers.map(peer=>peer.close()));}
  },20000);
  it('signs a server-owned soak ledger from real connection and committed operation evidence',async()=>{
    const boardId=await seedBoard(),runId=randomUUID(),peer=await connect(boardId,'owner-token',{runId,exactSha:'a'.repeat(40),environmentFingerprint:'b'.repeat(64),purpose:'initial',requiredDurationMs:1,requiredOfflineMs:1,expectedClients:1,expectedWriters:1,expectedReconnects:0});
    try{
      const binding=peer.initialSync?.soakBinding;expect(binding).toMatchObject({runId});
      await new Promise(resolve=>setTimeout(resolve,2));const id='soak-4144:api-ledger',vector=Y.encodeStateVector(peer.doc);executeCommands(peer.doc,[{type:'create',object:{id:'soak_api_ledger',schemaVersion:1,kind:'sticky',text:id,style:{},parentId:null,orderKey:'',geometry:{x:0,y:0,width:200,height:150,rotation:0}}}],{});const update=Y.encodeStateAsUpdate(peer.doc,vector),updateId=randomUUID();
      peer.send({type:'update',epoch:1,updateId,update:b64(update)});await peer.wait(message=>message.type==='ack'&&message.updateId===updateId);
      peer.send({type:'soak-finish',runId,challenge:binding!.challenge});const message=await peer.wait(item=>item.type==='soak-ledger');
      if(message.type!=='soak-ledger')throw new Error('Expected signed soak ledger');
      expect(message.payload.connections).toEqual(expect.arrayContaining([expect.objectContaining({connectionId:peer.initialSync!.connectionId,role:'owner',purpose:'initial'})]));
      expect(message.payload.operations).toEqual(expect.arrayContaining([expect.objectContaining({id,connectionId:peer.initialSync!.connectionId})]));
      expect(message.payload.finalHash).toBe(createHash('sha256').update(JSON.stringify(message.payload.finalDocument)).digest('hex'));expect(message.payload.finalDocument).toEqual(expect.arrayContaining([expect.objectContaining({text:id})]));expect(message.payload.finalSeq).toBeGreaterThanOrEqual(message.payload.operations[0]!.seq);expect(message.payload.finishedAtMs-message.payload.startedAtMs).toBeGreaterThanOrEqual(1);
      expect(verify(null,Buffer.from(JSON.stringify(message.payload)),soakKeys.publicKey,Buffer.from(message.signature,'base64'))).toBe(true);
      peer.send({type:'soak-finish',runId,challenge:binding!.challenge});expect(await peer.wait(item=>item.type==='error')).toMatchObject({type:'error',code:'VALIDATION_FAILED'});
    }finally{await peer.close();}
  });
  it('rejects ledger finalization by a non-owner even for an otherwise valid signed run',async()=>{
    const boardId=await seedBoard(),runId=randomUUID(),peer=await connect(boardId,'editor-token',{runId,exactSha:'a'.repeat(40),environmentFingerprint:'b'.repeat(64),purpose:'initial',requiredDurationMs:1,requiredOfflineMs:1,expectedClients:1,expectedWriters:1,expectedReconnects:0});
    try{const binding=peer.initialSync!.soakBinding!;await new Promise(resolve=>setTimeout(resolve,2));const vector=Y.encodeStateVector(peer.doc);executeCommands(peer.doc,[{type:'create',object:{id:'soak_non_owner',schemaVersion:1,kind:'sticky',text:'soak-4144:non-owner',style:{},parentId:null,orderKey:'',geometry:{x:0,y:0,width:200,height:150,rotation:0}}}],{});const updateId=randomUUID();peer.send({type:'update',epoch:1,updateId,update:b64(Y.encodeStateAsUpdate(peer.doc,vector))});await peer.wait(item=>item.type==='ack'&&item.updateId===updateId);peer.send({type:'soak-finish',runId,challenge:binding.challenge});expect(await peer.wait(item=>item.type==='error')).toMatchObject({type:'error',code:'VALIDATION_FAILED'});}finally{await peer.close();}
  });
  it('converges two concurrent Chinese edits, persists ACKs, reopens and deduplicates retry', async () => {
    const boardId = await seedBoard(), a = await connect(boardId, 'owner-token'), b = await connect(boardId, 'editor-token');
    try {
      // Both edits are generated before either is sent, genuinely concurrent against the same base.
      const aUpdate = appendText(a, '甲'), bUpdate = appendText(b, '乙'), aId = randomUUID(), bId = randomUUID();
      const aAck = a.wait(m => m.type === 'ack' && m.updateId === aId), bAck = b.wait(m => m.type === 'ack' && m.updateId === bId);
      a.send({ type: 'update', epoch: 1, updateId: aId, update: b64(aUpdate) });
      b.send({ type: 'update', epoch: 1, updateId: bId, update: b64(bUpdate) });
      const acknowledgements = await Promise.all([aAck, bAck]);
      expect(acknowledgements.map(m => m.type === 'ack' ? m.seq : -1).sort()).toEqual([2, 3]);
      await Promise.all([a.wait(m => m.type === 'update' && m.seq === 3), b.wait(m => m.type === 'update' && m.seq === 3)]);
      expect(readObjects(a.doc)).toEqual(readObjects(b.doc));
      expect(readObjects(a.doc)[0]?.text).toContain('甲'); expect(readObjects(a.doc)[0]?.text).toContain('乙');
      const fresh = new PgDatabase(appConfig());
      try {
        const state = await new PgWhiteboardCollaborationStore(fresh).load(owner, boardId), recovered = createWhiteboardDocument();
        Y.applyUpdate(recovered, state.update); expect(state.seq).toBe(3); expect(readObjects(recovered)).toEqual(readObjects(a.doc)); recovered.destroy();
      } finally { await fresh.close(); }
      const third = await connect(boardId, 'viewer-token');
      try { expect(readObjects(third.doc)).toEqual(readObjects(a.doc)); } finally { await third.close(); }
      const replay = a.wait(m => m.type === 'ack' && m.updateId === aId);
      a.send({ type: 'update', epoch: 1, updateId: aId, update: b64(aUpdate) }); await replay;
      expect((await store.load(owner, boardId)).seq).toBe(3);
    } finally { await a.close(); await b.close(); }
  });
  it('rejects viewer writes without advancing the durable sequence', async () => {
    const boardId = await seedBoard(), peer = await connect(boardId, 'viewer-token');
    const closed = closeEvent(peer.ws);
    peer.send({ type: 'update', epoch: 1, updateId: randomUUID(), update: b64(appendText(peer, '禁止')) });
    expect(await peer.wait(m => m.type === 'error')).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    expect((await closed).code).toBe(4403); expect((await store.load(owner, boardId)).seq).toBe(1); await peer.close();
  });
  it('closes an already connected editor within two seconds of committed revocation', async () => {
    const boardId = await seedBoard(), peer = await connect(boardId, 'editor-token'), closed = closeEvent(peer.ws);
    await repo.removeMember(owner, boardId, editor.userId); const revokedAt = performance.now();
    const result = await closed;
    expect(result.code).toBe(4403); expect(result.at - revokedAt).toBeLessThanOrEqual(2000);
    await peer.close();
  });
  it('rejects absent and invalid authentication and cross-tenant board access during upgrade', async () => {
    const boardId = await seedBoard();
    expect(await rejectedUpgrade(boardId)).toBe(401); expect(await rejectedUpgrade(boardId, 'invalid')).toBe(401);
    expect(await rejectedUpgrade(boardId, 'outsider-token')).toBe(404);
  });
  it('rejects over-limit updates before any durable write', async () => {
    const boardId = await seedBoard(), peer = await connect(boardId, 'owner-token'), closed = closeEvent(peer.ws);
    // Below transport envelope limit, above content-update byte limit.
    peer.send({ type: 'update', epoch: 1, updateId: randomUUID(), update: b64(new Uint8Array(65537)) });
    expect(await peer.wait(m => m.type === 'error')).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await closed).code).toBe(4403); expect((await store.load(owner, boardId)).seq).toBe(1); await peer.close();
  });
  it('enforces the WebSocket frame limit independently of JSON schema validation', async () => {
    const boardId = await seedBoard(), peer = await connect(boardId, 'owner-token'), closed = closeEvent(peer.ws);
    peer.ws.send('x'.repeat(100000)); expect((await closed).code).toBe(1009);
    expect((await store.load(owner, boardId)).seq).toBe(1); await peer.close();
  });
});
