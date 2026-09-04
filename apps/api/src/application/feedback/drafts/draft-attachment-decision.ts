/**
 * UC-17.8 B1.7 —— 把「草稿附件仅 owner 本人可下载」变成一个 `PermissionDecision`，
 * 供 `discloseDecided` 取出 `objectKey`。与 `feedback-detail-decision.ts` 同一手法、同一
 * 理由（草稿没有 `acl_bindings` 行，走绕开 `authorize()` 的那条路）。
 *
 * 规则比 D3 更窄：**只有 owner**——管理员也不行。草稿是提交前的私有物，
 * 「我的草稿」列表/读/改/删全部按 `owner_id` 谓词收口（见 `draft-ports.ts` 头注）。
 *
 * `reasonCode` 借 `ORG_SCOPE_DENIED`，理由同 `feedback-detail-decision.ts`：不为此在已签核
 * 的闭集里新造一个值。⚠ 调用方拿到 withheld 时应映射成 404 而非 403（同 `DRAFT_NOT_FOUND`
 * 的 404-非-403 纪律，不泄露草稿存在性）。
 */
import type { PermissionDecision } from "../../../domain/identity/permission-decision";
import type { OrgRole } from "../../../domain/identity/roles";

export interface FeedbackDraftAttachmentDecisionInput {
  readonly decisionId: string;
  readonly viewerId: string;
  /** null = 不是本组织成员（此时无论如何都看不见） */
  readonly viewerOrgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
  readonly draftOwnerId: string;
}

export function decideFeedbackDraftAttachmentVisibility(
  input: FeedbackDraftAttachmentDecisionInput,
): PermissionDecision {
  const orgPassed = input.viewerOrgRole !== null;
  const visible = orgPassed && input.draftOwnerId === input.viewerId;
  return {
    allowed: visible,
    orgLayer: { role: input.viewerOrgRole, teamId: input.viewerTeamId, passed: orgPassed },
    projectLayer: null,
    scopeLayer: { scope: "org-wide", passed: visible },
    reasonCode: visible ? null : orgPassed ? "ORG_SCOPE_DENIED" : "NO_ORG_MEMBERSHIP",
    decisionId: input.decisionId,
  };
}
