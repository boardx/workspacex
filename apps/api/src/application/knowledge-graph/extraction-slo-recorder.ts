/**
 * Phase 18 S8（#4365）—— 抽取 SLO 的进程内记录器：每个处理过的任务记一条样本（耗时 + 结果），门控跳过与模型调用各计数。
 *
 * ## 为什么在进程内、不落表
 *
 * 队列行完成即删（`kg_extraction_queue`），库里没有「这条花了多久」的历史；逐条结果表由 s4（逐条消息状态）在做，
 * 这里不另起一张与之竞争的表（#4365 协调约定）。于是：
 *   - 延迟与失败率：本进程最近 `SLO_WINDOW_MS` 内的样本（最多 `SLO_MAX_SAMPLES` 条），重启归零——是「当前健康度」，
 *     不是历史报表；
 *   - 卡住的租约：数据库现数（`kg_extraction_slo_counts()`），与进程无关。
 * 与 s4 的集成点：s4 的逐条结果表落地后，`recordJob` 的调用点（`runExtractionTick`）就是写那张表的位置，
 * 延迟 / 失败率可以改从那张表按时间窗算（多实例时也准）；门控跳过的原因同样写进去（`skipped` + reason）。
 *
 * ⚠ 多实例部署：每个实例只看得到自己处理的样本。管理页标明「本实例」；卡住的租约是全库的。
 */
import {
  evaluateExtractionSlo, percentile, type ExtractionSloAlert, type ExtractionSloThresholds,
} from "../../domain/knowledge-graph/extraction-slo";
import type { WorthSkipReason } from "../../domain/knowledge-graph/worth-remembering";

export const SLO_WINDOW_MS = 60 * 60 * 1000;
export const SLO_MAX_SAMPLES = 5_000;

export type ExtractionJobOutcome = "written" | "empty" | "skipped" | "failed";
/** 门控跳过的原因：规则三类，外加可选的便宜模型判「不值得」。 */
export type GateSkipReason = WorthSkipReason | "model_not_worth";

interface Sample { readonly at: number; readonly durationMs: number; readonly outcome: ExtractionJobOutcome; readonly gated: boolean }

export interface ExtractionSloWindow {
  readonly windowSeconds: number;
  /** 窗口内处理过的任务数（含门控跳过的）。 */
  readonly processed: number;
  /** 窗口内调了抽取模型的任务数（= 失败率的分母）。 */
  readonly modelJobs: number;
  readonly failed: number;
  readonly p95LatencyMs: number | null;
  readonly failureRate: number | null;
}

export interface ExtractionGateCounters {
  /** 进程启动以来被门控跳过的消息数，按原因。 */
  readonly skippedByReason: Readonly<Record<GateSkipReason, number>>;
  /** 省下的抽取模型调用次数（= 跳过数：每条被跳过的消息本来要调一次抽取模型）。 */
  readonly modelCallsSaved: number;
  /** 实际调用抽取模型的次数。 */
  readonly modelCalls: number;
  /** 便宜模型门控被调用 / 出错的次数（只在开关打开时非零；出错 ⇒ 照常抽取，不跳过）。 */
  readonly gateModelChecks: number;
  readonly gateModelErrors: number;
}

export class ExtractionSloRecorder {
  private readonly samples: Sample[] = [];
  private readonly skipped: Record<GateSkipReason, number> = { greeting: 0, acknowledgement: 0, pure_question: 0, model_not_worth: 0 };
  private modelCalls = 0;
  private gateModelChecks = 0;
  private gateModelErrors = 0;

  constructor(private readonly now: () => number = Date.now) {}

  recordJob(durationMs: number, outcome: ExtractionJobOutcome, gated = false): void {
    this.samples.push({ at: this.now(), durationMs: Math.max(0, durationMs), outcome, gated });
    if (this.samples.length > SLO_MAX_SAMPLES) this.samples.splice(0, this.samples.length - SLO_MAX_SAMPLES);
  }

  recordGateSkip(reason: GateSkipReason): void { this.skipped[reason] += 1; }
  recordModelCall(): void { this.modelCalls += 1; }
  recordGateModelCheck(ok: boolean): void {
    this.gateModelChecks += 1;
    if (!ok) this.gateModelErrors += 1;
  }

  window(): ExtractionSloWindow {
    const since = this.now() - SLO_WINDOW_MS;
    const live = this.samples.filter((s) => s.at >= since);
    const model = live.filter((s) => !s.gated);
    const failed = model.filter((s) => s.outcome === "failed").length;
    return {
      windowSeconds: SLO_WINDOW_MS / 1000,
      processed: live.length,
      modelJobs: model.length,
      failed,
      p95LatencyMs: percentile(live.map((s) => s.durationMs), 95),
      failureRate: model.length === 0 ? null : failed / model.length,
    };
  }

  gate(): ExtractionGateCounters {
    const saved = Object.values(this.skipped).reduce((a, b) => a + b, 0);
    return {
      skippedByReason: { ...this.skipped }, modelCallsSaved: saved, modelCalls: this.modelCalls,
      gateModelChecks: this.gateModelChecks, gateModelErrors: this.gateModelErrors,
    };
  }

  evaluate(stuckLeases: number, thresholds: ExtractionSloThresholds): ExtractionSloAlert[] {
    const w = this.window();
    return evaluateExtractionSlo({ p95LatencyMs: w.p95LatencyMs, failureRate: w.failureRate, samples: w.modelJobs, stuckLeases }, thresholds);
  }
}

export const KG_EXTRACTION_SLO_RECORDER = Symbol("KgExtractionSloRecorder");
