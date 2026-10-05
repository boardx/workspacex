import "reflect-metadata";
import {describe,it,expect,vi} from "vitest";
import {GUARDS_METADATA} from "@nestjs/common/constants";
import {PlatformModelTestController} from "../../src/interface/controllers/platform-model-test.controller";
import {PlatformOperatorGuard} from "../../src/interface/guards/platform-operator.guard";
import {PlatformModelTestService} from "../../src/application/model/platform-model-test";
import {PlatformModelTestError,type PlatformModelTestOperation} from "../../src/application/model/platform-model-test-ports";
import {platformModelTestRecord} from "../../src/application/model/platform-model-test-read-ports";
import {PlatformModelTestRequest} from "@repo/contracts/platform-model-test";
import type {Principal} from "../../src/domain/principal";
import {toOrgId} from "../../src/domain/org-id";
const request=PlatformModelTestRequest.parse({testId:"52f5c4f0-51a6-451b-ae38-e19a823f70ca",orgId:"org-a",modelId:"fixture",capability:"text",declaredNonConfidential:true,input:{prompt:"private prompt"},bounds:{maxOutputTokens:2,maximumCostMicros:"1000000",timeoutMs:1000}});
const operation:PlatformModelTestOperation={testId:request.testId,operatorUserId:"operator",request,state:"succeeded",settlementState:"held",result:{kind:"text",text:"result"},failureReason:null};
const principal:Principal={userId:"operator",orgId:toOrgId("some-session-org")};
function fixture(){const execute=vi.fn(async()=>operation),get=vi.fn(async()=>operation),cancel=vi.fn(async()=>operation);
 const service={execute,get,cancel} as unknown as PlatformModelTestService;
 const reader={candidates:vi.fn(async()=>[]),readUsageProjection:vi.fn(async()=>null)};
 return {controller:new PlatformModelTestController(service,reader),execute,get,cancel,reader};}
describe("platform model test controller boundaries",()=>{
 it("protects every endpoint with normal operator guard",()=>expect(Reflect.getMetadata(GUARDS_METADATA,PlatformModelTestController)).toContain(PlatformOperatorGuard));
 it("uses authenticated user and explicit validated org; public projection hides inputs",async()=>{
  const f=fixture();const result=await f.controller.start(request,principal);expect(f.execute).toHaveBeenCalledWith({operatorUserId:"operator",orgId:"org-a"},request);
  expect(result).not.toHaveProperty("request");expect(result).not.toHaveProperty("operatorUserId");expect(JSON.stringify(result)).not.toContain("private prompt");
 });
 it("rejects other billed users, endpoint or credentials before execution",async()=>{
  const f=fixture();for(const extra of [{billedUserId:"other"},{apiKey:"secret"},{endpoint:"https://provider"}])await expect(f.controller.start({...request,...extra},principal)).rejects.toMatchObject({status:400});expect(f.execute).not.toHaveBeenCalled();
 });
 it("rejects invalid path UUID and extra query fields",async()=>{
  const f=fixture();await expect(f.controller.get("invalid",{orgId:"org-a"},principal)).rejects.toMatchObject({status:400});
  await expect(f.controller.get(request.testId,{orgId:"org-a",operatorUserId:"other"},principal)).rejects.toMatchObject({status:400});expect(f.get).not.toHaveBeenCalled();
 });
 it("cancel validates path/body and uses authenticated attribution",async()=>{
  const f=fixture();await f.controller.cancel(request.testId,{orgId:"org-a"},principal);expect(f.cancel).toHaveBeenCalledWith({operatorUserId:"operator",orgId:"org-a"},request.testId);
 });
 it("maps conflict safely and hides untrusted errors",async()=>{
  const f=fixture();f.execute.mockRejectedValueOnce(new PlatformModelTestError("TEST_ID_CONFLICT"));await expect(f.controller.start(request,principal)).rejects.toMatchObject({status:409,response:{reasonCode:"TEST_ID_CONFLICT"}});
  f.execute.mockRejectedValueOnce(Error("Bearer secret"));await expect(f.controller.start(request,principal)).rejects.toMatchObject({status:503,response:{reasonCode:"TEST_UNAVAILABLE"}});
 });
 it("explicit projection excludes injected credentials and bindings",()=>{
  const record=platformModelTestRecord({...operation,privateConnectionId:"private",apiKey:"secret"} as PlatformModelTestOperation,null);
  expect(record).not.toHaveProperty("apiKey");expect(record).not.toHaveProperty("privateConnectionId");
 });
});
