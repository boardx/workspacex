import type { DebugTracePort } from "../ports/debug-trace.port";
import { research, wave2Runtime } from "@repo/contracts";
import { ResearchRuntimeError, type RuntimeActor, type RuntimeCommand } from "./guided-runtime-ports";

export type ResearchExecutionPhase = "steer" | "state_read" | "source_authorization" | "claim" | "perform" | "final_persistence";
export interface ResearchExecutionDiagnostic { phase: ResearchExecutionPhase; traceId: string; }
const types = new Set(["Error", "TypeError", "SyntaxError", "RangeError", "ZodError", "AbortError", "ModelCallError"]);
const reasonCodes = new Set<string>(research.operations.streamGuidedResearchRuntime.err);
const codes = new Set<string>([...wave2Runtime.AgentRunError.options, "23505", "23503", "23514", "40001", "40P01", "53300", "57P01", "08000", "08006", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ABORT_ERR"]);

/** Never record messages, stack traces, inputs, provider bodies or database detail.
 * An allowlisted category/code and operation phase are enough to locate failures
 * without turning the debug recorder into a copy of the user's research material.
 */
function safeErrors(error: unknown) {
  const result: { type: string; code?: string; reasonCode?: string; status?: number }[] = [];
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === "object" && result.length < 3 && !seen.has(current);) {
    seen.add(current);
    const item = current as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown };
    const type = current instanceof ResearchRuntimeError ? "ResearchRuntimeError" : typeof item.name === "string" && types.has(item.name) ? item.name : "UnknownError";
    const status = item.status ?? item.statusCode;
    result.push({ type, ...(current instanceof ResearchRuntimeError && reasonCodes.has(current.reasonCode) ? { reasonCode: current.reasonCode } : {}), ...(typeof item.code === "string" && codes.has(item.code) ? { code: item.code } : {}),
      ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) });
    current = item.cause;
  }
  return result.length ? result : [{ type: "UnknownError" }];
}

export function recordResearchFailure(debug: DebugTracePort | undefined, context: ResearchExecutionDiagnostic, actor: RuntimeActor, command: RuntimeCommand, error: unknown, progressStage?: string) {
  try {
    debug?.record({ traceId: context.traceId, kind: "research.runtime.failed", level: "error", msg: "Research execution failed",
      userId: actor.userId, orgId: actor.orgId,
      data: { phase: context.phase, sessionId: actor.sessionId, requestId: command.requestId, node: command.node, action: command.action,
        ...(progressStage ? { progressStage } : {}), errors: safeErrors(error) } });
  } catch { /* Diagnostics must never replace the original failure or recovery state. */ }
}
