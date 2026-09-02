/**
 * `downloadFeedbackAttachment`（FB-5）—— 附件字节的下载路径，权限判法与正文
 * **完全一致**（D3：管理员 + 提交人）。图片不是标题/票数那类展示性上下文，
 * 是反馈正文的一部分——见契约 `FeedbackAttachment` 头注。
 */
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { decideFeedbackDetailVisibility } from "./feedback-detail-decision";
import type { FeedbackAttachmentRepository } from "./attachment-ports";
import type { ProductFeedbackRepository } from "./ports";
import { FeedbackNotFoundError } from "./triage-feedback";

export class FeedbackAttachmentNotFoundError extends Error {}
export class FeedbackAttachmentAccessDeniedError extends Error {}

export interface DownloadFeedbackAttachmentDeps {
  readonly attachments: FeedbackAttachmentRepository;
  readonly feedback: ProductFeedbackRepository;
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
  // ⚠ 未认领（`feedbackId === null`，还在提交人自己的上传窗口里）也一律 404——
  //   这条路由服务的是"看一条已存在反馈的附件"，未认领的字节没有反馈可供判权限，
  //   把它当"不存在"处理比额外发明一条"上传者本人可看未认领附件"的分支更少代码、
  //   也更安全（没人需要在提交之前就能通过这条路由把字节读回来）。`objectKey === null`
  //   与 `feedbackId === null` 恒等价（见 `attachment-ports.ts` 头注），这里两者都判
  //   只是让类型收窄，不是多一条独立分支。
  if (attachment === null || attachment.feedbackId === null || attachment.objectKey === null) {
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
