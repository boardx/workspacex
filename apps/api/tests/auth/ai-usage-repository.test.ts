import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {aiUsage as C} from "@repo/contracts";
import {ensureDatabase,migrateOnce,resetOrgs,seedOrg,asApp} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgAsrRequestAccounting} from '../../src/infrastructure/auth/pg-asr-request-accounting';
import {PgPersonalTranscriptionRepository} from '../../src/infrastructure/recording/pg-personal-transcription-repository';
import {PgAiUsageRepository} from "../../src/infrastructure/auth/pg-ai-usage-repository";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {toOrgId} from "../../src/domain/org-id";
const ORG="org-usage-5261",OTHER="org-usage-5261-other",PROJECT="p-usage-5261";
let db:PgDatabase,usage:PgTokenUsageRepository,report:PgAiUsageRepository;
const now=Date.now(),start=new Date(now-3600000).toISOString(),end=new Date(now+3600000).toISOString();
const query=C.Query.parse({start,end,timezone:"Etc/UTC"});
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());usage=new PgTokenUsageRepository(db);report=new PgAiUsageRepository(db);});
beforeEach(async()=>{
 await resetOrgs(ORG,OTHER);await seedOrg({orgId:ORG,projectId:PROJECT});await seedOrg({orgId:OTHER,projectId:"p-usage-5261-other"});
 await usage.startRequest(toOrgId(ORG),{requestId:"usage-r1",userId:"alice",runId:"r",executionAttemptId:null,projectId:PROJECT,modelProvider:"p",modelId:"m",startedAt:new Date(now).toISOString()});
 await usage.startRequest(toOrgId(ORG),{requestId:"usage-pending",userId:"alice",runId:"r",executionAttemptId:null,projectId:PROJECT,modelProvider:"p",modelId:"m",startedAt:new Date(now).toISOString()});
 await usage.record(toOrgId(ORG),{eventId:"usage-r1",userId:"alice",runId:null,modelProvider:"p",modelId:"m",projectId:PROJECT,
  tokensTotal:15,promptTokens:10,completionTokens:5,outcome:"succeeded",totalSource:"reported",requestStartedAt:new Date(now).toISOString()});
 await usage.record(toOrgId(ORG),{eventId:"usage-r2",userId:"bob",runId:null,modelProvider:"p",modelId:"m2",projectId:null,
  tokensTotal:0,promptTokens:null,completionTokens:null,outcome:"failed",totalSource:"unknown",requestStartedAt:new Date(now).toISOString()});
 await usage.record(toOrgId(ORG),{eventId:"usage-prev",userId:"alice",runId:null,modelProvider:"p",modelId:"m",projectId:PROJECT,
  tokensTotal:7,promptTokens:5,completionTokens:2,outcome:"succeeded",totalSource:"reported",requestStartedAt:new Date(now-5400000).toISOString()});
 await usage.record(toOrgId(OTHER),{eventId:"other-usage",userId:"alice",runId:null,modelProvider:"p",modelId:"m",
  tokensTotal:999,promptTokens:900,completionTokens:99,outcome:"succeeded",totalSource:"reported"});
});
afterAll(async()=>{await resetOrgs(ORG,OTHER);await db.close();});
describe("same ledger reports — isolated PostgreSQL",()=>{
 it("summary, member/model/project and details have matching totals and explicit unknown coverage",async()=>{
  const summary=await report.summary(toOrgId(ORG),query);
  expect(summary.current).toMatchObject({totalTokens:"15",inputTokens:"10",outputTokens:"5",callCount:2,unknownCalls:1,failedCalls:1});
  expect(summary.previous).toMatchObject({totalTokens:"7",callCount:1});
  expect(summary.dispatchIntents).toBe(2);expect(summary.unsettledDispatchIntents).toBe(1);
  expect(summary.projects.some(p=>p.projectId===null)).toBe(true);
  const detail=await report.calls(toOrgId(ORG),{...query,asOf:summary.asOf});
  expect(detail.calls.reduce((sum,c)=>sum+BigInt(c.totalTokens),0n)).toBe(15n);
  expect(summary.members.reduce((sum,c)=>sum+BigInt(c.totalTokens),0n)).toBe(15n);
  expect(summary.models.reduce((sum,c)=>sum+BigInt(c.totalTokens),0n)).toBe(15n);
  expect(summary.matrix.reduce((sum,c)=>sum+BigInt(c.totalTokens),0n)).toBe(15n);
  expect(detail.calls.every(c=>!("prompt" in c)&&!("response" in c))).toBe(true);
 });
 it("filters member×provider/model intersections and explicit unassigned projects",async()=>{
  expect((await report.calls(toOrgId(ORG),{...query,userId:"alice",modelProvider:"p",modelId:"m"})).calls.map(c=>c.id)).toEqual(["usage-r1"]);
  expect((await report.calls(toOrgId(ORG),{...query,unassignedProject:"true"})).calls.map(c=>c.id)).toEqual(["usage-r2"]);
  expect((await report.summary(toOrgId(ORG),{...query,userId:"bob"})).current.totalTokens).toBe("0");
  expect((await asApp(OTHER,c=>c.query("SELECT id FROM token_usage_events WHERE org_id=$1",[ORG]))).rows).toEqual([]);
 });
 it("keyset preserves sub-millisecond timestamp precision and asOf excludes new receipts",async()=>{
  const initial=await report.calls(toOrgId(ORG),{...query,limit:1});expect(initial.nextCursor).not.toBeNull();
  expect(initial.nextCursor!.occurredAt).toMatch(/\.\d{6}Z$/);
  const next=await report.calls(toOrgId(ORG),{...query,asOf:initial.asOf,limit:1,cursorTime:initial.nextCursor!.occurredAt,cursorId:initial.nextCursor!.id});
  expect(next.calls).toHaveLength(1);expect(next.calls[0]!.id).not.toBe(initial.calls[0]!.id);
  await usage.record(toOrgId(ORG),{eventId:"late-r",userId:"alice",runId:null,modelProvider:"p",modelId:"m",tokensTotal:3,promptTokens:2,completionTokens:1,outcome:"succeeded",totalSource:"reported"});
  expect((await report.calls(toOrgId(ORG),{...query,asOf:initial.asOf})).calls.some(c=>c.id==="late-r")).toBe(false);
 });
 it("preserves microsecond snapshot bounds across report projections",async()=>{
  const asOf=new Date(Date.now()-1000).toISOString().replace(/\.\d{3}Z$/, ".123456Z");
  const summary=await report.summary(toOrgId(ORG),{...query,asOf});
  expect(summary.asOf).toBe(asOf);
  expect((await report.calls(toOrgId(ORG),{...query,asOf:summary.asOf})).asOf).toBe(asOf);
  expect((await report.summary(toOrgId(ORG),query)).asOf).toMatch(/\.\d{6}Z$/);
 });
 it("native dimensions keep original units, unknown provenance, and one receipt across report projections",async()=>{
  for(const [id,source,quantity] of [["native-estimated","estimated",2000n],["native-reported","reported",3n],["native-unknown","unknown",null]] as const){
   await usage.record(toOrgId(ORG),{eventId:id,userId:"alice",runId:null,modelProvider:"p",modelId:"native",tokensTotal:0,promptTokens:null,completionTokens:null,outcome:"succeeded",totalSource:"not-applicable",requestStartedAt:new Date(now).toISOString(),nativeUsage:{unit:"millisecond",quantity,source}});
  }
  const summary=await report.summary(toOrgId(ORG),query);
  expect(summary.current).toMatchObject({totalTokens:"15",nativeCalls:3,reportedCalls:1,unknownCalls:1,callCount:5});
  expect(summary.nativeUnits).toEqual([{unit:"millisecond",reportedQuantity:"3",estimatedQuantity:"2000",reportedCalls:1,estimatedCalls:1,unknownCalls:1}]);
  const calls=await report.calls(toOrgId(ORG),{...query,asOf:summary.asOf});
  expect(calls.calls.filter(c=>c.totalSource==="not-applicable")).toHaveLength(3);
  expect(calls.calls.find(c=>c.id==="native-unknown")!.nativeUsage).toEqual({unit:"millisecond",quantity:null,source:"unknown"});
  expect((await asApp(OTHER,c=>c.query("SELECT id FROM token_usage_events WHERE org_id=$1 AND native_unit IS NOT NULL",[ORG]))).rows).toEqual([]);
 });
 it("database constraints independently reject fabricated Token/native provenance and ledger mutation",async()=>{
  await expect(asApp(ORG,c=>c.query("INSERT INTO token_usage_events(id,org_id,user_id,model_provider,model_id,tokens_total,total_source,native_unit,native_quantity,native_source) VALUES('bad-native',$1,'alice','p','m',1,'not-applicable','image',1,'reported')",[ORG]))).rejects.toThrow();
  await usage.record(toOrgId(ORG),{eventId:"immutable-native",userId:"alice",runId:null,modelProvider:"p",modelId:"native",tokensTotal:0,promptTokens:null,completionTokens:null,outcome:"succeeded",totalSource:"not-applicable",nativeUsage:{unit:"image",quantity:1n,source:"reported"}});
  await expect(asApp(ORG,c=>c.query("UPDATE token_usage_events SET native_quantity=99 WHERE id='immutable-native'"))).rejects.toThrow();
 });

 it("non-run local trials keep null Agent identity, append-only starts and tenant scope",async()=>{
  await usage.startRequest(toOrgId(ORG),{requestId:"local-trial-http",userId:"alice",runId:null,projectId:null,executionAttemptId:null,modelProvider:"ollama-local",modelId:"actual-local",callPurpose:"local-trial",startedAt:new Date(now).toISOString()});
  const row=(await asApp(ORG,c=>c.query("SELECT run_id,execution_attempt_id,execution_lease_epoch,subtask_id,call_purpose FROM model_request_starts WHERE id='local-trial-http'"))).rows[0];
  expect(row).toEqual({run_id:null,execution_attempt_id:null,execution_lease_epoch:null,subtask_id:null,call_purpose:"local-trial"});
  expect((await asApp(OTHER,c=>c.query("SELECT id FROM model_request_starts WHERE id='local-trial-http'"))).rows).toEqual([]);
  await expect(asApp(ORG,c=>c.query("UPDATE model_request_starts SET user_id='bob' WHERE id='local-trial-http'"))).rejects.toThrow();
 });
 it("non-run starts cannot erase existing Agent identity requirements or use NULL purpose",async()=>{
  for(const purpose of ["primary",null])await expect(asApp(ORG,c=>c.query("INSERT INTO model_request_starts(id,org_id,user_id,run_id,model_provider,model_id,started_at,call_purpose) VALUES($1,$2,'alice',NULL,'p','m',now(),$3)",["invalid-non-run:"+String(purpose),ORG,purpose]))).rejects.toThrow();
 });

 // Authored for existing isolated remote PG CI; never run in the release-priority local workspace.
 it("ASR personal receipt retains exact active capture owner, null run, tenant fence and terminal idempotence",async()=>{
  const personal=new PgPersonalTranscriptionRepository(db),accounting=new PgAsrRequestAccounting(db),orgId=toOrgId(ORG);
  const capture={orgId,ownerUserId:"alice",transcriptionId:"asr-personal",captureId:"asr-capture"};
  await personal.create({...capture,name:"ASR fixture",tags:[]});await personal.startCapture({...capture,trackId:"asr-track"});
  const input={requestId:"asr-actual-ws",modelProvider:"fixture-asr",modelId:"actual",startedAt:new Date(now).toISOString()};
  for(const bad of [{...capture,orgId:toOrgId(OTHER)},{...capture,ownerUserId:"bob"},{...capture,captureId:"wrong-capture"}])await expect(accounting.start({kind:"personal-capture",...bad},input)).rejects.toThrow("ASR_ACCOUNTING_OWNER_DENIED");
  const receipt=await accounting.start({kind:"personal-capture",...capture},input);
  const terminal={endedAt:new Date(now+1).toISOString(),outcome:"failed" as const,queuedDurationMs:50n};await receipt.terminal(terminal);await receipt.terminal(terminal);
  const rows=(await asApp(ORG,c=>c.query("SELECT user_id,run_id,total_source,native_unit,native_quantity::text,native_source FROM token_usage_events WHERE id=$1",[input.requestId]))).rows;
  expect(rows).toEqual([{user_id:"alice",run_id:null,total_source:"unknown",native_unit:"millisecond",native_quantity:"50",native_source:"estimated"}]);
  expect((await asApp(OTHER,c=>c.query("SELECT id FROM token_usage_events WHERE id=$1",[input.requestId]))).rows).toEqual([]);
  await personal.finishCapture({...capture,durationMs:50});await expect(accounting.start({kind:"personal-capture",...capture},{...input,requestId:"ended-asr"})).rejects.toThrow("ASR_ACCOUNTING_OWNER_DENIED");
 });

});

// Source-only until the isolated PostgreSQL shard executes this file.
it("late original usage enriches one physical call, preserves raw base and historical asOf",async()=>{
 const subject={eventId:"late-same-physical",userId:"alice",runId:null,modelProvider:"late-provider",modelId:"late-model",projectId:PROJECT,
  outcome:"failed" as const,requestStartedAt:new Date(now).toISOString(),requestEndedAt:new Date(now+1).toISOString()};
 const unknown={...subject,tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:"unknown" as const};
 await usage.record(toOrgId(ORG),unknown);
 const original=(await asApp(ORG,c=>c.query("SELECT * FROM token_usage_events WHERE id=$1",[subject.eventId]))).rows[0];
 // Reporting cutoffs currently serialize milliseconds; advance beyond the commit's microseconds.
 await asApp(ORG,c=>c.query("SELECT pg_sleep(0.002)"));
 const scoped={...query,modelId:"late-model"},before=await report.summary(toOrgId(ORG),scoped);
 expect(before.current).toMatchObject({callCount:1,totalTokens:"0",unknownCalls:1});
 await usage.record(toOrgId(ORG),{...unknown,promptTokens:3});
 await asApp(ORG,c=>c.query("SELECT pg_sleep(0.002)"));
 const partial=await report.summary(toOrgId(ORG),scoped);
 expect(partial.current).toMatchObject({callCount:1,inputTokens:"3",totalTokens:"0",unknownCalls:1});
 const reported={...subject,outcome:"succeeded" as const,requestEndedAt:new Date(now+2).toISOString(),tokensTotal:5,promptTokens:3,completionTokens:2,totalSource:"reported" as const,costMicros:500n,currency:"CNY",priceVersion:"original-price"};
 await usage.record(toOrgId(ORG),reported);await usage.record(toOrgId(ORG),reported);
 await asApp(ORG,c=>c.query("SELECT pg_sleep(0.002)"));
 const after=await report.summary(toOrgId(ORG),scoped),calls=await report.calls(toOrgId(ORG),{...scoped,asOf:after.asOf});
 expect(after.current).toMatchObject({callCount:1,totalTokens:"5",inputTokens:"3",outputTokens:"2",reportedCalls:1,unknownCalls:0});
 expect(calls.calls).toHaveLength(1);expect(calls.calls[0]).toMatchObject({id:subject.eventId,totalTokens:"5",costMicros:"500",priceVersion:"original-price",outcome:"failed"});
 expect(Date.parse(calls.calls[0]!.endedAt!)).toBe(Date.parse(subject.requestEndedAt));
 expect((await report.summary(toOrgId(ORG),{...scoped,asOf:before.asOf})).current).toEqual(before.current);
 expect((await report.summary(toOrgId(ORG),{...scoped,asOf:partial.asOf})).current).toEqual(partial.current);
 expect((await asApp(ORG,c=>c.query("SELECT * FROM token_usage_events WHERE id=$1",[subject.eventId]))).rows[0]).toEqual(original);
 expect((await asApp(ORG,c=>c.query("SELECT revision::text FROM token_usage_enrichments WHERE request_id=$1 ORDER BY revision",[subject.eventId]))).rows).toEqual([{revision:"1"},{revision:"2"}]);
 expect((await asApp(OTHER,c=>c.query("SELECT id FROM effective_token_usage() WHERE id=$1",[subject.eventId]))).rows).toEqual([]);
 await expect(usage.record(toOrgId(OTHER),reported)).rejects.toBeDefined();
 await expect(usage.record(toOrgId(ORG),{...reported,requestStartedAt:new Date(now+1).toISOString()})).rejects.toBeDefined();
 expect((await asApp(OTHER,c=>c.query("SELECT request_id FROM token_usage_enrichments WHERE request_id=$1",[subject.eventId]))).rows).toEqual([]);
 await expect(asApp(ORG,c=>c.query("UPDATE token_usage_events SET tokens_total=5 WHERE id=$1",[subject.eventId]))).rejects.toBeDefined();
 await expect(asApp(ORG,c=>c.query("UPDATE token_usage_enrichments SET facts='{}'::jsonb WHERE request_id=$1",[subject.eventId]))).rejects.toBeDefined();
});
it("reported zero and partial known zero cannot be replaced by contradictory late usage",async()=>{
 const subject={userId:"alice",runId:null,modelProvider:"late-provider",modelId:"zero-model",outcome:"failed" as const};
 await usage.record(toOrgId(ORG),{...subject,eventId:"reported-zero",tokensTotal:0,promptTokens:0,completionTokens:0,totalSource:"reported",costMicros:0n,currency:"CNY",priceVersion:"zero-price"});
 await expect(usage.record(toOrgId(ORG),{...subject,eventId:"reported-zero",tokensTotal:1,promptTokens:1,completionTokens:0,totalSource:"reported",costMicros:1n,currency:"CNY",priceVersion:"zero-price"})).rejects.toBeDefined();
 await usage.record(toOrgId(ORG),{...subject,eventId:"partial-zero",tokensTotal:0,promptTokens:0,completionTokens:null,totalSource:"unknown"});
 await expect(usage.record(toOrgId(ORG),{...subject,eventId:"partial-zero",tokensTotal:2,promptTokens:1,completionTokens:1,totalSource:"reported"})).rejects.toBeDefined();
 expect((await asApp(ORG,c=>c.query("SELECT id,tokens_total::text,tokens_prompt::text,total_source FROM effective_token_usage() WHERE model_id='zero-model' ORDER BY id"))).rows).toEqual([
  {id:"partial-zero",tokens_total:"0",tokens_prompt:"0",total_source:"unknown"},
  {id:"reported-zero",tokens_total:"0",tokens_prompt:"0",total_source:"reported"},
 ]);
 expect((await asApp(ORG,c=>c.query("SELECT request_id FROM token_usage_enrichments WHERE request_id IN ('reported-zero','partial-zero')"))).rows).toEqual([]);
});

it("concurrent late counters merge once per field while contradictory known counters reject",async()=>{
 const subject={userId:"alice",runId:null,modelProvider:"late-provider",modelId:"concurrent-model",outcome:"failed" as const};
 const unknown={...subject,eventId:"concurrent-late",tokensTotal:0,promptTokens:null,completionTokens:null,totalSource:"unknown" as const};
 await usage.record(toOrgId(ORG),unknown);
 await Promise.all([usage.record(toOrgId(ORG),{...unknown,promptTokens:3}),usage.record(toOrgId(ORG),{...unknown,completionTokens:2})]);
 expect((await asApp(ORG,c=>c.query("SELECT tokens_total::text,tokens_prompt::text,tokens_completion::text,total_source FROM effective_token_usage() WHERE id='concurrent-late'"))).rows[0]).toEqual({tokens_total:"0",tokens_prompt:"3",tokens_completion:"2",total_source:"unknown"});
 await usage.record(toOrgId(ORG),{...unknown,tokensTotal:5,promptTokens:3,completionTokens:2,totalSource:"reported"});
 expect((await asApp(ORG,c=>c.query("SELECT count(*)::int AS calls,sum(tokens_total)::text AS tokens FROM effective_token_usage() WHERE id='concurrent-late'"))).rows[0]).toEqual({calls:1,tokens:"5"});
 const conflict={...unknown,eventId:"concurrent-known-conflict"};await usage.record(toOrgId(ORG),conflict);
 const results=await Promise.allSettled([usage.record(toOrgId(ORG),{...conflict,promptTokens:3}),usage.record(toOrgId(ORG),{...conflict,promptTokens:4})]);
 expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
 const effective=(await asApp(ORG,c=>c.query("SELECT tokens_prompt::text FROM effective_token_usage() WHERE id='concurrent-known-conflict'"))).rows[0];
 expect(["3","4"]).toContain(effective.tokens_prompt);
 expect((await asApp(ORG,c=>c.query("SELECT count(*)::int AS revisions FROM token_usage_enrichments WHERE request_id='concurrent-known-conflict'"))).rows[0]).toEqual({revisions:1});
 await expect(asApp(ORG,c=>c.query(`INSERT INTO token_usage_enrichments(org_id,request_id,revision,facts)
  VALUES($1,'concurrent-known-conflict',2,'{"total_source":null,"tokens_total":null}'::jsonb)`,[ORG]))).rejects.toBeDefined();
 expect((await asApp(ORG,c=>c.query("SELECT tokens_total::text,total_source FROM effective_token_usage() WHERE id='concurrent-known-conflict'"))).rows[0]).toEqual({tokens_total:"0",total_source:"unknown"});
});
