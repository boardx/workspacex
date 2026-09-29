/**
 * EV05 批量评测：`pnpm harness eval --all-skills --baseline --write-back`（04-eval-gates R3.9；契约束 work-eval
 * UC-7：对每个 Skill 循环 UC-2 跑套件 → UC-3 门判定 → UC-4 decideG5 → UC-5 回写，并出汇总）。
 *
 * 纯编排，不碰文件系统 / 网络：逐实体评测与门判定由 `BatchEntityEvaluator` 提供（CLI 侧 = fs 套件 + 门脚本），
 * 目录读写由 `BatchCatalogPort` 提供（CLI 侧 = 平台运营凭据调 HTTP）。
 *
 * 语义：
 * - 每个 Skill 都得到一行汇总（评测/判定出错也不中断整批；该行 g5=not_evaluated 并给 error）；
 * - `writeBack`：把门脚本产出的 `WorkGateStatus` 原样回写；G5 pass 且目录通道 = candidate → PATCH verified
 *   （服务端再按门状态记录独立判定，UC-7）；已 verified 的不重复改，G5 未过的绝不改通道。
 * - 不变式（V14）：批后目录中 verified 且 G5 pass 的 Skill 数 = 汇总 `g5Pass`；
 *   汇总里 G5 未过却已是 verified 的行（历史遗留）单独列在 `verifiedWithoutG5`，不静默算进去。
 */
import type { WorkGateStatus } from "@repo/contracts/work-eval";

export type BatchG5 = "pass" | "fail" | "not_evaluated";

export interface BatchEntityEvaluation {
  /** 门脚本产出的 WorkGateStatus；产不出（无版本 digest 等）→ null，并给 error。 */
  readonly status: WorkGateStatus | null;
  readonly reportPath: string | null;
  readonly error: string | null;
}

export interface BatchEntityEvaluator {
  /** 仓内全部声明 `metadata.work` 的 Skill stableId（Workflow/Agent 不在本批：A1 无 G5）。 */
  listSkillStableIds(): readonly string[];
  evaluate(stableId: string, opts: { readonly baseline: boolean }): Promise<BatchEntityEvaluation>;
}

export interface BatchCatalogEntry {
  readonly skillId: string;
  readonly channel: "candidate" | "verified" | "deprecated";
}

export interface BatchCatalogPort {
  /** stableId → 官方目录行；目录里没有 → null（该行记 error，不中断）。 */
  resolve(stableId: string): Promise<BatchCatalogEntry | null>;
  writeBack(skillId: string, status: WorkGateStatus, idempotencyKey: string): Promise<void>;
  markVerified(skillId: string, idempotencyKey: string): Promise<void>;
}

export interface BatchSummaryRow {
  readonly stableId: string;
  readonly subjectPassed: number | null;
  readonly baselinePassed: number | null;
  readonly deterministicTotal: number | null;
  readonly g5: BatchG5;
  readonly g5ReasonCode: string | null;
  readonly reportPath: string | null;
  readonly writtenBack: boolean;
  /** 批处理结束时该 Skill 的目录通道（未回写 / 目录无此行 → null） */
  readonly channel: BatchCatalogEntry["channel"] | null;
  readonly error: string | null;
}

export interface BatchSummary {
  readonly runId: string;
  readonly baseline: boolean;
  readonly writeBack: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly rows: readonly BatchSummaryRow[];
  readonly totals: {
    readonly skills: number;
    readonly g5Pass: number;
    readonly verified: number;
    readonly errors: number;
  };
  readonly verifiedWithoutG5: readonly string[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runAllSkillsEval(input: {
  readonly evaluator: BatchEntityEvaluator;
  readonly catalog: BatchCatalogPort | null;
  readonly baseline: boolean;
  readonly writeBack: boolean;
  readonly runId: string;
  readonly now?: () => Date;
}): Promise<BatchSummary> {
  if (input.writeBack && !input.catalog) throw new Error("--write-back requires a catalog port");
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const rows: BatchSummaryRow[] = [];
  const ids = [...new Set(input.evaluator.listSkillStableIds())].sort();

  for (const stableId of ids) {
    let ev: BatchEntityEvaluation;
    try {
      ev = await input.evaluator.evaluate(stableId, { baseline: input.baseline });
    } catch (e) {
      ev = { status: null, reportPath: null, error: errText(e) };
    }
    const g5Gate = ev.status?.gates.find((g) => g.gate === "G5") ?? null;
    const g5: BatchG5 = !g5Gate ? "not_evaluated" : g5Gate.outcome === "pass" ? "pass" : "fail";
    let error = ev.error;
    let writtenBack = false;
    let channel: BatchCatalogEntry["channel"] | null = null;

    if (input.writeBack && input.catalog && ev.status) {
      try {
        const entry = await input.catalog.resolve(stableId);
        if (!entry) error = error ?? `${stableId} is not in the official skill catalog`;
        else {
          channel = entry.channel;
          await input.catalog.writeBack(entry.skillId, ev.status, `${input.runId}:${stableId}:gate-status`);
          writtenBack = true;
          if (g5 === "pass" && entry.channel === "candidate") {
            await input.catalog.markVerified(entry.skillId, `${input.runId}:${stableId}:verified`);
            channel = "verified";
          }
        }
      } catch (e) {
        error = `write-back failed: ${errText(e)}`;
      }
    }
    rows.push({
      stableId,
      subjectPassed: ev.status?.subjectPassed ?? null,
      baselinePassed: ev.status?.baselinePassed ?? null,
      deterministicTotal: ev.status?.deterministicTotal ?? null,
      g5,
      g5ReasonCode: g5Gate?.reasonCode ?? null,
      reportPath: ev.reportPath,
      writtenBack,
      channel,
      error,
    });
  }

  return {
    runId: input.runId,
    baseline: input.baseline,
    writeBack: input.writeBack,
    startedAt,
    finishedAt: now().toISOString(),
    rows,
    totals: {
      skills: rows.length,
      g5Pass: rows.filter((r) => r.g5 === "pass").length,
      verified: rows.filter((r) => r.channel === "verified" && r.g5 === "pass").length,
      errors: rows.filter((r) => r.error !== null).length,
    },
    verifiedWithoutG5: rows.filter((r) => r.channel === "verified" && r.g5 !== "pass").map((r) => r.stableId),
  };
}

/** 批处理退出：有 error（含回写失败）→ 非 0；G5 fail 本身不算失败（是评测结论，不是运行故障）。 */
export function batchFailed(summary: BatchSummary): boolean {
  return summary.totals.errors > 0;
}

export function formatBatchSummary(summary: BatchSummary): string {
  const lines = [`eval --all-skills run ${summary.runId}${summary.baseline ? " (baseline)" : ""}${summary.writeBack ? " (write-back)" : ""}`];
  for (const r of summary.rows) {
    const counts = r.subjectPassed === null ? "subject -/- baseline -/-" : `subject ${r.subjectPassed}/${r.deterministicTotal} baseline ${r.baselinePassed ?? "-"}/${r.deterministicTotal}`;
    lines.push(`  ${r.stableId}  ${counts}  G5=${r.g5}${r.g5ReasonCode ? `(${r.g5ReasonCode})` : ""}${r.channel ? `  channel=${r.channel}` : ""}${r.error ? `  error: ${r.error}` : ""}`);
  }
  const t = summary.totals;
  lines.push(`  skills ${t.skills}  G5 pass ${t.g5Pass}  verified ${t.verified}  errors ${t.errors}`);
  if (summary.verifiedWithoutG5.length) lines.push(`  ⚠ verified without G5 pass: ${summary.verifiedWithoutG5.join(", ")}`);
  return lines.join("\n");
}
