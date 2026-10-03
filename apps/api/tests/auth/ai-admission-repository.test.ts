import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgAiAdmissionRepository } from "../../src/infrastructure/auth/pg-ai-admission-repository";
import { PgTokenUsageRepository } from "../../src/infrastructure/auth/pg-token-usage-repository";
import { toOrgId } from "../../src/domain/org-id";
const ORG="org-admission-5261", OTHER="org-admission-5261-other", USER="u-admission-5261";
const start=new Date(Date.now()-3_600_000).toISOString(), end=new Date(Date.now()+3_600_000).toISOString();
let db:PgDatabase, admission:PgAiAdmissionRepository, usage:PgTokenUsageRepository;
const request=(id:string)=>({requestId:id,userId:USER,windowStart:start,windowEnd:end,maximumTokens:6n,maximumCostMicros:600n,
 modelProvider:"provider",modelId:"model",currency:"CNY",priceVersion:"test-price-v1"});
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());admission=new PgAiAdmissionRepository(db);usage=new PgTokenUsageRepository(db);});
beforeEach(async()=>{
 await resetOrgs(ORG,OTHER);await seedOrg({orgId:ORG,projectId:"p-admission-5261"});await seedOrg({orgId:OTHER,projectId:"p-admission-5261-other"});
 await asApp(ORG,c=>c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'ordinary',1,$2)",[ORG,USER]));
 await asOwner(c=>c.query(`INSERT INTO ai_budget_windows(org_id,user_id,window_start,window_end,timezone,token_limit,cost_limit_micros,currency,price_version,configured_by)
  VALUES($1,$2,$3,$4,'Etc/UTC',10,1000,'CNY','test-price-v1',$2)`,[ORG,USER,start,end]));
});
afterAll(async()=>{await resetOrgs(ORG,OTHER);await db.close();});
describe("shared atomic admission foundation — isolated PostgreSQL",()=>{
 it("unreserved in-flight starts are unknown cost, including enterprise activation",async()=>{
  await usage.startRequest(toOrgId(ORG),{requestId:"legacy-inflight",userId:USER,runId:null,modelProvider:"provider",modelId:"model",startedAt:new Date().toISOString()});
  expect((await admission.reserve(toOrgId(ORG),request("after-activation"))).decision).toBe("COST_LIMIT_UNCONFIGURED");
  await asApp(ORG,c=>c.query("UPDATE organization_plans SET plan='enterprise' WHERE org_id=$1",[ORG]));
  expect((await admission.reserve(toOrgId(ORG),request("enterprise-after-activation"))).decision).toBe("COST_LIMIT_UNCONFIGURED");
 });
 it("a different worker reads the immutable reserved price after current policy changes",async()=>{
  const configuration={window:{start,end,timezone:"Etc/UTC"},ordinaryTokensPerUser:"10",costMicrosPerUser:"1000",currency:"CNY",
   prices:[{modelId:"formal",modelProvider:"provider",runtimeModelId:"model",inputMicrosPerMillion:"100000000",outputMicrosPerMillion:"100000000",cachedInputMicrosPerMillion:"100000000",maxInputTokens:4,maxOutputTokens:2}],fallbackModelIds:[],maxAttempts:1};
  await asApp(ORG,c=>c.query(`INSERT INTO organization_ai_policy_changes(id,org_id,version,configuration,price_version,actor_id,reason)
   VALUES('audit-reserved-price',$1,1,$2::jsonb,'test-price-v1',$3,'isolated old-price fixture')`,[ORG,JSON.stringify(configuration),USER]));
  await admission.reserve(toOrgId(ORG),request("price-cross-worker"));
  const replacement={...configuration,prices:[{...configuration.prices[0]!,inputMicrosPerMillion:"999"}]};
  await asApp(ORG,c=>c.query(`INSERT INTO organization_ai_policies(org_id,version,configuration,price_version,updated_by)
   VALUES($1,2,$2::jsonb,'new-price',$3)`,[ORG,JSON.stringify(replacement),USER]));
  const otherWorker=new PgAiAdmissionRepository(db);
  expect(await otherWorker.readReservedPrice(toOrgId(ORG),"price-cross-worker")).toMatchObject({userId:USER,priceVersion:"test-price-v1",price:configuration.prices[0]});
  expect(await otherWorker.readReservedPrice(toOrgId(OTHER),"price-cross-worker")).toBeNull();
  await expect(asApp(ORG,c=>c.query("UPDATE organization_ai_policy_changes SET configuration=$1::jsonb WHERE id='audit-reserved-price'",[JSON.stringify(replacement)]))).rejects.toBeDefined();
 });
 it("one stable logical attempt slot cannot be paid twice by concurrent workers",async()=>{
  const bounded={...request("logical-a"),logicalCallId:"stable-run-call",logicalAttempt:0,maximumAttempts:1,maximumTokens:1n,maximumCostMicros:1n};
  const results=await Promise.all([admission.reserve(toOrgId(ORG),bounded),admission.reserve(toOrgId(ORG),{...bounded,requestId:"logical-b"})]);
  expect(results.filter(result=>result.decision==="allowed")).toHaveLength(1);
  expect(results.filter(result=>result.decision==="AI_ATTEMPT_LIMIT_REACHED")).toHaveLength(1);
  const winner=results[0]?.decision==="allowed"?bounded:{...bounded,requestId:"logical-b"};
  expect(await admission.reserve(toOrgId(ORG),winner)).toMatchObject({decision:"allowed",replay:true});
  await expect(admission.reserve(toOrgId(ORG),{...winner,maximumAttempts:2})).rejects.toThrow("AI_RESERVATION_REPLAY_MISMATCH");
  await expect(admission.reserve(toOrgId(ORG),{...bounded,requestId:"logical-c",maximumAttempts:2,logicalAttempt:1})).rejects.toThrow("AI_LOGICAL_CALL_POLICY_MISMATCH");
 });
 it("two concurrent workers cannot sell the same remaining budget",async()=>{
  const results=await Promise.all([admission.reserve(toOrgId(ORG),request("reserve-a")),admission.reserve(toOrgId(ORG),request("reserve-b"))]);
  expect(results.filter(r=>r.decision==="allowed")).toHaveLength(1);
  expect(results.filter(r=>r.decision==="TOKEN_LIMIT_REACHED")).toHaveLength(1);
  expect((await asApp(ORG,c=>c.query("SELECT id FROM ai_request_reservations"))).rows).toHaveLength(1);
 });
 it("request replay holds once and rejects changed ownership/amount",async()=>{
  await admission.reserve(toOrgId(ORG),request("reserve-a"));
  expect(await admission.reserve(toOrgId(ORG),request("reserve-a"))).toEqual({decision:"allowed",replay:true,reservationState:"held"});
  await expect(admission.reserve(toOrgId(ORG),{...request("reserve-a"),maximumTokens:5n})).rejects.toThrow("AI_RESERVATION_REPLAY_MISMATCH");
 });
 it("unknown or absent terminal usage retains its hold",async()=>{
  await admission.reserve(toOrgId(ORG),request("reserve-a"));
  await admission.settle(toOrgId(ORG),"reserve-a",{tokens:null,costMicros:null});
  await expect(admission.settle(toOrgId(ORG),"reserve-a",{tokens:5n,costMicros:500n})).rejects.toThrow("AI_SETTLEMENT_RECEIPT_MISSING_OR_MISMATCH");
  expect((await asApp(ORG,c=>c.query("SELECT state FROM ai_request_reservations"))).rows[0]).toEqual({state:"held"});
 });
 it("known billable failed receipt settles once; aggregates use same immutable ledger",async()=>{
  await admission.reserve(toOrgId(ORG),request("reserve-a"));
  await usage.record(toOrgId(ORG),{eventId:"reserve-a",userId:USER,runId:null,modelProvider:"provider",modelId:"model",tokensTotal:5,
   promptTokens:5,completionTokens:0,outcome:"failed",totalSource:"reported",costMicros:500n,currency:"CNY",priceVersion:"test-price-v1"});
  // Between ledger arrival and settlement, one request occupies max hold once, not ledger+hold.
  expect((await admission.reserve(toOrgId(ORG),{...request("reserve-b"),maximumTokens:4n,maximumCostMicros:400n})).decision).toBe("allowed");
  await admission.settle(toOrgId(ORG),"reserve-a",{tokens:5n,costMicros:500n});
  await admission.settle(toOrgId(ORG),"reserve-a",{tokens:5n,costMicros:500n});
  await expect(admission.settle(toOrgId(ORG),"reserve-a",{tokens:4n,costMicros:500n})).rejects.toThrow("AI_SETTLEMENT_REPLAY_MISMATCH");
  expect((await admission.reserve(toOrgId(ORG),{...request("reserve-c"),maximumTokens:1n,maximumCostMicros:100n})).decision).toBe("allowed");
 });
 it("enterprise bypasses product tokens but cannot bypass finite cost",async()=>{
  await asApp(ORG,c=>c.query("UPDATE organization_plans SET plan='enterprise' WHERE org_id=$1",[ORG]));
  expect((await admission.reserve(toOrgId(ORG),{...request("reserve-a"),maximumTokens:100_000n})).decision).toBe("allowed");
  expect((await admission.reserve(toOrgId(ORG),{...request("reserve-b"),maximumTokens:100_000n})).decision).toBe("COST_LIMIT_REACHED");
 });
 it("tenant negative reads and settlement cannot access another organization's hold",async()=>{
  await admission.reserve(toOrgId(ORG),request("reserve-a"));
  expect((await asApp(OTHER,c=>c.query("SELECT id FROM ai_request_reservations"))).rows).toEqual([]);
  await expect(admission.settle(toOrgId(OTHER),"reserve-a",{tokens:0n,costMicros:0n})).rejects.toThrow("AI_RESERVATION_NOT_FOUND");
  await expect(asApp(OTHER,c=>c.query(`INSERT INTO ai_request_reservations(id,org_id,user_id,window_start,window_end,maximum_tokens,maximum_cost_micros,model_provider,model_id,currency,price_version)
   VALUES('cross-tenant',$1,$2,$3,$4,1,1,'p','m','CNY','v')`,[ORG,USER,start,end]))).rejects.toThrow();
 });
 it("unpriced historical charge blocks admission rather than treating it as zero",async()=>{
  await usage.record(toOrgId(ORG),{eventId:"old-unknown-price",userId:USER,runId:null,modelProvider:"provider",modelId:"model",tokensTotal:2,
   promptTokens:2,completionTokens:0,outcome:"succeeded",totalSource:"reported"});
  expect((await admission.reserve(toOrgId(ORG),request("reserve-a"))).decision).toBe("COST_LIMIT_UNCONFIGURED");
 });
});
