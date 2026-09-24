import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WorkshopConflict, type WhiteboardWorkshop } from '../../src/application/whiteboard/workshop-ports';
import { toOrgId } from '../../src/domain/org-id';
import { WhiteboardWorkshopController } from '../../src/interface/controllers/whiteboard-workshop.controller';

describe('whiteboard workshop controller errors', () => {
  it('returns a stable reason code without exposing the thrown message', async () => {
    const rawMessage = 'VOTE_QUOTA_EXCEEDED';
    const workshop = {
      comments: async () => { throw new WorkshopConflict(rawMessage); },
    } as unknown as WhiteboardWorkshop;
    const controller = new WhiteboardWorkshopController(workshop);

    let caught: unknown;
    try {
      await controller.comments(
        { orgId: toOrgId('workshop-controller'), userId: 'member' },
        '123e4567-e89b-42d3-a456-426614174000',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    const response = (caught as ConflictException).getResponse();
    expect(response).toEqual({
      reasonCode: 'VOTE_QUOTA_EXCEEDED',
      message: 'Workshop action conflicts with the current state.',
    });
    expect(JSON.stringify(response)).not.toContain(`"message":"${rawMessage}"`);
  });
});
