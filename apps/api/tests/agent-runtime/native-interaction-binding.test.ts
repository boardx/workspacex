import { createHash,randomUUID } from "node:crypto";
import { beforeAll,afterAll,it,expect,vi } from "vitest";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import { seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs } from "../support/db";
import { addChatThread,addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgNativeSessionOwner } from "../../src/infrastructure/agent-run/pg-native-session-owner";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
const org=toOrgId("interaction-binding-"+randomUUID());let db:PgDatabase;
beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());});
afterAll(async()=>{await db?.close();});
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

it.each([false,true])("old binding resumes with only mandatory interaction approvals strengthened (existing false keys=%s)",async(withFalseKeys)=>{
 const scope=toOrgId("interaction-upgrade-"+randomUUID()),run="run-"+randomUUID();await seed(scope,run);
 try {
  await asApp(scope,async c=>{
   await c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '5 minutes' WHERE id=$1",[run]);
   await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),scope,run]);
  });
  const transport={create:vi.fn(async()=>({sessionId:randomUUID(),token:'a'.repeat(64),expiresAt:Date.now()+60000})),destroy:vi.fn(async()=>{})};
  const owner=()=>new PgNativeSessionOwner(db,new PgParentRunControlReader(db),transport,'b'.repeat(64));
  const ctx={orgId:scope,parentRunId:run,attemptId:run+':0',leaseEpoch:1};
  const oldPolicy={execute:true,read_file:false,...(withFalseKeys?Object.fromEntries(Object.values(AGENT_INTERRUPTS_TOOL_NAMES).map(name=>[name,false])):{})};
  const ref=await owner().provision(ctx,[],oldPolicy);
  const next={...oldPolicy,...Object.fromEntries(Object.values(AGENT_INTERRUPTS_TOOL_NAMES).map(name=>[name,true]))};
  expect(await owner().provision(ctx,[],next)).toEqual(ref);
  expect((await owner().resolve(ref.bindingId,ctx)).interruptOn).toEqual(next);
  expect(await owner().provision(ctx,[],{...next,browser_navigate:true,browser_snapshot:false,unavailable_new_tool:true})).toEqual(ref);
  expect((await owner().resolve(ref.bindingId,ctx)).interruptOn).toEqual(next);
  for(const changed of [{...next,execute:false},{...next,read_file:true},{...oldPolicy}, {...next,confirm_task_intent:false}]){
   await expect(owner().provision(ctx,[],changed)).rejects.toThrow('native_session_existing_binding_unavailable');
   expect((await owner().resolve(ref.bindingId,ctx)).interruptOn).toEqual(next);
  }
  expect(transport.create).toHaveBeenCalledTimes(1);expect(transport.destroy).not.toHaveBeenCalled();
  await owner().release(ref.bindingId,scope,run);expect(transport.destroy).toHaveBeenCalledTimes(1);
 }finally{await resetOrgs(scope);}
});
