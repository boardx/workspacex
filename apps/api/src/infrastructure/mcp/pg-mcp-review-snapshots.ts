import {randomUUID} from 'node:crypto';
import {ReviewRecord,checkToolScopeCap} from '@repo/contracts/agent-runtime';
import {McpReviewInput,MCP_EXECUTION_LIMITS as L} from '@repo/contracts/mcp-execution-snapshot';
import type {z} from 'zod';
import type {DatabasePort} from '../../application/ports/database.port';
import type {IdentityRepository} from '../../application/identity/ports';
import type {OrgId} from '../../domain/org-id';
import {reviewMcpServer} from '../../application/mcp/review-mcp-server';
import {PgProvenanceRepository} from '../provenance/pg-provenance-repository';
import {createPgMcpToolStore} from './pg-mcp-tool-store';
import {assertMcpEndpointAllowed} from '../../domain/mcp/remote-endpoint-guard';
import {validateMcpToolSchemas} from './http-mcp-execution';
import {runtimeDescriptor} from './mcp-execution-descriptor';
import type {ReviewStatus} from '../../domain/mcp/server-status';

/** Persists the existing review use case and its exact reviewed schemas in one transaction. */
export class PgMcpReviewSnapshots {
 constructor(private db:DatabasePort,private identity:IdentityRepository){}
 async review(orgId:OrgId,reviewerId:string,raw:z.infer<typeof McpReviewInput>){
  const input=McpReviewInput.parse(raw),member=await this.identity.findOrgMembership(reviewerId,orgId);
  if(!member||!['lead','admin'].includes(member.orgRole))throw new Error('mcp_review_denied');
  if(input.grantedToolIds.length>L.maxTools||new Set(input.grantedToolIds).size!==input.grantedToolIds.length)throw new Error('mcp_review_invalid');
  return this.db.withTenant(orgId,async s=>{
   const server=(await s.query<{server_id:string;registered_by_actor_id:string;review_status:ReviewStatus;endpoint:string}>(`SELECT server_id,registered_by_actor_id,review_status,endpoint FROM mcp_servers WHERE org_id=$1 AND server_id=$2 FOR UPDATE`,[orgId,input.serverId])).rows[0];
   if(!server)throw new Error('mcp_review_denied');
   const credentialRevision=(await s.query<{revision:string}>('SELECT revision FROM mcp_server_secrets WHERE org_id=$1 AND server_id=$2',[orgId,input.serverId])).rows[0]?.revision??null;
   const available=await createPgMcpToolStore(this.db,orgId).current(input.serverId);
   const selected=input.grantedToolIds.map(id=>{const tool=available.find(t=>t.fullName===id);if(!tool)throw new Error('mcp_review_invalid');return tool;});
   if(Buffer.byteLength(JSON.stringify(selected))>L.maxResultBytes)throw new Error('mcp_review_schema_limit');
   if(input.verdict!=='维持隔离'){
    assertMcpEndpointAllowed(server.endpoint,{localOnlyOrg:false});
    if(!input.authScope||input.authScope==='未开放'||input.authScope==='仅某团队'||selected.length===0)throw new Error('mcp_review_scope_unsupported');
    for(const tool of selected){runtimeDescriptor(tool);if(!checkToolScopeCap({sideEffect:tool.sideEffect,authScope:input.authScope}).ok)throw new Error('mcp_review_scope_unsupported');}
    await validateMcpToolSchemas(selected.map(runtimeDescriptor));
   }
   let record:z.infer<typeof ReviewRecord>|undefined;
   const result=await reviewMcpServer({requestId:{next:()=>randomUUID()},provenance:new PgProvenanceRepository(this.db),reviews:{listByServer:async serverId=>(await s.query<{reviewerId:string}>('SELECT reviewer_id AS "reviewerId" FROM mcp_review_snapshots WHERE org_id=$1 AND server_id=$2 ORDER BY created_at DESC,review_id DESC',[orgId,serverId])).rows,append:async r=>{
    record=ReviewRecord.parse(r);
    await s.query('INSERT INTO mcp_review_snapshots(org_id,review_id,server_id,reviewer_id,endpoint,record,tools,credential_revision) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)',[orgId,r.reviewId,input.serverId,reviewerId,server.endpoint,JSON.stringify(record),JSON.stringify(selected),credentialRevision]);
   }}},{orgId,server:{serverId:input.serverId,registeredByActorId:server.registered_by_actor_id,reviewStatus:server.review_status},reviewerId,verdict:input.verdict,reason:input.reason,authScope:input.authScope,grantedToolIds:input.grantedToolIds});
   await s.query('UPDATE mcp_tools SET auth_scope=$3 WHERE org_id=$1 AND server_id=$2',[orgId,input.serverId,'未开放']);
   if(input.verdict!=='维持隔离')for(const tool of selected){
    const updated=await s.query('UPDATE mcp_tools SET auth_scope=$4 WHERE org_id=$1 AND server_id=$2 AND full_name=$3 AND schema_fingerprint=$5 RETURNING full_name',[orgId,input.serverId,tool.fullName,input.authScope,tool.schemaFingerprint]);
    if(updated.rows.length!==1)throw new Error('mcp_review_changed');
   }
   await s.query('UPDATE mcp_servers SET review_status=$3,connection_status=$4,auth_scope=$5,current_review_id=$6,isolation_mode=NULL WHERE org_id=$1 AND server_id=$2',[orgId,input.serverId,result.reviewStatus,result.connectionStatus,input.verdict==='维持隔离'?'未开放':input.authScope,result.reviewId]);
   return ReviewRecord.parse(record);
  });
 }
}
