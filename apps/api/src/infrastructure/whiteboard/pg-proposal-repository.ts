import { createHash,randomUUID } from 'node:crypto';
import * as C from '@repo/contracts/whiteboard-proposal';
import type { Principal } from '../../domain/principal';
import { toOrgId } from '../../domain/org-id';
import type { DatabasePort,TenantSession } from '../../application/ports/database.port';
import { ProposalConflict,type WhiteboardProposals } from '../../application/whiteboard/proposal-ports';
import type { WhiteboardCollaborationStore } from '../../application/whiteboard/collaboration-ports';
import { WHITEBOARD_VALIDATOR_LIMITS } from './update-validator';

type Decision=C.Proposal['commandDecisions'][number];
type Row={id:string;title:string;status:C.Proposal['status'];submitted_by:string;source_kind:'human-api'|'agent';actor_id:string;agent_id:string|null;agent_name:string|null;agent_version_id:string|null;run_id:string|null;model_provider:string|null;model_id:string|null;model_version:string|null;base_epoch:number;base_seq:string;commands:C.Proposal['commands'];command_decisions:Decision[];decided_by:string|null;decision_request_id:string|null;decision_action:string|null;committed_epoch:number|null;committed_seq:string|null;created_at:Date;decided_at:Date|null;request_hash:string};
type RuntimeRow={actor_id:string;agent_id:string;agent_name:string|null;agent_version_id:string;model_provider:string;model_id:string};
type StoredProvenance={kind:'human-api';actorId:string}|{kind:'agent';actorId:string;agentId:string;agentName:string;agentVersionId:string;runId:string;provider:string;model:string;modelVersion:string};

const pendingDecision=():Decision=>({status:'pending',decidedBy:null,decidedAt:null,requestId:null,committedEpoch:null,committedSeq:null});
function normalizeDecisions(r:Row):Decision[]{if(Array.isArray(r.command_decisions)&&r.command_decisions.length===r.commands.length)return r.command_decisions;return r.commands.map(()=>pendingDecision());}
function view(r:Row):C.Proposal{
  const createdAt=new Date(r.created_at).toISOString();
  const participant=r.source_kind==='agent'&&r.agent_id&&r.agent_name&&r.agent_version_id&&r.run_id&&r.model_provider&&r.model_id&&r.model_version
    ? {kind:'agent' as const,verified:true as const,agentId:r.agent_id,agentName:r.agent_name,agentVersionId:r.agent_version_id,runId:r.run_id,provider:r.model_provider,model:r.model_id,modelVersion:r.model_version}
    : {kind:'human-api' as const,verified:true as const,actorId:r.actor_id||r.submitted_by};
  return C.Proposal.parse({id:r.id,title:r.title,status:r.status,baseEpoch:r.base_epoch,baseSeq:Number(r.base_seq),commands:r.commands,
    commandDecisions:normalizeDecisions(r),provenance:{submittedBy:r.submitted_by,actor:{kind:'human',id:r.actor_id||r.submitted_by},
      source:r.source_kind==='agent'&&r.run_id?{kind:'agent-run',ref:r.run_id}:{kind:'api'},createdAt,participant},decidedBy:r.decided_by,
    createdAt,decidedAt:r.decided_at?new Date(r.decided_at).toISOString():null,
    committedEpoch:r.committed_epoch,committedSeq:r.committed_seq===null?null:Number(r.committed_seq)});
}
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,value])=>[k,canonical(value)]));return v;}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function expectedHead(row:Row):{epoch:number;seq:number}{
  const applied=normalizeDecisions(row).filter(item=>item.status==='applied'&&item.committedEpoch!==null&&item.committedSeq!==null);
  const latest=applied.sort((a,b)=>(b.committedSeq??0)-(a.committedSeq??0))[0];
  return latest?{epoch:latest.committedEpoch!,seq:latest.committedSeq!}:{epoch:row.base_epoch,seq:Number(row.base_seq)};
}
function terminal(decisions:Decision[],actorId:string,at:string,requestId:string){
  if(decisions.some(item=>item.status==='pending'))return{status:'pending' as const,decidedBy:null,decidedAt:null,decisionRequestId:null,decisionAction:null,epoch:null,seq:null};
  const applied=decisions.filter(item=>item.status==='applied').sort((a,b)=>(b.committedSeq??0)-(a.committedSeq??0));
  return{status:(applied.length?'applied':'rejected') as 'applied'|'rejected',decidedBy:actorId,decidedAt:at,decisionRequestId:requestId,
    decisionAction:applied.length?'accept':'reject',epoch:applied[0]?.committedEpoch??null,seq:applied[0]?.committedSeq??null};
}

/** Stores suggestions only. Accept is an explicit human operation, never model execution. */
export class PgProposalRepository implements WhiteboardProposals {
  constructor(private readonly db:DatabasePort,private readonly collaboration:WhiteboardCollaborationStore){}
  private async access(s:TenantSession,p:Principal,boardId:string,write:boolean):Promise<boolean>{
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
  private async insert(s:TenantSession,p:Principal,boardId:string,input:C.CreateProposal,provenance:StoredProvenance):Promise<C.Proposal|null>{
    if(!await this.access(s,p,boardId,true))return null;
    const hash=digest({input,provenance});
    const previous=await s.query<Row>('SELECT * FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2 AND submitted_by=$3 AND request_id=$4',[p.orgId,boardId,p.userId,input.requestId]);
    if(previous.rows[0]){if(previous.rows[0].request_hash!==hash)throw new ProposalConflict('REQUEST_ID_REUSED');return view(previous.rows[0]);}
    const count=await s.query<{count:string}>('SELECT count(*) FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);if(Number(count.rows[0]?.count)>=1000)throw new ProposalConflict('PROPOSAL_LIMIT');
    const agent=provenance.kind==='agent'?provenance:null;
    const r=await s.query<Row>(`INSERT INTO whiteboard_proposals(org_id,board_id,id,submitted_by,request_id,request_hash,title,source_kind,actor_id,agent_id,agent_name,agent_version_id,run_id,model_provider,model_id,model_version,base_epoch,base_seq,commands,command_decisions)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb) RETURNING *`,
      [p.orgId,boardId,randomUUID(),p.userId,input.requestId,hash,input.title,provenance.kind,provenance.actorId,agent?.agentId??null,agent?.agentName??null,agent?.agentVersionId??null,agent?.runId??null,agent?.provider??null,agent?.model??null,agent?.modelVersion??null,input.baseEpoch,input.baseSeq,JSON.stringify(input.commands),JSON.stringify(input.commands.map(()=>pendingDecision()))]);
    return view(r.rows[0]!);
  }
  create(p:Principal,boardId:string,input:C.CreateProposal):Promise<C.Proposal|null>{
    input=C.CreateProposal.parse(input);
    if(Buffer.byteLength(JSON.stringify(input.commands))>WHITEBOARD_VALIDATOR_LIMITS.commandBytes)throw new ProposalConflict('PROPOSAL_TOO_LARGE');
    return this.db.withTenant(p.orgId,s=>this.insert(s,p,boardId,input,{kind:'human-api',actorId:p.userId}));
  }
  createFromAgentRun(orgId:string,runId:string,boardId:string,input:C.CreateProposal):Promise<C.Proposal|null>{
    input=C.CreateProposal.parse(input);const scopedOrg=toOrgId(orgId);
    if(Buffer.byteLength(JSON.stringify(input.commands))>WHITEBOARD_VALIDATOR_LIMITS.commandBytes)throw new ProposalConflict('PROPOSAL_TOO_LARGE');
    return this.db.withTenant(scopedOrg,async s=>{
      const run=(await s.query<RuntimeRow>(`SELECT m.author_id AS actor_id,r.agent_id,a.name AS agent_name,r.agent_version_id,r.model_provider,r.model_id
        FROM agent_runs r JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id AND m.thread_id=r.thread_id
        LEFT JOIN agents a ON a.org_id=r.org_id AND a.id=r.agent_id
        WHERE r.org_id=$1 AND r.id=$2 AND m.author_kind='human'`,[scopedOrg,runId])).rows[0];
      if(!run)throw new ProposalConflict('AGENT_RUN_NOT_FOUND');
      const p:Principal={orgId:scopedOrg,userId:run.actor_id};
      return this.insert(s,p,boardId,input,{kind:'agent',actorId:run.actor_id,agentId:run.agent_id,agentName:run.agent_name??run.agent_id,
        agentVersionId:run.agent_version_id,runId,provider:run.model_provider,model:run.model_id,modelVersion:run.model_id});
    });
  }
  decide(p:Principal,boardId:string,proposalId:string,action:'accept'|'reject',input:C.DecideProposal):Promise<C.Proposal|null>{
    input=C.DecideProposal.parse(input);
    return this.db.withTenant(p.orgId,async s=>{
      if(!await this.access(s,p,boardId,true))return null;
      const result=await s.query<Row>('SELECT * FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE',[p.orgId,boardId,proposalId]);
      const row=result.rows[0];if(!row)return null;
      if(row.status!=='pending'){
        if(row.decided_by===p.userId&&row.decision_request_id===input.requestId&&row.decision_action===action)return view(row);
        throw new ProposalConflict('PROPOSAL_ALREADY_DECIDED');
      }
      const indexes=normalizeDecisions(row).flatMap((item,index)=>item.status==='pending'?[index]:[]);
      let status:C.Proposal['status']='rejected',epoch:number|null=null,seq:number|null=null;
      const at=new Date().toISOString();let decisions=normalizeDecisions(row);
      if(action==='accept'){
        const head=await s.query<{epoch:number;seq:string}>('SELECT epoch,seq FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
        const expected=expectedHead(row);
        if((head.rows[0]?.epoch??1)!==expected.epoch||Number(head.rows[0]?.seq??0)!==expected.seq)status='conflicted';
        else{
          const commands=indexes.map(index=>row.commands[index]!);
          const pending=await this.collaboration.writeCommandsInTransaction(s,p,boardId,{epoch:expected.epoch,requestId:input.requestId,commands});
          status='applied';epoch=pending.epoch;seq=pending.seq;
          decisions=decisions.map((item,index)=>indexes.includes(index)?{status:'applied',decidedBy:p.userId,decidedAt:at,requestId:input.requestId,committedEpoch:epoch,committedSeq:seq}:item);
        }
      }else decisions=decisions.map((item,index)=>indexes.includes(index)?{status:'rejected',decidedBy:p.userId,decidedAt:at,requestId:input.requestId,committedEpoch:null,committedSeq:null}:item);
      if(status!=='conflicted'){
        const done=terminal(decisions,p.userId,at,input.requestId);status=done.status;epoch=done.epoch;seq=done.seq;
      }
      const updated=await s.query<Row>(`UPDATE whiteboard_proposals SET status=$4,command_decisions=$5::jsonb,decided_by=$6,decision_request_id=$7,decision_action=$8,
        committed_epoch=$9,committed_seq=$10,decided_at=$11 WHERE org_id=$1 AND board_id=$2 AND id=$3 RETURNING *`,
        [p.orgId,boardId,proposalId,status,JSON.stringify(decisions),p.userId,input.requestId,action,epoch,seq,at]);
      return view(updated.rows[0]!);
    });
  }
  batchDecide(p:Principal,boardId:string,input:C.BatchDecision):Promise<C.BatchDecisionResult|null>{
    input=C.BatchDecision.parse(input);const hash=digest(input);
    return this.db.withTenant(p.orgId,async s=>{
      if(!await this.access(s,p,boardId,true))return null;
      const receipt=await s.query<{request_hash:string;result:unknown}>('SELECT request_hash,result FROM whiteboard_proposal_decisions WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4',[p.orgId,boardId,p.userId,input.requestId]);
      if(receipt.rows[0]){if(receipt.rows[0].request_hash!==hash)throw new ProposalConflict('REQUEST_ID_REUSED');return C.BatchDecisionResult.parse(receipt.rows[0].result);}
      const ids=input.selections.map(item=>item.proposalId);
      const rows=(await s.query<Row>('SELECT * FROM whiteboard_proposals WHERE org_id=$1 AND board_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',[p.orgId,boardId,ids])).rows;
      if(rows.length!==ids.length)return null;
      const byId=new Map(rows.map(row=>[row.id,row]));
      for(const selection of input.selections){const row=byId.get(selection.proposalId)!;if(row.status!=='pending')throw new ProposalConflict('PROPOSAL_ALREADY_DECIDED');
        const decisions=normalizeDecisions(row);if(selection.commandIndexes.some(index=>!row.commands[index]||decisions[index]?.status!=='pending'))throw new ProposalConflict('PROPOSAL_ALREADY_DECIDED');}
      let committed:{epoch:number;seq:number}|null=null;
      if(input.action==='accept'){
        const head=(await s.query<{epoch:number;seq:string}>('SELECT epoch,seq FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId])).rows[0];
        if(input.selections.some(selection=>{const expected=expectedHead(byId.get(selection.proposalId)!);return(head?.epoch??1)!==expected.epoch||Number(head?.seq??0)!==expected.seq;}))throw new ProposalConflict('PROPOSAL_CONFLICT');
        const commands=input.selections.flatMap(selection=>selection.commandIndexes.map(index=>byId.get(selection.proposalId)!.commands[index]!));
        committed=await this.collaboration.writeCommandsInTransaction(s,p,boardId,{epoch:head?.epoch??1,requestId:input.requestId,commands});
      }
      const at=new Date().toISOString(),updated:C.Proposal[]=[];
      for(const selection of input.selections){
        const row=byId.get(selection.proposalId)!,selected=new Set(selection.commandIndexes);
        const decisions=normalizeDecisions(row).map((item,index)=>!selected.has(index)?item:input.action==='accept'
          ? {status:'applied' as const,decidedBy:p.userId,decidedAt:at,requestId:input.requestId,committedEpoch:committed!.epoch,committedSeq:committed!.seq}
          : {status:'rejected' as const,decidedBy:p.userId,decidedAt:at,requestId:input.requestId,committedEpoch:null,committedSeq:null});
        const done=terminal(decisions,p.userId,at,input.requestId);
        const result=await s.query<Row>(`UPDATE whiteboard_proposals SET status=$4,command_decisions=$5::jsonb,decided_by=$6,decision_request_id=$7,decision_action=$8,
          committed_epoch=$9,committed_seq=$10,decided_at=$11 WHERE org_id=$1 AND board_id=$2 AND id=$3 RETURNING *`,
          [p.orgId,boardId,row.id,done.status,JSON.stringify(decisions),done.decidedBy,done.decisionRequestId,done.decisionAction,done.epoch,done.seq,done.decidedAt]);
        updated.push(view(result.rows[0]!));
      }
      const response=C.BatchDecisionResult.parse({proposals:updated});
      await s.query('INSERT INTO whiteboard_proposal_decisions(org_id,board_id,actor_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[p.orgId,boardId,p.userId,input.requestId,hash,JSON.stringify(response)]);
      return response;
    });
  }
}
