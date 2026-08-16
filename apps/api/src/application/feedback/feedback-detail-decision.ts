/**
 * 把 `canReadDetail`（D3）变成一个 `PermissionDecision`，供 `discloseDecided` 取正文。
 *
 * 与 `subject-visibility-decision.ts` / `interview` 束的 `visibility-decision.ts`
 * 同一手法、同一理由：一条反馈没有 `acl_bindings` 行（它不是项目/产出/切片三者之一），
 * 所以它走「一道门、两个判定来源」里绕开 `authorize()` 的那一条。
 *
 * ## 为什么 `reasonCode` 借 `ORG_SCOPE_DENIED` 而不是新造一个
 *
 * `PermissionReason` 是 **identity 束已签核契约**里的闭集（8 个值）。为「你不是管理员
 * 也不是提交人」新造第 9 个值，等于在实现期改一份已签核的契约——那要人类重新签，
 * 而这条判定并不需要一个新词才能说清楚：请求者确实是本组织成员（org 层过了），
 * 被挡住的是**这条内容的可见范围**，那正是 `ORG_SCOPE_DENIED` 说的事。
 *
 * ⚠ 不用 `PERSONAL_LAYER_CLOSED`：那个码的语义是 I-8「个人层对任何人封闭，含管理员」，
 *   而这里管理员**恰恰能看**。用它会让「管理员看不到」这条不成立的事写进审计。
 */
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { OrgRole } from "../../domain/identity/roles";
import { canReadDetail } from "../../domain/feedback/product-feedback";

export interface FeedbackDetailDecisionInput {
  readonly decisionId: string;
  readonly viewerId: string;
  /** null = 不是本组织成员（此时无论如何都看不见） */
  readonly viewerOrgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
  readonly submittedBy: string;
}

export function decideFeedbackDetailVisibility(input: FeedbackDetailDecisionInput): PermissionDecision {
  const orgPassed = input.viewerOrgRole !== null;
  const visible =
    orgPassed &&
    canReadDetail({
      viewerId: input.viewerId,
      viewerOrgRole: input.viewerOrgRole,
      submittedBy: input.submittedBy,
    });

  return {
    allowed: visible,
    orgLayer: { role: input.viewerOrgRole, teamId: input.viewerTeamId, passed: orgPassed },
    // 反馈不属于任何项目——`projectLayer: null` 是 I-11 要求的表达方式
    // （「没有项目上下文」不等于「在项目里没有角色」）。
    projectLayer: null,
    // 对象没有 `acl_bindings` 行（与 `interview` / `subject` 同型），取同一个既定默认。
    scopeLayer: { scope: "org-wide", passed: visible },
    reasonCode: visible ? null : orgPassed ? "ORG_SCOPE_DENIED" : "NO_ORG_MEMBERSHIP",
    decisionId: input.decisionId,
  };
}
