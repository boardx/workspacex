/**
 * `detachFromProjectStep` —— 解除挂载（uc-6-0 A3 / V4② / V9）。
 *
 * ## 契约的 `out` 里那个 `interviewStillExists: z.literal(true)` 不是装饰
 *
 * 它是 A3 的「产出仍在」被写进类型：一个把解除做成删除的实现，**编译不过**，
 * 因为它没有一场访谈可以拿来说「还在」。所以这里真的去读了一次那场访谈 ——
 * 返回一个字面量 `true` 而不去看，才是把断言写成了摆设。
 *
 * ## 解除不是删除
 *
 * 数据库那侧：0030 的 `undeletable` 触发器拒绝 DELETE，运行时角色也没有 DELETE 权限。
 * 这一侧：`detach` 打 `detached_at`，行还在，于是「谁在什么时候把它摘下来的」可回查。
 *
 * 解除后 `interview_sessions.project_id` 由 0030 的派生触发器算回 NULL（没有别的活挂载时），
 * 于是它重新只对创建者与显式协作者可见 —— 仍然是 F80 那一条谓词在算，本文件不判可见性。
 */
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import type { OrgRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError } from "./errors";
import type { InterviewScopeRepository } from "./ports";
import type { AttachmentRecord, GuardedAttachment, InterviewAttachmentRepository } from "./attachment-ports";

export interface DetachDeps {
  readonly repo: InterviewScopeRepository;
  readonly attachments: InterviewAttachmentRepository;
  readonly provenance: ProvenanceWriter;
  readonly decisions: DecisionIdFactory;
}

export interface DetachInputDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly attachmentId: string;
}

export interface DetachResult {
  readonly attachmentId: string;
  readonly detachedAt: string;
  readonly interviewStillExists: true;
}

export async function detachFromProjectStep(
  deps: DetachDeps,
  input: DetachInputDto,
): Promise<DetachResult> {
  /**
   * 能不能解除，取决于能不能读它挂的那场访谈 —— 与 F80 逐字同一条判定
   * （`decideInterviewVisibility`）。单独判一次「你是不是挂它的那个人」会引入第二套准入规则；
   * A3 也没有把解除限制给挂载者本人。
   */
  const projectIds = await deps.repo.projectIdsOf(input.orgId, input.actorId);
  const membership = await deps.repo.orgMembershipOf(input.orgId, input.actorId);
  const open = (
    g: GuardedAttachment | null,
    facts: GuardedAttachment["facts"] | null = null,
  ): AttachmentRecord | null => {
    if (g === null) return null;
    const r = discloseDecided(
      g.item,
      decideInterviewVisibility({
        decisionId: deps.decisions.next(),
        interview: facts ?? g.facts,
        viewer: { userId: input.actorId, projectIds },
        orgRole: membership.orgRole as OrgRole | null,
        viewerTeamId: membership.teamId,
      }),
    );
    return isDisclosed(r) ? r.payload : null;
  };

  const before = await deps.attachments.find(input.orgId, input.actorId, input.attachmentId);
  const existing = open(before);
  // 不存在、别的租户的、无权的、以及已经解除过的，一律同一个答案。
  if (before === null || existing === null || existing.detachedAt !== null) {
    throw new NoInterviewAccessError(input.attachmentId);
  }

  /**
   * ⚠ 回执按**解除之前**的事实判定，这不是偷懒。
   *
   * 解除本身会改变判定的输入：0030 的派生触发器把 `project_id` 算回 NULL，
   * 于是一个「只因为这场访谈挂在我项目上才看得见它」的项目成员，在他自己按下解除的那一瞬间
   * 就失去了可见性。按解除之后的事实判回执，他会拿到一个 404 —— 而动作**已经做了**。
   * 那是一个「成功了但告诉你失败」的响应，比任何越权都更容易让人重试到出问题。
   *
   * 他有权做这个动作（做之前判过），所以他有权拿到这个动作的回执。
   * 判定输入取 `before.facts`，即那次授权所依据的同一组事实。
   */
  const detached = open(
    await deps.attachments.detach(input.orgId, input.actorId, input.attachmentId),
    before.facts,
  );
  if (detached === null || detached.detachedAt === null) {
    throw new NoInterviewAccessError(input.attachmentId);
  }

  /**
   * 「产出仍在」不是一个常量 `true`，是**读出来的**。
   *
   * `detached` 这一行是经 `INTERVIEW_JOIN`（内连 `interview_sessions`）取回来的，
   * 所以它存在这件事同时证明了两件事：
   *   ① 挂载行还在 —— 解除是打标记不是删行（留痕）；
   *   ② 那场访谈还在 —— 若访谈被删，级联会把挂载行一起带走，这次回查就取不到行了。
   * 一个把解除做成 DELETE 的实现，走不到这一句。
   */

  // 审计（V9）。target.kind 取 `project` 的理由与 attach 相同（封闭枚举没有 `interview`）。
  await deps.provenance.append({
    orgId: input.orgId,
    type: "unbound",
    actorId: input.actorId,
    target: { kind: "project", id: detached.projectId },
    detail: {
      action: "detachFromProjectStep",
      interviewId: detached.interviewId,
      attachmentId: detached.attachmentId,
      agendaSegmentId: detached.agendaSegmentId,
      // 记下被松开的是哪一份快照 —— 「这个环节曾经引用过什么」在解除之后仍然要答得出来。
      pinnedVersionId: detached.pinnedVersionId,
      pinnedContentHash: detached.pinnedContentHash,
    },
  });

  return {
    attachmentId: detached.attachmentId,
    detachedAt: detached.detachedAt,
    interviewStillExists: true,
  };
}
