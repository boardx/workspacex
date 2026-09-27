import type { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../ports/database.port';
export interface WhiteboardProposalRepository {
  create(session:TenantSession,principal:Principal,proposal:WhiteboardAIProposal,requestHash:string):Promise<WhiteboardAIProposal>;
  lock(session:TenantSession,principal:Principal,boardId:string,proposalId:string):Promise<{proposal:WhiteboardAIProposal;ownerUserId:string;requestHash:string}|null>;
  setStatus(session:TenantSession,principal:Principal,boardId:string,proposalId:string,status:'cancelled'|'confirmed'|'stale'):Promise<void>;
}
