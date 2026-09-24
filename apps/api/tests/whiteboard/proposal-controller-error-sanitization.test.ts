import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProposalConflict, type ProposalConflictCode, type WhiteboardProposals } from '../../src/application/whiteboard/proposal-ports';
import { toOrgId } from '../../src/domain/org-id';
import type { Principal } from '../../src/domain/principal';
import { WhiteboardProposalController } from '../../src/interface/controllers/whiteboard-proposal.controller';

const principal: Principal = { orgId: toOrgId('proposal-errors-org'), userId: 'proposal-errors-user' };
const boardId = '123e4567-e89b-42d3-a456-426614174000';

describe('whiteboard proposal controller error boundary', () => {
  it('never returns an unknown repository message to the caller', async () => {
    const secret = 'database host and customer secret must not leave the server';
    const proposals = {
      list: vi.fn().mockRejectedValue(new ProposalConflict(secret as ProposalConflictCode)),
    } as unknown as WhiteboardProposals;
    const controller = new WhiteboardProposalController(proposals);
    let caught: unknown;
    try { await controller.list(principal, boardId); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ConflictException);
    const response = (caught as ConflictException).getResponse();
    expect(response).toEqual({ reasonCode: 'PROPOSAL_CONFLICT', message: 'Whiteboard proposal conflicts with the current state.' });
    expect(JSON.stringify(response)).not.toContain(secret);
  });
});
