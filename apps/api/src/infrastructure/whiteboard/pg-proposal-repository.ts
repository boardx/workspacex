import { createHash,randomUUID } from 'node:crypto';
import * as C from '@repo/contracts/whiteboard-proposal';
import type { Principal } from '../../domain/principal';
import type { DatabasePort,TenantSession } from '../../application/ports/database.port';
import { ProposalConflict,type WhiteboardProposals } from '../../application/whiteboard/proposal-ports';
import type { WhiteboardCollaborationStore } from '../../application/whiteboard/collaboration-ports';
import { WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';
type Row={id:string;title:string;status:C.Proposal['status'];submitted_by:string;generator_label:string|null;base_epoch:number;base_seq:string;commands:C.Proposal['commands'];decided_by:string|null;decision_request_id:string|null;decision_action:string|null;committed_epoch:number|null;committed_seq:string|null;created_at:Date;decided_at:Date|null;request_hash:string};
function view(r:Row):C.Proposal{return C.Proposal.parse({id:r.id,title:r.title,status:r.status,baseEpoch:r.base_epoch,baseSeq:Number(r.base_seq),commands:r.commands,
  provenance:{submittedBy:r.submitted_by,generator:r.generator_label?{label:r.generator_label,verified:false}:null},decidedBy:r.decided_by,
  createdAt:new Date(r.created_at).toISOString(),decidedAt:r.decided_at?new Date(r.decided_at).toISOString():null,committedEpoch:r.committed_epoch,committedSeq:r.committed_seq===null?null:Number(r.committed_seq)});}
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,value])=>[k,canonical(value)]));return v;}
/** Stores suggestions only. Accept is an explicit separate operation, never model execution. */
export class PgProposalRepository implements WhiteboardProposals {
  constructor(private readonly db:DatabasePort,private readonly collaboration:WhiteboardCollaborationStore){}
  private async access(s:TenantSession,p:Principal,boardId:string,write:boolean):Promise<boolean>{
    // Five-second proposal polling is read-only and must not contend with board
    // mutations. Writes take the board row lock because create's quota check and
    // every decision must remain serialized for the whole tenant transaction.
    const board=write
      ? await s.query<{owner_id:string;archived:boolean}>('SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE',[p.orgId,boardId])
      : await s.query<{owner_id:string;archived:boolean}>('SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2',[p.orgId,boardId]);
    const b=board.rows[0];if(!b||(write&&b.archived))return false;
    const role=await s.query<{role:string}>(`SELECT CASE WHEN $3=$4 THEN 'owner' ELSE m.role END AS role FROM org_memberships o
      LEFT JOIN whiteboard_members m ON m.org_id=o.org_id AND m.user_id=o.user_id AND m.board_id=$2
      WHERE o.org_id=$1 AND o.user_id=$3 AND ($3=$4 OR m.user_id IS NOT NULL)`,[p.orgId,boardId,p.userId,b.owner_id]);
    return Boolean(role.rows[0]&&(!write||role.rows[0].role!=='viewer'));
  }
  list(p:Principal,boardId:string):Promise<C.Proposal[]|null>{return this.db.withTenant(p.orgId,async s=>{
    if(!await this.access(s,p,boardId,false))return null;
    const r=await s.query<Row>('SELECT * FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2 ORDER BY created_at DESC,id LIMIT 1000',[p.orgId,boardId]);return r.rows.map(view);
  });}
  create(p:Principal,boardId:string,input:C.CreateProposal):Promise<C.Proposal|null>{
    input=C.CreateProposal.parse(input);
    if(Buffer.byteLength(JSON.stringify(input.commands))>WHITEBOARD_VALIDATOR_LIMITS.commandBytes)throw new ProposalConflict('PROPOSAL_TOO_LARGE');
    const hash=createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
    return this.db.withTenant(p.orgId,async s=>{
      if(!await this.access(s,p,boardId,true))return null;
      const previous=await s.query<Row>('SELECT * FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2 AND submitted_by=$3 AND request_id=$4',[p.orgId,boardId,p.userId,input.requestId]);
      if(previous.rows[0]){if(previous.rows[0].request_hash!==hash)throw new ProposalConflict('REQUEST_ID_REUSED');return view(previous.rows[0]);}
      const count=await s.query<{count:string}>('SELECT count(*) FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);if(Number(count.rows[0]?.count)>=1000)throw new ProposalConflict('PROPOSAL_LIMIT');
      const r=await s.query<Row>(`INSERT INTO whiteboard_proposals(org_id,board_id,id,submitted_by,request_id,request_hash,title,generator_label,base_epoch,base_seq,commands)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,[p.orgId,boardId,randomUUID(),p.userId,input.requestId,hash,input.title,input.generatorLabel??null,input.baseEpoch,input.baseSeq,JSON.stringify(input.commands)]);
      return view(r.rows[0]!);
    });
  }
  decide(p:Principal,boardId:string,proposalId:string,action:'accept'|'reject',input:C.DecideProposal):Promise<C.Proposal|null>{
    input=C.DecideProposal.parse(input);
    return this.db.withTenant(p.orgId,async s=>{
      if(!await this.access(s,p,boardId,true))return null;
      // Lock the proposal itself before observing its state. The board lock taken
      // by access() serializes every board mutation; this narrower row lock also
      // makes the single-decision invariant explicit and keeps it intact if board
      // authorization later moves to a shared lock.
      const result=await s.query<Row>('SELECT * FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE',[p.orgId,boardId,proposalId]);
      const row=result.rows[0];if(!row)return null;
      if(row.status!=='pending'){
        if(row.decided_by===p.userId&&row.decision_request_id===input.requestId&&row.decision_action===action)return view(row);
        throw new ProposalConflict('PROPOSAL_ALREADY_DECIDED');
      }
      let status:C.Proposal['status']='rejected',epoch:number|null=null,seq:number|null=null;
      if(action==='accept'){
        const head=await s.query<{epoch:number;seq:string}>('SELECT epoch,seq FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
        if((head.rows[0]?.epoch??1)!==row.base_epoch||Number(head.rows[0]?.seq??0)!==Number(row.base_seq))status='conflicted';
        else{
          // Shared mutation and decision receipt are one transaction. The returned
          // provisional result cannot escape until this outer withTenant commits.
          const pending=await this.collaboration.writeCommandsInTransaction(s,p,boardId,{epoch:row.base_epoch,requestId:row.id,commands:row.commands});
          status='applied';epoch=pending.epoch;seq=pending.seq;
        }
      }
      const updated=await s.query<Row>(`UPDATE whiteboard_proposals SET status=$4,decided_by=$5,decision_request_id=$6,decision_action=$7,
        committed_epoch=$8,committed_seq=$9,decided_at=clock_timestamp() WHERE org_id=$1 AND board_id=$2 AND id=$3 RETURNING *`,[p.orgId,boardId,proposalId,status,p.userId,input.requestId,action,epoch,seq]);
      return view(updated.rows[0]!);
    });
  }
}
