import type {z} from "zod";
import type {RuntimeModelRequestStart,RuntimeModelRequestTerminal,RuntimeModelRequestAdmission,RuntimeModelRequestAdmissionResponse} from "@repo/contracts/runtime-model-usage";
import type {OrgId} from "../../domain/org-id";
type WithoutOrg<T>=T extends unknown?Omit<T,"orgId">:never;
export type RuntimeModelDispatch=NonNullable<z.infer<typeof RuntimeModelRequestAdmissionResponse>["dispatch"]>;
export interface RuntimeModelUsagePort {
 admitRuntimeRequest?(orgId:OrgId,runId:string,input:WithoutOrg<z.infer<typeof RuntimeModelRequestAdmission>>):Promise<RuntimeModelDispatch|void>;
 startRuntimeRequest(orgId:OrgId,runId:string,input:Omit<z.infer<typeof RuntimeModelRequestStart>,"orgId">):Promise<void>;
 terminalRuntimeRequest(orgId:OrgId,runId:string,input:Omit<z.infer<typeof RuntimeModelRequestTerminal>,"orgId">):Promise<void>;
}

export const RUNTIME_MODEL_USAGE = Symbol("RuntimeModelUsage");

/** Metadata ownership is resolved by the repository, never from child input content. */
export function runtimeUsageObserver(port:RuntimeModelUsagePort,orgId:OrgId,runId:string,
  attemptId:string,leaseEpoch:number,modelId:string):NonNullable<import("./ports").ModelCallInput["onProviderRequest"]>{
  return async event=>{
    const ownership={attemptId,leaseEpoch,requestId:event.requestId};
    if(event.phase==="started") await port.startRuntimeRequest(orgId,runId,{...ownership,startedAt:event.startedAt,modelId,callPurpose:"primary"});
    else await port.terminalRuntimeRequest(orgId,runId,{...ownership,endedAt:event.endedAt??new Date().toISOString(),
      outcome:event.outcome??"failed",usage:event.usage??{}});
  };
}

export class RuntimeUsageOwnershipDenied extends Error {
 constructor(){super("RUNTIME_USAGE_OWNERSHIP_DENIED");}
}
