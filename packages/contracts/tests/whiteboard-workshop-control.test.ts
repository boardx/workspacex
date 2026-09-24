import { describe, expect, it } from 'vitest';
import {
  HideWorkshopPhases,
  SetWorkshopFreeze,
  WorkshopControlState,
  RevealWorkshopPhases,
} from '../src/whiteboard-workshop-control';

describe('whiteboard workshop control contract', () => {
  it('accepts bounded freeze, hide and reveal commands', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(SetWorkshopFreeze.parse({ requestId, frozen: true })).toEqual({ requestId, frozen: true });
    expect(HideWorkshopPhases.parse({ requestId, phaseIds: ['discover', 'decide'] })).toEqual({ requestId, phaseIds: ['discover', 'decide'] });
    expect(RevealWorkshopPhases.parse({ requestId })).toEqual({ requestId });
  });

  it('rejects duplicate, empty, unbounded and unknown phase input', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    expect(HideWorkshopPhases.safeParse({ requestId, phaseIds: [] }).success).toBe(false);
    expect(HideWorkshopPhases.safeParse({ requestId, phaseIds: ['same', 'same'] }).success).toBe(false);
    expect(HideWorkshopPhases.safeParse({ requestId, phaseIds: ['../secret'] }).success).toBe(false);
    expect(SetWorkshopFreeze.safeParse({ requestId, frozen: true, boardId: 'leak' }).success).toBe(false);
  });

  it('keeps the reconnect state strict and revisioned', () => {
    expect(WorkshopControlState.parse({
      frozen: true,
      hiddenPhaseIds: ['discover'],
      revision: 2,
      updatedBy: 'facilitator-1',
      updatedAt: '2026-09-24T00:00:00.000Z',
    })).toMatchObject({ frozen: true, hiddenPhaseIds: ['discover'], revision: 2 });
    expect(WorkshopControlState.safeParse({ frozen: false, hiddenPhaseIds: [], revision: 0, updatedBy: null, updatedAt: null, secret: true }).success).toBe(false);
  });
});
