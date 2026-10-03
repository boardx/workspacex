import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {aiUsage as C} from "@repo/contracts";
import {ensureDatabase,migrateOnce,resetOrgs,seedOrg,asApp} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
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

});
