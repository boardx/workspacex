/**
 * 派生数值算在这里，不算在模型里——测试方案的 S1（数据准确率 100%）与验收 E-4
 * （同一材料重跑三次数值一致）都要求同比这类派生量是**确定性计算**，模型只负责
 * 抽取原始数值与定性判断。见 `packages/contracts/src/post-investment-report.ts` 头注。
 */

/**
 * 从材料原文里常见的数字写法（"4,680万元" / "-860万元" / "29.5%"）里抽出一个可比较的
 * 浮点数。抽不出来返回 `null`——**不猜**，调用方据此把 `yoyPct` 置空而不是编一个数字。
 */
export function parseNumericValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** 同比/环比百分比。任一侧解析不出数字，或基期为 0（除零），返回 `null`。 */
export function computeYoyPct(currentValue: string, priorValue: string | null): number | null {
  if (priorValue === null) return null;
  const current = parseNumericValue(currentValue);
  const prior = parseNumericValue(priorValue);
  if (current === null || prior === null || prior === 0) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
}
