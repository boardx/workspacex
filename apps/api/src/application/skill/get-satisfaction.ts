/**
 * `getSatisfaction` —— 满意度用例（F62；契约 `getSatisfaction`，O-37）。
 *
 * ⚠ 最小样本量**不在本文件硬编码**：`packages/contracts/src/thresholds.ts` 的
 *   `skillSatisfactionMinSample` 是 `known: false`——本用例把它当**入参**接收
 *   （`minSampleSize`），生产路径由调用方经 `requireValue(...)` 取得
 *   （数值未裁决前会抛错，这是故意的，见 `thresholds.ts` 头注释：
 *   「不要在此处填一个看起来合理的默认值」）。测试可以传入任意数注入验证
 *   结构规则，不需要等真实数值裁决。
 */
import { computeSatisfaction, type SatisfactionCounts } from "../../domain/skill/satisfaction";
import type { SatisfactionCountsPort } from "./ports";

export interface GetSatisfactionInput {
  readonly skillId: string;
  /** 生产路径来自 `requireValue(THRESHOLDS.skillSatisfactionMinSample, ...)`；测试可注入任意值 */
  readonly minSampleSize: number;
}

export interface GetSatisfactionResult {
  readonly value: number | null;
  readonly sampleSize: number;
  readonly insufficient: boolean;
}

export async function getSatisfaction(
  input: GetSatisfactionInput,
  deps: { readonly counts: SatisfactionCountsPort },
): Promise<GetSatisfactionResult> {
  const counts: SatisfactionCounts = await deps.counts.countsOf(input.skillId);
  return computeSatisfaction(counts, input.minSampleSize);
}
