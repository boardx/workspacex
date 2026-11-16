/** QA-only fresh-seed reader; no restore branch, HTTP, dispatch, migrations, or data writes. */
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,realpathSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {z} from 'zod';
import {deriveTestIsolation} from '../../../../.harness/scripts/lib/test-isolation';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {resolveVisibility} from '../../src/application/chat/resolve-visibility';
import {discloseDecided,guard,isDisclosed} from '../../src/application/security/permission-filter';
import {toOrgId} from '../../src/domain/org-id';
const id=z.string().min(1).max(256),sha=z.string().regex(/^[a-f0-9]{64}$/);
const Request=z.object({orgId:id,userId:id,projectId:id.optional(),threadId:id.optional(),runIds:z.array(id).max(32).default([]),expectNoRuns:z.boolean().default(false),expectedAgentVersionId:id.optional(),expectedInstructionDigest:sha.optional()}).strict();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function need(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
async function audit(runtimePath:string,requestPath:string,outputPath:string){
 need([runtimePath,requestPath,outputPath].every(isAbsolute),'ABSOLUTE_PATHS_REQUIRED');
 need(resolve(outputPath).startsWith('/workspace/scratch/aidt-source-audit-20261116/'),'OWNED_AUDIT_OUTPUT_REQUIRED');
 const runtime=JSON.parse(readFileSync(runtimePath,'utf8')) as {isolation:Record<string,string>;composeProject:string;restoreReceiptFile?:unknown;restoredCheckpoint?:unknown};
 need(!runtime.restoreReceiptFile&&!runtime.restoredCheckpoint,'FRESH_SEED_RUNTIME_REQUIRED');
 const request=Request.parse(JSON.parse(readFileSync(requestPath,'utf8'))),repo=realpathSync('/workspace/aidt-module-latest');
 need((!!request.projectId)===(!!request.threadId),'PROJECT_THREAD_PAIR_REQUIRED');
 need(!request.runIds.length||request.projectId,'RUN_PROJECT_SCOPE_REQUIRED');
 const seed=runtime.isolation?.WORKSPACEX_ISOLATION_SEED;need(seed,'ISOLATION_SEED_REQUIRED');
 const derived=deriveTestIsolation({worktreePath:repo,isolationId:seed});
 need(derived.WORKSPACEX_DB===runtime.isolation.WORKSPACEX_DB&&derived.COMPOSE_PROJECT_NAME===runtime.composeProject,'ISOLATION_SCOPE_MISMATCH');
 Object.assign(process.env,derived,runtime.isolation);
 const binding=execFileSync('docker',['compose','-f',`${repo}/apps/api/docker-compose.dev.yml`,'-p',runtime.composeProject,'port','postgres','5432'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const port=/^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];need(port,'OWNED_LOOPBACK_DATABASE_REQUIRED');process.env.PGPORT=port;
 const config={...appConfig(),options:'-c default_transaction_read_only=on'};
 need(config.user==='app_rw'&&config.host==='127.0.0.1'&&config.database===derived.WORKSPACEX_DB,'APPLICATION_READ_ONLY_DATABASE_REQUIRED');
 const db=new PgDatabase(config,{info(){},error(){}}),orgId=toOrgId(request.orgId);
 try{return await db.withTenant(orgId,async session=>{
  const mode=(await session.query<{transaction_read_only:string}>('SHOW transaction_read_only')).rows[0];need(mode?.transaction_read_only==='on','READ_ONLY_REQUIRED');
  const identity=new PgIdentityRepository(db),orgMember=await identity.findOrgMembership(request.userId,orgId);need(orgMember,'ACTUAL_ORG_MEMBERSHIP_REQUIRED');
  const org=(await session.query<{status:string;kind:string}>('SELECT status,kind FROM organizations WHERE id=$1',[orgId])).rows[0];need(org?.status==='active','ACTIVE_ORG_REQUIRED');
  const totals=(await session.query<Record<string,string>>(`SELECT (SELECT count(*)::text FROM agent_runs WHERE org_id=$1) AS runs,(SELECT count(*)::text FROM aidt_run_context_snapshots WHERE org_id=$1) AS snapshots,(SELECT count(*)::text FROM aidt_run_context_applications WHERE org_id=$1) AS applications,(SELECT count(*)::text FROM model_request_starts WHERE org_id=$1) AS physical,(SELECT count(*)::text FROM token_usage_events WHERE org_id=$1) AS usage,(SELECT count(*)::text FROM credit_consumption_requests WHERE org_id=$1) AS credits`,[orgId])).rows[0]!;
  if(request.expectNoRuns)need(Object.values(totals).every(n=>n==='0'),'FRESH_ORG_ZERO_RUN_BASELINE_REQUIRED');
  let group:unknown=null,sources:unknown[]=[],runs:unknown[]=[];
  if(request.projectId&&request.threadId){
   const standing=await identity.findNonWorkshopStanding(request.userId,request.projectId,orgId);need(standing?.memberRole,'EXPLICIT_GROUP_MEMBERSHIP_REQUIRED');
   const visibility=await resolveVisibility({repo:identity,chat:new PgChatRepository(db),ids:{next:randomUUID}},{orgId,userId:request.userId,projectId:request.projectId,threadId:request.threadId});need(visibility.kind==='allow'&&visibility.thread.projectId===request.projectId,'ACTUAL_THREAD_ACCESS_REQUIRED');
   const p=(await session.query<{status:string;kind:string;aidt:boolean}>(`SELECT p.status,p.kind,EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AS aidt FROM projects p WHERE p.org_id=$1 AND p.id=$2`,[orgId,request.projectId])).rows[0];need(p?.status==='active'&&p.kind==='general'&&p.aidt,'ACTIVE_AIDT_GROUP_REQUIRED');
   group={projectId:request.projectId,threadId:request.threadId,projectStatus:p.status,memberRole:standing.memberRole,resolvedProjectRole:visibility.actor.projectRole,threadArchived:visibility.thread.archived};
   const saved=await session.query<{stage_id:number;revision:number;content:unknown;source_stage_revisions:unknown;updated_by:string;updated_at:Date}>('SELECT stage_id,revision,content,source_stage_revisions,updated_by,updated_at FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 ORDER BY stage_id,revision',[orgId,request.projectId]);
   const disclosed=discloseDecided(guard({kind:'project',id:request.projectId},saved.rows),visibility.base);need(isDisclosed(disclosed),'SOURCES_NOT_DISCLOSED');
   sources=disclosed.payload.map(row=>({stageId:row.stage_id,revision:row.revision,contentHash:hash(JSON.stringify(row.content)),sourceStageRevisions:row.source_stage_revisions,updatedByHash:hash(row.updated_by),updatedAt:row.updated_at}));
   for(const runId of request.runIds){
    const row=(await session.query<{id:string;thread_id:string;status:string;agent_version_id:string;remote_run_id:string|null;instruction_digest:string;instructions:string}>(`SELECT r.id,r.thread_id,r.status,r.agent_version_id,r.remote_run_id,v.instruction_digest,v.instructions FROM agent_runs r JOIN agent_versions v ON v.org_id=r.org_id AND v.id=r.agent_version_id WHERE r.org_id=$1 AND r.id=$2`,[orgId,runId])).rows[0];need(row?.thread_id===request.threadId,'ACTUAL_RUN_THREAD_REQUIRED');
    const instructionHash=hash(row.instructions);need(instructionHash===row.instruction_digest,'ACTUAL_AGENT_INSTRUCTION_DIGEST_MISMATCH');
    if(request.expectedAgentVersionId)need(row.agent_version_id===request.expectedAgentVersionId,'EXPECTED_CANONICAL_AGENT_VERSION_MISMATCH');
    if(request.expectedInstructionDigest)need(instructionHash===request.expectedInstructionDigest,'EXPECTED_CANONICAL_AGENT_INSTRUCTIONS_MISMATCH');
    const physical=(await session.query('SELECT id,user_id,execution_attempt_id,project_id,thread_id,started_at,occurred_at FROM model_request_starts WHERE org_id=$1 AND run_id=$2 ORDER BY occurred_at,id',[orgId,runId])).rows;
    const usage=(await session.query('SELECT id,user_id,outcome,total_source,tokens_total,tokens_prompt,tokens_completion,occurred_at FROM token_usage_events WHERE org_id=$1 AND run_id=$2 ORDER BY occurred_at,id',[orgId,runId])).rows;
    const credits=(await session.query('SELECT request_id,user_id,state,reserved_hundredths,debited_hundredths,created_at,settled_at FROM credit_consumption_requests WHERE org_id=$1 AND run_id=$2 ORDER BY created_at,request_id',[orgId,runId])).rows;
    need([...physical,...usage,...credits].every(r=>r.user_id===request.userId),'ACTUAL_ACCOUNTING_PRINCIPAL_MISMATCH');
    need(physical.every(r=>r.project_id===request.projectId&&r.thread_id===request.threadId),'PHYSICAL_THREAD_SCOPE_MISMATCH');
    const sanitize=(rows:Record<string,unknown>[])=>rows.map(({user_id,...r})=>({...r,principalUserIdHash:hash(String(user_id))}));
    runs.push({runId,status:row.status,agentVersionId:row.agent_version_id,instructionDigest:instructionHash,remoteRunIdHash:row.remote_run_id?hash(row.remote_run_id):null,physical:sanitize(physical),usage:sanitize(usage),credits:sanitize(credits),storedZeroDoesNotProveZeroConsumption:true,supplierBillIndependentlyVerified:false});
   }
  }
  const report={kind:'fresh-seed-independent-source-scope-ledger-audit',at:new Date().toISOString(),orgId:request.orgId,principalUserIdHash:hash(request.userId),orgRole:orgMember.orgRole,orgStatus:org.status,freshDeriveScopeVerified:true,restoreAdapterUsed:false,initialZeroRunBaselineRequired:request.expectNoRuns,orgTotals:totals,group,savedSources:sources,runs,rawStudentTextIncluded:false,privateConfigurationIncluded:false,databaseReadOnly:true,modelRequestsSent:0,financialWrites:0,budgetEnforcementPerformed:false};
  mkdirSync(dirname(outputPath),{recursive:true,mode:0o700});writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});return {status:'audited',reportPath:outputPath,runCount:runs.length};
 });}finally{await db.close();}
}
const [runtimePath,requestPath,outputPath]=process.argv.slice(2);
if(!runtimePath||!requestPath||!outputPath){console.error('AUDIT_EXPLICIT_PATHS_REQUIRED');process.exitCode=2;}
else await audit(runtimePath,requestPath,outputPath).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(e.message)?e.message:'AUDIT_FAILED_CLOSED');process.exitCode=1;});
