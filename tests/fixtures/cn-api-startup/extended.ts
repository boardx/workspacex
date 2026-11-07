/** Isolated PG extensions: original retention SQL/executor, HTTP synthetic model boundary. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {migrationFiles,MIGRATIONS_DIR} from '../../../apps/api/src/infrastructure/db/migrator';
import {migrationConfig,appConfig} from '../../../apps/api/src/infrastructure/db/pg-config';
import {PgDatabase} from '../../../apps/api/src/infrastructure/db/pg-database';
import {sweepDebugEvents} from '../../../apps/api/src/infrastructure/diagnostics/pg-debug-event-store';
import {sweepExpiredErrorLogs} from '../../../apps/api/src/infrastructure/logging/pg-error-log-writer';
import {AgentRunExecutor} from '../../../apps/api/src/infrastructure/agent-run/agent-run-executor';
import {PgAgentRunRepository} from '../../../apps/api/src/infrastructure/agent-run/pg-agent-run-repository';
import {toOrgId} from '../../../apps/api/src/domain/org-id';
import {seedOrg,addOrgMember,asApp} from '../../../apps/api/tests/support/db';
import {addChatThread,addChatMessage} from '../../../apps/api/tests/support/chat-db';
import {startupDiagnostic} from './diagnostic';
const pg=createRequire(new URL('../../../apps/api/package.json',import.meta.url))('pg');
const need=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
const root=fileURLToPath(new URL('../../../',import.meta.url));
const controlSourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000}).trim();
need(/^[a-f0-9]{40}$/.test(controlSourceSha),'CONTROL_SOURCE_SHA');
const sourceHashes=Object.fromEntries(['apps/api/src/infrastructure/diagnostics/pg-debug-event-store.ts','apps/api/src/infrastructure/logging/pg-error-log-writer.ts','apps/api/src/infrastructure/agent-run/agent-run-executor.ts','apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts'].map(p=>[p,createHash('sha256').update(readFileSync(root+p)).digest('hex')]));
const [scenario,output]=process.argv.slice(2);const started=Date.now(),checks:string[]=[];
need(['retention-extended','queued-worker-extended'].includes(scenario),'SCENARIO');
need(process.env.CN_API_STARTUP_FIXTURE==='1'&&process.env.PGHOST==='127.0.0.1'&&/^cn_startup_[a-f0-9]{16}$/.test(process.env.PGDATABASE??''),'ISOLATED_DATABASE');
const owner=new pg.Client({...migrationConfig(),query_timeout:120000});const db=new PgDatabase(appConfig());
let stage='clone-readback';let provider:ReturnType<typeof createServer>|undefined;let requests=0;
try{
 await owner.connect();const names=migrationFiles();const rows=(await owner.query('SELECT name,checksum FROM _kernel_migrations ORDER BY name')).rows;
 need(rows.length===names.length&&rows.every((x:any,i:number)=>x.name===names[i]&&x.checksum===createHash('sha256').update(readFileSync(MIGRATIONS_DIR+'/'+x.name)).digest('hex')),'EXACT_BASELINE_MIGRATIONS');
 need((await owner.query('TABLE cn_template_canary')).rows[0]?.value==='pristine-baseline','FRESH_BASELINE_REQUIRED');
 await owner.query('UPDATE cn_template_canary SET value=$1',[scenario]);
 if(scenario==='retention-extended'){
  stage='exact-age-boundaries';
  // Freeze PostgreSQL now() in the SAME real app-role transaction that runs original sweep SQL.
  await db.withoutTenant(async session=>{
   const anchor=(await session.query<{anchor:string}>('SELECT now()::text AS anchor')).rows[0]!.anchor;
   for(const [table,days] of [['error_logs',30],['debug_events',7]] as const){
    await owner.query(`DELETE FROM ${table}`);
    const fields=table==='error_logs'?'trace_id,msg,detail,created_at':'trace_id,kind,level,msg,created_at';
    const values=table==='error_logs'?"$1,'synthetic','{}',$2::timestamptz-($3::int*interval '1 day')+($4::int*interval '1 microsecond')":"$1,'fixture','info','synthetic',$2::timestamptz-($3::int*interval '1 day')+($4::int*interval '1 microsecond')";
    for(const [tag,offset] of [['before',-1],['equal',0],['after',1]] as const)await owner.query(`INSERT INTO ${table}(${fields}) VALUES(${values})`,['cn-boundary-'+tag,anchor,days,offset]);
   }
   // Only the connection/transaction boundary is pinned; original functions and SQL are unchanged.
   const pinned={withoutTenant:async(fn:any)=>fn(session)} as any;
   need((await sweepExpiredErrorLogs(pinned)).ok,'ERROR_SWEEP');need((await sweepDebugEvents(pinned)).ok,'DEBUG_SWEEP');
  });
  for(const table of ['error_logs','debug_events']){
   const got=(await owner.query(`SELECT trace_id FROM ${table} ORDER BY trace_id`)).rows.map((x:any)=>x.trace_id);
   need(JSON.stringify(got)===JSON.stringify(['cn-boundary-after','cn-boundary-equal']),'STRICT_LESS_THAN_BOUNDARY');
  }
  checks.push('original_error_30day_and_debug_7day_exact_microsecond_boundary');
  stage='actual-500001-row-limit';await owner.query('DELETE FROM debug_events');
  await owner.query("INSERT INTO debug_events(trace_id,kind,level,msg,created_at) SELECT 'cn-limit-'||i,'fixture','info','synthetic',now() FROM generate_series(1,500001) i");
  const first=(await owner.query('SELECT min(id)::text AS first,max(id)::text AS last,count(*)::int AS n FROM debug_events')).rows[0];need(first.n===500001,'REAL_ROW_COUNT');
  need((await sweepDebugEvents(db)).ok,'REAL_LIMIT_SWEEP');
  const after=(await owner.query('SELECT min(id)::text AS first,max(id)::text AS last,count(*)::int AS n FROM debug_events')).rows[0];
  need(after.n===500000&&BigInt(after.first)===BigInt(first.first)+1n&&after.last===first.last,'EXACT_NEWEST_500000');
  need((await sweepDebugEvents(db)).ok,'SECOND_LIMIT_SWEEP');
  const again=(await owner.query('SELECT min(id)::text AS first,max(id)::text AS last,count(*)::int AS n FROM debug_events')).rows[0];need(JSON.stringify(again)===JSON.stringify(after),'RETENTION_IDEMPOTENCE');
  checks.push('original_default_500001_to_500000_preserves_newest_ids','repeat_retention_idempotent');
 }else{
  stage='real-worker-seed';const org='org-cn-worker',project='project-cn-worker',actor='user-cn-worker';
  await seedOrg({orgId:org,projectId:project});await addOrgMember(org,actor,'consultant',null);
  await asApp(org,async c=>{
   await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('agent-cn-worker',$1,'cn-worker','synthetic','enabled',$2,now(),now())",[org,actor]);
   await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('version-cn-worker',$1,'agent-cn-worker','v1',repeat('a',64),'synthetic','{}','chat','fixture','[]',$2,now(),now())",[org,actor]);
  });
  let responseMode='success';
  provider=createServer((req,res)=>{if(req.method!=='POST'||req.url!=='/complete'){res.writeHead(404);res.end();return;}requests++;req.resume();req.once('end',()=>{res.writeHead(responseMode==='failure'?503:200,{'content-type':'application/json'});res.end(JSON.stringify({text:'synthetic-worker-response'}));});});
  await new Promise<void>(resolve=>provider!.listen(0,'127.0.0.1',resolve));const address=provider.address();need(address&&typeof address!=='string','PROVIDER_ADDRESS');
  const url='http://127.0.0.1:'+(address as any).port+'/complete';
  const model={async complete(){const r=await fetch(url,{method:'POST',body:'{}',signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw Error('SYNTHETIC_MODEL_UNAVAILABLE');return r.json();}};
  const logger={info(){},warn(){},debug(){},error(){}} as any;
  const executor=()=>new AgentRunExecutor(new PgAgentRunRepository(db),model,logger,false);
  const read=async(id:string)=>(await owner.query('SELECT status,writeback_attempts FROM agent_runs WHERE id=$1',[id])).rows[0];
  const messageCount=async(id:string)=>Number((await owner.query('SELECT count(*) AS n FROM chat_messages WHERE agent_run_id=$1',[id])).rows[0].n);
  const messageBody=async(id:string)=>(await owner.query('SELECT body FROM chat_messages WHERE agent_run_id=$1',[id])).rows[0]?.body;
  async function seed(id:string){await addChatThread({orgId:org,id:'thread-'+id,projectId:project,visibilityScope:'plenary',createdBy:actor});await addChatMessage({orgId:org,id:'input-'+id,threadId:'thread-'+id,body:'synthetic task',authorId:actor});await asApp(org,c=>c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,'agent-cn-worker','version-cn-worker','[]','chat','fixture','queued')",[id,org,'thread-'+id,'input-'+id]));}
  stage='concurrent-real-claim-and-writeback';await seed('run-cn-worker-success');
  await Promise.all([executor().tick(toOrgId(org)),executor().tick(toOrgId(org))]);
  need((await read('run-cn-worker-success')).status==='succeeded'&&(await read('run-cn-worker-success')).writeback_attempts===0&&await messageCount('run-cn-worker-success')===1&&requests===1,'EXACT_ONCE_CLAIM_WRITEBACK');
  await executor().tick(toOrgId(org));need(requests===1&&await messageCount('run-cn-worker-success')===1,'NO_TERMINAL_REEXECUTION');
  need(await messageBody('run-cn-worker-success')==='synthetic-worker-response','ACTUAL_MODEL_OUTPUT_WRITEBACK');
  checks.push('real_concurrent_executor_claim_one_http_model_call_one_message');
  stage='writeback-fault';await seed('run-cn-worker-writeback');
  await owner.query("CREATE FUNCTION cn_deny_worker_writeback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.agent_run_id='run-cn-worker-writeback' THEN RAISE EXCEPTION 'synthetic writeback denial'; END IF; RETURN NEW; END $$; CREATE TRIGGER cn_deny_worker_writeback BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION cn_deny_worker_writeback()");
  await executor().tick(toOrgId(org));need((await read('run-cn-worker-writeback')).status==='writeback_pending'&&(await read('run-cn-worker-writeback')).writeback_attempts===1&&await messageCount('run-cn-worker-writeback')===0&&requests===2,'FAULT_MUST_REMAIN_PENDING');
  await owner.query('DROP TRIGGER cn_deny_worker_writeback ON chat_messages');
  await Promise.all([executor().tick(toOrgId(org)),executor().tick(toOrgId(org))]);
  need((await read('run-cn-worker-writeback')).status==='succeeded'&&(await read('run-cn-worker-writeback')).writeback_attempts===1&&await messageCount('run-cn-worker-writeback')===1&&requests===2,'RECOVERY_WITHOUT_MODEL_REPLAY');
  await executor().tick(toOrgId(org));need(await messageCount('run-cn-worker-writeback')===1&&requests===2,'RECOVERY_IDEMPOTENT');
  need(await messageBody('run-cn-worker-writeback')==='synthetic-worker-response','RECOVERED_ORIGINAL_MODEL_OUTPUT');
  checks.push('actual_writeback_transaction_failure_new_executor_recovery_no_model_replay');
  stage='provider-fault';responseMode='failure';await seed('run-cn-worker-provider');await executor().tick(toOrgId(org));
  need((await read('run-cn-worker-provider')).status==='failed'&&await messageCount('run-cn-worker-provider')===0&&requests===3,'PROVIDER_FAILURE_TERMINAL');
  await executor().tick(toOrgId(org));need(requests===3&&await messageCount('run-cn-worker-provider')===0,'FAILED_RUN_NOT_REEXECUTED');
  checks.push('synthetic_http_provider_failure_durable_terminal_no_retry');
 }
 writeFileSync(output,JSON.stringify({kind:'cn-api-startup-extension-v1',scenario,verified:true,checks,controlSourceSha,sourceHashes,candidateExactSourceTested:false,applicationScope:'control-checkout-isolated-simulation',verifiedMigrationClone:true,migrationCount:names.length,modelBoundary:scenario==='queued-worker-extended'?'synthetic-loopback-http':'none',modelRequests:requests,productionAccepted:false,fullNestCompositionTested:false,durationSeconds:(Date.now()-started)/1000})+'\n',{flag:'wx',mode:0o600});
}catch(error){writeFileSync(output,JSON.stringify({kind:'cn-api-startup-extension-v1',scenario,verified:false,stage,checks,controlSourceSha,sourceHashes,candidateExactSourceTested:false,diagnostic:startupDiagnostic(error),productionAccepted:false})+'\n',{flag:'wx',mode:0o600});process.exitCode=1;}
finally{await db.close();await owner.end();if(provider)await new Promise<void>(resolve=>{provider!.close(()=>resolve());provider!.closeAllConnections();});}
