import {beforeEach,describe,expect,it,vi} from "vitest";
import {PlatformModelTestRequest} from "@repo/contracts/platform-model-test";
import {PlatformTestAccounting} from "../../src/infrastructure/model/platform-test-accounting";
import type {PlatformModelTestOperation} from "../../src/application/model/platform-model-test-ports";
const mocks=vi.hoisted(()=>({reserve:vi.fn(),start:vi.fn(),recover:vi.fn()}));
vi.mock("../../src/infrastructure/auth/pg-ai-admission-repository",()=>({PgAiAdmissionRepository:class {reserve=mocks.reserve;}}));
vi.mock("../../src/infrastructure/auth/pg-token-usage-repository",()=>({PgTokenUsageRepository:class {startRequest=mocks.start;}}));
vi.mock("../../src/application/agent-run/stage-two-receipt-recovery",()=>({recoverAiReceiptSettlement:mocks.recover}));
const request=PlatformModelTestRequest.parse({testId:"78bfcbe5-68be-437b-87dc-14b8b04d1823",orgId:"org",modelId:"formal",capability:"text",declaredNonConfidential:true,input:{prompt:"fixture"},bounds:{maximumCostMicros:"10",timeoutMs:1000,maxOutputTokens:2}});
const operation:PlatformModelTestOperation={testId:request.testId,operatorUserId:"operator",request,state:"queued",settlementState:"pending",result:null,failureReason:null};
function fixture(){
 const scoped={} as never;
 const metadata={orgId:"org",operatorUserId:"operator",testId:request.testId,state:"dispatching",settlementState:"held",physicalReceiptId:request.testId};
 const repository={withQueuedAccounting:vi.fn(async(_actor:unknown,_id:string,work:(s:never,m:typeof metadata)=>Promise<unknown>)=>work(scoped,metadata)),readAccountingMetadata:vi.fn(async()=>metadata),refreshSettlement:vi.fn(async()=>{})};
 const reservation={requestId:request.testId,userId:"operator",agentId:null,maximumCostMicros:10n};
 const resolve=vi.fn(async()=>({reservation,startedAt:"2026-10-05T00:00:00Z",callPurpose:"primary"}));
 return {accounting:new PlatformTestAccounting({} as never,repository as never,{resolve} as never),repository,reservation,resolve,scoped,metadata};
}
beforeEach(()=>{vi.clearAllMocks();mocks.reserve.mockResolvedValue({decision:"allowed",replay:false,tokenWarning:false});mocks.start.mockResolvedValue(undefined);mocks.recover.mockResolvedValue({status:"settled"});});
describe("platform test accounting independent mock boundaries",()=>{
 it("reserves then writes the single start through the queued transaction scope",async()=>{
  const f=fixture();await f.accounting.reserve(operation);expect(f.resolve).toHaveBeenCalledWith(operation,f.scoped);
  expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]!);
  expect(mocks.start).toHaveBeenCalledWith("org",expect.objectContaining({requestId:request.testId,userId:"operator",runId:null,executionAttemptId:null,agentId:null}));
 });
 it.each(["requestId","userId","agentId","cost"])("invalid %s binding has no reservation or start",async field=>{
  const f=fixture();if(field==="cost")f.reservation.maximumCostMicros=11n;else Object.assign(f.reservation,{[field]:"foreign"});
  await expect(f.accounting.reserve(operation)).rejects.toThrow("TEST_ACCOUNTING_BINDING_INVALID");expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
 });
 it.each([{decision:"COST_LIMIT_REACHED",replay:false},{decision:"allowed",replay:true},{decision:"allowed",replay:false,tokenWarning:true}])("refused/replayed/warned admission cannot write a start: %j",async decision=>{
  const f=fixture();mocks.reserve.mockResolvedValueOnce(decision);await expect(f.accounting.reserve(operation)).rejects.toThrow("TEST_ADMISSION_REFUSED");expect(mocks.start).not.toHaveBeenCalled();
 });
 it.each(["testId","operatorUserId","orgId"])("foreign metadata %s fails before admission",async field=>{
  const f=fixture();Object.assign(f.metadata,{[field]:"foreign"});
  await expect(f.accounting.reserve(operation)).rejects.toThrow("TEST_ACCOUNTING_BINDING_INVALID");expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
 });
 it("a text test cannot disguise its provenance as a local trial",async()=>{
  const f=fixture();f.resolve.mockResolvedValueOnce({reservation:f.reservation,startedAt:"2026-10-05T00:00:00Z",callPurpose:"local-trial"});
  await expect(f.accounting.reserve(operation)).rejects.toThrow("TEST_PURPOSE_INVALID");expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();
 });
 it("undispatched release keeps money held without invented zero usage or settlement",async()=>{
  const f=fixture();await f.accounting.releaseUndispatched(operation);expect(f.repository.readAccountingMetadata).toHaveBeenCalledTimes(1);expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.recover).not.toHaveBeenCalled();expect(f.repository.refreshSettlement).not.toHaveBeenCalled();
 });
 it("recovery consumes authoritative receipt identity then refreshes settlement",async()=>{
  const f=fixture();await f.accounting.settle(operation);expect(mocks.recover).toHaveBeenCalledWith(expect.anything(),"org",request.testId);expect(mocks.recover.mock.invocationCallOrder[0]).toBeLessThan(f.repository.refreshSettlement.mock.invocationCallOrder[0]!);
 });
 it.each(["queued","unknown","cancelled"])("%s cannot pass the final paid dispatch check",async state=>{
  const f=fixture();f.metadata.state=state;await expect(f.accounting.assertDispatch(operation,request.testId)).rejects.toThrow("TEST_DISPATCH_CLOSED");
 });
 it("different physical receipt cannot pass even in dispatching state",async()=>{
  const f=fixture();await expect(f.accounting.assertDispatch(operation,"foreign")).rejects.toThrow("TEST_DISPATCH_CLOSED");
 });
});
