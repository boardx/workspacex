/** #3278: real row locks preserve one claim across concurrent wake-ups. */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedOrg, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toOrgId } from "../../src/domain/org-id";
let db:PgDatabase;
async function seed(scope: ReturnType<typeof toOrgId>, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
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
it("transient title lock skips first claim; two wake-ups after commit claim only once",async()=>{
 const scope=toOrgId("claim-lock-"+randomUUID()),run="run-"+randomUUID();await seed(scope,run);
 let unlock!:()=>void;let locked!:()=>void;const hold=new Promise<void>(r=>unlock=r);const ready=new Promise<void>(r=>locked=r);
 const transaction=db.withTenant(scope,async c=>{await c.query("UPDATE chat_threads SET title='Model title' WHERE id=$1",[`thread-${scope}`]);locked();await hold;});
 try {await ready;const repo=new PgAgentRunRepository(db);expect(await repo.claimQueued(scope,1)).toEqual([]);unlock();await transaction;
 const row=await asApp(scope,c=>c.query("SELECT status FROM agent_runs WHERE id=$1",[run]));expect(row.rows[0].status).toBe("queued");
 const competing=await Promise.all([repo.claimQueued(scope,1),repo.claimQueued(scope,1)]);expect(competing.flat()).toHaveLength(1);console.info("CLAIM_LOCK_REPRO: first kick empty; after title commit still queued; second kick claims");
 }finally{unlock();await transaction;await resetOrgs(scope);}
});
