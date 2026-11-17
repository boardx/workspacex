// Explicit QA preparation for the one isolated stack04 fixture, not a product publishing API.
import { readFileSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve,dirname,basename,join,isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hash,requireFact,validateLaunch,validateBefore,assertAfter,appendFixtureVersion } from './lib/aidt-default-fixture-repair.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),mode=args[0]??'plan';
requireFact(['plan','apply'].includes(mode),'FIXTURE_PLAN_OR_APPLY_REQUIRED');
const privatePath=(name,external=true)=>{const p=process.env[name];requireFact(p&&isAbsolute(p)&&(!external||!resolve(p).startsWith(root+'/')),`ABSOLUTE_${name}_REQUIRED`);return resolve(p);};
const runtimeFile=privatePath('AIDT_FIXTURE_RUNTIME'),attestationFile=privatePath('AIDT_FIXTURE_LAUNCH_ATTESTATION',false),planFile=privatePath('AIDT_FIXTURE_REPAIR_PLAN');
const expectedVersion=process.env.AIDT_FIXTURE_EXPECTED_VERSION;requireFact(expectedVersion,'FIXTURE_EXPECTED_VERSION_REQUIRED');
requireFact(basename(dirname(runtimeFile))==='stack-context-04','ONLY_AUTHORIZED_STACK04_FIXTURE');
const runtime=JSON.parse(readFileSync(runtimeFile,'utf8')),attestation=JSON.parse(readFileSync(attestationFile,'utf8'));
const {deriveTestIsolation}=await import(pathToFileURL(join(root,'.harness/scripts/lib/test-isolation.ts')));
const iso=deriveTestIsolation({worktreePath:realpathSync(root),isolationId:runtime.isolation.WORKSPACEX_ISOLATION_SEED});
requireFact(iso.WORKSPACEX_DB===runtime.isolation.WORKSPACEX_DB&&iso.COMPOSE_PROJECT_NAME===runtime.composeProject,'FIXTURE_ISOLATION_MISMATCH');Object.assign(process.env,iso,runtime.isolation);
const port=spawnSync('docker',['compose','-f','apps/api/docker-compose.dev.yml','-p',runtime.composeProject,'port','postgres','5432'],{cwd:root,encoding:'utf8'}),publishedPort=port.stdout.trim().match(/:(\d+)$/)?.[1];requireFact(port.status===0&&publishedPort,'FIXTURE_ISOLATED_POSTGRES_UNAVAILABLE');process.env.PGPORT=publishedPort;
const {appConfig}=await import(pathToFileURL(join(root,'apps/api/src/infrastructure/db/pg-config.ts'))),{PgDatabase}=await import(pathToFileURL(join(root,'apps/api/src/infrastructure/db/pg-database.ts'))),{toOrgId}=await import(pathToFileURL(join(root,'apps/api/src/domain/org-id.ts'))),{FULLSTACK_E2E:fixture}=await import(pathToFileURL(join(root,'apps/web/e2e/fullstack-smoke-fixture.ts'))),{DEFAULT_AGENT_INSTRUCTIONS,DEFAULT_AGENT_STABLE_NAME}=await import(pathToFileURL(join(root,'apps/api/src/application/agent/ensure-default-agent.ts'))),{fullstackAgentInstructions}=await import(pathToFileURL(join(root,'apps/api/scripts/fixtures/fullstack-agent-instructions.ts'))),{insertAgentVersionFromDraft}=await import(pathToFileURL(join(root,'apps/api/src/infrastructure/agent/agent-version-insert.ts')));
requireFact(runtime.orgId===fixture.orgId&&runtime.fundedAdminEmail===fixture.adminEmail,'FIXTURE_RUNTIME_IDENTITY_MISMATCH');
const config=appConfig();requireFact(config.user==='app_rw'&&config.database===iso.WORKSPACEX_DB&&['127.0.0.1','localhost'].includes(config.host),'FIXTURE_APP_DATABASE_REQUIRED');
const ledgerPaths=JSON.parse(process.env.AIDT_FIXTURE_LEDGER_FILES??'[]');requireFact(Array.isArray(ledgerPaths)&&ledgerPaths.length>=2&&ledgerPaths.every(p=>isAbsolute(p)&&!resolve(p).startsWith(root+'/')),'FIXTURE_EXTERNAL_EXISTING_LEDGERS_REQUIRED');
const ledgerHashes=()=>Object.fromEntries(ledgerPaths.map(p=>[p,hash(readFileSync(p,'utf8'))]));
let cwdVerification='not-checked';
function verifyLaunch(){const pid=attestation.ownership?.api?.pid;requireFact(Number.isSafeInteger(pid),'FIXTURE_API_PID_REQUIRED');const stat=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');const actual={pid,state:fields[0],processGroup:Number(fields[2]),startTicks:Number(fields[19])};validateLaunch(attestation,actual);try{requireFact(realpathSync(`/proc/${pid}/cwd`)===join(root,'apps/api'),'FIXTURE_API_WORKSPACE_CHANGED');cwdVerification='direct-cwd';}catch(error){if(error?.code!=='EACCES')throw error;cwdVerification='owner-launch-only; direct-cwd-OS-EACCES';}}
verifyLaunch();const health=await fetch(runtime.apiOrigin+'/healthz',{signal:AbortSignal.timeout(5000)});requireFact(health.ok,'FIXTURE_API_HEALTH_REQUIRED');
const expected={orgId:fixture.orgId,agentId:fixture.agentId,actorId:fixture.adminUserId,stableName:DEFAULT_AGENT_STABLE_NAME,oldVersionId:expectedVersion,echoDigest:hash(fullstackAgentInstructions(undefined))};
const orgTables=['agent_runs','agent_run_context_snapshots','aidt_run_context_snapshots','aidt_run_context_applications','chat_messages','org_memberships','general_project_members','project_memberships','acl_bindings','capability_listings','org_agents','model_request_starts','token_usage_events','credit_consumption_requests'];
async function inspect(s,lock){
  const role=(await s.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  const agent=(await s.query(`SELECT to_jsonb(a) AS row FROM agents a WHERE org_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[expected.orgId,expected.agentId])).rows[0]?.row;requireFact(agent,'FIXTURE_AGENT_MISSING');
  const versions=(await s.query('SELECT to_jsonb(v) AS row FROM agent_versions v WHERE org_id=$1 AND agent_id=$2 ORDER BY id',[expected.orgId,expected.agentId])).rows.map(r=>r.row),version=versions.find(v=>v.id===expected.oldVersionId);requireFact(version,'FIXTURE_OLD_VERSION_MISSING');
  const membership=(await s.query('SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2',[expected.orgId,expected.actorId])).rows[0];
  const protectedRows={};for(const table of orgTables){const result=await s.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE org_id=$1 ORDER BY to_jsonb(t)::text`,[expected.orgId]);protectedRows[table]={count:result.rows.length,sha256:hash(result.rows.map(r=>r.row))};}
  const wallets=(await s.query("SELECT to_jsonb(w) AS row FROM credit_wallets w WHERE (owner_type='user' AND owner_id=$1) OR (owner_type='team' AND owner_id=$2) ORDER BY wallet_id",[expected.actorId,expected.orgId])).rows.map(r=>r.row);requireFact(wallets.some(w=>w.owner_type==='user'&&w.owner_id===expected.actorId),'FIXTURE_EXISTING_FUNDED_WALLET_REQUIRED');protectedRows.wallets={count:wallets.length,sha256:hash(wallets)};
  const counts=(await s.query("SELECT (SELECT count(*)::int FROM agent_runs WHERE org_id=$1 AND status NOT IN ('succeeded','failed','cancelled')) AS active,(SELECT count(*)::int FROM credit_consumption_requests WHERE org_id=$1 AND state<>'settled') AS unsettled",[expected.orgId])).rows[0];
  const accounting={...counts,held:wallets.reduce((v,w)=>v+BigInt(w.held_hundredths),0n).toString(),remainingHeld:wallets.reduce((v,w)=>v+BigInt(w.remaining_held_hundredths),0n).toString(),unbounded:wallets.reduce((v,w)=>v+BigInt(w.unbounded_requests),0n).toString()};
  return{role,agent,versions,version,membership,accounting,protected:protectedRows};
}
const db=new PgDatabase(config);let report;
try{report=await db.withTenant(toOrgId(expected.orgId),async session=>{
  if(mode==='plan')await session.query('SET TRANSACTION READ ONLY');
  const before=await inspect(session,mode==='apply');validateBefore(before,expected);verifyLaunch();
  const externalLedgers=ledgerHashes(),baseline={agentHash:hash(before.agent),oldVersionsHash:hash(before.versions),protected:before.protected,externalLedgers,apiPid:attestation.ownership.api.pid,apiStartTicks:attestation.ownership.api.startTicks};
  if(mode==='plan')return{schemaVersion:1,kind:'private-isolated-QA-fixture-append-only',...expected,canonicalDigest:hash(DEFAULT_AGENT_INSTRUCTIONS),newVersionId:`agent-version-fixture-${randomUUID()}`,semanticLabel:`fixture-canonical-default-${Date.now()}`,baseline,executorVerification:'owner-launch-attestation+current-PID-startTicks+health+tenant-DB; proc environ not read',cwdVerification,normalPublishApiVerified:false,modelRequests:0,createdAt:new Date().toISOString()};
  requireFact(process.env.AIDT_FIXTURE_APPLY_REVIEWED_PLAN==='1','FIXTURE_ROOT_REVIEW_REQUIRED');const plan=JSON.parse(readFileSync(planFile,'utf8')),proof=plan.planHash;delete plan.planHash;requireFact(hash(plan)===proof,'FIXTURE_APPROVED_PLAN_HASH_INVALID');
  requireFact(plan.kind==='private-isolated-QA-fixture-append-only'&&Object.entries(expected).every(([k,v])=>plan[k]===v)&&plan.canonicalDigest===hash(DEFAULT_AGENT_INSTRUCTIONS)&&hash(plan.baseline)===hash(baseline),'FIXTURE_PLAN_BASELINE_CHANGED');
  await appendFixtureVersion(session,before,plan,DEFAULT_AGENT_INSTRUCTIONS,insertAgentVersionFromDraft);const after=await inspect(session,false),newVersion=after.versions.find(v=>v.id===plan.newVersionId);requireFact(newVersion,'FIXTURE_NEW_VERSION_MISSING');assertAfter(before,after,newVersion,plan);requireFact(hash(ledgerHashes())===hash(externalLedgers),'FIXTURE_BUDGET_LEDGER_CHANGED');verifyLaunch();
  return{schemaVersion:1,kind:plan.kind,applied:true,orgId:plan.orgId,agentId:plan.agentId,oldVersionId:plan.oldVersionId,newVersionId:plan.newVersionId,oldInstructionDigest:plan.echoDigest,newInstructionDigest:plan.canonicalDigest,planHash:proof,protectedBefore:before.protected,protectedAfter:after.protected,oldVersionsUnchanged:true,modelPolicyPinsRoleFieldsUnchanged:true,onlyAgentPointerChanged:true,externalLedgersUnchanged:true,executorVerification:plan.executorVerification,normalPublishApiVerified:false,modelRequests:0,at:new Date().toISOString()};
});}finally{await db.close();}
if(mode==='plan'){report.planHash=hash(report);mkdirSync(dirname(planFile),{recursive:true,mode:0o700});writeFileSync(planFile,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});}else{writeFileSync(`${planFile}.applied.json`,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});}
console.log(JSON.stringify({mode,applied:report.applied??false,planFile,orgId:report.orgId,agentId:report.agentId,oldVersionId:report.oldVersionId,newVersionId:report.newVersionId,oldInstructionDigest:report.echoDigest??report.oldInstructionDigest,newInstructionDigest:report.canonicalDigest??report.newInstructionDigest,modelRequests:0}));
