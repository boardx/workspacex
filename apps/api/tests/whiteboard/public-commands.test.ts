import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import * as C from '@repo/contracts/whiteboard-public';
import { applyWhiteboardCommands, readWhiteboardDocument } from '../../src/application/whiteboard/public-commands';
import type { WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { toOrgId } from '../../src/domain/org-id';
const p = { orgId: toOrgId('wb-public-test'), userId: 'user' }, boardId = randomUUID();
const input = () => C.PublicWhiteboardCommands.parse({ epoch: 1, requestId: randomUUID(), commands: [{ type: 'delete', id: 'note' }] });
it('returns an exact authorized document projection without raw update or session metadata', async () => {
  const update = new Uint8Array([0, 0]), load = vi.fn(async () => ({ epoch: 1, seq: 7, role: 'viewer', archived: false, update, token: 'not-public' }));
  const objects = vi.fn(async () => []);
  const result = await readWhiteboardDocument({ boards: { load } as unknown as WhiteboardCollaborationStore, projection: { objects } }, p, boardId);
  expect(load).toHaveBeenCalledWith(p, boardId); expect(objects).toHaveBeenCalledWith(update);
  expect(result).toEqual({ boardId, epoch: 1, seq: 7, role: 'viewer', archived: false, objects: [] });
});
it('does not claim durable before the store resolves and strips raw update from the ACK', async () => {
  const body = input(); let release!: () => void;
  const committed = new Promise<void>(resolve => { release = resolve; });
  const writeCommands = vi.fn(async () => { await committed; return { epoch: 1, seq: 8, updateId: body.requestId, replayed: false, update: new Uint8Array([1, 2, 3]) }; });
  let finished = false;
  const pending = applyWhiteboardCommands({ boards: { writeCommands } as unknown as WhiteboardCollaborationStore }, p, boardId, body).then(value => { finished = true; return value; });
  await Promise.resolve(); expect(finished).toBe(false); release();
  expect(await pending).toEqual({ boardId, epoch: 1, seq: 8, requestId: body.requestId, replayed: false, durable: true });
});
it('propagates failed persistence rather than returning a durable result', async () => {
  const boards = { writeCommands: async () => { throw new Error('commit failed'); } } as unknown as WhiteboardCollaborationStore;
  await expect(applyWhiteboardCommands({ boards }, p, boardId, input())).rejects.toThrow('commit failed');
});
it('rejects extra fields and absent principal before calling persistence', async () => {
  const writeCommands = vi.fn(), boards = { writeCommands } as unknown as WhiteboardCollaborationStore;
  await expect(applyWhiteboardCommands({ boards }, p, boardId, { ...input(), actorId: 'forged' } as C.PublicWhiteboardCommands)).rejects.toThrow();
  await expect(applyWhiteboardCommands({ boards }, undefined as never, boardId, input())).rejects.toThrow('principal is empty');
  expect(writeCommands).not.toHaveBeenCalled();
});
