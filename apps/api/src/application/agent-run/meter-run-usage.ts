import type { OrgId } from "../../domain/org-id";
import type { ClaimedAgentRun, ReportedUsage, TokenUsageMeterPort } from "./ports";

/** Meter provider-reported usage without turning an accounting failure into a second model call. */
export async function meter(
  deps: { readonly usage?: TokenUsageMeterPort; readonly log: (message: string, detail: Record<string, unknown>) => void },
  orgId: OrgId,
  run: ClaimedAgentRun,
  usage: ReportedUsage,
  outcome: "succeeded" | "failed",
): Promise<void> {
  if (!deps.usage) return;
  try {
    await deps.usage.record(orgId, {
      userId: run.requesterUserId,
      runId: run.runId,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      // 总数缺失记 0（必填维度）；拆分维度缺失记 null（「上游没报」≠「用了 0」）。
      tokensTotal: usage.total ?? 0,
      promptTokens: usage.prompt ?? null,
      completionTokens: usage.completion ?? null,
      outcome,
    });
  } catch (e) {
    deps.log("token usage metering write failed; usage under-counted for this run", {
      runId: run.runId, tokensTotal: usage.total ?? 0, outcome,
      detail: e instanceof Error ? e.message : "unexpected metering failure",
    });
  }
}

