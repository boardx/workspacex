import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import type {IdentityRepository} from "../../src/application/identity/ports";
import {PgPlatformModelTestRepository} from "../../src/infrastructure/model/pg-platform-model-test-repository";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {asApp,asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../support/db";
const ORG="org-platform-test-db",OTHER="org-platform-other-db";
const actor={orgId:ORG,operatorUserId:"fixture-operator"};
const request={testId:"9b696910-134b-499d-aa54-881c4eefaf78",orgId:ORG,modelId:"fixture-formal-model",capability:"text" as const,declaredNonConfidential:true as const,input:{prompt:"isolated fixture"},bounds:{maximumCostMicros:"10",timeoutMs:1000,maxOutputTokens:2}};
let db:PgDatabase,repository:PgPlatformModelTestRepository,operatorAllowed=true,memberAllowed=true;
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());
 repository=new PgPlatformModelTestRepository(db,{isOperator:async()=>operatorAllowed,identities:()=>({findOrgMembership:async()=>memberAllowed?{orgRole:"member"}:null}) as unknown as IdentityRepository});
});
beforeEach(async()=>{operatorAllowed=true;memberAllowed=true;await resetOrgs(ORG,OTHER);await seedOrg({orgId:ORG,projectId:"project-platform-test-db"});await seedOrg({orgId:OTHER,projectId:"project-platform-other-db"});});
afterAll(async()=>{await db?.close();await resetOrgs(ORG,OTHER);});
describe("real PG isolated platform model test persistence",()=>{
 it("links an actual held receipt with explicit platform provenance atomically before dispatch",async()=>{
  await repository.claim(actor,request);
  await asApp(ORG,async c=>{
   await c.query(`INSERT INTO ai_budget_windows(org_id,user_id,window_start,window_end,timezone,token_limit,cost_limit_micros,currency,price_version,configured_by)
    VALUES($1,$2,'2026-10-01','2026-11-01','UTC',10,100,'CNY','fixture-price',$2)`,[ORG,actor.operatorUserId]);
   await c.query(`INSERT INTO ai_request_reservations(id,org_id,user_id,window_start,window_end,maximum_tokens,maximum_cost_micros,model_provider,model_id,currency,price_version,formal_model_id)
    VALUES('fixture-platform-receipt',$1,$2,'2026-10-01','2026-11-01',2,10,'fixture-provider','fixture-runtime','CNY','fixture-price',$3)`,[ORG,actor.operatorUserId,request.modelId]);
  });
  const start={requestId:"fixture-platform-receipt",platformTestId:request.testId,userId:actor.operatorUserId,runId:null,executionAttemptId:null,projectId:null,modelProvider:"fixture-provider",modelId:"fixture-runtime",startedAt:"2026-10-05T00:00:00Z",callPurpose:"primary" as const};
  await expect(repository.withQueuedAccounting(actor,request.testId,async scoped=>{
   await new PgTokenUsageRepository(scoped).startRequest(ORG as never,{...start,callPurpose:"retrieval-rerank"});
   return {physicalReceiptId:start.requestId,value:null};
  })).rejects.toThrow("authority mismatch");
  expect((await repository.readAccountingMetadata(actor,request.testId)).physicalReceiptId).toBeNull();
  await repository.withQueuedAccounting(actor,request.testId,async scoped=>{
   await new PgTokenUsageRepository(scoped).startRequest(ORG as never,start);
   return {physicalReceiptId:start.requestId,value:null};
  });
  const receipt=await asApp(ORG,c=>c.query("SELECT platform_test_id FROM model_request_starts WHERE id=$1",[start.requestId]));
  expect(receipt.rows[0].platform_test_id).toBe(request.testId);
  expect(await repository.beginDispatch(actor,request.testId)).toBe(true);
  expect(await repository.beginDispatch(actor,request.testId)).toBe(false);
  expect((await repository.cancel(actor,request.testId)).state).toBe("unknown");
 });
 it("concurrent identical UUID claims produce exactly one dispatch owner",async()=>{
  const claims=await Promise.all([repository.claim(actor,request),repository.claim(actor,request)]);
  expect(claims.filter(result=>result.claimed)).toHaveLength(1);expect(claims.filter(result=>!result.claimed)).toHaveLength(1);
  const count=await asApp(ORG,c=>c.query("SELECT count(*)::text AS n FROM platform_model_tests WHERE id=$1",[request.testId]));expect(count.rows[0].n).toBe("1");
 });
 it("foreign UUID collision reveals no operation and never steals billing identity",async()=>{
  await repository.claim(actor,request);
  await expect(repository.claim({orgId:OTHER,operatorUserId:actor.operatorUserId},{...request,orgId:OTHER})).rejects.toThrow("TEST_ID_CONFLICT");
  await expect(repository.read({orgId:OTHER,operatorUserId:actor.operatorUserId},request.testId)).rejects.toThrow("TEST_NOT_FOUND");
  await expect(repository.read({...actor,operatorUserId:"other-operator"},request.testId)).rejects.toThrow("TEST_NOT_FOUND");
  expect((await asApp(OTHER,c=>c.query("SELECT id FROM platform_model_tests WHERE id=$1",[request.testId]))).rows).toEqual([]);
 });
 it("role or formal membership revocation blocks polling and new claims",async()=>{
  await repository.claim(actor,request);operatorAllowed=false;await expect(repository.read(actor,request.testId)).rejects.toThrow("TEST_FORBIDDEN");
  operatorAllowed=true;memberAllowed=false;await expect(repository.read(actor,request.testId)).rejects.toThrow("TEST_FORBIDDEN");
 });
 it("queued cancellation prevents reservation and cannot be revived by late terminal",async()=>{
  await repository.claim(actor,request);expect((await repository.cancel(actor,request.testId)).state).toBe("cancelled");
  let invoked=false;await expect(repository.withQueuedAccounting(actor,request.testId,async()=>{invoked=true;return {physicalReceiptId:"missing",value:null};})).rejects.toThrow("TEST_ACCOUNTING_UNAVAILABLE");expect(invoked).toBe(false);
  expect(await repository.beginDispatch(actor,request.testId)).toBe(false);
  await repository.terminal(actor,request.testId,{state:"failed",result:null,failureReason:"admission-refused"});
  expect(await repository.read(actor,request.testId)).toMatchObject({state:"cancelled",result:null,settlementState:"held"});
 });
 it("missing physical start or held budget can never authorize dispatch",async()=>{
  await repository.claim(actor,request);await expect(repository.beginDispatch(actor,request.testId)).rejects.toThrow("TEST_ACCOUNTING_UNAVAILABLE");
  await expect(repository.attachPhysicalReceipt(actor,request.testId,"missing-start")).rejects.toThrow("receipt ownership mismatch");
  await expect(asApp(ORG,c=>c.query("UPDATE platform_model_tests SET state='dispatching' WHERE id=$1",[request.testId]))).rejects.toThrow("reservation missing");
 });
 it("request/billing ownership is immutable even to the owner, and terminal output never enables models",async()=>{
  await repository.claim(actor,request);
  await expect(asOwner(c=>c.query("UPDATE platform_model_tests SET operator_user_id='forged' WHERE id=$1",[request.testId]))).rejects.toThrow("identity is immutable");
  await expect(asOwner(c=>c.query("UPDATE platform_model_tests SET request=jsonb_set(request,'{modelId}','\"forged\"') WHERE id=$1",[request.testId]))).rejects.toThrow("identity is immutable");
  await repository.terminal(actor,request.testId,{state:"failed",result:null,failureReason:"adapter-unavailable"});
  await expect(asOwner(c=>c.query("UPDATE platform_model_tests SET state='queued' WHERE id=$1",[request.testId]))).rejects.toThrow("transition denied");
  expect((await repository.read(actor,request.testId)).result).toBeNull();
 });
});
