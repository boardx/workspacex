/**
 * FB-5 —— 反馈附件（图片）的仓储端口。与 `ports.ts`（反馈本身）分开，理由同
 * `notification-ports.ts` 头注：这是反馈之外的一张独立表、独立生命周期
 * （上传时未挂反馈，`submitFeedback` 之后才认领——见迁移
 * `20260902120000_fb5_feedback_attachments.sql` 头注）。
 */
import type { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** UC-17.8 D3：白名单只在契约 `FeedbackAttachmentMime` 里写一遍，这里派生。 */
export type FeedbackAttachmentContentType = z.infer<typeof feedbackLoop.FeedbackAttachmentMime>;

export interface FeedbackAttachmentRow {
  readonly id: string;
  readonly orgId: string;
  readonly uploadedBy: string;
  readonly feedbackId: string | null;
  /** UC-17.8 B1：挂在哪条草稿上（`feedback_id IS NULL` 时才可能非 null）。 */
  readonly draftId: string | null;
  /**
   * 能读出字节的钥匙——同 `pg-product-feedback-repository.ts` 把 `detail` 包成
   * `Guarded<string>` 一样的理由：`objectKey` 才是「读到即可看到图片内容」的那个字段，
   * 必须经 `discloseDecided` 才能取出：挂着 `feedbackId` 时 ref 是 `feedback`（D3）；
   * UC-17.8 B1.7：只挂着 `draftId` 时 ref 是 `feedback_draft`（owner 本人）。`null` 仅当
   * 两者都为 `null`（尚未认领）——此时没有可供 `guard()` 挂靠的对象，下载路由对未认领
   * 附件一律先 404，不会走到需要读这个字段的那一步（见 `download-feedback-attachment.ts`）。
   */
  readonly objectKey: Guarded<string> | null;
  readonly contentType: FeedbackAttachmentContentType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface NewFeedbackAttachment {
  readonly id: string;
  readonly orgId: OrgId;
  readonly uploadedBy: string;
  readonly objectKey: string;
  readonly contentType: FeedbackAttachmentContentType;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface FeedbackAttachmentRepository {
  /** 落 PG 元数据。字节由调用方先写进 `ObjectStore`（见 `upload-feedback-attachment.ts`）。 */
  create(row: NewFeedbackAttachment): Promise<void>;

  /**
   * `submitFeedback` 成功后按 id 列表认领——**原子地**把匹配
   * `(org_id, uploaded_by, id) AND feedback_id IS NULL` 的行的 `feedback_id` 置为
   * 这条新反馈的 id。返回真正认领成功的行数：调用方据此判断有没有 id 认领失败
   * （别人的 id / 已被别的反馈认领 / 根本不存在），best-effort、只记日志，不阻塞
   * 反馈提交本身——见 `submit-feedback.ts` 头注。
   */
  claimForFeedback(
    orgId: OrgId,
    feedbackId: string,
    attachmentIds: readonly string[],
    uploadedBy: string,
  ): Promise<number>;

  /** 一条反馈已认领的全部附件，供 `listFeedback` 投影。 */
  findByFeedbackIds(
    orgId: OrgId,
    feedbackIds: readonly string[],
  ): Promise<readonly FeedbackAttachmentRow[]>;

  /** 下载路由用——查具体一条，不限上传者（下载路由自己按反馈可见性判权限）。 */
  findById(orgId: OrgId, attachmentId: string): Promise<FeedbackAttachmentRow | null>;

  /* ─────────── UC-17.8 B1 · 草稿挂靠 ─────────── */

  /**
   * 同 `claimForFeedback`，但挂到草稿上：匹配 `(org_id, uploaded_by, id) AND feedback_id IS NULL
   * AND draft_id IS NULL` 的行把 `draft_id` 置为这条草稿。返回真正挂上的行数，best-effort 同上。
   */
  claimForDraft(orgId: OrgId, draftId: string, attachmentIds: readonly string[], uploadedBy: string): Promise<number>;

  /**
   * 草稿提交：把挂在草稿上的附件整体改挂到新建的反馈上（`feedback_id = $fb, draft_id = NULL`）。
   * 返回迁走的行数。⚠ 只匹配 `draft_id = $draft`——不按 id 列表，草稿上有什么就迁什么。
   */
  moveDraftAttachmentsToFeedback(orgId: OrgId, draftId: string, feedbackId: string): Promise<number>;

  /** 删草稿前把它上面的附件放回未认领（`draft_id = NULL`）。数据库 FK `ON DELETE SET NULL` 是兜底。 */
  releaseDraftAttachments(orgId: OrgId, draftId: string): Promise<number>;

  /** 「我的草稿」列表投影用——一批草稿各自挂着的附件。⚠ 只回 owner 自己上传的行（草稿是私有物）。 */
  findByDraftIds(orgId: OrgId, draftIds: readonly string[], ownerId: string): Promise<readonly FeedbackAttachmentRow[]>;
}

export const FEEDBACK_ATTACHMENT_REPOSITORY = Symbol("FeedbackAttachmentRepository");
