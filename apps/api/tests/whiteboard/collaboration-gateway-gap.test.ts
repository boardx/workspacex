import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import * as Y from 'yjs';
import { WHITEBOARD_SYNC, WhiteboardClientMessage, WhiteboardServerMessage, type WhiteboardServerMessage as ServerMessage } from '@repo/contracts/whiteboard-sync';
import { createWhiteboardDocument, executeCommands, readObjects } from '@repo/whiteboard-core';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
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
      return { epoch: 1, seq, updateId: input.updateId, replayed: false, update: input.update };
    },
    writeCommands: async () => { throw new Error('unused'); }, writeCommandsInTransaction: async () => { throw new Error('unused'); },
  };
  const boards: WhiteboardRepository = {
    get: async () => ({ id: boardId, name: 'gap', ownerId: principal.userId, role: 'owner', archived: false, tagIds: [], tagsRevision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
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
  const vector = Y.encodeStateVector(client), updateId = randomUUID();
  executeCommands(client, [{ type: 'create', object: object('local-seq-3') }], null);
  ws.send(JSON.stringify({ type: 'update', epoch: 1, updateId, update: Buffer.from(Y.encodeStateAsUpdate(client, vector)).toString('base64') }));
  await expect.poll(() => messages.find(message => message.type === 'ack' && message.updateId === updateId)).toBeTruthy();
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
    get: async () => ({ id: boardId, name: 'frame', ownerId: principal.userId, role: 'owner', archived: false, tagIds: [], tagsRevision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
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
