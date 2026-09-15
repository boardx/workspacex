/**
 * 「数据缺失说明」表单（R3-3）—— 把人工确认的缺失原因变成结构化输入。
 *
 * 为什么必须有这个表单：UC-16.1 的 R3-3 把缺失原因定成**人工确认事实**，逐字写着
 * 「这是 PDF 数据质量表的分支依据，Agent 不得自行推断」。这条分支决定的是
 * 「按上一期数据暂估出分」还是「直接判 E、公司经营异常」——两个完全不同的投后动作。
 * 在本表单落地之前，任务书只能请模型自己判断「这家公司是在保密期还是失联了」，
 * 那是把一个人才知道的事实交给模型猜。
 *
 * 原因码不在这里声明：单一事实源是契约 `postinvest-rating.ts` 的
 * `MissingDataReasonCode`（ADR-020）。本文件只补它的中文展示名——`Record<>` 是
 * 穷尽的，契约加一个码而这里没跟上会直接编译失败，不会静默漏一个选项。
 */
import type { postinvestRating } from "@repo/contracts";

type MissingDataReason = postinvestRating.MissingDataReason;
type MissingDataReasonCode = postinvestRating.MissingDataReasonCode;

export const MISSING_REASON_LABELS: Record<MissingDataReasonCode, string> = {
  confidentiality_period: "保密期（上市 / 并购）",
  relationship_broken: "关系交恶",
  major_litigation: "重大诉讼",
  lost_contact: "失联",
  suspended: "停业",
  bankrupt: "破产",
  other: "其他（填写说明）",
};

export const MISSING_REASON_CODES = Object.keys(MISSING_REASON_LABELS) as MissingDataReasonCode[];

export const EMPTY_MISSING_REASON: MissingDataReason = {
  reasons: [],
  otherText: undefined,
  standaloneOnly: false,
  operatingReportOnly: false,
  noPriorYear: false,
};

/**
 * 渲染成任务书里的「人工确认事实」段。刻意写成祈使句而不是描述句：这一段是**约束**，
 * 不是背景信息——模型读到它以后不该再去推断缺失原因，只该按它走分支。
 *
 * 什么都没勾时返回 null（不往任务书里塞一段空话，也不暗示"用户确认了没有缺失"）。
 */
export function buildMissingReasonBrief(reason: MissingDataReason): string | null {
  const lines: string[] = [];
  const picked = reason.reasons.map((code) =>
    code === "other" && reason.otherText?.trim()
      ? `其他：${reason.otherText.trim()}`
      : MISSING_REASON_LABELS[code],
  );
  if (picked.length > 0) lines.push(`财务报表缺失的原因（我已确认）：${picked.join("、")}。`);
  if (reason.standaloneOnly) lines.push("我提供的只有未合并子公司的单体报表。");
  if (reason.operatingReportOnly) lines.push("我提供的只有经营报告，没有财务报表。");
  if (reason.noPriorYear) lines.push("没有上年对比数据。");
  if (lines.length === 0) return null;

  return [
    "## 人工确认事实（我填的，不是你推断的）",
    ...lines,
    "以上每一条都是我作为项目负责人确认过的事实，直接作为第二步数据质量判定的分支依据使用。",
    "不要再自行推断缺失原因，也不要因为材料里看起来像别的情况就改判；我没说的情况按未确认处理，需要就问我。",
  ].join("\n");
}
