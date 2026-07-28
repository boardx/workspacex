/**
 * Context Pack 丢弃原因 —— **封闭枚举，唯一事实源**（裁决 D-U4，2026-07-28）
 *
 * 背景：UC-0.2 只说「丢弃清单带原因」，没给分类。实现期发明了这 7 类，
 * 人类裁定**采纳为封闭枚举**，并附一条纪律：**新增类别必须走 ADR，不允许临时加**。
 *
 * 为什么封闭而不是 `{ category, detail: string }` 开放结构：
 * 丢弃原因是**给人看的可审查性**，不是日志。开放结构必然长出几十种说法，
 * 到时「AI 为什么没读这条」就又变成不可回答的问题——而那正是 Context Pack 要解决的问题本身。
 *
 * ⚠ 这个枚举是 `omissions[].reason` 的**后端契约**（UC-0.2）。
 *   key 用 kebab-case（线上格式），前后端、research 屏、brain 的「AI 读到了什么」
 *   共用这一份，**不许各自定义**。`scripts/lint-omission-reason.mjs` 机械检查：
 *   代码里不得出现表外的 reason 字面量。
 */

export const OMISSION_REASONS = {
  withdrawn: {
    label: "已撤回",
    /** 一句话说清「为什么它没被读」——面向被解释的人，不是面向开发 */
    explain: "来源方行使了撤回权，该证据已退出检索（D-13 撤回链第 02 步）",
    /** 合规性丢弃：**必须始终可见**，不因「只显示前 N 条」而被折叠 */
    compliance: true,
  },
  expired: {
    label: "时效过期",
    explain: "超过有效期转为待复核（监管类 12 个月 / 市场数据 6 个月），引用时必须提示已过期",
    compliance: true,
  },
  unauthorized: {
    label: "无授权",
    explain: "当前身份不在该条目的可见性范围内——两层交集鉴权未通过（UC-0.3）",
    compliance: true,
  },
  "low-confidence": {
    label: "低置信",
    explain: "置信度低于本次装配的阈值，未纳入但可在明细里查看",
    compliance: false,
  },
  budget: {
    label: "预算截断",
    explain: "token 预算用尽，按相关度排序后被截断——不是不相关，是没装下",
    compliance: false,
  },
  deduped: {
    label: "去重",
    explain: "与已纳入的条目内容重复，保留了来源更可靠的那一份",
    compliance: false,
  },
  "out-of-scope": {
    label: "越出范围",
    explain: "不在本次检索的范围内（如跨项目、跨组织，或本轮限定的材料集之外）",
    compliance: false,
  },
} as const satisfies Record<string, { label: string; explain: string; compliance: boolean }>;

export type OmissionReason = keyof typeof OMISSION_REASONS;

export const OMISSION_REASON_KEYS = Object.keys(OMISSION_REASONS) as OmissionReason[];

/** 合规性丢弃原因——这些**不得**因折叠/截断而从界面消失 */
export const COMPLIANCE_REASONS: OmissionReason[] = OMISSION_REASON_KEYS.filter(
  (k) => OMISSION_REASONS[k].compliance,
);

export function omissionLabel(r: OmissionReason): string {
  return OMISSION_REASONS[r].label;
}

export function omissionExplain(r: OmissionReason): string {
  return OMISSION_REASONS[r].explain;
}

export function isComplianceOmission(r: OmissionReason): boolean {
  return OMISSION_REASONS[r].compliance;
}
