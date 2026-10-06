import { sourceRelevanceIssueCodes as relevanceIssueCodes, sourceRelevanceEvaluationFields as evaluationFields, sourceRelevanceMatchFields as matchFields, sourceRelevancePresentationFields as presentationFields } from "./guided-source-relevance-protocol";
import type { DebugTracePort } from "../ports/debug-trace.port";
import { research, wave2Runtime } from "@repo/contracts";
import { ResearchRuntimeError, type RuntimeActor, type RuntimeCommand } from "./guided-runtime-ports";

export type ResearchExecutionPhase = "steer" | "state_read" | "source_authorization" | "claim" | "perform" | "final_persistence";
export interface ResearchExecutionDiagnostic { phase: ResearchExecutionPhase; traceId: string; }
const types = new Set(["Error", "TypeError", "SyntaxError", "RangeError", "ZodError", "AbortError", "ModelCallError"]);
const reasonCodes = new Set<string>(research.operations.streamGuidedResearchRuntime.err);
const codes = new Set<string>([...wave2Runtime.AgentRunError.options, "23505", "23503", "23514", "40001", "40P01", "53300", "57P01", "08000", "08006", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ABORT_ERR"]);

// These are protocol categories, never arbitrary provider or Zod messages/keys.
type SafeValidationIssue = { code: string; path?: (string | number)[] };
function safeRelevancePath(value: unknown): (string | number)[] | undefined {
  if (!Array.isArray(value) || value.length > 6) return undefined;
  if (!value.length) return [];
  if (value[0] !== "evaluations") return undefined;
  const index = (part: unknown) => typeof part === "number" && Number.isInteger(part) && part >= 0 && part <= 255;
  if (value.length === 1) return ["evaluations"];
  if (!index(value[1])) return undefined;
  if (value.length === 2) return ["evaluations", value[1]];
  if (!evaluationFields.has(value[2])) return undefined;
  if (value.length === 3) return value.slice();
  if (value[2] === "presentation" && value.length === 4 && presentationFields.has(value[3])) return value.slice();
  if (value[2] !== "matches" || !index(value[3])) return undefined;
  if (value.length === 4 || (value.length === 5 && matchFields.has(value[4]))) return value.slice();
  return undefined;
}
function safeRelevanceIssues(error: unknown): SafeValidationIssue[] {
  if (!(error instanceof ResearchRuntimeError) || error.reasonCode !== "RESEARCH_SOURCE_RELEVANCE_INVALID") return [];
  const issues = (error as ResearchRuntimeError & { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 16).flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object") return [];
    const item = issue as { code?: unknown; path?: unknown };
    if (typeof item.code !== "string" || !relevanceIssueCodes.has(item.code)) return [];
    const path = safeRelevancePath(item.path);
    return [{ code: item.code, ...(path !== undefined ? { path } : {}) }];
  });
}

/** Never record messages, stack traces, inputs, provider bodies or database detail.
 * Only allowlisted categories/codes, structural validation paths and operation phase
 * locate failures without turning the debug recorder into a copy of the user's research material.
 */
function safeErrors(error: unknown) {
  const result: { type: string; code?: string; reasonCode?: string; status?: number; issues?: SafeValidationIssue[] }[] = [];
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === "object" && result.length < 3 && !seen.has(current);) {
    seen.add(current);
    const item = current as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown };
    const type = current instanceof ResearchRuntimeError ? "ResearchRuntimeError" : typeof item.name === "string" && types.has(item.name) ? item.name : "UnknownError";
    const status = item.status ?? item.statusCode;
    const issues = safeRelevanceIssues(current);
    result.push({ type, ...(issues.length ? { issues } : {}), ...(current instanceof ResearchRuntimeError && reasonCodes.has(current.reasonCode) ? { reasonCode: current.reasonCode } : {}), ...(typeof item.code === "string" && codes.has(item.code) ? { code: item.code } : {}),
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

/** A private, per-call validation event. Repairs may subsequently succeed.
 * Reuse the same allowlist as terminal diagnostics; never copy model output. */
export function recordSourceRelevanceFailure(debug: DebugTracePort | undefined, context: { sessionId: string; callId: string; requestId?: string; traceId?: string }, error: unknown) {
  try {
    if (!safeRelevanceIssues(error).length) return;
    debug?.record({ traceId: context.traceId ?? context.requestId ?? context.sessionId, kind: "research.source_relevance.failed", level: "warn", msg: "Source relevance validation failed",
      data: { sessionId: context.sessionId, callId: context.callId, ...(context.requestId ? { requestId: context.requestId } : {}), errors: safeErrors(error) } });
  } catch { /* Diagnostic sink failure cannot replace the validation error. */ }
}
