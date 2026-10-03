import type { OrgId } from "../../domain/org-id";
import { ModelCallError, type ClaimedAgentRun, type TokenUsageMeterPort, type TokenUsageRecord } from "./ports";
import { meter } from "./meter-run-usage";

/** Each auxiliary model request is a separate ledger receipt, including billable errors. */
export async function meterModelCompletion<T extends {
  readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number;
}>(
  deps: { readonly usage?: TokenUsageMeterPort; readonly log: (message: string, detail: Record<string, unknown>) => void },
  orgId: OrgId,
  run: ClaimedAgentRun,
  callPurpose: TokenUsageRecord["callPurpose"],
  call: () => Promise<T>,
): Promise<T> {
  let completion: T;
  try { completion = await call(); }
  catch (error) {
    await meter(deps, orgId, run, error instanceof ModelCallError ? error.usage ?? {} : {}, "failed", callPurpose);
    throw error;
  }
  await meter(deps, orgId, run, {
    total: completion.tokens, prompt: completion.promptTokens, completion: completion.completionTokens,
  }, "succeeded", callPurpose);
  return completion;
}
