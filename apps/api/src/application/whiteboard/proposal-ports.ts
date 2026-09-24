import type * as C from '@repo/contracts/whiteboard-proposal';
import type { Principal } from '../../domain/principal';
export const WHITEBOARD_PROPOSALS=Symbol('WhiteboardProposals');
export type ProposalConflictCode =
  | 'PROPOSAL_TOO_LARGE'
  | 'REQUEST_ID_REUSED'
  | 'PROPOSAL_LIMIT'
  | 'PROPOSAL_ALREADY_DECIDED'
  | 'PROPOSAL_CONFLICT';
export class ProposalConflict extends Error {
  constructor(readonly code: ProposalConflictCode) {
    super(code);
    this.name = 'ProposalConflict';
  }
}
export interface WhiteboardProposals {
  list(p:Principal,boardId:string):Promise<C.Proposal[]|null>;
  create(p:Principal,boardId:string,input:C.CreateProposal):Promise<C.Proposal|null>;
  decide(p:Principal,boardId:string,proposalId:string,action:'accept'|'reject',input:C.DecideProposal):Promise<C.Proposal|null>;
}
