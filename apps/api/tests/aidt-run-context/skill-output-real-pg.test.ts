import {recoverProblemFraming} from "../../src/infrastructure/aidt-run-context/pg-skill-output";
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {writeBackPendingRuns} from "../../src/application/agent-run/writeback";
import {PgAgentRunRepository} from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import {PgAidtRunContextProvider} from "../../src/infrastructure/aidt-run-context/pg-aidt-run-context-provider";
import {PgAidtRunContextStore} from "../../src/infrastructure/aidt-run-context/pg-aidt-run-context-store";
import {PgChatMessageCommandRepository} from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {FileSkillStarterPackSource,REPO_SKILL_STARTER_PACK_ROOT} from "../../src/infrastructure/skill/file-skill-starter-pack-source";
import {asApp,ensureDatabase,migrateOnce} from "../support/db";
import {createBridgePgFixture} from "./support/real-pg-fixture";

let db:PgDatabase;
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());});
afterAll(async()=>db?.close());
it("committed reply updates only its entity without a browser; receipt replay and recovery preserve exact human decisions",async()=>{
 const f=await createBridgePgFixture(db);
 try {
  const entityId=randomUUID(),other=randomUUID(),projectId=f.projectId;
  await f.save(1,{
    ["problemEntity:"+entityId]:JSON.stringify({id:entityId,title:"夜间出行",archived:false}),
    ["problemDraft:"+entityId]:JSON.stringify({initial:"你好"}),
    ["problemEntity:"+other]:JSON.stringify({id:other,title:"其他课题",archived:false}),
  });
  const {threadId}=await f.stages.entityThread(f.actor,{entityId,stageId:1,purpose:"stage"});
  const actor={...f.actor,threadId};
  const store=new PgAidtRunContextStore(db);
  const contexts=new PgAidtRunContextProvider(db,new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT),store,()=>true);
  const commands=new PgChatMessageCommandRepository(db,undefined,contexts),runs=new PgAgentRunRepository(db,null,store);
  const pin=await f.mountApprovedSkill("aidt-methods","1.4.2","aidt-understand",threadId);
  const snapshot=await f.publishAgent([pin.versionId]);
  const read=async()=>(await f.stages.get(f.actor,1)).stage!;
  const clock={now:()=>new Date().toISOString(),newStepId:randomUUID};
  const run=async(text:string,answer:string,project=true)=>{
   const runId=randomUUID(),before=await read();
   await commands.accept(f.orgId,{projectId,threadId,actorId:f.studentId,clientMessageId:randomUUID(),messageId:randomUUID(),runId,
    selectedAgentId:snapshot.agentId,text,snapshot,aidtContext:{schemaVersion:1,purpose:"stage",stageId:1,projectId,entityId,stageRevisions:[{stageId:1,revision:before.revision}]}});
   // Simulate only model completion. Both message commits and the actual projection use PostgreSQL.
   await asApp(f.orgId,async s=>{await s.query("UPDATE agent_runs SET status='running' WHERE id=$1",[runId]);await s.query("UPDATE agent_runs SET status='writeback_pending',model_output=$1 WHERE id=$2 AND org_id=$3",[answer,runId,f.orgId]);});
   const errors:string[]=[];
   await writeBackPendingRuns({runs,clock,aidtContexts:project?contexts:undefined,log:message=>errors.push(message)},{orgId:f.orgId});
   expect(errors).toEqual([]);
   return runId;
  };
  const initial=await read();
  await run("你好","你好！想研究什么？");
  expect((await read()).revision).toEqual(initial.revision);
  const result=await run("新手司机夜间高速公路开车","### 原始命题\n新手司机夜间高速公路开车\n### 选题价值\n小组担心临时施工时的提示");
  const first=await read(),saved=JSON.parse(first.content.draft.fields["problemDraft:"+entityId]!);
  expect(saved).toMatchObject({initial:"新手司机夜间高速公路开车",whyWorthStudying:"小组担心临时施工时的提示"});
  expect(saved.roundCompletion).toBeUndefined();
  expect(first.content.draft.fields["problemDraft:"+other]).toBeUndefined();
  await contexts.projectCompleted(f.orgId,result);
  expect(await contexts.reconcileEntity(actor,1,entityId)).toBe(false);
  expect((await read()).revision).toBe(first.revision);
  await run("我们亲自观察到这个问题","### 原始命题\n新手司机夜间高速公路开车\n### 来源类型\n亲自观察\n### 已知\n施工路段标识变化",false);
  expect(await contexts.reconcileEntity(actor,1,entityId)).toBe(true);
  expect(JSON.parse((await read()).content.draft.fields["problemDraft:"+entityId]!)).toMatchObject({problemSources:'["observation"]',known:"施工路段标识变化"});
  const frozen = await f.save(1,{...first.content.draft.fields,["problemDraft:"+entityId]:JSON.stringify({initial:"你好",rewrittenTheme:"确认",roundCompletion:"旧记录"})});
  const historical = (source:typeof frozen,id:string)=>asApp(f.orgId,s=>recoverProblemFraming(s,actor,source,id));
  expect(await historical(frozen,entityId)).toBe("新手司机夜间高速公路开车");
  expect(await historical(frozen,other)).toBeUndefined();
  expect(await historical(initial,entityId)).toBeUndefined();
  expect((await read()).revision).toBe(frozen.revision);
  await expect(contexts.reconcileEntity({...actor,userId:f.outsiderId},1,entityId)).rejects.toThrow();
 } finally {await f.cleanup();}
});
