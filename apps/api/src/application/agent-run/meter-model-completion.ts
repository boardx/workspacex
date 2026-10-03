import type { OrgId } from "../../domain/org-id";
import { ModelCallError, type ClaimedAgentRun, type ModelCallInput, type ModelCallCompletion, type ModelCallPort, type TokenUsageMeterPort, type TokenUsageRecord } from "./ports";
import {currentRunLease} from "./run-lease";
import { meter } from "./meter-run-usage";

/** Each auxiliary model request is a separate ledger receipt, including billable errors. */
export async function meterModelCompletion<T extends {
  readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number; readonly cacheInputTokens?: number; readonly reasoningOutputTokens?: number;
}>(
  deps: { readonly usage?: TokenUsageMeterPort; readonly log: (message: string, detail: Record<string, unknown>) => void },
  orgId: OrgId,
  run: ClaimedAgentRun,
  callPurpose: TokenUsageRecord["callPurpose"],
  call: (onProviderRequest:ModelCallInput["onProviderRequest"]|undefined,context:Pick<ModelCallInput,"orgId"|"runId"|"executionAttemptId"|"executionLeaseEpoch"|"usageCallPurpose">) => Promise<T>,
  model?: ModelCallPort,
): Promise<T> {
  const requestAccounting = Boolean(deps.usage?.startRequest && model?.supportsRequestAccounting?.(run.modelProvider));
  const lease=currentRunLease();
  const context={orgId:String(orgId),runId:run.runId,executionLeaseEpoch:lease?.epoch,
    executionAttemptId:lease?`${run.runId}:lease:${lease.epoch}:${callPurpose}`:undefined,usageCallPurpose:callPurpose};
  const onProviderRequest = requestAccounting ? requestUsageObserver(deps,orgId,run,callPurpose,context.executionAttemptId??null) : undefined;
  let completion: T;
  try { completion = await call(onProviderRequest,context); }
  catch (error) {
    if (!requestAccounting) await meter(deps, orgId, run, error instanceof ModelCallError ? error.usage ?? {} : {}, "failed", callPurpose);
    throw error;
  }
  if (!requestAccounting) await meter(deps, orgId, run, completionUsage(completion), "succeeded", callPurpose);
  return completion;
}

/** Shared trusted per-dispatch accounting; start failure prevents provider dispatch. */
export function requestUsageObserver(
  deps:{readonly usage?:TokenUsageMeterPort;readonly log:(message:string,detail:Record<string,unknown>)=>void},
  orgId:OrgId,run:ClaimedAgentRun,callPurpose:TokenUsageRecord["callPurpose"],executionAttemptId:string|null,
):NonNullable<ModelCallInput["onProviderRequest"]>{
  return async event=>{
    if(event.phase==="started") await deps.usage!.startRequest!(orgId,{requestId:event.requestId,startedAt:event.startedAt,
      userId:run.requesterUserId,runId:run.runId,executionAttemptId,projectId:run.projectId,threadId:run.threadId,
      agentId:run.agentId,callPurpose,modelProvider:run.modelProvider,modelId:run.modelId});
    else await meter(deps,orgId,run,event.usage??{},event.outcome??"failed",callPurpose,
      {eventId:event.requestId,requestStartedAt:event.startedAt,requestEndedAt:event.endedAt,executionAttemptId:executionAttemptId??undefined});
  };
}

export const completionUsage=(completion:Pick<ModelCallCompletion,"tokens"|"promptTokens"|"completionTokens"|"cacheInputTokens"|"reasoningOutputTokens">)=>({
  total:completion.tokens,prompt:completion.promptTokens,completion:completion.completionTokens,
  cacheInput:completion.cacheInputTokens,reasoningOutput:completion.reasoningOutputTokens,
});
