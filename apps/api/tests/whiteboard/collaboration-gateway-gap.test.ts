import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardClientMessage, WhiteboardServerMessage, type WhiteboardServerMessage as ServerMessage } from '@repo/contracts/whiteboard-sync';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import { WhiteboardCollaborationError, type WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import { toOrgId } from '../../src/domain/org-id';
import { attachWhiteboardGateway } from '../../src/interface/ws/whiteboard.gateway';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
const object = (id: string) => ({ id, kind: 'sticky' as const, schemaVersion: 1 as const, text: id, style: {}, parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 } });

it('fills an external seq gap before broadcasting the later local commit', async () => {
  const boardId = randomUUID(), principal = { orgId: toOrgId('gateway-gap-test'), userId: 'owner' }, authority = createWhiteboardDocument();
  executeCommands(authority, [{ type: 'create', object: object('seq-1') }], null);
  let seq = 1, appended = false, gapLoads = 0;
  const store: WhiteboardCollaborationStore = {
    head: async () => ({ epoch: 1, seq, role: 'owner', archived: false }),
    load: async (_principal, _board, vector) => {
      if (appended && vector) gapLoads++;
      return { epoch: 1, seq, role: 'owner', archived: false, update: Y.encodeStateAsUpdate(authority, vector) };
    },
    append: async (_principal, _board, input) => {
      executeCommands(authority, [{ type: 'create', object: object('external-seq-2') }], null); seq = 2;
      Y.applyUpdate(authority, input.update); seq = 3; appended = true;
      return { epoch: 1, seq, updateId: input.updateId, gestureId:input.gestureId, replayed: false, update: input.update };
    },
    writeCommands: async () => { throw new Error('unused'); }, writeCommandsInTransaction: async () => { throw new Error('unused'); },
  };
  const boards: WhiteboardRepository = {
    mentionableMembers: async () => [],
    get: async () => ({ id: boardId, name: 'gap', ownerId: principal.userId, role: 'owner', archived: false, lifecycleRevision: 0, tagIds: [], tagsRevision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    list: async () => ({items:[],nextCursor:null}), create: async () => { throw new Error('unused'); }, update: async () => null, permanentlyDelete: async () => null,
    members: async () => null, putMember: async () => false, removeMember: async () => false,
  };
  const server = createServer(); servers.push(server);
  attachWhiteboardGateway(server, { store, boards, principals: { resolve: async () => principal } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`, [WHITEBOARD_SYNC.protocol, `${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
  const messages: ServerMessage[] = [];
  ws.on('message', (raw: RawData) => messages.push(WhiteboardServerMessage.parse(JSON.parse(raw.toString()))));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const client = createWhiteboardDocument();
  ws.send(JSON.stringify({ type: 'hello', stateVector: Buffer.from(Y.encodeStateVector(client)).toString('base64') }));
  await expect.poll(() => messages.find(message => message.type === 'sync')).toBeTruthy();
  const sync = messages.find(message => message.type === 'sync')!; if (sync.type !== 'sync') throw new Error('sync missing');
  Y.applyUpdate(client, Buffer.from(sync.update, 'base64'));
  const vector = Y.encodeStateVector(client), updateId = randomUUID(),gestureId=randomUUID();
  executeCommands(client, [{ type: 'create', object: object('local-seq-3') }], null);
  ws.send(JSON.stringify({ type: 'update', epoch: 1, updateId, gestureId, update: Buffer.from(Y.encodeStateAsUpdate(client, vector)).toString('base64') }));
  await expect.poll(() => messages.find(message => message.type === 'ack' && message.updateId === updateId && message.gestureId===gestureId)).toBeTruthy();
  const delivered = messages.find(message => message.type === 'update' && message.seq === 3); if (!delivered || delivered.type !== 'update') throw new Error('seq 3 missing');
  Y.applyUpdate(client, Buffer.from(delivered.update, 'base64'));
  expect(gapLoads).toBe(1);
  expect(readObjects(client).map(item => item.id).sort()).toEqual(['external-seq-2', 'local-seq-3', 'seq-1']);
  expect(messages.some(message => message.type === 'update' && message.seq === 2)).toBe(false);
  ws.close(); client.destroy(); authority.destroy();
});

it('rejects an oversized inbound frame in transport before JSON or Zod parsing', async () => {
  const boardId = randomUUID(), principal = { orgId: toOrgId('gateway-frame-test'), userId: 'owner' };
  const store = {
    head: async () => { throw new Error('unreachable'); }, load: async () => { throw new Error('unreachable'); },
    append: async () => { throw new Error('unreachable'); }, writeCommands: async () => { throw new Error('unreachable'); },
    writeCommandsInTransaction: async () => { throw new Error('unreachable'); },
  } as WhiteboardCollaborationStore;
  const boards: WhiteboardRepository = {
    mentionableMembers: async () => [],
    get: async () => ({ id: boardId, name: 'frame', ownerId: principal.userId, role: 'owner', archived: false, lifecycleRevision: 0, tagIds: [], tagsRevision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    list: async () => ({items:[],nextCursor:null}), create: async () => { throw new Error('unused'); }, update: async () => null, permanentlyDelete: async () => null,
    members: async () => null, putMember: async () => false, removeMember: async () => false,
  };
  const parse = vi.spyOn(WhiteboardClientMessage, 'parse'), server = createServer(); servers.push(server);
  attachWhiteboardGateway(server, { store, boards, principals: { resolve: async () => principal } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`, [WHITEBOARD_SYNC.protocol, `${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const closed = new Promise<number>(resolve => ws.once('close', resolve));
  ws.send('x'.repeat(WHITEBOARD_SYNC.inboundFrameBytes + 1));
  expect(await closed).toBe(1009); expect(parse).not.toHaveBeenCalled(); parse.mockRestore();
});

it('classifies resume safely and publishes bounded editing presence without persisting it', async () => {
  const boardId=randomUUID(),principal={orgId:toOrgId('gateway-resume-test'),userId:'grace'},doc=createWhiteboardDocument();
  let appendCalls=0;
  const store:WhiteboardCollaborationStore={head:async()=>({epoch:4,seq:8,role:'editor',archived:false}),load:async()=>({epoch:4,seq:8,role:'editor',archived:false,update:Y.encodeStateAsUpdate(doc)}),append:async()=>{appendCalls++;throw new Error('unused')},writeCommands:async()=>{throw new Error('unused')},writeCommandsInTransaction:async()=>{throw new Error('unused')}};
  const boards:WhiteboardRepository={mentionableMembers:async()=>[],get:async()=>({id:boardId,name:'resume',ownerId:'owner',role:'editor',archived:false,lifecycleRevision:0,tagIds:[],tagsRevision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),list:async()=>({items:[],nextCursor:null}),permanentlyDelete:async()=>null,create:async()=>{throw new Error('unused')},update:async()=>null,members:async()=>null,putMember:async()=>false,removeMember:async()=>false};
  const server=createServer();servers.push(server);attachWhiteboardGateway(server,{store,boards,principals:{resolve:async()=>principal},identities:{resolve:async()=>({displayName:'Grace',avatarUrl:'https://assets.example/grace.png',principalKind:'user'})}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const ws=new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`,[WHITEBOARD_SYNC.protocol,`${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
  const messages:ServerMessage[]=[];ws.on('message',(raw:RawData)=>messages.push(WhiteboardServerMessage.parse(JSON.parse(raw.toString()))));await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  ws.send(JSON.stringify({type:'hello',stateVector:Buffer.from(Y.encodeStateVector(doc)).toString('base64'),resume:{epoch:3,seq:99}}));
  await expect.poll(()=>messages.find(message=>message.type==='recovery')).toMatchObject({type:'recovery',code:'STALE_EPOCH',disposition:'reload-required',epoch:4,seq:8});
  ws.send(JSON.stringify({type:'awareness',cursor:{x:12,y:24},selected:['note'],editingObjectId:'note',viewport:{centerX:10,centerY:20,zoom:2,revision:2},presenting:true,followingActorId:null}));
  await expect.poll(()=>messages.filter(message=>message.type==='presence').at(-1)).toMatchObject({type:'presence',peers:[{actorId:'grace',displayName:'Grace',avatarUrl:'https://assets.example/grace.png',principalKind:'user',cursor:{x:12,y:24},selected:['note'],editingObjectId:'note',viewport:{revision:2},presenting:true}]});
  ws.send(JSON.stringify({type:'awareness',cursor:{x:13,y:25},selected:['note'],viewport:{centerX:999,centerY:999,zoom:8,revision:1},presenting:false,followingActorId:'stale-target'}));
  await expect.poll(()=>messages.filter(message=>message.type==='presence').at(-1)).toMatchObject({type:'presence',peers:[{cursor:{x:13,y:25},viewport:{centerX:10,centerY:20,zoom:2,revision:2},presenting:true,followingActorId:null}]});
  expect(appendCalls).toBe(0);ws.close();doc.destroy();
});


it.each([
  ['NOT_FOUND', 'ACCESS_REVOKED', false],
  ['FORBIDDEN', 'FORBIDDEN', false],
  ['ARCHIVED', 'BOARD_ARCHIVED', false],
  ['DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE', true],
] as const)('classifies monitor failure %s without leaving revoked clients retrying', async (failure, code, recoverable) => {
  const boardId=randomUUID(), principal={orgId:toOrgId('gateway-monitor-test'),userId:'reader'}, doc=createWhiteboardDocument();
  const store:WhiteboardCollaborationStore={
    head:async()=>{throw failure==='DEPENDENCY_UNAVAILABLE'?new Error('store unavailable'):new WhiteboardCollaborationError(failure);},
    load:async()=>({epoch:1,seq:0,role:'viewer',archived:false,update:Y.encodeStateAsUpdate(doc)}),
    append:async()=>{throw new Error('unused');},writeCommands:async()=>{throw new Error('unused');},writeCommandsInTransaction:async()=>{throw new Error('unused');},
  };
  const boards:WhiteboardRepository={mentionableMembers:async()=>[],get:async()=>({id:boardId,name:'monitor',ownerId:'owner',role:'viewer',archived:false,lifecycleRevision:0,tagIds:[],tagsRevision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),list:async()=>({items:[],nextCursor:null}),permanentlyDelete:async()=>null,create:async()=>{throw new Error('unused');},update:async()=>null,members:async()=>null,putMember:async()=>false,removeMember:async()=>false};
  const server=createServer();servers.push(server);attachWhiteboardGateway(server,{store,boards,principals:{resolve:async()=>principal}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const ws=new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`,[WHITEBOARD_SYNC.protocol,`${WHITEBOARD_SYNC.bearerSubprotocolPrefix}token`]);
  const messages:ServerMessage[]=[];ws.on('message',(raw:RawData)=>messages.push(WhiteboardServerMessage.parse(JSON.parse(raw.toString()))));
  try {
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    ws.send(JSON.stringify({type:'hello',stateVector:Buffer.from(Y.encodeStateVector(doc)).toString('base64')}));
    await expect.poll(()=>messages.find(message=>message.type==='sync')).toBeTruthy();
    await expect.poll(()=>messages.find(message=>message.type==='error'),{timeout:2500}).toMatchObject({type:'error',code,recoverable});
  } finally { ws.close();doc.destroy(); }
});
