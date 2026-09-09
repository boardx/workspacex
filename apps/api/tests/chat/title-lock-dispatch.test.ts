/** #3278: Real HTTP acceptance and PostgreSQL title/claim locking.
 * The kick seam only controls scheduling; both claim attempts use the real repository.
 * No model execution is asserted by this test. */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread } from "../support/chat-db";
import { createChatWave2FixtureSchema } from "../support/chat-wave2-fixture-schema";
import { DEFAULT_PERSONAL_THREAD_TITLE } from "../../src/application/chat/mutate-thread";
import { AgentRunExecutor } from "../../src/infrastructure/agent-run/agent-run-executor";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";


process.env.KERNEL_ALLOW_TEST_PRINCIPAL="1";
process.env.KERNEL_QUIET="1";
process.env.KERNEL_AGENT_CATALOG_SCHEMA="chat_wave2_fixture";
process.env.KERNEL_AGENT_RUN_AUTOSTART="0";
process.env.KERNEL_THREAD_TITLE_MODEL_ENABLED="0";
const ORG="org-title-lock-dispatch", ACTOR="actor-title-lock", AGENT="agent-title-lock", VERSION="version-title-lock";
let app:NestExpressApplication;let BASE="";
const headers={"x-kernel-test-principal":`${ACTOR}:${ORG}`,"content-type":"application/json"};
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();await asOwner(c=>createChatWave2FixtureSchema(c));
 const {createApp}=await import("../../src/main");app=await createApp();await app.listen(0,"127.0.0.1");
 const address=app.getHttpServer().address();if(!address || typeof address==="string")throw new Error("Missing TCP listener");BASE=`http://127.0.0.1:${address.port}`;
},180_000);
beforeEach(async()=>{
 await asOwner(async c=>{await c.query("DELETE FROM chat_wave2_fixture.agent_versions");await c.query("DELETE FROM chat_wave2_fixture.agents");});
 await resetOrgs(ORG);await seedOrg({orgId:ORG,projectId:"project-title-lock"});await addOrgMember(ORG,ACTOR,"consultant",null);
 await asApp(ORG,async c=>{
  await c.query("INSERT INTO chat_wave2_fixture.agents(id,org_id,status,published_version_id) VALUES($1,$2,'enabled',$3)",[AGENT,ORG,VERSION]);
  await c.query("INSERT INTO chat_wave2_fixture.agent_versions(id,org_id,agent_id,skill_version_ids,model_provider,model_id,published_at) VALUES($1,$2,$3,'[]','dashscope','test',now())",[VERSION,ORG,AGENT]);
 });
});
afterAll(async()=>{await app?.close();await asOwner(c=>c.query("DROP SCHEMA IF EXISTS chat_wave2_fixture CASCADE"));});
async function newPersonalThread(){const id=randomUUID();await addChatThread({orgId:ORG,id,projectId:null,visibilityScope:"private",createdBy:ACTOR,title:DEFAULT_PERSONAL_THREAD_TITLE});return id;}
function postMessage(threadId:string,text:string){return fetch(`${BASE}/chat/threads/${threadId}/messages`,{method:"POST",headers,body:JSON.stringify({clientMessageId:randomUUID(),text,agentId:AGENT})});}
it.each([false,true])("title transaction failure=%s still re-kicks after a skipped claim",async(failTitle)=>{
 const db=new PgDatabase(appConfig());const repo=new PgAgentRunRepository(db);const claims:number[]=[];const pending:Promise<void>[]=[];
 let ready!:()=>void;const locked=new Promise<void>(r=>ready=r);let firstDone!:()=>void;const firstClaim=new Promise<void>(r=>firstDone=r);
 let secondStarted!:()=>void;const secondKick=new Promise<void>(r=>secondStarted=r);
 const kick=vi.spyOn(AgentRunExecutor.prototype,"kick").mockImplementation(()=>{
  const attempt=pending.length;if(attempt===1)secondStarted();
  pending.push((async()=>{if(attempt===0)await locked;const rows=await repo.claimQueued(toOrgId(ORG),1);claims.push(rows.length);if(attempt===0){firstDone();await secondKick;}})());
 });
 const title=vi.spyOn(PgChatRepository.prototype,"autoTitleThreadIfDefault").mockImplementation(async(org,threadId)=>{
  return db.withTenant(org,async c=>{await c.query("UPDATE chat_threads SET title='locked model title' WHERE id=$1",[threadId]);ready();await firstClaim;if(failTitle)throw new Error("title failure");return true;});
 });
 try {const threadId=await newPersonalThread();expect((await postMessage(threadId,"first message")).status).toBe(202);await Promise.all(pending);
  expect(claims).toEqual([0,1]);expect(kick).toHaveBeenCalledTimes(2);
  expect(await repo.claimQueued(toOrgId(ORG),1)).toEqual([]);
 }finally{ready();firstDone();secondStarted();await Promise.allSettled(pending);title.mockRestore();kick.mockRestore();await db.close();}
});
