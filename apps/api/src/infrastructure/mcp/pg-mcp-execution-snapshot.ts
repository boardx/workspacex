import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {McpFrozenTool,McpInvokeInput,McpInvokeOutput,McpRunSnapshotView,MCP_EXECUTION_LIMITS as L} from '@repo/contracts/mcp-execution-snapshot';
import {ToolWhitelistEntry,ReviewRecord} from '@repo/contracts/agent-runtime';
import type {DatabasePort} from '../../application/ports/database.port';
import type {McpExecutionSnapshot} from '../../application/agent-run/mcp-execution-snapshot';
import type {ExecutionAuthorityContext,ToolExecutionCheck,ToolAuthorityReader,ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import {resolveVisibility,type ResolveVisibilityDeps} from '../../application/chat/resolve-visibility';
import {isLocalOrg} from '../../domain/identity/local-org';
import {whitelistEntryGrants} from '../../domain/agent/three-layer-permission';
import {evaluateMcpAuthScope} from '../../domain/mcp/authorize-scope';
import {callability,type ReviewStatus,type ConnectionStatus,type AuthScope} from '../../domain/mcp/server-status';
import {toOrgId,type OrgId} from '../../domain/org-id';
import {createPgMcpToolStore} from './pg-mcp-tool-store';
import {runtimeDescriptor} from './mcp-execution-descriptor';
import {PgMcpIsolation} from './pg-mcp-isolation';
import {mcpInflightControl,acknowledgeMcpLocalStop} from './mcp-inflight-control';
import {PgMcpReviewSnapshots} from './pg-mcp-review-snapshots';
import type {McpCredentialExecutionBroker} from './mcp-credential-execution-broker';
import type {McpExecutionCall} from './http-mcp-execution';
import {mcpExecutionDigest as digest} from './mcp-execution-digest';
interface RunFacts {agent_id:string;agent_version_id:string;requester_id:string;thread_id:string;project_id:string|null;updated_at:string;tool_whitelist:unknown;}
interface ServerFacts {isolation_mode:'interrupt'|'drain'|null;server_id:string;endpoint:string;auth_scope:AuthScope;review_status:ReviewStatus;connection_status:ConnectionStatus;quarantine_until:Date|null;current_review_id:string|null;involves_customer_data:boolean;credential_configured:boolean;credential_revision:string|null;}
interface SnapshotRow {snapshot_id:string;digest:string;tools:unknown;agent_id:string;agent_version_id:string;requester_id:string;}
/** Run-scoped capability evidence. Shared run-control remains the only dispatch admission authority. */
export class PgMcpExecutionSnapshot implements McpExecutionSnapshot {
 constructor(private db:DatabasePort,private reader:ToolAuthorityReader,private authority:ToolExecutionAuthority,private visibility:ResolveVisibilityDeps,private execute:McpExecutionCall,private broker?:Pick<McpCredentialExecutionBroker,'execute'>){}
 review(orgId:OrgId,reviewerId:string,input:Parameters<McpExecutionSnapshot['review']>[2]){return new PgMcpReviewSnapshots(this.db,this.visibility.repo).review(orgId,reviewerId,input);}
 isolate(orgId:OrgId,userId:string,input:Parameters<McpExecutionSnapshot['isolate']>[2]){return new PgMcpIsolation(this.db,this.visibility.repo).isolate(orgId,userId,input);}
 isolationStatus(orgId:OrgId,userId:string,serverId:string,requestId:string){return new PgMcpIsolation(this.db,this.visibility.repo).status(orgId,userId,serverId,requestId);}
 private async facts(org:OrgId,run:string):Promise<RunFacts>{
  const facts=await this.db.withTenant(org,async s=>(await s.query<RunFacts>(`SELECT r.agent_id,r.agent_version_id,m.author_id AS requester_id,r.thread_id,t.project_id,a.updated_at,a.tool_whitelist
    FROM agent_runs r JOIN agent_versions v ON v.org_id=r.org_id AND v.id=r.agent_version_id AND v.agent_id=r.agent_id
    JOIN agents a ON a.org_id=r.org_id AND a.id=r.agent_id
    JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id AND m.thread_id=r.thread_id AND m.author_kind='human'
    JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
    WHERE r.org_id=$1 AND r.id=$2 FOR SHARE OF a`,[org,run])).rows[0]);
  if(!facts)throw new Error('mcp_run_unavailable');
  const organization=await this.visibility.repo.findOrganization(org);
  if(!organization)throw new Error('mcp_run_unavailable');
  if((await resolveVisibility(this.visibility,{orgId:org,userId:facts.requester_id,threadId:facts.thread_id,projectId:facts.project_id})).kind!=='allow')throw new Error('mcp_run_unavailable');
  return facts;
 }
 private async servers(org:OrgId):Promise<ServerFacts[]>{return this.db.withTenant(org,async s=>(await s.query<ServerFacts>(`SELECT m.server_id,m.endpoint,m.auth_scope,m.review_status,m.connection_status,m.quarantine_until,m.current_review_id,m.involves_customer_data,m.isolation_mode,
 EXISTS(SELECT 1 FROM mcp_server_secrets sec WHERE sec.org_id=m.org_id AND sec.server_id=m.server_id) AS credential_configured,
 (SELECT revision FROM mcp_server_secrets sec WHERE sec.org_id=m.org_id AND sec.server_id=m.server_id) AS credential_revision
 FROM mcp_servers m WHERE m.org_id=$1 FOR SHARE OF m`,[org])).rows);}
 private async allowedScope(org:OrgId,facts:RunFacts,scope:AuthScope){
  const membership=facts.project_id?await this.visibility.repo.findProjectMembership(facts.requester_id,facts.project_id,org):null;
  return evaluateMcpAuthScope(scope,{isProjectOwner:membership?.projectRole==='facilitator'&&membership.isHost,isInAuthorizedTeam:false}).allowed;
 }
 private async eligible(org:OrgId,facts:RunFacts,drainingReviewId?:string):Promise<z.infer<typeof McpFrozenTool>[]>{
  const organization=await this.visibility.repo.findOrganization(org);
  if(!organization||isLocalOrg(organization.kind))return [];
  const whitelist=z.array(ToolWhitelistEntry).parse(facts.tool_whitelist??[]),tools:z.infer<typeof McpFrozenTool>[]=[];
  for(const server of await this.servers(org)){
   if(!server.current_review_id||!(callability({reviewStatus:server.review_status,connectionStatus:server.connection_status}).callable||(drainingReviewId===server.current_review_id&&server.isolation_mode==='drain'))||(server.credential_configured&&!this.broker)||server.involves_customer_data||server.quarantine_until&&server.quarantine_until.getTime()>Date.now()||!await this.allowedScope(org,facts,server.auth_scope))continue;
   const review=await this.db.withTenant(org,async s=>(await s.query<{endpoint:string;credential_revision:string|null;record:unknown;tools:unknown}>('SELECT endpoint,record,tools,credential_revision FROM mcp_review_snapshots WHERE org_id=$1 AND review_id=$2 AND server_id=$3',[org,server.current_review_id,server.server_id])).rows[0]);
   if(!review||review.endpoint!==server.endpoint||review.credential_revision!==server.credential_revision)continue;
   const record=ReviewRecord.parse(review.record),reviewed=z.array(z.object({fullName:z.string(),schemaFingerprint:z.string()}).passthrough()).parse(review.tools);
   if(record.authScopeSet!==server.auth_scope)continue;
   for(const tool of await createPgMcpToolStore(this.db,org).current(server.server_id)){
    const entry=whitelist.find(e=>e.toolFullName===tool.fullName)??null;
    if(tool.authScope!==record.authScopeSet||!whitelistEntryGrants(entry)||!record.grantedToolIds.includes(tool.fullName)||!reviewed.some(t=>t.fullName===tool.fullName&&t.schemaFingerprint===tool.schemaFingerprint)||!await this.allowedScope(org,facts,tool.authScope))continue;
    tools.push(McpFrozenTool.parse({reviewId:server.current_review_id,credentialRevision:server.credential_revision,endpoint:server.endpoint,tool,whitelistEntry:entry,runtime:runtimeDescriptor(tool)}));
   }
  }
  if(tools.length>L.maxTools||new Set(tools.map(t=>t.runtime.name)).size!==tools.length||Buffer.byteLength(JSON.stringify(tools))>L.maxResultBytes)throw new Error('mcp_snapshot_limit_or_collision');
  return tools.sort((a,b)=>a.runtime.name<b.runtime.name?-1:1);
 }
 private view(row:SnapshotRow){const tools=z.array(McpFrozenTool).parse(row.tools);if(digest(tools)!==row.digest)throw new Error('mcp_snapshot_invalid');return McpRunSnapshotView.parse({ref:{snapshotId:row.snapshot_id,digest:row.digest},tools:tools.map(t=>t.runtime)});}
 private async stored(org:OrgId,run:string){return this.db.withTenant(org,async s=>(await s.query<SnapshotRow>('SELECT snapshot_id,digest,tools,agent_id,agent_version_id,requester_id FROM mcp_run_snapshots WHERE org_id=$1 AND run_id=$2',[org,run])).rows[0]);}
 private admitted<T>(context:ExecutionAuthorityContext,consume:()=>Promise<T>){return this.reader.withSnapshot(context,async state=>{
  if(!state?.active||state.cancelRequested||!state.leaseValid||state.attemptId!==context.attemptId)throw new Error('mcp_run_unavailable');return consume();
 });}
 capture(context:ExecutionAuthorityContext){return this.admitted(context,async()=>{
  const facts=await this.facts(context.orgId,context.parentRunId),existing=await this.stored(context.orgId,context.parentRunId);if(existing){if(existing.agent_id!==facts.agent_id||existing.agent_version_id!==facts.agent_version_id||existing.requester_id!==facts.requester_id)throw new Error('mcp_snapshot_unavailable');return this.view(existing);}
  const tools=await this.eligible(context.orgId,facts),id=randomUUID(),hash=digest(tools);
  await this.db.withTenant(context.orgId,async s=>{await s.query(`INSERT INTO mcp_run_snapshots(org_id,run_id,snapshot_id,agent_id,agent_version_id,requester_id,agent_observed_updated_at,tools,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(org_id,run_id) DO NOTHING`,[context.orgId,context.parentRunId,id,facts.agent_id,facts.agent_version_id,facts.requester_id,facts.updated_at,JSON.stringify(tools),hash]);});
  const saved=await this.stored(context.orgId,context.parentRunId);if(!saved)throw new Error('mcp_snapshot_unavailable');return this.view(saved);
 });}
 resolve(context:ExecutionAuthorityContext){return this.admitted(context,async()=>{
  const facts=await this.facts(context.orgId,context.parentRunId),row=await this.stored(context.orgId,context.parentRunId);if(!row||row.agent_id!==facts.agent_id||row.agent_version_id!==facts.agent_version_id||row.requester_id!==facts.requester_id)throw new Error('mcp_snapshot_unavailable');return this.view(row);
 });}
 private async recheck(context:ToolExecutionCheck,frozen:z.infer<typeof McpFrozenTool>,draining=false){
  if(!(await this.authority.check(context)).allowed)throw new Error('mcp_dispatch_denied');
  const facts=await this.facts(context.orgId,context.parentRunId),row=await this.stored(context.orgId,context.parentRunId);
  if(!row||row.agent_id!==facts.agent_id||row.agent_version_id!==facts.agent_version_id||row.requester_id!==facts.requester_id)throw new Error('mcp_snapshot_unavailable');
  const current=(await this.eligible(context.orgId,facts,draining?frozen.reviewId:undefined)).find(t=>t.runtime.name===frozen.runtime.name);
  if(!current||current.reviewId!==frozen.reviewId||current.endpoint!==frozen.endpoint||current.tool.schemaFingerprint!==frozen.tool.schemaFingerprint||(current.credentialRevision??null)!==(frozen.credentialRevision??null))throw new Error('mcp_capability_revoked');
 }
 async invoke(runId:string,raw:z.infer<typeof McpInvokeInput>){
  const deadlineAt=Date.now()+L.deadlineMs;
  const input=McpInvokeInput.parse(raw),org=toOrgId(input.orgId),context={...input,orgId:org,parentRunId:runId};
  if(Buffer.byteLength(JSON.stringify(input.toolArgs))>L.maxArgsBytes||!(await this.authority.check(context)).allowed)throw new Error('mcp_dispatch_denied');
  const facts=await this.facts(org,runId),row=await this.stored(org,runId);if(!row||row.agent_id!==facts.agent_id||row.agent_version_id!==facts.agent_version_id||row.requester_id!==facts.requester_id)throw new Error('mcp_snapshot_unavailable');
  this.view(row);const frozen=z.array(McpFrozenTool).parse(row.tools).find(t=>t.runtime.name===input.toolName),current=(await this.eligible(org,facts)).find(t=>t.runtime.name===input.toolName);
  if(!frozen||!current||frozen.reviewId!==current.reviewId||frozen.endpoint!==current.endpoint||frozen.tool.schemaFingerprint!==current.tool.schemaFingerprint||(frozen.credentialRevision??null)!==(current.credentialRevision??null))throw new Error('mcp_capability_revoked');
  if(current.tool.authScope==='需人工确认每次'){
   const once=await this.reader.withSnapshot(context,async s=>!!s?.active&&!s.cancelRequested&&s.leaseValid&&s.attemptId===input.attemptId&&!s.explicitlyDenied&&!!await s.authorizeOnce?.());if(!once)throw new Error('mcp_confirmation_required');
  }
  const hash=digest(input.toolArgs);
  const cached=await this.admitted(context,async()=>{
   await this.recheck(context,frozen);
   return this.db.withTenant(org,async s=>{
   await s.query('SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',[org,runId]);
   const prior=(await s.query<{tool_name:string;args_digest:string;status:string;result:unknown}>('SELECT tool_name,args_digest,status,result FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3',[org,runId,input.toolCallId])).rows[0];
   if(prior){if(prior.tool_name!==input.toolName||prior.args_digest!==hash||prior.status!=='succeeded')throw new Error('mcp_execution_unconfirmed');return McpInvokeOutput.parse(prior.result);}
   const count=(await s.query<{n:string}>('SELECT count(*) AS n FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',[org,runId])).rows[0];if(Number(count?.n)>=L.maxInvocations)throw new Error('mcp_execution_limit');
   await s.query("INSERT INTO mcp_tool_executions(org_id,run_id,tool_call_id,tool_name,args_digest,status,server_id,review_id,attempt_id,lease_epoch,deadline_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)",[org,runId,input.toolCallId,input.toolName,hash,frozen.tool.serverId,frozen.reviewId,input.attemptId,input.leaseEpoch,new Date(deadlineAt+L.cancelAckGraceMs)]);return null;
   });
  });
  if(cached)return cached;
  const control=await mcpInflightControl(this.db,org,runId,input.toolCallId,deadlineAt);
  try{if(control.signal.aborted)throw new Error('mcp_execution_unconfirmed');const execution=frozen.credentialRevision?this.broker?.execute:this.execute;if(!execution)throw new Error('mcp_credential_unavailable');const result=await execution(frozen,input.toolArgs,{signal:control.signal,deadlineAt,receipt:{orgId:org,runId,toolCallId:input.toolCallId,attemptId:input.attemptId,leaseEpoch:input.leaseEpoch}});return await this.admitted(context,async()=>{
   if(control.signal.aborted)throw new Error('mcp_execution_unconfirmed');await this.recheck(context,frozen,true);
   const saved=await this.db.withTenant(org,s=>s.query("UPDATE mcp_tool_executions SET status='succeeded',result=$4::jsonb,finished_at=now() WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3 AND status='pending' RETURNING tool_call_id",[org,runId,input.toolCallId,JSON.stringify(result)]));if(saved.rows.length!==1)throw new Error('mcp_execution_unconfirmed');return result;
  });}
  catch{await this.db.withTenant(org,s=>s.query("UPDATE mcp_tool_executions SET status='unconfirmed',finished_at=now() WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3 AND status='pending'",[org,runId,input.toolCallId]));throw new Error('mcp_execution_unconfirmed');}
  finally{await control.close();await acknowledgeMcpLocalStop(this.db,org,runId,input.toolCallId);}
 }
}
