import type {DatabasePort} from "../../application/ports/database.port";
import type {OrgCoreModelAvailability} from "../../application/model/org-core-model-ports";
import type {ModelCallInput,ModelCallPort} from "../../application/agent-run/ports";
import {toOrgId,type OrgId} from "../../domain/org-id";
import {assertRunCoreModelSnapshot} from "./pg-org-core-model-repository";
/** Installed independently of product quota. No provider dependency is required by the port. */
export interface CoreModelRuntimeGuard {
 assertAccepted(orgId:OrgId,rootRunId:string,scopedDb?:DatabasePort):Promise<void>;
}
export const CORE_MODEL_RUNTIME_GUARD=Symbol("CoreModelRuntimeGuard");
export function createCoreModelRuntimeGuard(db:DatabasePort,availability:OrgCoreModelAvailability):CoreModelRuntimeGuard{
 return {assertAccepted:(orgId,rootRunId,scopedDb)=>assertRunCoreModelSnapshot(scopedDb??db,availability,orgId,rootRunId)};
}
/** Bind after constructing the raw provider router, using availability backed by that raw
 * router. Injecting the public availability token here would create a provider cycle. */
export function guardCoreModelCalls(delegate:ModelCallPort,guard:CoreModelRuntimeGuard):ModelCallPort{
 const checked=async(input:ModelCallInput):Promise<ModelCallInput>=>{
  // Ancillary calls without a run cannot inherit an organization core selection.
  if(!input.runId)return input;
  if(!input.orgId)throw new Error("CORE_MODEL_RUN_SCOPE_REQUIRED");
  const orgId=toOrgId(input.orgId),runId=input.runId;
  await guard.assertAccepted(orgId,runId);
  return {...input,beforeProviderDispatch:async request=>{
   // Concrete adapters may retry after the initial call; verify at each actual dispatch too.
   await guard.assertAccepted(orgId,runId);
   await input.beforeProviderDispatch?.(request);
  }};
 };
 return new Proxy(delegate,{get(target,key){
  const value=Reflect.get(target,key,target);
  if(typeof value!=="function")return value;
  if(key==="complete"||key==="completeStream"||key==="completeWithProgress")return async(input:ModelCallInput,...args:unknown[])=>value.call(target,await checked(input),...args);
  return value.bind(target);
 }});
}
