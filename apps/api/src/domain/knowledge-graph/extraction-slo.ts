/**
 * Phase 18 S8（#4365）—— 记忆抽取的 SLO：三个指标、三个阈值、一个判定。纯函数。
 *
 *   - `p95LatencyMs`：一条消息从被认领到处理完（写入 / 空 / 跳过 / 失败）的耗时，窗口内的第 95 百分位；
 *   - `failureRate`：窗口内失败的任务 / 处理过的任务（门控跳过的不算分母：那些没有调模型，混进来会把失败率摊薄）；
 *   - `stuckLeases`：租约已过期还没完成的队列行（worker 卡死 / 进程崩了的直接信号，数据库现数）。
 *
 * 超阈值 ⇒ `alerts` 非空：worker 记一条 error 级结构化日志（只在「进入超标」时记一次，恢复时记一条 info），
 * 管理页顶部出横幅。阈值从环境变量读（`readExtractionSloThresholds`），默认值见下。
 */

export interface ExtractionSloThresholds {
  readonly p95LatencyMs: number;
  readonly failureRate: number;
  readonly stuckLeases: number;
}

/** 默认阈值：p95 两分钟（一次模型调用的正常上限在 180 秒超时之内）、失败率 20%、卡住的租约 0 条（有就报）。 */
export const EXTRACTION_SLO_DEFAULTS: ExtractionSloThresholds = { p95LatencyMs: 120_000, failureRate: 0.2, stuckLeases: 0 };
/** 失败率至少要有这么多样本才判（刚启动时 1 条失败 = 100%，不该报警）。 */
export const EXTRACTION_SLO_MIN_SAMPLES = 5;

export type ExtractionSloMetric = "p95_latency" | "failure_rate" | "stuck_leases";

export interface ExtractionSloAlert {
  readonly metric: ExtractionSloMetric;
  readonly value: number;
  readonly threshold: number;
}

function positive(raw: string | undefined, fallback: number, { allowZero = false } = {}): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : fallback;
}

export function readExtractionSloThresholds(env: NodeJS.ProcessEnv = process.env): ExtractionSloThresholds {
  const rate = positive(env.KG_EXTRACTION_SLO_FAILURE_RATE, EXTRACTION_SLO_DEFAULTS.failureRate);
  return {
    p95LatencyMs: positive(env.KG_EXTRACTION_SLO_P95_MS, EXTRACTION_SLO_DEFAULTS.p95LatencyMs),
    failureRate: rate <= 1 ? rate : EXTRACTION_SLO_DEFAULTS.failureRate,
    stuckLeases: Math.floor(positive(env.KG_EXTRACTION_SLO_STUCK_LEASES, EXTRACTION_SLO_DEFAULTS.stuckLeases, { allowZero: true })),
  };
}

/** 最近邻法百分位（nearest-rank）：空 ⇒ null。 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export function evaluateExtractionSlo(
  m: { readonly p95LatencyMs: number | null; readonly failureRate: number | null; readonly samples: number; readonly stuckLeases: number },
  t: ExtractionSloThresholds,
): ExtractionSloAlert[] {
  const alerts: ExtractionSloAlert[] = [];
  if (m.p95LatencyMs !== null && m.p95LatencyMs > t.p95LatencyMs) {
    alerts.push({ metric: "p95_latency", value: m.p95LatencyMs, threshold: t.p95LatencyMs });
  }
  if (m.failureRate !== null && m.samples >= EXTRACTION_SLO_MIN_SAMPLES && m.failureRate > t.failureRate) {
    alerts.push({ metric: "failure_rate", value: m.failureRate, threshold: t.failureRate });
  }
  if (m.stuckLeases > t.stuckLeases) alerts.push({ metric: "stuck_leases", value: m.stuckLeases, threshold: t.stuckLeases });
  return alerts;
}
