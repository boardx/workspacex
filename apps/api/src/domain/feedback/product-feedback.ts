/**
 * FB-2 —— 反馈的**领域规则**（纯函数，无 IO、无框架）。
 *
 * 契约：`packages/contracts/src/feedback-loop.ts`。这里落三件契约表达不了的东西：
 *
 *   ① **状态机**——zod 校验的是「这一次请求的形状」，它看不到当前状态，
 *      所以「从 A 只能到 B 或 C」在契约里写不出来。
 *   ② **正文可见性（D3）**——它依赖「请求者是谁 / 是不是管理员 / 是不是提交人」，
 *      这三样都不在请求体里。
 *   ③ **`不做` 必须带理由**——跨字段规则。
 *
 * ⚠ 这三条都**在数据库里另有一半**（CHECK 约束 / RLS）。不是重复：
 *   这一半负责回一个**具名的、能显示给人看的**错误；那一半负责保证并发、
 *   直连 SQL、以及「有人以后新写了一个绕过用例的路径」时规则仍然成立。
 *   只有其中一半时，前者会在并发下失效，后者只会给用户一句 23514。
 */

/** 与契约 `FeedbackStatus` 逐字同集。⚠ 这里不 import zod——domain 层不依赖契约包的运行时。 */
export type FeedbackStatus = "待处理" | "已进入迭代" | "已修复" | "不做";

export type OrgRole = "admin" | (string & {});

/**
 * 合法状态转移。
 *
 * ## 为什么每个终态都能回 `待处理`
 *
 * 「已修复」会被证伪（用户回来说还是坏的），「不做」会被推翻（三个月后又有人提同一件事，
 * 票数上去了）。没有回边时，这两件事在系统里的唯一表达方式是**再提一条新反馈**——
 * 于是同一个问题在库里有两条记录、两串票数，而它们都不是完整的事实。
 *
 * ## 为什么 `已修复` 不能直接到 `不做`
 *
 * 那条路读起来是「修好了，但我们决定不做」，没有任何一种真实情况长这样。
 * 真实情况是「我们发现之前判错了」——那要先回 `待处理`，让这次改判在
 * `product_feedback_status_events` 里留下**两条**痕迹（撤销 + 重判），
 * 而不是一条把中间那次判断抹掉的直达边。
 */
const ALLOWED_TRANSITIONS: Readonly<Record<FeedbackStatus, readonly FeedbackStatus[]>> = {
  待处理: ["已进入迭代", "不做"],
  已进入迭代: ["已修复", "待处理", "不做"],
  已修复: ["待处理"],
  不做: ["待处理"],
};

export type TriageOutcome =
  /** 状态确实变了，调用方应落库 + 写一条 status event */
  | { readonly kind: "changed"; readonly from: FeedbackStatus; readonly to: FeedbackStatus; readonly reason: string | null }
  /** 目标状态 = 当前状态。幂等重放，**不落库、不写事件** */
  | { readonly kind: "unchanged"; readonly at: FeedbackStatus }
  | { readonly kind: "rejected"; readonly code: "TRIAGE_REASON_REQUIRED" }
  | { readonly kind: "rejected"; readonly code: "ILLEGAL_TRANSITION"; readonly from: FeedbackStatus; readonly to: FeedbackStatus };

/**
 * 分诊一次状态变更。
 *
 * ⚠ **幂等重放（`unchanged`）不写事件**。把「管理员点了两次『进迭代』」记成两条转移，
 *   会让状态流水在回答「这条被来回改了几次」时给出一个偏大的数字，
 *   而那个数字读起来像是有人在反复改判。
 *
 * ⚠ 理由的必填判定放在转移合法性**之前**：一次「从已修复直接判不做且没写理由」
 *   有两个毛病，先报哪个都对，但**必须每次都报同一个**——否则同一个请求在
 *   不同版本里得到不同错误码，而调用方按错误码分支。这里固定先报理由。
 */
export function triage(input: {
  readonly current: FeedbackStatus;
  readonly next: FeedbackStatus;
  readonly reason: string | null;
}): TriageOutcome {
  const reason = input.reason === null ? null : input.reason.trim();
  const normalizedReason = reason === "" ? null : reason;

  if (input.next === "不做" && normalizedReason === null) {
    return { kind: "rejected", code: "TRIAGE_REASON_REQUIRED" };
  }
  if (input.next === input.current) {
    return { kind: "unchanged", at: input.current };
  }
  if (!ALLOWED_TRANSITIONS[input.current].includes(input.next)) {
    return { kind: "rejected", code: "ILLEGAL_TRANSITION", from: input.current, to: input.next };
  }
  return { kind: "changed", from: input.current, to: input.next, reason: normalizedReason };
}

/** 供测试与文档反查：某状态出去有哪些边。⚠ 返回副本——导出内部数组等于让调用方能改状态机。 */
export function allowedTransitionsFrom(status: FeedbackStatus): readonly FeedbackStatus[] {
  return [...ALLOWED_TRANSITIONS[status]];
}

/**
 * D3（2026-08-15 人类裁决）：**标题+票数对全组织可见，正文仅管理员与提交人**。
 *
 * ⚠ 这个函数返回的是 `boolean`，而调用方拿它去决定 `detail` 是**原文还是 null**——
 *   不是「返回一段脱敏后的摘要」。摘要是一种看起来无害的泄露：正文里的客户名
 *   往往就在第一句。要么给全文，要么什么都不给。
 *
 * ⚠ 提交人自己恒可见。他写的就是他自己那段字，对他遮起来只会让「我提的」那个
 *   标签页变成一列没有内容的标题。
 */
export function canReadDetail(input: {
  readonly viewerId: string;
  readonly viewerOrgRole: OrgRole;
  readonly submittedBy: string;
}): boolean {
  return input.viewerOrgRole === "admin" || input.viewerId === input.submittedBy;
}

/**
 * 分诊权限：**只有组织管理员**。
 *
 * ⚠ 不做「提交人可以关自己那条」的例外。看起来体贴，实际是给状态机开一个
 *   不经分诊的旁路：一条被提交人自行标成「已修复」的反馈，会照常计入
 *   `getFeedbackCounts` 的已修复数，而没有任何人验证过它真的修好了。
 */
export function canTriage(viewerOrgRole: OrgRole): boolean {
  return viewerOrgRole === "admin";
}
