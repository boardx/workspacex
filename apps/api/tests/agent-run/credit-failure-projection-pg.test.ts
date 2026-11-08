/** Persisted main-run Credit guidance, requester binding and viewer disclosure. */
import { beforeAll, beforeEach, expect, it } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { PermissionDecision } from "../../src/domain/identity/permission-decision";
import type { RunProjection } from "../../src/application/agent-run/ports";

const ORG = "org-credit-failure-6407";
const org = toOrgId(ORG);
const RUN = "credit-failure-run";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

const ALLOW_ALL = { allowed: true, decisionId: "credit-guidance-decision" } as unknown as PermissionDecision;

async function readProjection(repo: PgAgentRunRepository): Promise<RunProjection> {
  const guarded = await repo.readRun(org, RUN);
  expect(guarded, "这条 run 必须读得到").not.toBeNull();
  const disclosed = discloseDecided(guarded!, ALLOW_ALL);
  expect(isDisclosed(disclosed), "恒允许的判定下必须拿得到载荷").toBe(true);
  return (disclosed as { payload: RunProjection }).payload;
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "resolved-project" });
  await addChatThread({ orgId: ORG, id: "resolved-thread", projectId: null, visibilityScope: "plenary", createdBy: "resolved-user" });
  await addChatMessage({ orgId: ORG, id: "resolved-input", threadId: "resolved-thread", body: "run", authorId: "resolved-user" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('resolved-agent',$1,'resolved-agent','resolved-agent','enabled','resolved-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('resolved-version',$1,'resolved-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'resolved-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('${RUN}',$1,'resolved-thread','resolved-input','resolved-agent','resolved-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
  });
});


it("persists owned credit guidance across repository restart and public schema",async()=>{
 const repo=new PgAgentRunRepository(db),failure={code:'credit_required' as const,ownerType:'user' as const,ownerId:'resolved-user',rechargePath:'/billing?purchase=1'};
 await repo.failRun(org,RUN,'CREDIT_REQUIRED',undefined,failure);
 expect((await readProjection(repo)).creditFailure).toEqual(failure);
 const restarted=await readProjection(new PgAgentRunRepository(db));
 const {wave2Runtime}=await import('@repo/contracts');
 expect(wave2Runtime.AgentRunView.parse(restarted).creditFailure).toEqual(failure);
});
it("does not persist recharge scope for accounting unavailable",async()=>{
 const repo=new PgAgentRunRepository(db),failure={code:'credit_required' as const,ownerType:'user' as const,ownerId:'resolved-user',rechargePath:'/billing?purchase=1'};
 await expect(repo.failRun(org,RUN,'CREDIT_ACCOUNTING_UNAVAILABLE',undefined,failure)).rejects.toThrow();
});

it("wrong-owner guidance cannot be persisted into another initiator's run",async()=>{
 const repo=new PgAgentRunRepository(db);
 await repo.failRun(org,RUN,'CREDIT_REQUIRED',undefined,{code:'credit_required',ownerType:'user',ownerId:'other-user',rechargePath:'/billing?purchase=1'});
 const view=await readProjection(repo);expect(view.status).toBe('failed');expect(view.error).toBe('CREDIT_ACCOUNTING_UNAVAILABLE');expect(view.creditFailure).toBeUndefined();
});
it("authorized coworkers retain run visibility but never receive another user's personal recharge scope",async()=>{
 const {addOrgMember,addProjectMember}=await import('../support/db');
 await addOrgMember(ORG,'resolved-user','admin',null);await addOrgMember(ORG,'coworker','admin',null);
 await addProjectMember(ORG,'resolved-project','resolved-user','facilitator',null);await addProjectMember(ORG,'resolved-project','coworker','facilitator',null);
 await asApp(ORG,c=>c.query("UPDATE chat_threads SET project_id='resolved-project' WHERE id='resolved-thread' AND org_id=$1",[ORG]));
 const repo=new PgAgentRunRepository(db);
 await repo.failRun(org,RUN,'CREDIT_REQUIRED',undefined,{code:'credit_required',ownerType:'user',ownerId:'resolved-user',rechargePath:'/billing?purchase=1'});
 const {PgIdentityRepository}=await import('../../src/infrastructure/identity/pg-identity-repository');
 const {PgChatRepository}=await import('../../src/infrastructure/chat/pg-chat-repository');
 const {readAgentRun}=await import('../../src/application/agent-run/read-run');
 const {streamAgentRunDeltas}=await import('../../src/application/agent-run/stream-run');
 const deps={runs:repo,repo:new PgIdentityRepository(db),chat:new PgChatRepository(db),ids:{next:()=>`credit-decision-${Date.now()}`}};
 const own=await readAgentRun(deps as never,{orgId:org,userId:'resolved-user',runId:RUN});expect(own.creditFailure?.ownerId).toBe('resolved-user');
 const other=await readAgentRun(deps as never,{orgId:org,userId:'coworker',runId:RUN});expect(other.status).toBe('failed');expect(other.error).toBe('CREDIT_REQUIRED');expect(other.creditFailure).toBeUndefined();
 for(const userId of ['resolved-user','coworker']){
  const outcome=await streamAgentRunDeltas(deps as never,{orgId:org,userId,runId:RUN,onDelta:async()=>{}});
  expect(outcome.kind).toBe('failed');
  expect('creditFailure' in outcome?outcome.creditFailure?.ownerId:undefined).toBe(userId==='resolved-user'?'resolved-user':undefined);
 }
});

it("mixed-version nonterminal stale guidance does not leak or constrain old writers",async()=>{
 await asApp(ORG,c=>c.query("UPDATE agent_runs SET credit_failure=$3::jsonb WHERE org_id=$1 AND id=$2",[ORG,RUN,JSON.stringify({code:'credit_required',ownerType:'user',ownerId:'resolved-user',rechargePath:'/billing?purchase=1'})]));
 const repo=new PgAgentRunRepository(db);expect((await readProjection(repo)).creditFailure).toBeUndefined();
 await repo.failRun(org,RUN,'MODEL_CALL_FAILED');const view=await readProjection(repo);expect(view.creditFailure).toBeUndefined();expect(view.error).toBe('MODEL_CALL_FAILED');
});

it('real HTTP polling and SSE retain owned guidance after app restart and filter coworkers',async()=>{
 const {addOrgMember,addProjectMember}=await import('../support/db');
 for(const user of ['resolved-user','coworker']){
  await addOrgMember(ORG,user,'admin',null);
  await addProjectMember(ORG,'resolved-project',user,'facilitator',null);
 }
 await asApp(ORG,c=>c.query("UPDATE chat_threads SET project_id='resolved-project' WHERE org_id=$1 AND id='resolved-thread'",[ORG]));
 const failure={code:'credit_required' as const,ownerType:'user' as const,ownerId:'resolved-user',rechargePath:'/billing?purchase=1'};
 await new PgAgentRunRepository(db).failRun(org,RUN,'CREDIT_REQUIRED',undefined,failure);
 const {NestFactory,APP_GUARD}=await import('@nestjs/core');
 const {Module}=await import('@nestjs/common');
 const {AgentRunController}=await import('../../src/interface/controllers/agent-run.controller');
 const {PrincipalGuard}=await import('../../src/interface/guards/principal.guard');
 const {PRINCIPAL_RESOLVER_PORT}=await import('../../src/application/ports/principal-resolver.port');
 const {IDENTITY_REPOSITORY,DECISION_ID_FACTORY}=await import('../../src/application/identity/ports');
 const {CHAT_REPOSITORY}=await import('../../src/application/chat/ports');
 const {AGENT_RUN_STORE,AGENT_RUN_EXECUTOR,MODEL_CALL_PORT}=await import('../../src/application/agent-run/ports');
 const {AGENT_RUN_CONTEXT_SNAPSHOT}=await import('../../src/application/agent-run/context-snapshot');
 const {INTERJECTION_STORE}=await import('../../src/application/agent-run/interjection-store');
 const {PARENT_RUN_CONTROL}=await import('../../src/application/agent-run/parent-run-control');
 const {CLOCK}=await import('../../src/application/auth/ports');
 const {PgIdentityRepository}=await import('../../src/infrastructure/identity/pg-identity-repository');
 const {PgChatRepository}=await import('../../src/infrastructure/chat/pg-chat-repository');
 let dispatches=0;
 const start=async()=>{
  class Fixture{}
  Module({controllers:[AgentRunController],providers:[
   {provide:IDENTITY_REPOSITORY,useValue:new PgIdentityRepository(db)},
   {provide:DECISION_ID_FACTORY,useValue:{next:()=>`credit-http-${Date.now()}`}},
   {provide:CHAT_REPOSITORY,useValue:new PgChatRepository(db)},
   {provide:AGENT_RUN_STORE,useValue:new PgAgentRunRepository(db)},
   {provide:AGENT_RUN_CONTEXT_SNAPSHOT,useValue:{}},
   {provide:AGENT_RUN_EXECUTOR,useValue:{kick:()=>{dispatches++;}}},
   {provide:INTERJECTION_STORE,useValue:{}},{provide:CLOCK,useValue:{now:()=>new Date()}},
   {provide:MODEL_CALL_PORT,useValue:{complete:async()=>{dispatches++;throw new Error('unexpected model dispatch');}}},
   {provide:PARENT_RUN_CONTROL,useValue:null},
   {provide:PRINCIPAL_RESOLVER_PORT,useValue:{resolve:async(headers:Record<string,string>)=>{
    const user=headers.authorization?.replace('Bearer ','');
    return user==='resolved-user'||user==='coworker'?{userId:user,orgId:org}:null;
   }}},{provide:APP_GUARD,useClass:PrincipalGuard},
  ]})(Fixture);
  const app=await NestFactory.create(Fixture,{logger:false,abortOnError:false});
  await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();
  if(!address||typeof address==='string')throw new Error('missing fixture address');
  return {app,base:`http://127.0.0.1:${address.port}`};
 };
 for(let restart=0;restart<2;restart++){
  const {app,base}=await start();
  try{
   expect((await fetch(`${base}/agent-runs/${RUN}`)).status).toBe(401);
   for(const user of ['resolved-user','coworker']){
    const headers={authorization:`Bearer ${user}`};
    const response=await fetch(`${base}/agent-runs/${RUN}`,{headers});expect(response.status).toBe(200);
    const view=await response.json() as {error:string;creditFailure?:unknown};
    expect(view.error).toBe('CREDIT_REQUIRED');expect(view.creditFailure).toEqual(user==='resolved-user'?failure:undefined);
    const stream=await fetch(`${base}/agent-runs/${RUN}/stream`,{headers});expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const events=(await stream.text()).split('\n\n').filter(frame=>frame.startsWith('data:')).map(frame=>JSON.parse(frame.slice(5)) as Record<string,unknown>);
    expect(events.at(-1)).toEqual({type:'final',status:'failed',error:'CREDIT_REQUIRED',...(user==='resolved-user'?{creditFailure:failure}:{})});
   }
  }finally{await app.close();}
 }
 expect(dispatches).toBe(0);
});
