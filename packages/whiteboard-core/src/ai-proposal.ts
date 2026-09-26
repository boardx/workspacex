import {
  WhiteboardAIProposal,
  WhiteboardOperationProvenance,
  type WhiteboardAIProposal as Proposal,
  type WhiteboardOperationActor,
  type WhiteboardOperationReceipt,
} from '@repo/contracts/whiteboard-operation';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import { digestWhiteboardObject, type WhiteboardOperationKernel } from './operation-kernel';

export class WhiteboardAIProposalManager {
  private readonly proposals = new Map<string, Proposal>();
  constructor(private readonly kernel: WhiteboardOperationKernel, private readonly now: () => Date = () => new Date()) {}
  preview(input: {
    proposalId: string; boardId: string; actor: WhiteboardOperationActor;
    action: Proposal['action']; provenance: Proposal['provenance']; ttlMs?: number;
  }): Proposal {
    if (input.actor.kind !== 'ai' || !input.actor.scopes.includes('board:write')) throw new Error('BOARD_AI_PROPOSAL_FORBIDDEN');
    const prior = this.proposals.get(input.proposalId);
    if (prior) return structuredClone(prior);
    const referenced = new Set<string>();
    for (const command of input.action.commands) {
      if (command.type !== 'create') referenced.add(command.id);
      if ('objectIds' in input.action) input.action.objectIds.forEach(id => referenced.add(id));
    }
    const objects = this.kernel.objects().filter(object => referenced.has(object.id));
    if (objects.length !== referenced.size) throw new Error('BOARD_AI_PROPOSAL_OBJECT_NOT_FOUND');
    const createdAt = this.now(), expiresAt = new Date(createdAt.getTime() + Math.min(input.ttlMs ?? 300_000, 3_600_000));
    const proposal = WhiteboardAIProposal.parse({ proposalId: input.proposalId, boardId: input.boardId,
      createdBy: input.actor, baseRevision: this.kernel.revision(),
      baseObjectDigests: Object.fromEntries(objects.map(object => [object.id, digestWhiteboardObject(object)])),
      action: input.action, provenance: WhiteboardOperationProvenance.parse({ ...input.provenance, source: 'ai-proposal' }),
      status: 'preview', createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() });
    this.proposals.set(proposal.proposalId, structuredClone(proposal));
    return structuredClone(proposal); // Preview is deliberately a zero-write operation.
  }
  cancel(proposalId: string, actorId: string): Proposal {
    const proposal = this.required(proposalId);
    if (proposal.createdBy.actorId !== actorId) throw new Error('BOARD_AI_PROPOSAL_FORBIDDEN');
    if (proposal.status !== 'preview') throw new Error('BOARD_AI_PROPOSAL_FINAL');
    proposal.status = 'cancelled'; this.proposals.set(proposalId, proposal); return structuredClone(proposal);
  }
  confirm(proposalId: string, requestId: string, actorId: string): { proposal: Proposal; receipt: WhiteboardOperationReceipt } {
    const proposal = this.required(proposalId);
    if (proposal.createdBy.actorId !== actorId) throw new Error('BOARD_AI_PROPOSAL_FORBIDDEN');
    if (proposal.status !== 'preview') throw new Error('BOARD_AI_PROPOSAL_FINAL');
    if (Date.parse(proposal.expiresAt) <= this.now().getTime()) throw new Error('BOARD_AI_PROPOSAL_EXPIRED');
    const current = new Map(this.kernel.objects().map(object => [object.id, digestWhiteboardObject(object)]));
    for (const [objectId, digest] of Object.entries(proposal.baseObjectDigests)) if (current.get(objectId) !== digest) throw new Error('BOARD_AI_PROPOSAL_CONFLICT');
    const receipt = this.kernel.dispatch({ apiVersion: '2026-09-01', requestId, boardId: proposal.boardId,
      expectedRevision: proposal.baseRevision, actor: proposal.createdBy, commands: proposal.action.commands,
      provenance: proposal.provenance });
    proposal.status = 'confirmed'; this.proposals.set(proposalId, proposal);
    return { proposal: structuredClone(proposal), receipt };
  }
  private required(id: string): Proposal { const value = this.proposals.get(id); if (!value) throw new Error('BOARD_AI_PROPOSAL_NOT_FOUND'); return structuredClone(value); }
}

export function proposalCommands(proposal: Proposal): readonly WhiteboardCommand[] { return proposal.action.commands; }
