import {describe,it,expect,vi} from "vitest";
import type {ModelCallInput,ModelCallPort} from "../../src/application/agent-run/ports";
import {guardCoreModelCalls} from "../../src/infrastructure/model/core-model-runtime-guard";
const input={orgId:"org-guard",runId:"root-run",modelProvider:"deep-agent",modelId:"runtime",system:"fixture",user:"fixture"} as ModelCallInput;
describe("quota independent accepted core model dispatch guard",()=>{
 it.each(["complete","completeStream","completeWithProgress"] as const)("refuses changed accepted binding before %s can dispatch",async method=>{
  const paid=vi.fn(async()=>({text:"paid"}));const model=guardCoreModelCalls({complete:paid,completeStream:paid,completeWithProgress:paid},{assertAccepted:async()=>{throw new Error("CORE_MODEL_UNAVAILABLE");}});
  await expect(model[method]!(input,async()=>{})).rejects.toThrow("CORE_MODEL_UNAVAILABLE");expect(paid).not.toHaveBeenCalled();
 });
 it("checks every concrete retry and keeps existing admission callback",async()=>{
  let changed=false;const assertAccepted=vi.fn(async()=>{if(changed)throw new Error("CORE_MODEL_UNAVAILABLE");});const prior=vi.fn(async()=>{});
  const request={requestId:"physical",modelProvider:"provider",modelId:"runtime",serializedBody:"{}",outputTokenLimit:2};
  const paid=vi.fn(async(call:ModelCallInput)=>{await call.beforeProviderDispatch!(request);changed=true;await call.beforeProviderDispatch!({...request,requestId:"retry"});return {text:"unreachable"};});
  await expect(guardCoreModelCalls({complete:paid},{assertAccepted}).complete({...input,beforeProviderDispatch:prior})).rejects.toThrow("CORE_MODEL_UNAVAILABLE");
  expect(prior).toHaveBeenCalledOnce();expect(assertAccepted.mock.calls.map(()=>"checked")).toEqual(["checked","checked","checked"]);
 });
 it("preserves streaming callbacks, capability functions and original optional shape",async()=>{
  const delta=vi.fn(async()=>{}),progress=vi.fn(async()=>{}),paid=vi.fn(async()=>({text:"ok"}));
  const raw={complete:paid,completeWithProgress:paid,supportsProgress:()=>true} as ModelCallPort;
  const model=guardCoreModelCalls(raw,{assertAccepted:async()=>{}});await model.completeWithProgress!(input,progress,delta);
  expect(paid.mock.calls[0]?.slice(1)).toEqual([progress,delta]);expect(model.completeStream).toBeUndefined();expect(model.supportsProgress?.("deep-agent")).toBe(true);
 });
 it("run without organization scope is refused before dispatch",async()=>{const paid=vi.fn();await expect(guardCoreModelCalls({complete:paid},{assertAccepted:async()=>{}}).complete({...input,orgId:undefined})).rejects.toThrow("CORE_MODEL_RUN_SCOPE_REQUIRED");expect(paid).not.toHaveBeenCalled();});
 it("ancillary no-run call cannot inherit selection and preserves original input",async()=>{const paid=vi.fn(async()=>({text:"ok"})),check=vi.fn();const auxiliary={...input,runId:undefined};await guardCoreModelCalls({complete:paid},{assertAccepted:check}).complete(auxiliary);expect(check).not.toHaveBeenCalled();expect(paid).toHaveBeenCalledWith(auxiliary);});
});

describe("private SDK start quota independent guard",()=>{
 it.each([null,"child-run"])("checks persisted root owner before start for child %s",async subtaskId=>{
  const {PgRuntimeModelUsageRepository}=await import("../../src/infrastructure/auth/pg-runtime-model-usage-repository");
  const query=vi.fn(async(sql:string)=>{
   if(sql.includes("FROM model_request_starts"))return {rows:[]};
   if(sql.includes(subtaskId?"FROM subtask_runs":"FROM agent_runs"))return {rows:[{user_id:"user",project_id:"project",thread_id:"thread",agent_id:"agent",root_run_id:"root-run",subtask_id:subtaskId}]};
   return {rows:[]};
  });
  const db={withTenant:async(_org:unknown,work:Function)=>work({query})} as unknown as import("../../src/application/ports/database.port").DatabasePort;
  const check=vi.fn(async()=>{throw new Error("CORE_MODEL_UNAVAILABLE");});
  const previous=process.env.KERNEL_MODEL_PROVIDER;process.env.KERNEL_MODEL_PROVIDER="provider";
  try{
   const repo=new PgRuntimeModelUsageRepository(db,{record:vi.fn()},undefined,undefined,{assertAccepted:check});
   await expect(repo.startRuntimeRequest("org-guard" as never,subtaskId??"root-run",{requestId:"physical",attemptId:"attempt",leaseEpoch:1,modelId:"runtime",startedAt:"2026-10-05T00:00:00Z",callPurpose:"primary"})).rejects.toThrow("CORE_MODEL_UNAVAILABLE");
   expect(check).toHaveBeenCalledWith("org-guard","root-run",expect.any(Object));expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
  }finally{if(previous===undefined)delete process.env.KERNEL_MODEL_PROVIDER;else process.env.KERNEL_MODEL_PROVIDER=previous;}
 });
});
