import { WhiteboardAIProposal, WhiteboardUndoReceipt } from '@repo/contracts/whiteboard-operation';
import type { WhiteboardProposalRepository } from '../../application/whiteboard/proposal-ports';
import type { TenantSession } from '../../application/ports/database.port';
import type { Principal } from '../../domain/principal';
import type { ObjectStore } from '../../application/artifact/ports';
import { ProposalBodyStorage, ProposalBodyStorageError, type ProposalBodyRef } from './proposal-body-storage';

type Row={owner_user_id:string;actor_id:string;request_hash:string;status:string;payload:unknown;object_key:string|null;content_hash:string|null;byte_size:string|number|null};
/** Call only after the service's fresh Board ACL + Board row lock, in the same transaction. */
export class PgWhiteboardProposalRepository implements WhiteboardProposalRepository {
  private readonly bodies:ProposalBodyStorage;
  constructor(objects:Pick<ObjectStore,'putOnce'|'get'|'head'>){this.bodies=new ProposalBodyStorage(objects);}
  private async pin(session:TenantSession,p:Principal,boardId:string,ref:ProposalBodyRef){
    // Existing active asset roots and their purge fence protect these immutable
    // files without replacing the shared GC roots function. Keep prior receipts
    // rooted; retention must never release a live proposal or undo reference.
    await session.query(`INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at) VALUES($1,$2,$3,$4,$5,'active',now()) ON CONFLICT(org_id,board_id,object_key) DO UPDATE SET state='active',released_at=NULL,activated_at=now()`,[p.orgId,boardId,ref.key,ref.hash,ref.bytes]);
  }
  private async publish(session:TenantSession,p:Principal,value:WhiteboardAIProposal){
    const ref=await this.bodies.write(p,value);await this.pin(session,p,value.boardId,ref);
    await session.query(`UPDATE whiteboard_ai_proposals SET payload='{}'::jsonb,object_key=$4,content_hash=$5,byte_size=$6,status=$7,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND proposal_id=$3`,[p.orgId,value.boardId,value.proposalId,ref.key,ref.hash,ref.bytes,value.status]);
  }
  async create(session:TenantSession,p:Principal,proposal:WhiteboardAIProposal,requestHash:string){
    const existing=await this.lock(session,p,proposal.boardId,proposal.proposalId);
    if(existing){if(existing.ownerUserId!==p.userId||existing.requestHash!==requestHash)throw new Error('BOARD_AI_PROPOSAL_IDEMPOTENCY_CONFLICT');return existing.proposal;}
    const value=WhiteboardAIProposal.parse(proposal),ref=await this.bodies.write(p,value);await this.pin(session,p,value.boardId,ref);
    await session.query(`INSERT INTO whiteboard_ai_proposals(org_id,board_id,proposal_id,owner_user_id,actor_id,request_hash,status,payload,expires_at,object_key,content_hash,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,$8,$9,$10,$11)`,[p.orgId,value.boardId,value.proposalId,p.userId,value.createdBy.actorId,requestHash,value.status,value.expiresAt,ref.key,ref.hash,ref.bytes]);
    return value;
  }
  async lock(session:TenantSession,p:Principal,boardId:string,proposalId:string){
    const found=(await session.query<Row>(`SELECT owner_user_id,actor_id,request_hash,status,payload,object_key,content_hash,byte_size FROM whiteboard_ai_proposals WHERE org_id=$1 AND board_id=$2 AND proposal_id=$3 FOR UPDATE`,[p.orgId,boardId,proposalId])).rows[0];
    if(!found)return null;
    let proposal:WhiteboardAIProposal;
    if(found.object_key===null){
      // Legacy migration never clears PG until immutable readback + root publication
      // succeed. Transaction rollback retains the original payload on any failure.
      proposal=WhiteboardAIProposal.parse(found.payload);
      if(proposal.boardId!==boardId||proposal.proposalId!==proposalId||proposal.createdBy.orgId!==p.orgId||proposal.createdBy.actorId!==found.actor_id||proposal.status!==found.status)throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');
      await this.publish(session,p,proposal);
    }else{
      if(JSON.stringify(found.payload)!=='{}'||found.content_hash===null||found.byte_size===null)throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');
      proposal=await this.bodies.read(p,boardId,proposalId,{key:found.object_key,hash:found.content_hash,bytes:Number(found.byte_size)});
      if(proposal.createdBy.actorId!==found.actor_id)throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');
      proposal=WhiteboardAIProposal.parse({...proposal,status:found.status});
    }
    return{proposal,ownerUserId:found.owner_user_id,requestHash:found.request_hash};
  }
  async setStatus(session:TenantSession,p:Principal,boardId:string,proposalId:string,status:'cancelled'|'confirmed'|'stale'){
    if(!await this.lock(session,p,boardId,proposalId))throw new Error('BOARD_AI_PROPOSAL_NOT_FOUND');
    await session.query(`UPDATE whiteboard_ai_proposals SET status=$4,updated_at=now() WHERE org_id=$1 AND board_id=$2 AND proposal_id=$3`,[p.orgId,boardId,proposalId,status]);
  }
  async setConfirmation(session:TenantSession,p:Principal,boardId:string,proposalId:string,undoReceipt:WhiteboardUndoReceipt){
    const stored=await this.lock(session,p,boardId,proposalId);if(!stored)throw new Error('BOARD_AI_PROPOSAL_NOT_FOUND');
    const undo=WhiteboardUndoReceipt.parse(undoReceipt);
    if(undo.boardId!==boardId)throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');
    await this.publish(session,p,WhiteboardAIProposal.parse({...stored.proposal,status:'confirmed',undoReceipt:undo}));
  }
}
