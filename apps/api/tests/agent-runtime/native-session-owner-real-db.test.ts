import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgNativeOutputStaging } from "../../src/infrastructure/agent-run/pg-native-output-staging";
import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { readFile } from "node:fs/promises";
import { createHash,randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect } from "vitest";
import { seedOrg,addOrgMember,asOwner,asApp,ensureDatabase,migrateOnce,resetOrgs } from "../support/db";
import { addChatThread,addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgNativeSessionOwner } from "../../src/infrastructure/agent-run/pg-native-session-owner";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
const org=toOrgId('native-'+randomUUID()), parent='run-'+randomUUID();let db:PgDatabase;
async function seed(scope: typeof org, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
  await addOrgMember(scope,"intruder","consultant",null);
  await addChatThread({ orgId: scope, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: scope, id: `message-${scope}`, threadId: thread, body: "parent", authorId: "actor" });
  await asApp(scope, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,'t042','T042','enabled','actor',now(),now())`, [agent,scope]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
      skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','actor',now(),now())`,
    [version,scope,agent,createHash("sha256").update("pinned instructions").digest("hex")]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','queued')`,
    [id,scope,thread,`message-${scope}`,agent,version]);
  });
}

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);});
it('real PG persists encrypted binding across owner restart, rejects stale scope, confirms release',async()=>{
 let created=0,deleted=0;const token='a'.repeat(64);const transport={create:async()=>{created++;return {sessionId:randomUUID(),token,expiresAt:Date.now()+60000};},destroy:async()=>{deleted++;}};
 const owner=()=>new PgNativeSessionOwner(db,new PgParentRunControlReader(db),transport,'b'.repeat(64));
 const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};
 const ref=await owner().provision(ctx,[],{});const result=await owner().resolve(ref.bindingId,ctx);
 expect(result.token).toBe(token);
 const profile=await db.withTenant(org,async s=>(await s.query<{runtime_profile:string}>('SELECT runtime_profile FROM agent_runs WHERE org_id=$1 AND id=$2',[org,parent])).rows[0]!.runtime_profile);expect(profile).toBe('native-v1');expect((await owner().provision(ctx,[],{})).bindingId).toBe(ref.bindingId);expect(created).toBe(1);
 const rows=await db.withTenant(org,s=>s.query<{token_cipher:string}>('SELECT token_cipher FROM native_session_bindings WHERE org_id=$1',[org]));expect(rows.rows[0]!.token_cipher).not.toContain(token);
 await expect(owner().resolve(ref.bindingId,{...ctx,leaseEpoch:2})).rejects.toThrow('denied');
 await expect(owner().resolve(ref.bindingId,{...ctx,attemptId:'forged'})).rejects.toThrow('denied');
 await expect(owner().resolve(ref.bindingId,{...ctx,orgId:toOrgId('other-org')})).rejects.toThrow('denied');
 await db.withTenant(org,s=>s.query('UPDATE native_session_bindings SET expires_at=0 WHERE org_id=$1',[org]));
 await expect(owner().resolve(ref.bindingId,ctx)).rejects.toThrow('unavailable');
 await expect(owner().provision(ctx,[],{})).rejects.toThrow('unavailable');expect(created).toBe(1);
 await db.withTenant(org,s=>s.query('UPDATE native_session_bindings SET expires_at=$2 WHERE org_id=$1',[org,Date.now()+60000]));
 const unavailable=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),{...transport,destroy:async()=>{throw new Error('unavailable');}},'b'.repeat(64));
 await expect(unavailable.release(ref.bindingId,org,parent)).rejects.toThrow();
 await expect(owner().resolve(ref.bindingId,ctx)).rejects.toThrow('unavailable');
 await owner().releaseForRun(org,parent);await owner().releaseForRun(org,parent);
 await expect(owner().releaseForRun(org,'unknown-run')).rejects.toThrow('native_session_binding_unavailable');expect(deleted).toBe(1);
 await expect(owner().resolve(ref.bindingId,ctx)).rejects.toThrow('unavailable');
});
it('unknown creation persists failed state and never retries external creation',async()=>{
 const scope=toOrgId('native-failed-'+randomUUID()),run='failed-'+randomUUID();await seed(scope,run);
 try{
 await asApp(scope,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[run]));
 await asApp(scope,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),scope,run]));
 let calls=0;const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),{create:async()=>{calls++;throw new Error('secret unknown remote result');},destroy:async()=>{}},'b'.repeat(64));
 const ctx={orgId:scope,parentRunId:run,attemptId:run+':0',leaseEpoch:1};
 await expect(owner.provision(ctx,[],{})).rejects.toThrow('native_session_provision_failed_no_replay');
 await expect(owner.provision(ctx,[],{})).rejects.toThrow('native_session_existing_binding_unavailable');expect(calls).toBe(1);
 }finally{await resetOrgs(scope);}
});

it('migration replays and forced RLS remains enabled',async()=>{
 const sql=await readFile(new URL('../../migrations/20260908030000_native_session_bindings.sql',import.meta.url),'utf8');
 await asOwner(async c=>{await c.query(sql);await c.query(sql);const r=await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='native_session_bindings'");expect(r.rows[0]).toMatchObject({relrowsecurity:true,relforcerowsecurity:true});});
});
it.each(['cancel','db-write','compensation-fails'])('known create compensates %s and never publishes a stale binding',async mode=>{
 const scope=toOrgId('native-race-'+randomUUID()),run='race-'+randomUUID();await seed(scope,run);
 try{
 await asApp(scope,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[run]));
 await asApp(scope,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),scope,run]));
 let deleted=0,failReady=true;const transport={create:async()=>{
  if(mode!=='db-write')await asApp(scope,c=>c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE id=$1",[run]));
  return {sessionId:randomUUID(),token:'a'.repeat(64),expiresAt:Date.now()+60000};
 },destroy:async()=>{deleted++;if(mode==='compensation-fails')throw new Error('unavailable');}};
 const wrapped={withTenant:async(orgId:any,fn:any)=>db.withTenant(orgId,s=>fn({query:async(sql:string,args:any)=>{if(mode==='db-write'&&failReady&&sql.includes("status='ready'")){failReady=false;throw new Error('injected write failed');}return s.query(sql,args);}}))} as unknown as PgDatabase;
 const owner=new PgNativeSessionOwner(wrapped,new PgParentRunControlReader(db),transport,'b'.repeat(64));
 await expect(owner.provision({orgId:scope,parentRunId:run,attemptId:run+':0',leaseEpoch:1},[],{})).rejects.toThrow(mode==='compensation-fails'?'compensation_unconfirmed':'no_replay');
 expect(deleted).toBe(1);
 const row=await db.withTenant(scope,async s=>(await s.query<{status:string;token_cipher:string|null}>('SELECT status,token_cipher FROM native_session_bindings WHERE org_id=$1',[scope])).rows[0]!);
 expect(row.status).toBe(mode==='compensation-fails'?'release_pending':'released');expect(row.token_cipher===null).toBe(mode!=='compensation-fails');
 }finally{await resetOrgs(scope);}
});

it('PG recovery forwards stored native profile and actual remote thread identity',async()=>{
 const scope=toOrgId('native-recovery-'+randomUUID()),run='recovery-'+randomUUID();await seed(scope,run);
 try{
 await asApp(scope,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),model_provider='deep-agent',runtime_profile='native-v1',remote_run_id='remote',remote_thread_id='native-thread',lease_epoch=1,lease_expires_at=now()-interval '1 minute' WHERE id=$1",[run]));
 const calls:unknown[][]=[];
 const recovery=new PgRunRecovery(db,{heartbeatRun:async()=>{}} as never,{reconcileExistingRun:async(...args)=>{calls.push(args);return {kind:'running'};}});
 expect(await recovery.tick(scope)).toBe(1);
 expect(calls).toEqual([[`thread-${scope}`,'remote',run,'native-thread','native-v1']]);
 }finally{await resetOrgs(scope);}
});

it.each(['success','missing-stager','uncertain','paused','approval'])('native PG recovery lifecycle: %s',async mode=>{
 const scope=toOrgId('native-final-'+randomUUID()),run='final-'+randomUUID();await seed(scope,run);
 try{
 await asApp(scope,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),model_provider='deep-agent',runtime_profile='native-v1',remote_run_id='remote',remote_thread_id='native-thread',lease_epoch=1,lease_expires_at=now()-interval '1 minute',recovery_attempts=$2 WHERE id=$1",[run,mode==='uncertain'?4:0]));
 const file={name:'report.pdf',mime:'application/pdf',sizeBytes:42,objectKey:'persisted/report'};
 await asApp(scope,c=>c.query("INSERT INTO native_output_staging(id,org_id,run_id,idempotency_key,args_digest,sha256,file) VALUES($1,$2,$3,'once',$4,$4,$5::jsonb)",[randomUUID(),scope,run,'a'.repeat(64),JSON.stringify(file)]));
 const stager=new PgNativeOutputStaging(db,{} as never,{} as never,{} as never,{} as never);
 const releases:unknown[][]=[];
 const sessions={releaseForRun:async(...args:unknown[])=>{releases.push(args);}} as never;
 const result=mode==='paused'?{kind:'paused'}:mode==='approval'?{kind:'approval',toolName:'execute',argsSummary:'cmd'}:mode==='uncertain'?{kind:'uncertain',diagnostic:'unavailable'}:{kind:'success',completion:{text:'recovered'}};
 const recovery=new PgRunRecovery(db,new PgAgentRunRepository(db),{reconcileExistingRun:async()=>result} as never,mode==='missing-stager'?undefined:stager,sessions);
 await recovery.tick(scope);
 const row=await db.withTenant(scope,async s=>(await s.query<{status:string;model_output_files:unknown}>('SELECT status,model_output_files FROM agent_runs WHERE org_id=$1 AND id=$2',[scope,run])).rows[0]!);
 expect(row.status).toBe({success:'writeback_pending','missing-stager':'running',uncertain:'failed',paused:'paused',approval:'awaiting_tool_permission'}[mode]);
 if(mode==='success')expect(row.model_output_files).toEqual([file]);
 expect(releases).toEqual(mode==='success'||mode==='uncertain'?[[scope,run]]:[]);
 }finally{await resetOrgs(scope);}
});
