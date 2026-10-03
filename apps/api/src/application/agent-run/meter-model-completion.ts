import type { OrgId } from "../../domain/org-id";
import { ModelCallError, type ClaimedAgentRun, type ModelCallInput, type ModelCallPort, type TokenUsageMeterPort, type TokenUsageRecord } from "./ports";
import { meter } from "./meter-run-usage";

/** Each auxiliary model request is a separate ledger receipt, including billable errors. */
export async function meterModelCompletion<T extends {
  readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number;
}>(
  deps: { readonly usage?: TokenUsageMeterPort; readonly log: (message: string, detail: Record<string, unknown>) => void },
  orgId: OrgId,
  run: ClaimedAgentRun,
  callPurpose: TokenUsageRecord["callPurpose"],
  call: (onProviderRequest?: ModelCallInput["onProviderRequest"]) => Promise<T>,
  model?: ModelCallPort,
): Promise<T> {
  const requestAccounting = Boolean(deps.usage?.startRequest && model?.supportsRequestAccounting?.(run.modelProvider));
  const onProviderRequest: ModelCallInput["onProviderRequest"] = requestAccounting ? async event => {
    if (event.phase === "started") {
      await deps.usage!.startRequest!(orgId, { requestId: event.requestId, startedAt: event.startedAt,
        userId: run.requesterUserId, runId: run.runId, modelProvider: run.modelProvider,
        modelId: run.modelId, projectId: run.projectId, threadId:run.threadId, agentId:run.agentId, callPurpose, executionAttemptId: null });
    } else await meter(deps, orgId, run, event.usage ?? {}, event.outcome ?? "failed", callPurpose,
      { eventId: event.requestId, requestStartedAt: event.startedAt, requestEndedAt: event.endedAt });
  } : undefined;
  let completion: T;
  try { completion = await call(onProviderRequest); }
  catch (error) {
    if (!requestAccounting) await meter(deps, orgId, run, error instanceof ModelCallError ? error.usage ?? {} : {}, "failed", callPurpose);
    throw error;
  }
  if (!requestAccounting) await meter(deps, orgId, run, {
    total: completion.tokens, prompt: completion.promptTokens, completion: completion.completionTokens,
  }, "succeeded", callPurpose);
  return completion;
}
