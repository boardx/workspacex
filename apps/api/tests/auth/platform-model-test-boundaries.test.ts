import {describe,it,expect,vi} from "vitest";
import {PlatformModelTestRequest,PlatformModelTestResult} from "@repo/contracts/platform-model-test";
import {PlatformModelTestService} from "../../src/application/model/platform-model-test";
import type {PlatformModelTestDependencies,PlatformModelTestOperation} from "../../src/application/model/platform-model-test-ports";

const input=PlatformModelTestRequest.parse({testId:"5292be0b-9b72-4e97-9228-0cc01f35dfe1",orgId:"org",modelId:"formal",capability:"text",declaredNonConfidential:true,input:{prompt:"fixture"},bounds:{maxOutputTokens:2,maximumCostMicros:"10",timeoutMs:1000}});
const actor={operatorUserId:"operator",orgId:"org"};
function fixture(){
 let row:PlatformModelTestOperation|undefined;
 const reserve=vi.fn(async()=>{}),releaseUndispatched=vi.fn(async()=>{}),settle=vi.fn(async()=>{});
 const invoke=vi.fn(async()=>({kind:"text" as const,text:"result"}));
 const repository:PlatformModelTestDependencies["repository"]={
  claim:async(_actor,raw)=>{const request=PlatformModelTestRequest.parse(raw);if(row)return {operation:row,claimed:false};row={testId:request.testId,operatorUserId:actor.operatorUserId,request,state:"queued",settlementState:"pending",result:null,failureReason:null};return {operation:row,claimed:true};},
  read:async()=>row!,beginDispatch:async()=>{if(row!.state!=="queued")return false;row={...row!,state:"dispatching"};return true;},
  terminal:async(_actor,_id,terminal)=>{row={...row!,...terminal};},
  cancel:async()=>{if(row!.state!=="queued"&&row!.state!=="dispatching")return row!;row={...row!,state:row!.state==="queued"?"cancelled":"unknown",settlementState:"held",result:null,failureReason:"dispatch-cancelled"};return row;},
 };
 const deps:PlatformModelTestDependencies={repository,accounting:{reserve,releaseUndispatched,settle},adapters:{resolve:async()=>({enabled:true,adapter:{invoke}})}};
 return {deps,service:new PlatformModelTestService(deps),reserve,releaseUndispatched,settle,invoke};
}
describe("independent platform model test boundaries (no PG or paid provider)",()=>{
 it.each(["billedUserId","endpoint","baseUrl","credential","apiKey"])("client %s cannot enter the strict request",field=>{
  expect(PlatformModelTestRequest.safeParse({...input,[field]:"forged"}).success).toBe(false);
  expect(PlatformModelTestRequest.safeParse({...input,input:{...input.input,[field]:"forged"}}).success).toBe(false);
 });
 it("non-confidential confirmation and finite maximum cost are mandatory",()=>{
  expect(PlatformModelTestRequest.safeParse({...input,declaredNonConfidential:false}).success).toBe(false);
  for(const value of ["0","1.5","","9223372036854775808"]){
   expect(()=>PlatformModelTestRequest.safeParse({...input,bounds:{...input.bounds,maximumCostMicros:value}})).not.toThrow();
   expect(PlatformModelTestRequest.safeParse({...input,bounds:{...input.bounds,maximumCostMicros:value}}).success).toBe(false);
  }
 });
 it("post-dispatch cancellation never calls release even when vendor throws",async()=>{
  const f=fixture(),abort=new AbortController();f.invoke.mockImplementationOnce(async()=>{abort.abort();throw Error("credential=secret");});
  const actual=await f.service.execute(actor,input,abort.signal);
  expect(actual).toMatchObject({state:"unknown",result:null,failureReason:"dispatch-cancelled"});
  expect(f.releaseUndispatched).not.toHaveBeenCalled();expect(JSON.stringify(actual)).not.toContain("secret");
  await f.service.execute(actor,input);expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it("durable terminal failure cannot settle, free money, or reopen a vendor request",async()=>{
  const f=fixture();f.deps.repository.terminal=async()=>{throw Error("storage-failure");};
  await expect(f.service.execute(actor,input)).rejects.toThrow("storage-failure");
  await f.service.execute(actor,input);
  expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.settle).not.toHaveBeenCalled();expect(f.releaseUndispatched).not.toHaveBeenCalled();
 });
 it("cancellation winning during reservation invokes only the undispatched release port",async()=>{
  const f=fixture();f.reserve.mockImplementationOnce(async()=>{await f.service.cancel(actor,input.testId);});
  expect((await f.service.execute(actor,input)).state).toBe("cancelled");
  expect(f.invoke).not.toHaveBeenCalled();expect(f.releaseUndispatched).toHaveBeenCalledTimes(1);expect(f.settle).not.toHaveBeenCalled();
 });
});


describe("testbench result URL boundary",()=>{
 it.each(["//foreign.example/image","/\\foreign.example/image","/image\nheader","javascript:alert(1)","https://name:secret@example.test/image"])("rejects unsafe image/audio URL %j",url=>{
  expect(PlatformModelTestResult.safeParse({kind:"image",assets:[{url,mimeType:"image/png"}]}).success).toBe(false);
  expect(PlatformModelTestResult.safeParse({kind:"audio",asset:{url,mimeType:"audio/wav"},durationMs:null}).success).toBe(false);
 });
 it.each(["/files/fixture.png","https://example.test/fixture.png"])("accepts explicit safe asset URL %s",url=>{
  expect(PlatformModelTestResult.safeParse({kind:"image",assets:[{url,mimeType:"image/png"}]}).success).toBe(true);
 });
});
