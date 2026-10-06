import { safeModelProviderFailure, type ModelProviderFailure } from "../../agent-run/model-provider-failure";
import type { DebugTracePort } from "../../ports/debug-trace.port";
import { ModelCallError, type ModelCallCompletion } from "../../agent-run/ports";
import type { InterviewReportAnalysisGap } from "./digital-report-quality";
import type { ReportClaimBoundaryGap } from "./interview-report-claim-boundaries";

type Stage = "context" | "model" | "validation" | "storage";
type Reason = "completed" | "context_error" | "provider_error" | "empty_output" | "cancelled" | "paused" | "interrupted" | "truncated" | "invalid_format" | "quality_rejected" | "grounding_rejected" | "storage_error" | "unexpected_error";
/** Only controlled enums, counts and timings cross the diagnostic boundary. No bodies or error messages. */
export class InterviewReportDiagnostics {
  private readonly started = performance.now();
  private readonly timings: Record<Stage, number> = { context: 0, model: 0, validation: 0, storage: 0 };
  private stage: Stage = "context";
  private reason: Reason | null = null;
  private reasonStage: Stage | null = null;
  private modelCalls = 0;
  private outputCharacters = 0;
  private missing: readonly (InterviewReportAnalysisGap | ReportClaimBoundaryGap)[] = [];
  constructor(private readonly trace: Pick<DebugTracePort, "record"> | undefined, private readonly traceId: string, private readonly enabled: boolean) {}
  async measure<T>(stage: Stage, operation: () => T | Promise<T>): Promise<T> {
    this.stage = stage;
    const start = performance.now();
    if (stage === "model") this.modelCalls += 1;
    let succeeded = false;
    try { const result = await operation(); succeeded = true; return result; }
    catch (error) {
      if (stage === "storage") this.reason = "storage_error";
      else if (stage === "context") this.reason = "context_error";
      else if (stage === "model") this.reason = "provider_error";
      this.reasonStage = stage;
      throw error;
    }
    finally {
      this.timings[stage] += performance.now() - start;
      this.record(`interview.report_generation.${stage}`, "info", { stage, elapsedMs: performance.now() - start, succeeded, modelCalls: this.modelCalls });
    }
  }
  output(response: ModelCallCompletion): void {
    this.outputCharacters = response.text.length;
    this.missing = [];
    this.reasonStage = null;
    this.reason = response.cancelled ? "cancelled" : response.paused ? "paused" : response.interrupted ? "interrupted" : response.truncated ? "truncated" : !response.text.trim() ? "empty_output" : null;
    if (this.reason) this.reasonStage = "model";
  }
  reject(reason: "invalid_format" | "quality_rejected" | "grounding_rejected", missing: readonly (InterviewReportAnalysisGap | ReportClaimBoundaryGap)[] = []): void { this.reason = reason; this.reasonStage = "validation"; this.missing = missing; }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.finish("completed");
      return result;
    } catch (error) {
      const reason = this.reason ?? (this.stage === "context" ? "context_error" : this.stage === "model" ? "provider_error" : this.stage === "storage" ? "storage_error" : "unexpected_error");
      try { this.finish(reason, error instanceof ModelCallError ? error.code : undefined,
        reason === "provider_error" ? safeModelProviderFailure(error instanceof ModelCallError
          ? error.providerFailure ?? (error.code === "MODEL_PROVIDER_NOT_CONFIGURED" ? { kind: "configuration" } : undefined) : undefined) : undefined); } catch { /* Diagnostic metadata cannot replace the original error. */ }
      throw error;
    }
  }
  private finish(reason: Reason, providerCode?: ModelCallError["code"], providerFailure?: ModelProviderFailure): void {
    this.record(`interview.report_generation.${reason === "completed" ? "completed" : "failed"}`, reason === "completed" ? "info" : "warn", {
      reason, stage: reason === "completed" ? this.stage : this.reasonStage ?? this.stage, modelCalls: this.modelCalls, outputCharacters: this.outputCharacters,
      missing: this.missing, timings: { ...this.timings }, ...(providerCode ? { providerCode } : {}), ...(providerFailure ? { providerFailure } : {}),
    }, performance.now() - this.started);
  }
  private record(kind: string, level: "info" | "warn", data: unknown, durationMs?: number): void {
    if (!this.enabled) return;
    try { this.trace?.record({ traceId: this.traceId, kind, level, msg: "Interview report generation diagnostic", data, durationMs }); }
    catch { /* Diagnostics cannot alter persistence, permissions or public errors. */ }
  }
}
