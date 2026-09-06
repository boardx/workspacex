import { readFileSync } from "node:fs";
import { migrationFiles, MIGRATIONS_DIR } from "../../src/infrastructure/db/migrator";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { withRunLease, RunLeaseLostError } from "../../src/application/agent-run/run-lease";
import { randomUUID } from "node:crypto";
import { PgChatMessageCommandRepository } from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import type { ObjectStore } from "../../src/application/artifact/ports";
import { PgArtifactStore } from "../../src/infrastructure/artifacts-steering/pg-artifact-store";
import { PgArtifactContinuationReader } from "../../src/infrastructure/artifacts-steering/pg-artifact-continuation-reader";
import { registerRunArtifacts } from "../../src/infrastructure/artifacts-steering/register-run-artifacts";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const ORG="org-artifact-workbench", OTHER="org-artifact-workbench-other", THREAD="artifact-personal-thread", USER="artifact-user";
const org=toOrgId(ORG);
const db: DatabasePort={ withTenant:(id,fn)=>asApp(id,c=>fn({query:async(sql,params=[])=>({rows:(await c.query(sql,[...params])).rows})})),
  withoutTenant:async()=>{throw new Error("tenant required");},close:async()=>{} };
const store=new PgArtifactStore(db);
const bytes=new Map<string,Uint8Array>();
const objects: ObjectStore={get:async key=>bytes.get(key)??null,head:async key=>bytes.has(key)?{sizeBytes:bytes.get(key)!.length,mime:"text/plain"}:null,
  putOnce:async(key,data)=>{if(bytes.has(key))throw new Error("overwrite");bytes.set(key,data);} };

async function run(id:string) {
  await addChatMessage({orgId:ORG,id:`${id}-input`,threadId:THREAD,body:"change heading",authorId:USER});
  await asApp(ORG,async c=>{
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status)
      VALUES($1,$2,$3,$4,'artifact-agent','artifact-version','[]','deep-agent','deep-agent','running')`,[id,ORG,THREAD,`${id}-input`]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'accepted','succeeded',now(),now())`,[`${id}-step`,ORG,id]);
  });
}
async function output(runId:string,key:string,content:string) {
  bytes.set(key,Buffer.from(content));
  await addChatMessage({orgId:ORG,id:`${runId}-output`,threadId:THREAD,body:"file",authorId:"artifact-agent",agentId:"artifact-agent",authorKind:"agent"});
  await asApp(ORG,c=>c.query(`INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes)
    VALUES($1,$2,$3,$4,$5,'report.txt','text/plain',$6)`,[`${runId}-attachment`,ORG,THREAD,`${runId}-output`,key,Buffer.byteLength(content)]));
}
async function register(runId:string,key:string) {
  await db.withTenant(org,s=>registerRunArtifacts(s,{orgId:org,runId,threadId:THREAD,messageId:`${runId}-output`,
    files:[{name:"report.txt",mime:"text/plain",sizeBytes:bytes.get(key)!.length,objectKey:key}]}));
}

beforeAll(async()=>{await ensureDatabase();await migrateOnce();});
beforeEach(async()=>{
  bytes.clear();await resetOrgs(ORG,OTHER);
  await seedOrg({orgId:ORG,projectId:"artifact-project"});await seedOrg({orgId:OTHER,projectId:"artifact-other-project"});
  await addOrgMember(ORG,USER,"consultant",null);
  await addChatThread({orgId:ORG,id:THREAD,projectId:null,visibilityScope:"plenary",createdBy:USER});
  await asApp(ORG,async c=>{
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('artifact-agent',$1,'artifact-agent','artifact-agent','enabled',$2,now(),now())`,[ORG,USER]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES('artifact-version',$1,'artifact-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,$2,now(),now())`,[ORG,USER]);
  });
  await run("source-run");await output("source-run","object-v1","old version");await register("source-run","object-v1");
});

describe("artifact continuation over existing attachments",()=>{
  const artifactId="agent-artifact-source-run-attachment";
  it("takes one expired lease and reconciles completion without a new remote run",async()=>{
    await asApp(ORG,c=>c.query("UPDATE agent_runs SET lease_epoch=1,lease_expires_at=now()-interval '1 second',remote_run_id='existing-remote' WHERE org_id=$1 AND id='source-run'",[ORG]));
    const actual=new PgDatabase(appConfig());
    const reconcileExistingRun=vi.fn().mockResolvedValue({kind:"success",completion:{text:"Recovered actual response",finalMessageId:"recovered-ai"}});
    try{
      const journal=new PgAgentRunRepository(actual);
      await journal.appendExecutionEvent(org,"source-run",{kind:"text_delta",attemptId:"source-run:1",messageId:"source-run:1:recovered-ai",delta:"Recovered act"});
      const recovery=new PgRunRecovery(actual,new PgAgentRunRepository(actual),{reconcileExistingRun});
      expect(await recovery.tick(org)).toBe(1);expect(await recovery.tick(org)).toBe(0);
      expect(reconcileExistingRun).toHaveBeenCalledTimes(1);expect(reconcileExistingRun).toHaveBeenCalledWith(THREAD,"existing-remote","source-run");
      const saved=await asApp(ORG,c=>c.query("SELECT status,model_output,lease_epoch FROM agent_runs WHERE id='source-run'"));
      expect(saved.rows[0]).toMatchObject({status:"writeback_pending",model_output:"Recovered actual response",lease_epoch:2});
      const log=vi.fn();
      await writeBackPendingRuns({runs:new PgAgentRunRepository(actual),clock:{now:()=>new Date().toISOString(),newStepId:()=>randomUUID()},log},{orgId:org});
      const final=await asApp(ORG,c=>c.query("SELECT r.status,m.body FROM agent_runs r JOIN chat_messages m ON m.org_id=r.org_id AND m.agent_run_id=r.id WHERE r.id='source-run'"));
      expect(log).not.toHaveBeenCalled();expect(final.rows).toEqual([{status:"succeeded",body:"Recovered actual response"}]);
      const finalEvents=(await journal.readExecutionEvents(org,"source-run",-1)).filter(event=>event.kind==="final_message");
      expect(finalEvents).toHaveLength(1);expect(finalEvents[0]).toMatchObject({attemptId:"source-run:1",messageId:"source-run:1:recovered-ai"});
      await writeBackPendingRuns({runs:new PgAgentRunRepository(actual),clock:{now:()=>new Date().toISOString(),newStepId:()=>randomUUID()},log},{orgId:org});
      expect(reconcileExistingRun).toHaveBeenCalledTimes(1);
    }finally{await actual.close();}
  });
  it("fences old leases across all DB mutations while preserving nested transactions",async()=>{
    await asApp(ORG,c=>c.query("UPDATE agent_runs SET lease_epoch=2,lease_expires_at=now()+interval '2 minutes' WHERE org_id=$1 AND id='source-run'",[ORG]));
    const actual=new PgDatabase(appConfig());
    try{
      await expect(withRunLease({orgId:org,runId:"source-run",epoch:1,verify:async()=>{}},()=>actual.withTenant(org,s=>s.query("UPDATE agent_runs SET status='failed' WHERE id='source-run'")))).rejects.toBeInstanceOf(RunLeaseLostError);
      await withRunLease({orgId:org,runId:"source-run",epoch:2,verify:async()=>{}},()=>actual.withTenant(org,first=>actual.withTenant(org,async second=>{
        expect(first).toBe(second);await second.query("UPDATE agent_runs SET recovery_diagnostic='lease checked' WHERE org_id=$1 AND id='source-run'",[ORG]);
      })));
      const current=await asApp(ORG,c=>c.query("SELECT status,recovery_diagnostic FROM agent_runs WHERE id='source-run'"));
      expect(current.rows[0]).toMatchObject({status:"running",recovery_diagnostic:"lease checked"});
    }finally{await actual.close();}
  });
  it("reads source privacy facts through pinned version ancestry",async()=>{
    await asApp(ORG,c=>c.query("UPDATE chat_messages SET visibility_scope='private',raw_transcript=true WHERE org_id=$1 AND id='source-run-input'",[ORG]));
    await run("descendant-run");
    await asApp(ORG,c=>c.query("INSERT INTO agent_run_artifact_context(org_id,run_id,artifact_id,based_on_version) VALUES($1,'descendant-run',$2,1)",[ORG,artifactId]));
    await output("descendant-run","object-v2","derived content");await register("descendant-run","object-v2");
    const facts=await store.sourceMessageFacts(org,artifactId,2);
    expect(facts).toEqual(expect.arrayContaining([{id:"source-run-input",visibilityScope:"private",rawTranscript:true},
      {id:"descendant-run-input",visibilityScope:null,rawTranscript:false}]));
    expect(await store.sourceMessageFacts(toOrgId(OTHER),artifactId,2)).toEqual([]);
  });
  it("registers one version idempotently and retains personal thread guard",async()=>{
    await register("source-run","object-v1");
    expect(await store.findLocator(org,artifactId)).toEqual({threadId:THREAD,projectId:null});
    const guarded=await store.getArtifact(org,artifactId);
    expect(guarded).not.toBeNull();
    const rows=await asApp(ORG,c=>c.query("SELECT version,storage_key,attachment_id FROM agent_artifact_versions WHERE artifact_id=$1",[artifactId]));
    expect(rows.rows).toEqual([{version:1,storage_key:"object-v1",attachment_id:"source-run-attachment"}]);
    expect(await store.getArtifact(toOrgId(OTHER),artifactId)).toBeNull();
  });
  it("loads the explicit older base bytes and appends without changing old versions",async()=>{
    await run("edit-run");
    await asApp(ORG,c=>c.query("INSERT INTO agent_run_artifact_context(org_id,run_id,artifact_id,based_on_version) VALUES($1,'edit-run',$2,1)",[ORG,artifactId]));
    const prepared=await new PgArtifactContinuationReader(db,objects).prepare(org,"edit-run");
    expect(Buffer.from(prepared!.inputFiles[0]!.contentBase64,"base64").toString()).toBe("old version");
    await output("edit-run","object-v2","new version");await register("edit-run","object-v2");
    await register("edit-run","object-v2");
    const rows=await asApp(ORG,c=>c.query("SELECT version,storage_key,based_on_version FROM agent_artifact_versions WHERE artifact_id=$1 ORDER BY version",[artifactId]));
    expect(rows.rows).toEqual([{version:1,storage_key:"object-v1",based_on_version:null},{version:2,storage_key:"object-v2",based_on_version:1}]);
    expect(Buffer.from((await objects.get("object-v1"))!).toString()).toBe("old version");
    const stillOld=await new PgArtifactContinuationReader(db,objects).prepare(org,"edit-run");
    expect(Buffer.from(stillOld!.inputFiles[0]!.contentBase64,"base64").toString()).toBe("old version");
  });
  it("accepts the edit and pinned version atomically and deduplicates retried requests",async()=>{
    const commands=new PgChatMessageCommandRepository(db);
    const request={projectId:null,threadId:THREAD,actorId:USER,clientMessageId:randomUUID(),text:"edit old version",selectedAgentId:"artifact-agent",
      messageId:randomUUID(),runId:randomUUID(),snapshot:{agentId:"artifact-agent",agentVersionId:"artifact-version",skillVersionIds:[],modelProvider:"deep-agent",modelId:"deep-agent",instructions:"test"},
      artifactContinuation:{artifactId,basedOnVersion:1}};
    await Promise.all([commands.accept(org,request),commands.accept(org,{...request,messageId:randomUUID(),runId:randomUUID()})]);
    const result=await asApp(ORG,c=>c.query("SELECT c.based_on_version,r.status FROM agent_run_artifact_context c JOIN agent_runs r ON r.id=c.run_id AND r.org_id=c.org_id WHERE c.org_id=$1",[ORG]));
    expect(result.rows).toEqual([{based_on_version:1,status:"queued"}]);
    const invalid={...request,clientMessageId:randomUUID(),messageId:randomUUID(),runId:randomUUID(),artifactContinuation:{artifactId,basedOnVersion:999}};
    await expect(commands.accept(org,invalid)).rejects.toThrow("ARTIFACT_VERSION_NOT_FOUND");
    const missing=await asApp(ORG,c=>c.query("SELECT id FROM agent_runs WHERE id=$1",[invalid.runId]));
    expect(missing.rows).toEqual([]);
  });

  it("replays workbench migrations without changing cancellation, approval identities or registered continuation attachments", async () => {
    const repo = new PgAgentRunRepository(db);
    await run("cancelled-replay");
    await repo.requestCancellation(org, "cancelled-replay");
    await repo.cancelAtCheckpoint(org, "cancelled-replay");
    await run("approval-replay");
    await repo.markAwaitingToolPermission(org, "approval-replay", {toolName: "call_skill", argsSummary: "summary"});
    const approvalBefore = await asApp(ORG, c => c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='approval-replay'", [ORG]));
    await run("registered-edit");
    await asApp(ORG, c => c.query("INSERT INTO agent_run_artifact_context(org_id,run_id,artifact_id,based_on_version) VALUES($1,'registered-edit',$2,1)", [ORG, artifactId]));
    await output("registered-edit", "object-replay-v2", "retained bytes");
    await register("registered-edit", "object-replay-v2");
    await asApp(ORG, c => c.query("UPDATE chat_messages SET agent_run_id='registered-edit' WHERE org_id=$1 AND id='registered-edit-output'", [ORG]));
    await repo.storeOutputAwaitingWriteback(org, "registered-edit", {text: "done", finalStepSeq: 2});
    await asApp(ORG, c => c.query("UPDATE agent_runs SET status='succeeded' WHERE org_id=$1 AND id='registered-edit'", [ORG]));
    const before = await asApp(ORG, c => c.query("SELECT id,artifact_id,version,attachment_id,storage_key FROM agent_artifact_versions WHERE org_id=$1 ORDER BY id", [ORG]));
    const replayFiles = migrationFiles().filter(name => /^202609070(?:1[0-9]|2[01])000_/.test(name));
    expect(replayFiles).toHaveLength(12);
    // Owner is used only to apply DDL, exactly as production migration repair does.
    // Every preservation assertion below goes back through tenant-scoped app access.
    await asOwner(async c => {
      for (const name of replayFiles) {
        await c.query("BEGIN");
        try { await c.query(readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8")); await c.query("COMMIT"); }
        catch (error) { await c.query("ROLLBACK"); throw error; }
      }
    });
    const after = await asApp(ORG, c => c.query("SELECT id,artifact_id,version,attachment_id,storage_key FROM agent_artifact_versions WHERE org_id=$1 ORDER BY id", [ORG]));
    expect(after.rows).toEqual(before.rows);
    expect((await asApp(ORG, c => c.query("SELECT id FROM agent_artifacts WHERE org_id=$1 AND id='agent-artifact-registered-edit-attachment'", [ORG]))).rows).toEqual([]);
    expect((await asApp(ORG, c => c.query("SELECT status FROM agent_runs WHERE org_id=$1 AND id='cancelled-replay'", [ORG]))).rows[0].status).toBe("cancelled");
    expect((await asApp(ORG, c => c.query("SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id='approval-replay'", [ORG]))).rows).toEqual(approvalBefore.rows);
    expect(await objects.get("object-replay-v2")).toEqual(Buffer.from("retained bytes"));
  });

  it("missing output cannot create a fake continuation version",async()=>{
    await run("failed-edit");
    await asApp(ORG,c=>c.query("INSERT INTO agent_run_artifact_context(org_id,run_id,artifact_id,based_on_version) VALUES($1,'failed-edit',$2,1)",[ORG,artifactId]));
    await expect(db.withTenant(org,s=>registerRunArtifacts(s,{orgId:org,runId:"failed-edit",threadId:THREAD,messageId:"none",files:[]})))
      .rejects.toThrow("unambiguous revised file");
    const rows=await asApp(ORG,c=>c.query("SELECT count(*)::int AS count FROM agent_artifact_versions WHERE artifact_id=$1",[artifactId]));
    expect(rows.rows[0].count).toBe(1);
  });
});
