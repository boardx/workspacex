/**
 * `downloadFeedbackAttachment`（FB-5）—— 附件字节的下载路径。两条权限判法：
 *
 *   · 挂着 `feedbackId`：与反馈正文**完全一致**（D3：管理员 + 提交人）。图片不是
 *     标题/票数那类展示性上下文，是反馈正文的一部分——见契约 `FeedbackAttachment` 头注。
 *   · 挂着 `draftId`（UC-17.8 B1.7）：草稿没有 `acl_bindings` 行、不适用 D3，规则更窄
 *     ——只有 owner 本人（连管理员也不行），判定见 `drafts/draft-attachment-decision.ts`。
 *   · 两者都没有（未认领）：一律 404，理由不变，见下方注释。
 */
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { decideFeedbackDetailVisibility } from "./feedback-detail-decision";
import { decideFeedbackDraftAttachmentVisibility } from "./drafts/draft-attachment-decision";
import type { FeedbackAttachmentRepository } from "./attachment-ports";
import type { ProductFeedbackRepository } from "./ports";
import type { FeedbackDraftRepositoryFactory } from "./draft-ports";
import { FeedbackNotFoundError } from "./triage-feedback";

export class FeedbackAttachmentNotFoundError extends Error {}
export class FeedbackAttachmentAccessDeniedError extends Error {}

export interface DownloadFeedbackAttachmentDeps {
  readonly attachments: FeedbackAttachmentRepository;
  readonly feedback: ProductFeedbackRepository;
  readonly drafts: FeedbackDraftRepositoryFactory;
  /** 每一次可见性判定都有自己的 id——同 `list-feedback.ts` 的既有纪律（R10 ④）。 */
  readonly newDecisionId: () => string;
}

export interface DownloadFeedbackAttachmentInput {
  readonly orgId: OrgId;
  readonly attachmentId: string;
  readonly viewerId: string;
  readonly viewerOrgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
}

export interface DownloadFeedbackAttachmentResult {
  readonly objectKey: string;
  readonly contentType: string;
}

export async function downloadFeedbackAttachment(
  deps: DownloadFeedbackAttachmentDeps,
  input: DownloadFeedbackAttachmentInput,
): Promise<DownloadFeedbackAttachmentResult> {
  const attachment = await deps.attachments.findById(input.orgId, input.attachmentId);
  if (attachment === null || attachment.objectKey === null) {
    throw new FeedbackAttachmentNotFoundError();
  }

  // 挂着 `draftId`（尚未提交）：B1.7，只有 owner 本人。草稿没有 `acl_bindings` 行、
  // 不适用 D3，判定见 `drafts/draft-attachment-decision.ts`。
  if (attachment.feedbackId === null && attachment.draftId !== null) {
    const draft = await deps.drafts.forOrg(input.orgId).get(attachment.draftId, input.viewerId);
    // 不存在**或不是 viewer 的草稿** ⇒ 404（同 `DRAFT_NOT_FOUND` 纪律，不泄露存在性）。
    if (draft === null) throw new FeedbackAttachmentNotFoundError();
    const decision = decideFeedbackDraftAttachmentVisibility({
      decisionId: deps.newDecisionId(),
      viewerId: input.viewerId,
      viewerOrgRole: input.viewerOrgRole,
      viewerTeamId: input.viewerTeamId,
      draftOwnerId: draft.ownerId,
    });
    const outcome = discloseDecided(attachment.objectKey, decision);
    if (!isDisclosed(outcome)) throw new FeedbackAttachmentAccessDeniedError();
    return { objectKey: outcome.payload, contentType: attachment.contentType };
  }

  // 两者都没有（还在提交人自己的上传窗口里，尚未认领到反馈或草稿）：一律 404——
  //   没人需要在提交之前就能通过这条路由把字节读回来。
  if (attachment.feedbackId === null) {
    throw new FeedbackAttachmentNotFoundError();
  }

  const feedback = await deps.feedback.findById(attachment.feedbackId, input.viewerId);
  if (feedback === null) throw new FeedbackNotFoundError();

  // 与正文用**同一条**判定（D3）——见文件头注："附件的权限判法与正文完全一致"。
  // 复用 `decideFeedbackDetailVisibility` 而不是重新手写 `canTriage(...) || submittedBy===...`：
  // 两处各写一遍的话，其中一处漏改是这条规则事实上分岔成两条而没人发现。
  const decision = decideFeedbackDetailVisibility({
    decisionId: deps.newDecisionId(),
    viewerId: input.viewerId,
    viewerOrgRole: input.viewerOrgRole,
    viewerTeamId: input.viewerTeamId,
    submittedBy: feedback.submittedBy,
  });
  const outcome = discloseDecided(attachment.objectKey, decision);
  if (!isDisclosed(outcome)) throw new FeedbackAttachmentAccessDeniedError();

  return { objectKey: outcome.payload, contentType: attachment.contentType };
}
