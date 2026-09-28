import { createHash } from 'node:crypto';
import { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import { WHITEBOARD_COLLABORATION_LIMITS } from '@repo/contracts/whiteboard-collaboration';
import { ObjectExistsError, type ObjectStore } from '../../application/artifact/ports';
import type { Principal } from '../../domain/principal';

export interface ProposalBodyRef { key:string; hash:string; bytes:number; }
export class ProposalBodyStorageError extends Error {
  constructor(readonly code:'PROPOSAL_BODY_UNAVAILABLE'|'PROPOSAL_BODY_INTEGRITY_FAILED'){super(code);}
}
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const proposalBodyPrefix=(p:Principal,boardId:string)=>`whiteboards/tenants/${digest(p.orgId).slice(0,32)}/boards/${boardId}/proposal-bodies/`;
export class ProposalBodyStorage {
  constructor(private readonly objects:Pick<ObjectStore,'putOnce'|'get'|'head'>){}
  async write(p:Principal,value:WhiteboardAIProposal):Promise<ProposalBodyRef>{
    const proposal=WhiteboardAIProposal.parse(value);
    if(proposal.createdBy.orgId!==p.orgId||proposal.undoReceipt&&proposal.undoReceipt.boardId!==proposal.boardId)throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');
    const bytes=Buffer.from(JSON.stringify(proposal));
    if(bytes.length>WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes)throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');
    const hash=digest(bytes),ref={key:`${proposalBodyPrefix(p,proposal.boardId)}${hash}.json`,hash,bytes:bytes.length};
    try{await this.objects.putOnce(ref.key,bytes,'application/json');}catch(error){if(!(error instanceof ObjectExistsError))throw new ProposalBodyStorageError('PROPOSAL_BODY_UNAVAILABLE');}
    await this.read(p,proposal.boardId,proposal.proposalId,ref);return ref;
  }
  async read(p:Principal,boardId:string,proposalId:string,ref:ProposalBodyRef):Promise<WhiteboardAIProposal>{
    const fail=():never=>{throw new ProposalBodyStorageError('PROPOSAL_BODY_INTEGRITY_FAILED');};
    if(!/^[a-f0-9]{64}$/.test(ref.hash)||ref.key!==`${proposalBodyPrefix(p,boardId)}${ref.hash}.json`||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes)fail();
    let bytes:Uint8Array|null,head:Awaited<ReturnType<ObjectStore['head']>>;
    try{[bytes,head]=await Promise.all([this.objects.get(ref.key),this.objects.head(ref.key)]);}catch{throw new ProposalBodyStorageError('PROPOSAL_BODY_UNAVAILABLE');}
    if(!bytes||!head||bytes.byteLength!==ref.bytes||head.sizeBytes!==ref.bytes||head.mime!=='application/json'||digest(bytes)!==ref.hash)fail();
    try{
      const value=WhiteboardAIProposal.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes!)));
      if(value.boardId!==boardId||value.proposalId!==proposalId||value.createdBy.orgId!==p.orgId||value.undoReceipt&&value.undoReceipt.boardId!==boardId)fail();
      return value;
    }catch{ return fail(); }
  }
}
