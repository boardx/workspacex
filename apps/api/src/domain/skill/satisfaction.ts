/**
 * Skill 满意度口径（F62；`contracts/skills/usecases.md:410`、O-37）。
 *
 * 洋葱最内层：纯函数，不知道数据库里 rating 表长什么样，也不知道
 * 最小样本量这个数字**现在还没人给**（`packages/contracts/src/thresholds.ts`
 * 的 `skillSatisfactionMinSample` 是 `known: false`）。
 *
 * ⚠ 本文件不替阈值编一个数——`minSampleSize` 是入参，由 application 层
 *   经 `requireValue(THRESHOLDS.skillSatisfactionMinSample, ...)` 取得
 *   （生产路径今天会抛错，这是故意的：抛错好过悄悄用一个「看起来合理」的数）。
 *   本文件测的是**结构规则**——「低于阈值就不给百分比」——这条规则与
 *   最终数值无关，可以先用任意注入值验证。
 */

/** 👍/👎 计数。⚠ 不含未评价、不加权（O-37 逐字） */
export interface SatisfactionCounts {
  readonly up: number;
  readonly down: number;
}

export interface SatisfactionResult {
  /** ⚠ null ⟺ 样本不足。**不返回 0，也不返回估算值**（同 `getSatisfaction` 契约注释） */
  readonly value: number | null;
  readonly sampleSize: number;
  readonly insufficient: boolean;
}

/**
 * 计算满意度。
 *
 * · 口径恒为 `up / (up + down)`——不含「未评价」，不按时间/权重加权。
 * · `sampleSize < minSampleSize` ⇒ `value: null ∧ insufficient: true`：
 *   界面显示「样本不足」而不是一个基于过少样本、容易被误读为「已算过」的百分比。
 */
export function computeSatisfaction(
  counts: SatisfactionCounts,
  minSampleSize: number,
): SatisfactionResult {
  const sampleSize = counts.up + counts.down;

  if (sampleSize < minSampleSize) {
    return { value: null, sampleSize, insufficient: true };
  }

  return { value: counts.up / sampleSize, sampleSize, insufficient: false };
}
