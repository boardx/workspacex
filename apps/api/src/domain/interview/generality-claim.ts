/**
 * F95 —— 普遍性断言写作约束 (`uc-6-5` R3 step7 / R4 E5, AC7, O-16 / D-16,
 * `packages/contracts/src/interview.ts` `checkGeneralizationClaim`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的两条不变量
 *
 * 1. **触发线是全仓单一门槛**（O-16）——阈值 5（普遍性断言）与 8（跨组织聚合）
 *    **只在 `packages/contracts/src/thresholds.ts` 声明一次**，本文件用
 *    `requireValue(THRESHOLDS.generalizationClaimMinIndependentSubjects, …)` 取数，
 *    不在这里另抄一份字面量 `5`（AGENTS.md「同一事实不得声明在两处」，本项目已因此漂移五次）。
 * 2. **计数口径 = 独立受访者人数**（同一人多次发言只算 1；`附和` 与 `sourceKind=virtual`
 *    不计入）——`countIndependentSubjects` 是这条口径唯一的落点，`checkGeneralizationClaim`
 *    不重新数一遍。
 *
 * ## 本文件刻意没有的东西
 * · **「普遍性断言」措辞的自然语言判定算法**——只做最小的字面匹配
 *   （`普遍`/`大多数`/`用户都认为`），复杂的语义判定不在本 feature 范围内
 *   （见 issue notes：本 feature 只管"独立受访者 < 5 时阻断"这一条判据）。
 * · **跨组织聚合的分组与「不可推断」标注**（V7b）——那是跨束（12-3 / 17-gov）
 *   的实现位置，本文件只导出同一处单源的阈值供其消费。
 */
import { thresholds as T } from "@repo/contracts";
import type { z } from "zod";
import { interview as C } from "@repo/contracts";

export type InterviewSourceKindT = z.infer<typeof C.InterviewSourceKind>;

/** 参与「独立受访者计数」判定所需的最小引述形状。 */
export interface QuoteForIndependentCount {
  readonly subjectId: string;
  readonly sourceKind: InterviewSourceKindT;
  /** 现场逐字稿已标「附和 · 非独立证据」（UC-6.4 第 8 步）。 */
  readonly isAppeasement: boolean;
}

/** O-16 全仓单一门槛：普遍性断言触发线。不在别处另抄一份。 */
export function generalizationClaimThreshold(): number {
  return T.requireValue(T.THRESHOLDS.generalizationClaimMinIndependentSubjects, "generalizationClaimMinIndependentSubjects");
}

/** O-16 全仓单一门槛：跨组织不可逆聚合最小样本量。同上，供跨束消费。 */
export function crossOrgAggregationMinSample(): number {
  return T.requireValue(T.THRESHOLDS.crossOrgAggregationMinSample, "crossOrgAggregationMinSample");
}

/**
 * countIndependentSubjects —— 独立受访者计数（I-27 计数口径）。
 *
 * ⚠ 同一人多条引述只算 1（`Set` 去重）；`附和` 与 `sourceKind=virtual` 均不计入——
 *   两者都是"覆盖排除"，不是"没有更好信号时的默认值"。
 */
export function countIndependentSubjects(quotes: readonly QuoteForIndependentCount[]): number {
  const independentSubjectIds = new Set(
    quotes
      .filter((q) => !q.isAppeasement && q.sourceKind !== "virtual")
      .map((q) => q.subjectId),
  );
  return independentSubjectIds.size;
}

/** 报告草稿里触发「普遍性断言」写作约束的措辞（最小字面匹配，见文件头注释）。 */
const GENERALITY_PHRASES = ["普遍认为", "大多数", "用户都认为", "普遍"] as const;

/** 该草稿文本是否包含「普遍性断言」措辞。 */
export function containsGeneralizationClaim(draftText: string): boolean {
  return GENERALITY_PHRASES.some((p) => draftText.includes(p));
}

export interface GeneralizationCheckResult {
  readonly blocked: boolean;
  readonly independentSubjects: number;
  readonly suggestion: string | null;
}

/**
 * checkGeneralizationClaim —— 契约 `checkGeneralizationClaim` 的领域实现（AC7 / E5）。
 *
 * ⚠ 未含普遍性措辞 ⇒ 永不阻断（`blocked: false`），即便独立受访者数 < 5——
 *   这条规则只管"写了普遍性断言但证据撑不住"，不禁止"部分受访者提到"这类
 *   本就克制的表述。
 * ⚠ 阻断时的提示文案**必须给出实际的独立受访者人数**（R4 E5 逐字要求），
 *   `suggestion` 固定给「部分受访者提到」改写建议，不是留白让调用方自己拼文案——
 *   一个"只返回 blocked: true 不给建议"的实现会让界面拿不到这句话。
 */
export function checkGeneralizationClaim(
  draftText: string,
  quotes: readonly QuoteForIndependentCount[],
): GeneralizationCheckResult {
  const independentSubjects = countIndependentSubjects(quotes);

  if (!containsGeneralizationClaim(draftText)) {
    return { blocked: false, independentSubjects, suggestion: null };
  }

  const threshold = generalizationClaimThreshold();
  if (independentSubjects >= threshold) {
    return { blocked: false, independentSubjects, suggestion: null };
  }

  return {
    blocked: true,
    independentSubjects,
    suggestion: `只有 ${independentSubjects} 位独立受访者提到，建议改写为「部分受访者提到」`,
  };
}
