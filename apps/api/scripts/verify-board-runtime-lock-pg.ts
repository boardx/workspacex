import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {assertBoardRealFixtureTarget} from './support/board-real-model-fixture';
import {FULLSTACK_E2E as F} from '../../web/e2e/fullstack-smoke-fixture';

/** Manual root-session acceptance. Uses existing isolated fixture, no model requests. */
async function main(){
 assertBoardRealFixtureTarget(process.env);
 assert.equal(process.env.BOARD_RUNTIME_LOCK_PG_ACCEPTANCE,'1');
 const actor=process.env.BOARD_REAL_MODEL_ACTOR_ID;
 assert.equal(actor,`${F.agentId}-board-organize`,'prepare the dedicated Board fixture first');
 const output=process.env.BOARD_RUNTIME_LOCK_EVIDENCE;
 assert.ok(output,'explicit evidence output path required');
 await assert.rejects(access(output),{code:'ENOENT'},'use a new evidence path for each run');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const {asOwner,asApp}=await import('../tests/support/db');
 const reports:unknown[]=[];
 const baseline=await asOwner(async c=>(await c.query(`SELECT a.published_version_id,i.enabled,i.model_snapshot,i.skill_snapshot,
  (SELECT count(*)::int FROM agent_versions v WHERE v.org_id=$1 AND v.agent_id=$2) AS versions,
  (SELECT count(*)::int FROM whiteboard_operations WHERE org_id=$1) AS operations
  FROM agents a JOIN whiteboard_actor_identities i ON i.org_id=a.org_id AND i.actor_id=a.id
  WHERE a.org_id=$1 AND a.id=$2`,[F.orgId,actor])).rows);
 assert.equal(baseline.length,1);
 await asApp(F.orgId,async c=>{
  assert.equal((await c.query('SELECT current_user AS role')).rows[0].role,'app_rw');
  for(const [org,delegator] of [[`${F.orgId}-other`,F.userId],[F.orgId,`${F.userId}-other`]]){
   const deniedResult: {rows:Array<{binding:unknown}>}=await c.query('SELECT public.whiteboard_lock_ai_runtime($1,$2,$3) AS binding',[org,actor,delegator]);
   assert.equal(deniedResult.rows[0]!.binding,null);
  }
  await c.query('SAVEPOINT registry_permission');
  let denied=false;
  try{await c.query('UPDATE whiteboard_actor_identities SET enabled=false WHERE org_id=$1 AND actor_id=$2',[F.orgId,actor]);}
  catch(error){denied=(error as {code?:string}).code==='42501';}
  await c.query('ROLLBACK TO SAVEPOINT registry_permission');assert.equal(denied,true,'app_rw must not acquire registry UPDATE');
 });
 for(const action of ['publish','disable'] as const){
  await asOwner(async writer=>{
   await writer.query('BEGIN');await writer.query("SELECT set_config('app.current_org',$1,true)",[F.orgId]);
   await writer.query("SET LOCAL statement_timeout='12s'");
   const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
   const version=`board-lock-${randomUUID()}`;
   let pending:Promise<unknown>|undefined;
   try{
    if(action==='publish')await writer.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      SELECT $3,v.org_id,v.agent_id,$3,v.instruction_digest,v.instructions,v.skill_version_ids,v.model_provider,v.model_id,v.tool_policy,v.creator_id,now(),now()
      FROM agents a JOIN agent_versions v ON v.id=a.published_version_id AND v.org_id=a.org_id WHERE a.org_id=$1 AND a.id=$2`,[F.orgId,actor,version]);
    let settled=false,blocked=false;const started=performance.now();
    await asApp(F.orgId,async reader=>{
     const readerPid=(await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
     const binding=(await reader.query('SELECT public.whiteboard_lock_ai_runtime($1,$2,$3) AS binding',[F.orgId,actor,F.userId])).rows[0].binding;
     assert.equal(binding.agentVersionId,baseline[0].published_version_id);
     assert.equal(binding.actor.delegatedBy,F.userId);assert.ok(binding.actor.scopes.includes('board:write'));
     pending=(action==='publish'
      ?writer.query('UPDATE agents SET published_version_id=$3 WHERE org_id=$1 AND id=$2 RETURNING published_version_id',[F.orgId,actor,version])
      :writer.query('UPDATE whiteboard_actor_identities SET enabled=false WHERE org_id=$1 AND actor_id=$2 RETURNING enabled',[F.orgId,actor])).then(result=>{settled=true;assert.equal(result.rowCount,1);return result;});
     // Attach rejection immediately: timeout/error must fail, never become a false blocked observation.
     pending.catch(()=>{settled=true;});
     const deadline=performance.now()+5_000;
     while(performance.now()<deadline&&!settled){
      const pids=(await reader.query('SELECT pg_blocking_pids($1) AS pids',[writerPid])).rows[0].pids as number[];
      if(pids.includes(readerPid)){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
     }
     assert.equal(blocked,true,'actual PG blocker must be the app_rw runtime-lock transaction');
     assert.equal(settled,false,'mutation must still be waiting before reader commit');
    }); // asApp commits here; the writer can only complete after this releases locks.
    assert.ok(pending);await pending;
    const changed=await writer.query(action==='publish'?'SELECT published_version_id AS value FROM agents WHERE org_id=$1 AND id=$2':'SELECT enabled AS value FROM whiteboard_actor_identities WHERE org_id=$1 AND actor_id=$2',[F.orgId,actor]);
    assert.equal(changed.rows[0].value,action==='publish'?version:false);
    reports.push({action,blockedByAppTransaction:blocked,completedAfterCommit:true,elapsedMs:performance.now()-started});
   }finally{
    if(pending)await pending.catch(()=>undefined);
    await writer.query('ROLLBACK'); // Dedicated fixture always restored, including failure paths.
   }
  });
 }
 const final=await asOwner(async c=>(await c.query(`SELECT a.published_version_id,i.enabled,i.model_snapshot,i.skill_snapshot,
  (SELECT count(*)::int FROM agent_versions v WHERE v.org_id=$1 AND v.agent_id=$2) AS versions,
  (SELECT count(*)::int FROM whiteboard_operations WHERE org_id=$1) AS operations
  FROM agents a JOIN whiteboard_actor_identities i ON i.org_id=a.org_id AND i.actor_id=a.id
  WHERE a.org_id=$1 AND a.id=$2`,[F.orgId,actor])).rows);
 assert.deepEqual(final,baseline,'rejected calls and rolled-back probes must persist zero writes');
 await writeFile(output,JSON.stringify({kind:'board-runtime-lock-pg',sha,observedAt:new Date().toISOString(),appRole:'app_rw',tenantRejected:true,delegatorRejected:true,registryUpdateRejected:true,zeroPersistentWrites:true,reports},null,2),{mode:0o600,flag:'wx'});
 console.log('Board runtime PG lock acceptance passed; evidence written.');
}
main().catch(()=>{console.error('Board runtime PG lock acceptance failed; no passing evidence produced. Credentials and SQL error details are suppressed.');process.exitCode=1;});
