import {pricedRunModel} from "./priced-run-model";
import {currentRunLease} from "./run-lease";
import type { ClaimedAgentRun } from "./ports";
import type { ExecuteAgentRunDeps } from "./execute-run";

/** Rollout admits new runs only. A continuation retains its persisted engine.
 * The returned dependency view is local to this claim; concurrent runs cannot change it.
 * Legacy callers without a persisted profile retain their existing first-run behavior.
 */
export function dependenciesForRuntimeProfile(deps: ExecuteAgentRunDeps, run: ClaimedAgentRun): ExecuteAgentRunDeps {
  const continuing = run.checkpointResume === true || run.pendingDecision !== null
    || run.resumeStepSeqBase !== undefined || (run.leaseEpoch ?? 1) > 1;
  const native = run.runtimeProfile === "native-v1"
    || (!continuing && deps.nativeRuntimeEnabled !== false);
  const view=native ? deps : { ...deps, nativeSessions: undefined };
  if(!deps.aiAdmission)return view;
  const lease=currentRunLease();if(!lease||lease.runId!==run.runId)throw new Error("AI_RUN_LEASE_MISSING");
  return {...view,model:pricedRunModel(deps.model,lease.orgId,run,deps.aiAdmission)};
}
