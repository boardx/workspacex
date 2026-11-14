import { afterEach, expect, it, vi } from 'vitest';
import { whiteboard as C } from '@repo/contracts';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { encodeStateAsUpdate } from 'yjs';
import { WhiteboardShareController } from '../../src/interface/controllers/whiteboard-share.controller';
import { toOrgId } from '../../src/domain/org-id';

const owner = { userId: 'owner', orgId: toOrgId('org-a') };
const boardId = '04d7d8aa-065f-456a-8d88-9780f388ec92';

afterEach(() => vi.useRealTimers());

function setup() {
  const doc = createWhiteboardDocument();
  const update = encodeStateAsUpdate(doc);
  doc.destroy();
  const get = vi.fn().mockResolvedValue({ name: 'Shared board', role: 'owner', archived: false });
  const load = vi.fn().mockResolvedValue({ role: 'owner', archived: false, update });
  const controller = new WhiteboardShareController({ get } as never, { load } as never, {} as never);
  return { controller, get, load };
}

it('allows anonymous reads before expiry and rejects expired or modified tokens before reading the board', async () => {
  vi.useFakeTimers();
  const now = Date.now();
  const { controller, load } = setup();
  const { token, expiresAt } = await controller.create(owner, boardId);
  expect(Date.parse(expiresAt)).toBe(now + C.BOARD_SHARE_TTL_MS);
  await expect(controller.read(token)).resolves.toEqual({ title: 'Shared board', expiresAt, objects: [] });
  expect(load).toHaveBeenCalledWith(owner, boardId);

  load.mockClear();
  await expect(controller.read(token + 'x')).rejects.toMatchObject({ status: 404 });
  vi.setSystemTime(now + C.BOARD_SHARE_TTL_MS);
  await expect(controller.read(token)).rejects.toMatchObject({ status: 404 });
  expect(load).not.toHaveBeenCalled();
});

it('requires an active board owner to issue a share and checks ownership again on use', async () => {
  const { controller, get, load } = setup();
  get.mockResolvedValueOnce({ role: 'editor', archived: false });
  await expect(controller.create(owner, boardId)).rejects.toMatchObject({ status: 404 });
  const { token } = await controller.create(owner, boardId);
  get.mockResolvedValueOnce({ role: 'owner', archived: true });
  await expect(controller.read(token)).rejects.toMatchObject({ status: 404 });
  expect(load).not.toHaveBeenCalled();
});
