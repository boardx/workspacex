import { executeQueuedRuns } from "../../src/application/agent-run/execute-run";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import type { NativeSessionOwner } from "../../src/application/agent-run/native-session-owner";
import { PgPlanLedgerRepository } from "../../src/infrastructure/plan-control/pg-plan-ledger-repository";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { seedOrg, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toOrgId } from "../../src/domain/org-id";
const org=toOrgId("runtime-profile-"+randomUUID());let db:PgDatabase;
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

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());});
afterAll(async()=>{await db?.close();});
it.each(["legacy","native-v1"] as const)("claim preserves durable %s profile across repository restart and approval requeue",async(profile)=>{
  const scope=toOrgId("profile-"+randomUUID()),run="run-"+randomUUID();
  await seed(scope,run);
  try {
    await new PgAgentRunRepository(db).claimQueued(scope,1);
    await asApp(scope,c=>c.query("UPDATE agent_runs SET runtime_profile=$2, status='awaiting_tool_permission', pending_tool_name='execute', lease_epoch=1 WHERE id=$1",[run,profile]));
    expect(await new PgAgentRunRepository(db).approveAndRequeue(scope,run)).toBe(true);
    const restarted=new PgDatabase(appConfig());
    try {
      const [outcome]=await new PgAgentRunRepository(restarted).claimQueued(scope,1);
      expect(outcome).toMatchObject({kind:"executable",run:{runtimeProfile:profile,leaseEpoch:2,pendingDecision:{kind:"approve"}}});
    } finally {await restarted.close();}
  } finally {await resetOrgs(scope);}
});

it("native approval continuation drains through its original engine while new native admission is disabled",async()=>{
  const scope=toOrgId("profile-drain-"+randomUUID()),run="run-"+randomUUID();
  await seed(scope,run);
  const restarted=new PgDatabase(appConfig());
  try {
    await new PgAgentRunRepository(db).claimQueued(scope,1);
    await asApp(scope,c=>c.query("UPDATE agent_runs SET runtime_profile='native-v1',model_provider='deep-agent',status='awaiting_tool_permission',pending_tool_name='execute' WHERE id=$1",[run]));
    await new PgAgentRunRepository(db).approveAndRequeue(scope,run);
    const binding={bindingId:randomUUID(),profile:"native-v1" as const,policy:"native-v1" as const};
    const owner:NativeSessionOwner={provision:vi.fn(async()=>binding),resolve:vi.fn(),release:vi.fn(async()=>{}),releaseForRun:vi.fn(async()=>{})};
    const complete=vi.fn(async(input:ModelCallInput)=>{await input.onRemoteRunStarted?.("continued-remote","original-thread");return {text:"resumed output"};});
    const listFiles=vi.fn(async()=>[]);
    await executeQueuedRuns({runs:new PgAgentRunRepository(restarted),model:{complete},nativeSessions:owner,nativeRuntimeEnabled:false,
      nativeOutputs:{stage:vi.fn(async()=>{throw new Error("no republish");}),listFiles},
      planLedger:new PgPlanLedgerRepository(restarted),clock:{now:()=>new Date().toISOString(),newStepId:()=>randomUUID()},log:(message,detail)=>console.info("E008_DIAGNOSTIC",message,detail),
    },{orgId:scope});
    expect(complete).toHaveBeenCalledTimes(1);expect(complete.mock.calls[0]?.[0]).toMatchObject({nativeSession:binding,resume:{decision:"approve"},executionLeaseEpoch:2});
    expect(owner.provision).toHaveBeenCalledTimes(1);expect(owner.release).toHaveBeenCalledTimes(1);expect(listFiles).toHaveBeenCalledWith(scope,run);
    const row=await asApp(scope,c=>c.query("SELECT status,runtime_profile,remote_run_id FROM agent_runs WHERE org_id=$1 AND id=$2",[scope,run]));
    expect(row.rows[0]).toMatchObject({status:"writeback_pending",runtime_profile:"native-v1",remote_run_id:"continued-remote"});
  } finally {await restarted.close();await resetOrgs(scope);}
});
