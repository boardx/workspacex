/**
 * `attachToProjectStep` —— 把一场访谈挂到项目环节（uc-6-0 R3步骤7 / A3 / V4 / V9）。
 *
 * ## 三件事，缺一条这个 feature 就是空的
 *
 * ① 挂上之后**该项目成员看得见**（V4①）。
 * ② 引用的是**固定快照**，上游继续往前走，已挂的这一条不跟着变（V4③ / D-30）。
 * ③ 挂载**写审计**（V9；范围切换那种读操作不写）。
 *
 * ## ① 怎么做到的：不新写可见性规则
 *
 * 本文件**没有**任何一句「挂载了也算可见」。可见性的唯一落点仍是 F80 的
 * `VISIBILITY_PREDICATE`，它的第三支是「项目非空 ∧ 看的人是该项目成员」；
 * 迁移 0030 的 `interview_attachment_project_projection()` 让 `project_id` 由**活着的挂载**
 * 派生出来，于是那条谓词自己就算出了 V4①，解除后又自己算回「不属于任何项目」（V4②）。
 *
 * 在这里加一条 OR 分支同样能让测试变绿，代价是服务端过滤从此有两处事实源 ——
 * 本项目已五次因此漂移。
 *
 * ## ② 怎么做到的：判定不在本束
 *
 * `REQUIRES_PINNED` 用的是 `domain/artifact/downstream-eligibility.ts` 的 `judgeCitation`，
 * 逐字同一条规则（contracts/interview I-30 自己写着「artifact 束 I-14 是同一条」）。
 * 在这里重写一个 `versionIsPinned` 会是这条规则的第四份声明。
 *
 * ## ⚠ 已知不可求值：`STEP_CLOSED_OR_ARCHIVED`
 *
 * 契约把它列在 `err` 里，本仓**求不出来**：没有 `steps` 表，`agenda_segment_id` 因此没有外键
 * （0008 为 `artifact_bindings` 记过同一件事，phase-00 起就没有）。
 * 造一个「永远说 open」的查表来假装覆盖比没有这道检查更糟 —— 它读起来像覆盖。
 * 故：报告，不伪造。
 */
import { judgeCitation } from "../../domain/artifact/downstream-eligibility";
import type { OrgId } from "../../domain/org-id";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { OrgRole } from "../../domain/identity/roles";
import type { DecisionIdFactory } from "../identity/ports";
import type { IdFactory } from "../artifact/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError, RequiresPinnedError } from "./errors";
import type { InterviewScopeRepository } from "./ports";
import type { AttachmentRecord, InterviewAttachmentRepository } from "./attachment-ports";

export interface AttachDeps {
  readonly repo: InterviewScopeRepository;
  readonly attachments: InterviewAttachmentRepository;
  readonly provenance: ProvenanceWriter;
  readonly decisions: DecisionIdFactory;
  readonly ids: IdFactory;
}

export interface AttachInputDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly interviewId: string;
  readonly projectId: string;
  readonly agendaSegmentId: string;
  readonly pinnedVersionId: string;
}

/** 契约的 `attachToProjectStep.out`。快照的哈希/版号**不在契约里**，只进审计。 */
export interface AttachResult {
  readonly attachmentId: string;
  readonly interviewId: string;
  readonly projectId: string;
  readonly agendaSegmentId: string;
  readonly pinnedVersionId: string;
}

export async function attachToProjectStep(
  deps: AttachDeps,
  input: AttachInputDto,
): Promise<AttachResult> {
  /**
   * 读权先判，且走的是 F80 的同一条路径（SQL 过滤 + 进程内第二次判定）。
   *
   * 不可见 ⇒ `NO_INTERVIEW_ACCESS`，与「不存在」同一个答案：一个「无权时说无权、
   * 不存在时说不存在」的写接口，是一个比读接口更好用的 id 枚举器。
   */
  const found = await deps.repo.findVisibleById(input.orgId, input.actorId, input.interviewId);
  if (found === null) throw new NoInterviewAccessError(input.interviewId);

  const [projectIds, membership] = await Promise.all([
    deps.repo.projectIdsOf(input.orgId, input.actorId),
    deps.repo.orgMembershipOf(input.orgId, input.actorId),
  ]);
  const disclosed = discloseDecided(
    found.item,
    decideInterviewVisibility({
      decisionId: deps.decisions.next(),
      interview: found.facts,
      viewer: { userId: input.actorId, projectIds },
      orgRole: membership.orgRole as OrgRole | null,
      viewerTeamId: membership.teamId,
    }),
  );
  if (!isDisclosed(disclosed)) throw new NoInterviewAccessError(input.interviewId);

  /**
   * 写权：`pre` 是「调用者对该项目该环节有写权限」。本仓能求值的那一半是**项目成员身份**
   * （环节级写权没有对象可判 —— 没有 steps 表，见文件头）。
   *
   * 不是成员 ⇒ 与不可见同一个答案。「你能看见这场访谈，但你不是那个项目的人」
   * 若给出一个可分辨的响应，就把「哪些项目存在」变成可枚举的 —— uc-6-0/E3 的同一个探测面。
   */
  if (!projectIds.includes(input.projectId)) {
    throw new NoInterviewAccessError(input.interviewId);
  }

  const anchors = await deps.attachments.anchorsFor(input.orgId, input.pinnedVersionId);
  if (!judgeCitation(input.pinnedVersionId, anchors).eligible) {
    throw new RequiresPinnedError(input.pinnedVersionId);
  }

  const written = await deps.attachments.attach({
    orgId: input.orgId,
    attachmentId: deps.ids.next("itvatt"),
    interviewId: input.interviewId,
    projectId: input.projectId,
    agendaSegmentId: input.agendaSegmentId,
    pinnedVersionId: input.pinnedVersionId,
    attachedBy: input.actorId,
  });

  /**
   * 回执也要过一次判定。
   *
   * 看起来多余 —— 刚判过。但判定的输入在这中间**变了**：0030 的派生触发器把
   * `interview_sessions.project_id` 换成了这个项目。所以这一次判定是对**写入之后的世界**
   * 做的，而回执正是写入之后的世界的内容。一个「写完就直接把入参回显」的实现，
   * 在派生把访谈挂到了一个调用方并不属于的项目时，仍然会把回执发出去。
   */
  const receipt = discloseDecided(
    written.item,
    decideInterviewVisibility({
      decisionId: deps.decisions.next(),
      interview: written.facts,
      viewer: { userId: input.actorId, projectIds },
      orgRole: membership.orgRole as OrgRole | null,
      viewerTeamId: membership.teamId,
    }),
  );
  if (!isDisclosed(receipt)) throw new NoInterviewAccessError(input.interviewId);
  const row: AttachmentRecord = receipt.payload;

  /**
   * 审计（V9）。写失败 ⇒ 整个请求失败，与 `getInterview` 同一立场：
   * 「尽力而为的审计」意味着日志完整到出事的那一刻为止，而那一刻正是它有用的时候。
   *
   * ⚠ `target.kind` 取 `project` 而不是 `interview`：`provenance.ProvenanceEvent.target.kind`
   * 是封闭枚举 `artifact | artifact-version | capability | membership | project | organization`，
   * **没有 `interview` 成员**（0005 的 CHECK 是同一份枚举的第二次表达）。
   * 后果是具体的：`queryProvenance` 只能按 target 过滤，所以「这一场访谈被谁挂过/探过」
   * 查不出来，只能查「这个项目上发生过哪些挂载」。这是 F80 报告过的同一个缺口
   * （design-coherence 的 XC-10），补法是给 phase-00 的契约枚举与 0005 的 CHECK 各加一个成员 ——
   * 那是跨束契约改动，属已签核的 phase-00 契约，**报告而不是顺手改**。
   *
   * `contentHash` 进明细：它是「这个环节引用的是当时那一份」唯一可事后核验的东西。
   */
  await deps.provenance.append({
    orgId: input.orgId,
    type: "bound",
    actorId: input.actorId,
    target: { kind: "project", id: input.projectId },
    detail: {
      action: "attachToProjectStep",
      interviewId: row.interviewId,
      attachmentId: row.attachmentId,
      agendaSegmentId: row.agendaSegmentId,
      pinnedVersionId: row.pinnedVersionId,
      pinnedVersionNumber: row.pinnedVersionNumber,
      pinnedContentHash: row.pinnedContentHash,
    },
  });

  return {
    attachmentId: row.attachmentId,
    interviewId: row.interviewId,
    projectId: row.projectId,
    agendaSegmentId: row.agendaSegmentId,
    pinnedVersionId: row.pinnedVersionId,
  };
}
