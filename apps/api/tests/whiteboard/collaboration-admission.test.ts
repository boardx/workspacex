import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';
import { attachWhiteboardGateway } from '../../src/interface/ws/whiteboard.gateway';
import { toOrgId } from '../../src/domain/org-id';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { expect, it, vi } from 'vitest';
import { WhiteboardAdmission } from '../../src/interface/ws/whiteboard-admission';
const signal = () => new AbortController();
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it('admits a benign tenant while fifty noisy board sessions are queued', async () => {
  const gate = new WhiteboardAdmission(), blocked = deferred(), order: number[] = [];
  const noisy = Array.from({length: 50}, (_, index) => gate.run('noisy', async () => { order.push(index); if (!index) await blocked.promise; }, signal().signal));
  await gate.run('benign', async () => { expect(order).toEqual([0]); }, signal().signal);
  blocked.resolve(); await Promise.all(noisy); expect(order).toHaveLength(50);
});
it('removes disconnected queued work before database entry', async () => {
  const gate = new WhiteboardAdmission(), blocked = deferred(), controller = signal(), database = vi.fn();
  const first = gate.run('org', () => blocked.promise, signal().signal);
  const queued = gate.run('org', database, controller.signal);
  controller.abort(); await expect(queued).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
  blocked.resolve(); await first; await Promise.resolve(); expect(database).not.toHaveBeenCalled();
});
it('keeps the occupied slot until canceled running database work settles', async () => {
  const gate = new WhiteboardAdmission(), blocked = deferred(), controller = signal(), database = vi.fn(async () => undefined);
  const running = gate.run('org', () => blocked.promise, controller.signal);
  await Promise.resolve(); controller.abort(); await expect(running).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
  const next = gate.run('org', database, signal().signal);
  await Promise.resolve(); expect(database).not.toHaveBeenCalled(); blocked.resolve(); await next; expect(database).toHaveBeenCalledOnce();
});

it('bounds total concurrency at two across fifty distinct tenants', async () => {
  const gate = new WhiteboardAdmission(); let active = 0, maximum = 0, completed = 0;
  await Promise.all(Array.from({length:50}, (_, index) => gate.run(String(index), async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--; completed++;
  }, signal().signal)));
  expect(maximum).toBe(2); expect(completed).toBe(50);
});

it('syncs fifty distinct same-tenant WebSocket sessions and rechecks fresh revocation', async () => {
  const boardId = randomUUID(), orgId = toOrgId('admission-sessions'), doc = new Y.Doc();
  const state = {epoch:1,seq:0,role:'owner' as const,archived:false};
  let active = 0, maximum = 0, loads = 0, revoked = false;
  const database = async <T>(result: T): Promise<T> => {
    active++; maximum = Math.max(maximum, active);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return result; } finally { active--; }
  };
  const unused = async () => { throw new Error('unused port'); };
  const boards: WhiteboardRepository = {
    mentionableMembers: async () => [],
    get: async principal => database({id:boardId,name:'admission',ownerId:principal.userId,role:'owner' as const,archived:false,lifecycleRevision:0,tagIds:[],tagsRevision:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),
    list: unused, create: unused, update: unused, permanentlyDelete: unused, members: unused, putMember: unused, removeMember: unused,
  };
  const store: WhiteboardCollaborationStore = {
    head: async () => database(state),
    load: async () => { loads++; return database({...state,update:Y.encodeStateAsUpdate(doc)}); },
    loadInTransaction: unused, append: unused, writeCommands: unused, writeCommandsInTransaction: unused,
  };
  const server = createServer(), sockets: WebSocket[] = [], checks = new Map<string,number>();
  attachWhiteboardGateway(server, {boards,store,principals:{resolve:async ({authorization}) => {
    const userId = String(authorization).slice('Bearer '.length); checks.set(userId,(checks.get(userId)??0)+1);
    return database(revoked && userId==='session-0' ? null : {orgId,userId});
  }}});
  try {
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    const ready = Array.from({length:50}, (_, index) => new Promise<void>((resolve,reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/whiteboards/${boardId}/sync`,[WHITEBOARD_SYNC.protocol,`${WHITEBOARD_SYNC.bearerSubprotocolPrefix}session-${index}`]);
      sockets.push(socket);
      socket.once('error',reject);
      socket.once('open',() => socket.send(JSON.stringify({type:'hello',stateVector:Buffer.from(Y.encodeStateVector(doc)).toString('base64')})));
      socket.on('message',raw => { if(JSON.parse(raw.toString()).type==='sync') resolve(); });
      socket.once('close',() => reject(new Error('session closed before sync')));
    }));
    await Promise.all(ready);
    expect(loads).toBe(50); expect(maximum).toBeLessThanOrEqual(4); expect(checks.size).toBe(50);
    revoked = true;
    await expect.poll(() => sockets[0]!.readyState,{timeout:3000}).toBe(WebSocket.CLOSED);
    expect(checks.get('session-0')).toBeGreaterThan(1);
  } finally {
    for(const socket of sockets) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve())); doc.destroy();
  }
},10000);
