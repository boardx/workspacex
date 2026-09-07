import {randomUUID} from 'node:crypto';
import {McpIsolationInput,McpIsolationOutput} from '@repo/contracts/mcp-execution-snapshot';
import type {z} from 'zod';
import type {DatabasePort} from '../../application/ports/database.port';
import type {IdentityRepository} from '../../application/identity/ports';
import type {OrgId} from '../../domain/org-id';
import {isolatedByPolicy} from '../../domain/mcp/server-status';
import {PgProvenanceRepository} from '../provenance/pg-provenance-repository';
/** Server governance commands. These are not parent-run cancellation commands. */
export class PgMcpIsolation {
 constructor(private db:DatabasePort,private identity:IdentityRepository){}
 private async authorize(orgId:OrgId,userId:string){const member=await this.identity.findOrgMembership(userId,orgId);if(!member||member.orgRole!=='admin')throw new Error('mcp_isolation_denied');}
 async isolate(orgId:OrgId,userId:string,raw:z.infer<typeof McpIsolationInput>){
  await this.authorize(orgId,userId);const input=McpIsolationInput.parse(raw);if(!input.reason.trim())throw new Error('mcp_isolation_reason_required');
  const requestId=randomUUID();
  await this.db.withTenant(orgId,async s=>{
   const server=await s.query('SELECT server_id FROM mcp_servers WHERE org_id=$1 AND server_id=$2 FOR UPDATE',[orgId,input.serverId]);if(!server.rows.length)throw new Error('mcp_isolation_unavailable');
   const affected=(await s.query<{agent_id:string}>("SELECT DISTINCT s.agent_id FROM mcp_run_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.tools) t(value) WHERE s.org_id=$1 AND t.value->'tool'->>'serverId'=$2",[orgId,input.serverId])).rows.map(r=>r.agent_id);
   await new PgProvenanceRepository(this.db).appendWithin(s,{orgId,type:'capability-updated',actorId:userId,target:{kind:'capability',id:input.serverId},detail:{operation:'mcp-isolate',requestId,mode:input.mode,reason:input.reason}});
   await s.query('INSERT INTO mcp_isolation_requests(org_id,request_id,server_id,mode,requested_by,reason,affected_agent_ids) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[orgId,requestId,input.serverId,input.mode,userId,input.reason,JSON.stringify(affected)]);
   await s.query("UPDATE mcp_servers SET review_status='维持隔离',connection_status=$3,isolation_mode=$4 WHERE org_id=$1 AND server_id=$2",[orgId,input.serverId,isolatedByPolicy(),input.mode]);
   await s.query("INSERT INTO mcp_isolation_calls(org_id,request_id,run_id,tool_call_id) SELECT org_id,$3,run_id,tool_call_id FROM mcp_tool_executions WHERE org_id=$1 AND server_id=$2 AND status='pending'",[orgId,input.serverId,requestId]);
   if(input.mode==='interrupt')await s.query("UPDATE mcp_tool_executions SET isolation_request_id=$3 WHERE org_id=$1 AND server_id=$2 AND status='pending'",[orgId,input.serverId,requestId]);
  });
  return this.status(orgId,userId,input.serverId,requestId);
 }
 async status(orgId:OrgId,userId:string,serverId:string,requestId:string){
  await this.authorize(orgId,userId);
  return this.db.withTenant(orgId,async s=>{
   const row=(await s.query<{mode:'interrupt'|'drain';affected_agent_ids:string[];connection_status:string}>('SELECT r.mode,r.affected_agent_ids,m.connection_status FROM mcp_isolation_requests r JOIN mcp_servers m ON m.org_id=r.org_id AND m.server_id=r.server_id WHERE r.org_id=$1 AND r.server_id=$2 AND r.request_id=$3',[orgId,serverId,requestId])).rows[0];if(!row)throw new Error('mcp_isolation_unavailable');
   // Expiry is uncertainty, never proof that a remote side effect or a lost process stopped.
   await s.query("UPDATE mcp_tool_executions SET status='unconfirmed',finished_at=now() WHERE org_id=$1 AND server_id=$2 AND status='pending' AND (deadline_at IS NULL OR deadline_at<now())",[orgId,serverId]);
   const counts=(await s.query<{ack:string;pending:string;unknown:string;completed:string}>(`SELECT count(*) FILTER(WHERE e.local_stop_ack_at IS NOT NULL)::text AS ack,count(*) FILTER(WHERE e.status='pending')::text AS pending,count(*) FILTER(WHERE e.status='unconfirmed' AND e.local_stop_ack_at IS NULL)::text AS unknown,count(*) FILTER(WHERE e.status='succeeded')::text AS completed FROM mcp_isolation_calls c JOIN mcp_tool_executions e ON e.org_id=c.org_id AND e.run_id=c.run_id AND e.tool_call_id=c.tool_call_id WHERE c.org_id=$1 AND c.request_id=$2`,[orgId,requestId])).rows[0]!;
   const ack=row.mode==='interrupt'?Number(counts.ack):0;
   return McpIsolationOutput.parse({serverId,connectionStatus:row.connection_status,affectedAgentIds:row.affected_agent_ids,interruptedCalls:ack,requestId,mode:row.mode,localAcknowledgedCalls:Number(counts.ack),pendingCalls:Number(counts.pending),unconfirmedCalls:Number(counts.unknown),completedCalls:Number(counts.completed),remoteOutcome:'unknown'});
  });
 }
}
