import {describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {VerifiedModelBoundRegistry,type ModelBoundRegistration} from "../../src/application/agent-run/verified-model-bound-registry";
import type {ModelCallPort} from "../../src/application/agent-run/ports";
const model:ModelCallPort={complete:async()=>({text:"unused"}),supportsDispatchAdmission:()=>true,supportsRequestAccounting:()=>true};
const registration=():ModelBoundRegistration=>({binding:{modelId:"formal",modelProvider:"route",runtimeModelId:"runtime",contextWindow:100,maxOutputTokens:10,capabilityTags:["tools"],outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true},billingUnit:"token",implementation:"fixture-verifier",version:"1",artifactSha256:"a".repeat(64),source:"provider-count",verifyDeploymentBinding:async()=>true,measureSerializedBody:async()=>5});
const request={requestId:"id",modelProvider:"route",modelId:"runtime",outputTokenLimit:10,serializedBody:JSON.stringify({model:"runtime",messages:[{content:"full input"}],tools:[{name:"fixture"}],response_format:{type:"json_schema"}})};
describe("trusted code model-bound registration",()=>{
 it("resolves formal or pinned runtime IDs only through one verified explicit binding",async()=>{
  const registry=new VerifiedModelBoundRegistry(model,[registration()]);
  expect(await registry.formalModelId("route","formal")).toBe("formal");expect(await registry.formalModelId("route","runtime")).toBe("formal");
  await expect(registry.formalModelId("route","display name")).rejects.toThrow("UNVERIFIED");await expect(registry.formalModelId("foreign","runtime")).rejects.toThrow("UNVERIFIED");
 });
 it("passes exact messages/tools/schema body and emits a matching digest with implementation/version",async()=>{
  const entry=registration();const measure=vi.fn(entry.measureSerializedBody);const registry=new VerifiedModelBoundRegistry(model,[{...entry,measureSerializedBody:measure}]);
  expect(await registry.measure(request)).toMatchObject({tokens:5,implementation:"fixture-verifier",version:"1",serializedBodySha256:createHash("sha256").update(request.serializedBody).digest("hex")});expect(measure).toHaveBeenCalledWith(request.serializedBody);
 });
 it("does not guess unregistered models, revoked binding, missing adapter capability or native units",async()=>{
  expect(await new VerifiedModelBoundRegistry(model,[]).measure(request)).toBeNull();
  for(const entry of [{...registration(),verifyDeploymentBinding:async()=>false},{...registration(),billingUnit:"native" as const},{...registration(),billingUnit:"unknown" as const}])expect(await new VerifiedModelBoundRegistry(model,[entry]).measure(request)).toBeNull();
  expect(await new VerifiedModelBoundRegistry({...model,supportsDispatchAdmission:undefined},[registration()]).measure(request)).toBeNull();
 });
 it("rejects duplicate physical routes, missing evidence and invalid input values",async()=>{
  expect(()=>new VerifiedModelBoundRegistry(model,[registration(),registration()])).toThrow("REGISTRATION_INVALID");
  expect(()=>new VerifiedModelBoundRegistry(model,[{...registration(),artifactSha256:"unverified"}])).toThrow("REGISTRATION_INVALID");
  for(const count of [-1,1.5,Infinity,null])expect(await new VerifiedModelBoundRegistry(model,[{...registration(),measureSerializedBody:async()=>count}]).measure(request)).toBeNull();
  expect(await new VerifiedModelBoundRegistry(model,[registration()]).measure({...request,serializedBody:JSON.stringify({model:"different"})})).toBeNull();
 });
 it("freezes registered binding identity and rechecks deployment revocation on every measurement",async()=>{
  const entry=registration();let valid=true;const verify=vi.fn(async()=>valid);const registry=new VerifiedModelBoundRegistry(model,[{...entry,verifyDeploymentBinding:verify}]);
  (entry.binding.capabilityTags as string[]).push("unverified-capability");expect(await registry.measure(request)).not.toBeNull();valid=false;expect(await registry.measure(request)).toBeNull();expect(verify).toHaveBeenCalledTimes(2);
 });
});

it("private SDK replacement requires verified exact endpoint/account grouping",async()=>{
 const first=registration(),second={...registration(),binding:{...registration().binding,modelId:"cheap",runtimeModelId:"cheap-runtime"}};
 expect(await new VerifiedModelBoundRegistry(model,[first,second]).samePrivateConnection("route","runtime","cheap-runtime")).toBe(false);
 const grouped=[first,second].map(entry=>({...entry,privateConnectionId:"fixture-endpoint-account"}));
 expect(await new VerifiedModelBoundRegistry(model,grouped).samePrivateConnection("route","runtime","cheap-runtime")).toBe(true);
 expect(await new VerifiedModelBoundRegistry(model,[grouped[0]!,{...grouped[1]!,privateConnectionId:"other-account"}]).samePrivateConnection("route","runtime","cheap-runtime")).toBe(false);
 expect(await new VerifiedModelBoundRegistry(model,[grouped[0]!,{...grouped[1]!,verifyDeploymentBinding:async()=>false}]).samePrivateConnection("route","runtime","cheap-runtime")).toBe(false);
});
