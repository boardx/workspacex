/**
 * 研究问题（RQ）覆盖度 —— 值对象（F92，uc-6-4 R3 步骤7 / AC1）。
 *
 * ## 四取值，`not_applicable` 不是 `uncovered` 的同义词
 *
 * 原型示例 `RQ1 证据充分 ｜ RQ2 证据充分 ｜ RQ3 有信息待追问 ｜ RQ4 尚未覆盖 ｜ RQ5 不适用本人`
 * 给出的是 5 个 RQ、4 个不同取值。`不适用本人`（`not_applicable`）标记"这个 RQ
 * 本就不该问这位受访者"，与"该问、还没问到"的 `uncovered` 在语义与下游统计上都
 * 必须区分（A2：`not_applicable` 不计入本场"未覆盖"，也不在 UC-6.5 矩阵里被解读
 * 为"未提及"）——见契约 `RqCoverageValue` 头注同一立场。
 */
export type RqCoverageValueName = "covered" | "partial" | "uncovered" | "not_applicable";

export const RQ_COVERAGE_VALUES: readonly RqCoverageValueName[] = [
  "covered",
  "partial",
  "uncovered",
  "not_applicable",
];

export interface RqCoverageDraft {
  readonly rqId: string;
  readonly label: string;
  readonly order: number;
}

export interface RqCoverageRecord extends RqCoverageDraft {
  /** `null` = 尚未打过任何状态（不等同于 `uncovered`——那是人工确认过的一个值）。 */
  readonly value: RqCoverageValueName | null;
}

/**
 * 结束汇总（AC1）：5 个 RQ 的覆盖态一次性呈现，`not_applicable` 单独计数、
 * 不并入 `uncoveredCount`——这是本函数存在的唯一理由，若把它们合并计数，
 * "未覆盖" 的数字就会把"不适用"也算进去，产出失真的覆盖率。
 */
export interface RqCoverageSummary {
  readonly total: number;
  readonly coveredCount: number;
  readonly partialCount: number;
  readonly uncoveredCount: number;
  readonly notApplicableCount: number;
  readonly items: readonly RqCoverageRecord[];
}

export function summarizeRqCoverage(items: readonly RqCoverageRecord[]): RqCoverageSummary {
  let coveredCount = 0;
  let partialCount = 0;
  let uncoveredCount = 0;
  let notApplicableCount = 0;
  for (const item of items) {
    switch (item.value) {
      case "covered":
        coveredCount += 1;
        break;
      case "partial":
        partialCount += 1;
        break;
      case "uncovered":
        uncoveredCount += 1;
        break;
      case "not_applicable":
        notApplicableCount += 1;
        break;
      case null:
        break;
    }
  }
  return {
    total: items.length,
    coveredCount,
    partialCount,
    uncoveredCount,
    notApplicableCount,
    items,
  };
}
