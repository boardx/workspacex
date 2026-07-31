/**
 * Ports for `StepAttachment` —— 挂到项目环节（F81，uc-6-0 R3步骤7 / A3 / V4 / V9）。
 *
 * ## 端口形状本身就是「固定快照」那条不变量
 *
 * `AttachmentRecord` 带着 `pinnedVersionId` **和它的 `contentHash` / `versionNumber`**
 * 一起回来，而这三样都来自**挂载行所指的那一条版本**，不是来自 artifact 的 head。
 * 这不是顺手多查两列：`attach` / `detach` 的审计明细里记的就是它们，
 * 而「这个环节引用的是当时那一份」这句话，除了那份的哈希以外没有别的东西能证明。
 *
 * 于是「把读快照改成读当前值」是一个**具体的、可执行的**改动
 * （`pg-interview-attachment-repository.ts` 的 `SNAPSHOT_JOIN`），
 * 而 `mount-to-segment-snapshot.test.ts` 必须当场红。
 *
 * ## 这里没有 `updateAttachment`
 *
 * 解除是 `detach`（打标记），改指是被数据库拒绝的（0030 的 `snapshot_frozen` 触发器）。
 * 端口不表达一个「换个快照」的方法，所以没有实现能提供它 —— 与 `ProvenanceWriter`
 * 没有 updater 是同一条纪律。
 */
import type { OrgId } from "../../domain/org-id";
import type { CitationAnchor } from "../../domain/artifact/downstream-eligibility";
import type { InterviewVisibilityFacts } from "../../domain/interview/scope";
import type { Guarded } from "../security/permission-filter";

/** 一条挂载，连同它**冻住的那一份**的可验证身份。 */
export interface AttachmentRecord {
  readonly attachmentId: string;
  readonly interviewId: string;
  readonly projectId: string;
  readonly stepId: string;
  readonly pinnedVersionId: string;
  /** ⚠ 属于 `pinnedVersionId` 那一行，**不是** artifact 的 head。 */
  readonly pinnedVersionNumber: number;
  /** 同上。SHA-256，是「快照没跟着上游走」唯一可断言的证据。 */
  readonly pinnedContentHash: string;
  readonly attachedBy: string;
  readonly attachedAt: string;
  readonly detachedAt: string | null;
}

/**
 * 一条「已从库里取出、但还没对任何人解封」的挂载 —— 与 F80 的 `GuardedInterviewRow` 同形。
 *
 * 挂载的可见性**不是一条新规则**：能不能看见一条挂载，等于能不能看见它挂的那场访谈。
 * 所以 `facts` 是访谈的可见性事实，判定仍由 `decideInterviewVisibility` 做。
 * 在这里另起一条「挂过就能看」的规则，会让访谈的可见性有两处事实源。
 */
export interface GuardedAttachment {
  readonly item: Guarded<AttachmentRecord>;
  readonly facts: InterviewVisibilityFacts;
}

export interface AttachInput {
  readonly orgId: OrgId;
  readonly attachmentId: string;
  readonly interviewId: string;
  readonly projectId: string;
  readonly stepId: string;
  readonly pinnedVersionId: string;
  readonly attachedBy: string;
}

export interface InterviewAttachmentRepository {
  /**
   * 写入一条挂载。
   *
   * 数据库的 `requires_pinned` 触发器是最后一道门，所以即便调用方跳过了 use case 的判定，
   * 一个非 pinned 的版本仍然进不来。use case 仍然先判一次 —— 那次判定给的是
   * `REQUIRES_PINNED` 这个**契约码**，而不是一条 SQLSTATE。
   */
  attach(input: AttachInput): Promise<GuardedAttachment>;

  /**
   * 解除：打 `detached_at`，不删行。返回被解除的那一条（含它冻住的快照身份，供审计）。
   * 解除者即判定人 —— 两者是同一个人，分成两个参数只会让它们有机会不同。
   */
  detach(orgId: OrgId, viewerUserId: string, attachmentId: string): Promise<GuardedAttachment | null>;

  /** 按 id 直读一条挂载。`null` = 不存在或不属于本租户（两者同一个答案，uc-6-0/E3）。 */
  find(orgId: OrgId, viewerUserId: string, attachmentId: string): Promise<GuardedAttachment | null>;

  /** 该访谈**活着的**挂载。解除过的不在其中，但它们的行还在（留痕）。 */
  listActive(
    orgId: OrgId,
    viewerUserId: string,
    interviewId: string,
  ): Promise<readonly GuardedAttachment[]>;

  /**
   * 该版本所属 artifact 在本租户下的**全部**绑定锚点。
   *
   * 整批返回而不是在 SQL 里先筛出 pinned：A4 允许一个 artifact 在多个环节上以不同模式、
   * 不同版本绑定，所以「这个版本是不是被钉住了」是关于**集合**的问题；
   * 在仓储里先筛，等于把判定搬进 SQL，而那时唯一能断言的就只剩那条查询本身。
   */
  anchorsFor(orgId: OrgId, versionId: string): Promise<readonly CitationAnchor[]>;
}

export const INTERVIEW_ATTACHMENT_REPOSITORY = Symbol("InterviewAttachmentRepository");
