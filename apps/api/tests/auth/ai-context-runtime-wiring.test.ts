import {describe,it,expect,vi} from "vitest";
import {readContextPackAiFacts,aiContextInputHash} from "../../src/application/agent-run/context-pack-ai-facts";
import {createAiQuotaRuntimeWiring} from "../../src/infrastructure/agent-run/ai-runtime-wiring";
import {assembleFromRecorded} from "../../src/application/context-pack/replay-pack";
import {packContentHash} from "../../src/domain/context-pack/pack-hash";
import type {RecordedRun} from "../../src/domain/context-pack/recorded-run";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("facts-org"),input={orgId:org,userId:"u",runId:"agent-run",serializedInput:"exact trusted assembled input"};
const run:RecordedRun={runId:"context-run",packId:"pack",orgId:String(org),query:{tenantId:String(org),principalId:"u",projectIds:[],task:"decision-support",query:"fixture",timeRange:null,allowedSensitivity:["internal"],tokenBudget:1000,freshnessRequirement:null,evidencePolicy:"all"},retrievalPlan:[],candidates:[],withheld:[],unanchorable:[],claims:[],thresholdUsed:0.45};
function fixture(){
 const row={run,contentHash:packContentHash(assembleFromRecorded(run,null)),pinnedSnapshotId:null};
 const store={findRecorded:vi.fn().mockResolvedValue(row),confidentialNow:vi.fn().mockResolvedValue(new Set())};
 const bindings={resolve:vi.fn().mockResolvedValue({contextPackRunId:run.runId,inputSha256:aiContextInputHash(input.serializedInput),completeInput:true,requiredCapabilities:["tools"]})};
 const constraints={resolve:vi.fn().mockResolvedValue({localOnly:false,source:"org-policy",reason:"fixture"})};
 return {store,bindings,constraints};
}
describe("trusted Context Pack facts and default-off runtime composition",()=>{
 it("default-off never builds registrations or queries; enabling absent config fails closed",()=>{
  const deps={} as never;expect(createAiQuotaRuntimeWiring(false,null,deps)).toBeNull();
  expect(()=>createAiQuotaRuntimeWiring(true,null,deps)).toThrow("AI_RUNTIME_REQUIRED_CONFIGURATION_MISSING");
 });
 it("binds exact complete input to the original principal, replay and identity authority",async()=>{
  const f=fixture();expect(await readContextPackAiFacts(input,f as never)).toEqual({confidentiality:"non-confidential",requiredCapabilities:["tools"]});
  expect(f.bindings.resolve).toHaveBeenCalledWith(org,"u","agent-run",aiContextInputHash(input.serializedInput));
  expect(f.constraints.resolve).toHaveBeenCalledWith({orgId:org,userId:"u",dataScope:[]});
  f.constraints.resolve.mockResolvedValue({localOnly:true,source:"org-policy",reason:"strict"});
  expect(await readContextPackAiFacts(input,f as never)).toMatchObject({confidentiality:"confidential"});
 });
 it("missing/partial/mismatched bindings and foreign principal/tenant remain unknown",async()=>{
  for(const binding of [null,{completeInput:false,inputSha256:aiContextInputHash(input.serializedInput)},{completeInput:true,inputSha256:"wrong"}]){
   const f=fixture();f.bindings.resolve.mockResolvedValue(binding);expect(await readContextPackAiFacts(input,f as never)).toMatchObject({confidentiality:"unknown"});expect(f.constraints.resolve).not.toHaveBeenCalled();
  }
  for(const altered of [{...run,orgId:"other"},{...run,query:{...run.query,principalId:"other"}}]){
   const f=fixture();f.store.findRecorded.mockResolvedValue({run:altered,contentHash:"irrelevant",pinnedSnapshotId:null});expect(await readContextPackAiFacts(input,f as never)).toMatchObject({confidentiality:"unknown"});expect(f.constraints.resolve).not.toHaveBeenCalled();
  }
 });
 it("a divergent recorded pack cannot silently classify the current request as public",async()=>{
  const f=fixture();f.store.findRecorded.mockResolvedValue({run,contentHash:"tampered",pinnedSnapshotId:null});await expect(readContextPackAiFacts(input,f as never)).rejects.toThrow();expect(f.constraints.resolve).not.toHaveBeenCalled();
 });
});
