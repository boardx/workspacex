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
  await run("问题来源：亲自观察\n来源描述：我们亲眼看见施工提示牌更换","### 原始命题\n新手司机夜间高速公路开车\n### 来源类型\n亲自观察\n### 已知\n施工路段标识变化",false);
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

it("uses the reviewed recording excerpt and same-thread student observations when the next turn builds a finding", async () => {
 const f = await createBridgePgFixture(db);
 try {
  const id = randomUUID(), sibling = randomUUID(), projectId = f.projectId;
  const row = { version: 1, id, code: "U01", original: "如何选饮料？", adopted: "上次怎么选的？", guideConfirmed: true,
   topic: "午休", goal: "选择过程", consent: { notes: true, audio: true } };
  const material = "interviewMaterial:" + id + ":one", quote = "我看不出口味差别";
  await f.save(2, {
   ["interviewRecord:" + id]: JSON.stringify(row),
   ["interviewRecord:" + sibling]: JSON.stringify({ ...row, id: sibling, code: "U02" }),
   [material]: JSON.stringify({ name: "U01.wav", mime: "audio/wav", artifactId: "audio", versionId: "v1", projectId }),
   ["interviewTranscript:" + id]: JSON.stringify({ sourceKey: material, checked: true, text: quote, locator: "01:42" }),
  });
  const { threadId } = await f.stages.entityThread(f.actor, { entityId: id, stageId: 2, purpose: "stage" });
  const store = new PgAidtRunContextStore(db);
  const contexts = new PgAidtRunContextProvider(db, new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT), store, () => true);
  const commands = new PgChatMessageCommandRepository(db, undefined, contexts), runs = new PgAgentRunRepository(db, null, store);
  const pin = await f.mountApprovedSkill("aidt-methods", "1.4.2", "aidt-empathize", threadId);
  const snapshot = await f.publishAgent([pin.versionId]);
  const read = async () => (await f.stages.get(f.actor, 2)).stage!;
  const observation = "他在菜单前反复比较口味";
  for (const [text, answer] of [[observation, "你在哪个场景观察到的？"], ["午休时在食堂窗口",
   "### 人物发现卡（草稿）\n一句发现：" + observation + "\n具体情况：午休时在食堂窗口\n受访者原话：" + quote]] as const) {
   const runId = randomUUID(), revision = (await read()).revision;
   await commands.accept(f.orgId, { projectId, threadId, actorId: f.studentId, clientMessageId: randomUUID(), messageId: randomUUID(),
    runId, selectedAgentId: snapshot.agentId, text, snapshot, aidtContext: { schemaVersion: 1, purpose: "stage", stageId: 2,
     projectId, entityId: id, stageRevisions: [{ stageId: 2, revision }] } });
   await asApp(f.orgId, async s => {
    const saved = await s.query<{ block: string }>("SELECT snapshot_json->>'modelReferenceBlock' AS block FROM aidt_run_context_snapshots WHERE run_id=$1", [runId]);
    expect(saved.rows[0]?.block).toContain(quote);
    expect(saved.rows[0]?.block).not.toContain("U02");
    await s.query("UPDATE agent_runs SET status='running' WHERE id=$1", [runId]);
    await s.query("UPDATE agent_runs SET status='writeback_pending',model_output=$1 WHERE id=$2 AND org_id=$3", [answer, runId, f.orgId]);
   });
   const errors: string[] = [];
   await writeBackPendingRuns({ runs, aidtContexts: contexts, clock: { now: () => new Date().toISOString(), newStepId: randomUUID },
    log: message => errors.push(message) }, { orgId: f.orgId });
   expect(errors).toEqual([]);
  }
  const draft = (await read()).content.draft;
  expect(draft.discoveryCards).toMatchObject([{ id, headline: observation, context: "午休时在食堂窗口", quote, sourceRef: "U01.wav · 01:42" }]);
  expect(draft.fields["interviewConfirmed:" + id]).not.toBe("true");
  const beforeWithdrawal = (await read()).revision;
  await f.save(2, { ...draft.fields, ["interviewRecord:" + id]: JSON.stringify({ ...row, consent: { notes: false, audio: false } }) });
  await expect(commands.accept(f.orgId, { projectId, threadId, actorId: f.studentId, clientMessageId: randomUUID(), messageId: randomUUID(),
    runId: randomUUID(), selectedAgentId: snapshot.agentId, text: "继续讨论", snapshot,
    aidtContext: { schemaVersion: 1, purpose: "stage", stageId: 2, projectId, entityId: id,
      stageRevisions: [{ stageId: 2, revision: beforeWithdrawal }] } })).rejects.toThrow();

 } finally { await f.cleanup(); }
});
