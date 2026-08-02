/**
 * F60 -- UC-4.4 阶段四：异常检测与自动限速（O-36 第 3 项：10 倍 / 24 小时滚动窗口）+
 * 越权调用拦截计数。
 *
 * `user_visible_behavior` 摘录: 「异常检测按 24 小时滚动窗口均值 10 倍触发自动限速，
 * 越权调用被拦截并计数。」
 *
 * ## Why the multiplier is read from `thresholds.ts`, not written here as a literal
 * O-36's third decision item is "10 倍 / 24 小时滚动窗口" -- a resolved value, not a pending
 * one. `packages/contracts/src/thresholds.ts` is this project's single source for such
 * decided-but-tunable numbers (see its file header); a second `10` typed directly into this
 * module would be exactly the "同一事实声明在两处" drift this codebase has hit five times
 * already (AGENTS.md). `CALL_CHAIN_MAX_DEPTH` in `call-chain.ts` follows the same pattern for
 * O-36's fourth item.
 *
 * ## Why "relative to baseline", not absolute
 * R4/R7 are explicit the judgment is "单人单日消耗超均值 N 倍", not a fixed call count -- a
 * subject with a naturally high baseline should not trip the same absolute ceiling as one with
 * a low baseline. A baseline of `0` (no history yet) intentionally does NOT trigger: dividing
 * by zero would otherwise manufacture an "infinite multiplier" false positive for any agent's
 * very first calls, which is not what "10x the usual" means when there is no "usual" yet.
 */
import { agentRuntime as A, thresholds as T } from "@repo/contracts";
import type { z } from "zod";

/** O-36 第 3 项，裁决值。**不得在别处另抄字面量 `10`。** */
export const QUOTA_ANOMALY_MULTIPLIER: number = T.requireValue<number>(
  T.THRESHOLDS.agentQuotaAnomalyMultiplier,
  "agentQuotaAnomalyMultiplier",
);

/** O-36 第 3 项，观察窗口（小时）。 */
export const QUOTA_ANOMALY_WINDOW_HOURS: number = T.requireValue<number>(
  T.THRESHOLDS.agentQuotaAnomalyWindowHours,
  "agentQuotaAnomalyWindowHours",
);

export type AnomalyT = z.infer<typeof A.Anomaly>;

/** The two numbers the judgment is a pure function of. */
export interface UsageWindow {
  /** This subject's historical rolling-24h average, computed over some trailing baseline period. */
  readonly baselineAverage: number;
  /** Call count in the current rolling 24h window. */
  readonly currentWindowCount: number;
}

export interface QuotaAnomalyVerdict {
  readonly triggered: boolean;
  readonly multiplier: number;
}

/**
 * V20: pushing a subject to >= 10x their rolling baseline triggers; 9x does not.
 * ⚠ `baselineAverage <= 0` never triggers -- see file header on why.
 */
export function detectQuotaAnomaly(usage: UsageWindow): QuotaAnomalyVerdict {
  if (usage.baselineAverage <= 0) {
    return { triggered: false, multiplier: 0 };
  }
  const multiplier = usage.currentWindowCount / usage.baselineAverage;
  return { triggered: multiplier >= QUOTA_ANOMALY_MULTIPLIER, multiplier };
}

export interface AnomalyAuditWriter {
  write(event: Record<string, unknown>): { readonly ok: boolean };
}

export class ProvenanceWriteFailedError extends Error {
  constructor() {
    super("PROVENANCE_WRITE_FAILED");
    this.name = "ProvenanceWriteFailedError";
  }
}

/**
 * Quota anomaly hit -> automatic rate limit (a SYSTEM action, "不等人") + an audit event that is
 * itself visible to the affected subject (`Anomaly.visibleToSubject` is a `z.literal(true)` in
 * the contract -- there is no way to construct one that hides from its subject).
 */
export function raiseQuotaAnomaly(
  input: {
    readonly anomalyId: string;
    readonly subjectId: string;
    readonly verdict: QuotaAnomalyVerdict;
    readonly detectedAt: string;
  },
  writer: AnomalyAuditWriter,
): AnomalyT {
  const written = writer.write({ kind: "quota-anomaly", ...input });
  if (!written.ok) throw new ProvenanceWriteFailedError();
  return {
    anomalyId: input.anomalyId,
    severity: "高",
    subjectId: input.subjectId,
    rateLimited: input.verdict.triggered,
    handled: false,
    detectedAt: input.detectedAt,
    visibleToSubject: true,
  };
}

/**
 * V6: unauthorized MCP access attempts MUST be intercepted and counted, not merely logged --
 * every call to this function both writes an audit event (so a write failure fails the
 * interception the same way `recordToolCall`'s write failure fails the call, I-44's sibling
 * guarantee) and increments the tally, never just one of the two.
 */
export function interceptUnauthorizedCall(
  counters: Map<string, number>,
  agentId: string,
  writer: AnomalyAuditWriter,
): { readonly agentId: string; readonly count: number } {
  const written = writer.write({ kind: "unauthorized-attempt", agentId });
  if (!written.ok) throw new ProvenanceWriteFailedError();
  const next = (counters.get(agentId) ?? 0) + 1;
  counters.set(agentId, next);
  return { agentId, count: next };
}

export function unauthorizedAnomaly(input: {
  readonly anomalyId: string;
  readonly agentId: string;
  readonly detectedAt: string;
}): AnomalyT {
  return {
    anomalyId: input.anomalyId,
    severity: "中",
    subjectId: input.agentId,
    rateLimited: false,
    handled: false,
    detectedAt: input.detectedAt,
    visibleToSubject: true,
  };
}

/** `[标记为正常]` 须填理由才能解除限速（`REVIEW_REASON_REQUIRED`）。 */
export class ReviewReasonRequiredError extends Error {
  constructor() {
    super("REVIEW_REASON_REQUIRED");
    this.name = "ReviewReasonRequiredError";
  }
}

export function markAnomalyNormal(reason: string): { readonly rateLimitReleased: true } {
  if (reason.trim().length === 0) {
    throw new ReviewReasonRequiredError();
  }
  return { rateLimitReleased: true };
}
