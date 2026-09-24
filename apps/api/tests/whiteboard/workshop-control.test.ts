import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WorkshopControlError, type WorkshopControlRepository } from '../../src/application/whiteboard/workshop-control-ports';
import { getWorkshopControl, hideWorkshopPhases, revealWorkshopPhases, setWorkshopFreeze } from '../../src/application/whiteboard/workshop-control';
import type { Principal } from '../../src/domain/principal';
import { toOrgId } from '../../src/domain/org-id';
import type { whiteboardWorkshopControl as W } from '@repo/contracts';
import { WhiteboardWorkshopControlController } from '../../src/interface/controllers/whiteboard-workshop-control.controller';

const principal: Principal = { orgId: toOrgId('org-workshop-control'), userId: 'facilitator' };
const boardId = '11111111-1111-4111-8111-111111111111';
const initial: W.WorkshopControlState = { frozen: false, hiddenPhaseIds: [], revision: 0, updatedBy: null, updatedAt: null };

function fakeRepository(): WorkshopControlRepository & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(actor, id) { calls.push(`get:${actor.orgId}:${id}`); return initial; },
    async setFreeze(actor, id, input) { calls.push(`freeze:${actor.userId}:${id}:${input.frozen}`); return { ...initial, frozen: input.frozen, revision: 1, updatedBy: actor.userId, updatedAt: new Date(0).toISOString() }; },
    async hidePhases(actor, id, input) { calls.push(`hide:${actor.userId}:${id}:${input.phaseIds.join(',')}`); return { ...initial, hiddenPhaseIds: [...input.phaseIds], revision: 1, updatedBy: actor.userId, updatedAt: new Date(0).toISOString() }; },
    async revealPhases(actor, id) { calls.push(`reveal:${actor.userId}:${id}`); return { ...initial, revision: 1, updatedBy: actor.userId, updatedAt: new Date(0).toISOString() }; },
  };
}

describe('workshop control application boundary', () => {
  it('parses commands before delegating to the authoritative repository', async () => {
    const repo = fakeRepository(), requestId = randomUUID();
    await expect(getWorkshopControl(repo, principal, boardId)).resolves.toEqual(initial);
    await expect(setWorkshopFreeze(repo, principal, boardId, { requestId, frozen: true })).resolves.toMatchObject({ frozen: true, revision: 1 });
    await expect(hideWorkshopPhases(repo, principal, boardId, { requestId: randomUUID(), phaseIds: ['discover'] })).resolves.toMatchObject({ hiddenPhaseIds: ['discover'] });
    await expect(revealWorkshopPhases(repo, principal, boardId, { requestId: randomUUID() })).resolves.toMatchObject({ hiddenPhaseIds: [] });
    expect(repo.calls).toHaveLength(4);
  });

  it('rejects malformed ids and payloads without touching persistence', async () => {
    const repo = fakeRepository();
    await expect(setWorkshopFreeze(repo, principal, 'not-a-board', { requestId: randomUUID(), frozen: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(hideWorkshopPhases(repo, principal, boardId, { requestId: randomUUID(), phaseIds: [] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.calls).toEqual([]);
  });

  it('exposes a closed stable error vocabulary', () => {
    expect(['NOT_FOUND', 'FORBIDDEN', 'IDEMPOTENCY_CONFLICT', 'VALIDATION_FAILED']).toContain(new WorkshopControlError('FORBIDDEN').code);
  });

  it('maps denials to a stable response without board or phase details', async () => {
    const repo = fakeRepository();
    repo.setFreeze = async () => { throw new WorkshopControlError('FORBIDDEN'); };
    const controller = new WhiteboardWorkshopControlController(repo);
    try {
      await controller.freeze(principal, boardId, { requestId: randomUUID(), frozen: true });
      throw new Error('expected workshop control denial');
    } catch (error) {
      const response = error as { getStatus(): number; getResponse(): unknown };
      expect(response.getStatus()).toBe(403);
      expect(response.getResponse()).toEqual({ code: 'WORKSHOP_CONTROL_FORBIDDEN' });
      expect(JSON.stringify(response.getResponse())).not.toContain(boardId);
    }
  });
});
