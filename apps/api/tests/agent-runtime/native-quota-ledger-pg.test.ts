import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,it,expect,vi} from "vitest";
import {Configuration} from "@repo/contracts/ai-policy";
import {toOrgId} from "../../src/domain/org-id";
import type {AiReservationInput} from "../../src/application/agent-run/ai-admission-ports";
import type {TokenUsageRecord} from "../../src/application/agent-run/ports";
import {recoverAiReceiptSettlement} from "../../src/application/agent-run/stage-two-receipt-recovery";
import {PgAiAdmissionRepository} from "../../src/infrastructure/auth/pg-ai-admission-repository";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {addChatThread} from "../support/chat-db";
import {seedAgentRun} from "../support/agent-run-db";
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from "../support/db";
/** Real PostgreSQL ledger acceptance. Native tariffs and reported supplier counts are test fixtures;
 * this suite does not dispatch a provider or prove deployment pricing/model availability. */
let db:PgDatabase;const orgs:string[]=[];
beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());});
afterAll(async()=>{await db?.close();await resetOrgs(orgs);});
async function fixture(plan:"ordinary"|"enterprise"="ordinary",tokens:string|null=null,cost="100",rate="3"){
 const org=toOrgId("native-ledger-"+randomUUID()),user="native-user",project="project-"+org,thread="thread-"+org,run="run-"+org;
 orgs.push(org);await seedOrg({orgId:org,projectId:project});await addOrgMember(org,user,"consultant",null);
 await addChatThread({orgId:org,id:thread,projectId:project,visibilityScope:"plenary",createdBy:user});await seedAgentRun({orgId:org,id:run,threadId:thread,authorId:user});
 const window={start:new Date(Date.now()-60_000).toISOString(),end:new Date(Date.now()+3_600_000).toISOString(),timezone:"Etc/UTC"};
 const configuration=Configuration.parse({window,ordinaryTokensPerUser:tokens,costMicrosPerUser:cost,currency:"CNY",
  prices:[{modelId:"dummy-token",modelProvider:"dummy",runtimeModelId:"dummy-token-runtime",inputMicrosPerMillion:"1",outputMicrosPerMillion:"1",cachedInputMicrosPerMillion:"1",maxInputTokens:1,maxOutputTokens:1}],
  nativePrices:[{modelId:"native-image",modelProvider:"native-fixture",runtimeModelId:"image-runtime",unit:"image",quantum:"2",microsPerQuantum:rate,maxQuantity:"2"}],fallbackModelIds:[],maxAttempts:1});
 const priceVersion=randomUUID();await asApp(org,async c=>{
  await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,$2,1,$3)",[org,plan,user]);
  await c.query("INSERT INTO organization_ai_policy_changes(id,org_id,version,configuration,price_version,actor_id,reason) VALUES($1,$2,1,$3::jsonb,$4,$5,$6)",[randomUUID(),org,JSON.stringify(configuration),priceVersion,user,"native ledger acceptance fixture"]);
  await c.query("INSERT INTO organization_ai_policies(org_id,version,configuration,price_version,updated_by) VALUES($1,1,$2::jsonb,$3,$4)",[org,JSON.stringify(configuration),priceVersion,user]);
 });
 const admission=new PgAiAdmissionRepository(db),usage=new PgTokenUsageRepository(db);
 const budget=await admission.resolveBudgetPolicy(org,user,"not-applicable");expect(budget.decision).toBe("configured");
 function input(quantity=2n):AiReservationInput{return {requestId:randomUUID(),userId:user,formalModelId:"native-image",agentId:null,
  windowStart:window.start,windowEnd:window.end,maximumTokens:0n,maximumCostMicros:(quantity*BigInt(rate)+1n)/2n,
  modelProvider:"native-fixture",modelId:"image-runtime",currency:"CNY",priceVersion,nativePolicy:{unit:"image",maximumQuantity:quantity}};}
 async function start(reservation:AiReservationInput){const startedAt=new Date().toISOString();await usage.startRequest(org,{requestId:reservation.requestId,userId:user,runId:run,executionAttemptId:"attempt-"+org,
  projectId:project,threadId:thread,agentId:null,callPurpose:"native-image",modelProvider:reservation.modelProvider,modelId:reservation.modelId,startedAt});return startedAt;}
 function terminal(reservation:AiReservationInput,startedAt:string,quantity:bigint|null=1n,source:"reported"|"estimated"|"unknown"="reported"):TokenUsageRecord{
  return {eventId:reservation.requestId,userId:user,runId:run,executionAttemptId:"attempt-"+org,projectId:project,threadId:thread,agentId:null,callPurpose:"native-image",
   modelProvider:reservation.modelProvider,modelId:reservation.modelId,requestStartedAt:startedAt,requestEndedAt:new Date().toISOString(),tokensTotal:0,totalSource:"not-applicable",promptTokens:null,completionTokens:null,
   nativeUsage:{unit:"image",quantity,source},...(source!=="reported"?{}:{costMicros:(quantity!*BigInt(rate)+1n)/2n,currency:"CNY",priceVersion}),outcome:"succeeded"};
 }
 async function state(requestId:string){return (await asApp(org,c=>c.query("SELECT state,settled_tokens,settled_cost_micros,billing_kind,native_unit,max_native_quantity::text FROM ai_request_reservations WHERE org_id=$1 AND id=$2",[org,requestId]))).rows[0];}
 return {org,user,configuration,admission,usage,input,start,terminal,state,priceVersion};
}
it.each([null,"0"])("ordinary native admission remains available with Token allowance %s and finite costs",async tokens=>{
 const f=await fixture("ordinary",tokens),request=f.input();expect(await f.admission.reserve(f.org,request)).toMatchObject({decision:"allowed",replay:false});
 const startedAt=await f.start(request),terminal=f.terminal(request,startedAt);await f.usage.record(f.org,terminal);
 await f.admission.settle(f.org,request.requestId,{tokens:0n,costMicros:2n});
 expect(await f.state(request.requestId)).toMatchObject({state:"settled",settled_tokens:"0",settled_cost_micros:"2",billing_kind:"native",native_unit:"image",max_native_quantity:"2"});
});
it("enterprise native exemption retains the finite monetary budget",async()=>{
 const f=await fixture("enterprise","0","3"),request=f.input();expect((await f.admission.reserve(f.org,request)).decision).toBe("allowed");
 const startedAt=await f.start(request);await f.usage.record(f.org,f.terminal(request,startedAt,2n));await f.admission.settle(f.org,request.requestId,{tokens:0n,costMicros:3n});
 expect((await f.admission.reserve(f.org,f.input())).decision).toBe("COST_LIMIT_REACHED");
});
it("changing native quantity on replay is rejected even when both bounds round to the same cost",async()=>{
 const f=await fixture("ordinary",null,"100","1"),request=f.input(1n);expect(request.maximumCostMicros).toBe(1n);await f.admission.reserve(f.org,request);
 expect(await f.admission.reserve(f.org,request)).toMatchObject({replay:true});
 await expect(f.admission.reserve(f.org,{...request,nativePolicy:{unit:"image",maximumQuantity:2n}})).rejects.toThrow("AI_RESERVATION_REPLAY_MISMATCH");
});
it("a native reservation cannot be settled with a reported zero Token receipt substituted for native quantity",async()=>{
 const f=await fixture(),request=f.input();await f.admission.reserve(f.org,request);const startedAt=await f.start(request);
 const terminal=f.terminal(request,startedAt);const {nativeUsage:_native,...tokenReceipt}=terminal;
 await f.usage.record(f.org,{...tokenReceipt,totalSource:"reported",promptTokens:0,completionTokens:0});
 await expect(f.admission.settle(f.org,request.requestId,{tokens:0n,costMicros:2n})).rejects.toThrow("AI_SETTLEMENT_RECEIPT_MISSING_OR_MISMATCH");expect((await f.state(request.requestId)).state).toBe("held");
});
it("immutable native snapshot recomputes the supplier quantity and rejects a mismatched reported price",async()=>{
 const f=await fixture(),request=f.input();await f.admission.reserve(f.org,request);const startedAt=await f.start(request);
 await f.usage.record(f.org,{...f.terminal(request,startedAt),costMicros:1n});
 await expect(f.admission.settle(f.org,request.requestId,{tokens:0n,costMicros:1n})).rejects.toThrow("AI_SETTLEMENT_RECEIPT_MISSING_OR_MISMATCH");expect((await f.state(request.requestId)).state).toBe("held");
});
it.each(["estimated","unknown"] as const)("%s native quantity retains its hold and recovery never dispatches",async source=>{
 const f=await fixture(),request=f.input();await f.admission.reserve(f.org,request);const startedAt=await f.start(request);
 await f.usage.record(f.org,f.terminal(request,startedAt,source==="unknown"?null:1n,source));
 await f.admission.settle(f.org,request.requestId,{tokens:0n,costMicros:null});
 expect(await recoverAiReceiptSettlement({recovery:f.admission,admission:f.admission},f.org,request.requestId)).toEqual({status:"held",reason:"usage-unknown"});expect((await f.state(request.requestId)).state).toBe("held");
});
it("recovery settles the authoritative native terminal after lost settlement acknowledgement without supplier HTTP",async()=>{
 const f=await fixture(),request=f.input();await f.admission.reserve(f.org,request);const startedAt=await f.start(request);await f.usage.record(f.org,f.terminal(request,startedAt));
 expect(await f.admission.readRecoverySnapshot(f.org,request.requestId)).toMatchObject({reservationState:"held",receipt:{tokens:0n,costMicros:2n}});
 const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("supplier HTTP must not run"));
 try{expect(await recoverAiReceiptSettlement({recovery:f.admission,admission:f.admission},f.org,request.requestId)).toEqual({status:"settled"});
  expect(await recoverAiReceiptSettlement({recovery:f.admission,admission:f.admission},f.org,request.requestId)).toEqual({status:"settled"});expect(fetcher).not.toHaveBeenCalled();
 }finally{fetcher.mockRestore();}
 expect((await f.state(request.requestId)).settled_cost_micros).toBe("2");
});
it("a foreign organization cannot find or recover another organization's native reservation",async()=>{
 const f=await fixture(),foreign=await fixture(),request=f.input();await f.admission.reserve(f.org,request);
 expect(await f.admission.readRecoverySnapshot(foreign.org,request.requestId)).toBeNull();
 expect(await recoverAiReceiptSettlement({recovery:f.admission,admission:f.admission},foreign.org,request.requestId)).toEqual({status:"not-found"});
 await expect(f.admission.settle(foreign.org,request.requestId,{tokens:0n,costMicros:3n})).rejects.toThrow("AI_RESERVATION_NOT_FOUND");
});

it("concurrent native holds cannot oversell a finite enterprise cost budget",async()=>{
 const f=await fixture("enterprise","0","3"),a=f.input(),b=f.input();
 const results=await Promise.all([f.admission.reserve(f.org,a),f.admission.reserve(f.org,b)]);
 expect(results.map(r=>r.decision).sort()).toEqual(["COST_LIMIT_REACHED","allowed"].sort());
 const held=await asApp(f.org,c=>c.query("SELECT count(*)::text AS count,sum(maximum_cost_micros)::text AS cost FROM ai_request_reservations WHERE org_id=$1 AND state='held'",[f.org]));
 expect(held.rows[0]).toEqual({count:"1",cost:"3"});
});
it("a durable start without a terminal remains held during recovery",async()=>{
 const f=await fixture(),request=f.input();await f.admission.reserve(f.org,request);await f.start(request);
 expect(await recoverAiReceiptSettlement({recovery:f.admission,admission:f.admission},f.org,request.requestId)).toEqual({status:"held",reason:"receipt-missing"});expect((await f.state(request.requestId)).state).toBe("held");
});
