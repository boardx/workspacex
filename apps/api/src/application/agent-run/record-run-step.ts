import type { OrgId } from "../../domain/org-id";
import type { RunFailureCode, RunStepKind, RunStepStatus } from "./ports";
import type { ExecuteAgentRunDeps } from "./execute-run";

/**
 * The one place a step becomes durable, so no path can record half of one.
 *
 * Extracted out of `execute-run.ts` (not moved for tidiness) -- that file carries
 * `tests/agent-run/execute-run-thin-gateway.test.ts`'s R7 line-count ceiling (F01's "thin
 * gateway" guard), same reason `execute-run-events.ts` exists. Phase 14 F15 (R3'/R6) needed
 * two more optional fields threaded through here; keeping the helper in its own file is what
 * lets that happen without regrowing the file the guard exists to keep thin.
 */
export async function record(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  input: {
    runId: string; seq: number; kind: RunStepKind; startedAt: string;
    inputDigest: string | null; outputDigest: string | null; failureCode: RunFailureCode | null;
    toolName?: string | null; toolArgsSummary?: string | null; toolResultSummary?: string | null;
    planningNote?: string | null;
    /**
     * Phase 14 F15 (R3'/R6) -- the FULL plaintext `inputDigest`/`outputDigest` were hashed
     * FROM, for `kind: "model_called"` steps (`system`/`text` -- "模型看到了什么、完整说了
     * 什么"). Omitted everywhere else in this cut (`tool_call`'s full args/result require
     * `deep-agent-model-provider.ts` to expose untruncated data -- explicitly deferred
     * follow-up, not a silently dropped requirement; see `get-run-transcript.ts`'s header).
     * `AppendedRunStep`'s own doc explains why this is a plain string here, not a cipher call.
     */
    inputFullContent?: string | null; outputFullContent?: string | null;
    /** #742 Gap 1 -- explicit status override for the ONE case `failureCode` can't express:
     * an `in_progress` `tool_call` row. Every other caller omits this and keeps the old
     * derivation (`failureCode === null ? "succeeded" : "failed"`). */
    status?: RunStepStatus;
    /** #742 Gap 1 -- `tool_call` steps only, see `AppendedRunStep.toolCallId`'s own doc. */
    toolCallId?: string | null;
  },
): Promise<void> {
  await deps.runs.appendStep(orgId, {
    runId: input.runId,
    seq: input.seq,
    kind: input.kind,
    status: input.status ?? (input.failureCode === null ? "succeeded" : "failed"),
    startedAt: input.startedAt,
    endedAt: deps.clock.now(),
    inputDigest: input.inputDigest,
    outputDigest: input.outputDigest,
    failureCode: input.failureCode,
    toolName: input.toolName ?? null,
    toolArgsSummary: input.toolArgsSummary ?? null,
    toolResultSummary: input.toolResultSummary ?? null,
    planningNote: input.planningNote ?? null,
    toolCallId: input.toolCallId ?? null,
    inputFullContent: input.inputFullContent ?? null,
    outputFullContent: input.outputFullContent ?? null,
  });
}
