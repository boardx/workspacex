/**
 * `withdrawParticipantPhone` —— F14（UC-1.2 R7）：受访者/参与者手机号纳入撤回与删除范围。
 *
 * ## D-13 最小切片：这个用例只做「触发」，不做「执行」
 *
 * 契约语义（I-34）列了四件事：① 入队 ② ≤5 分钟退出检索 ③ 报告段落标失效
 * ④ ≤30 天物理删除并出回执。本用例只负责 ①②的**触发**——② 是同一事务内把
 * `project_participants.withdrawn_at` 写上，让 F12 的名单核对查询立即读不到这一行
 * （见 `pg-invite-link-repository.ts` 的 `joinByGroupLink`）。③④ 的实际级联执行
 * 属 22-files（T86）与 17-gov（UC-17.2），本用例不实现、也不假装实现——`affectedReportSegments`
 * 如实返回空集，见下方返回值注释。
 *
 * ## 幂等重放 vs 冲突：两种「已经有一张单据」
 *
 * usecases.md 逐字「幂等重放：已在队列中返回同一单据，不重复排队」，但 `err` 数组同时
 * 列着 `WITHDRAWAL_IN_PROGRESS`（跨用例共享码，domain.md/usecases.md 定义为「目标处于
 * 撤回/待删除队列中，不得被新引用」）。这两句话看似矛盾，本实现的读法是：
 *   - 同一 `requestedBy` 重复调用 ⇒ **是**同一次意图的重放 ⇒ 返回同一张单据，不报错；
 *   - 不同 `requestedBy` 对同一 `participantId` 各发起一次 ⇒ **不是**重放，是两个不同
 *     来源对同一目标的冲突声明（例如受访者本人已撤回，引导师这次又代发起） ⇒
 *     `WITHDRAWAL_IN_PROGRESS`。
 * 这条界线没有专门裁决可引，是从「幂等」这个词本身的含义（同一请求重放）反推的——
 * 与「不同请求恰好撞同一目标」区分开，写在这里以便下一个人看到这条线在哪。
 *
 * ## 为什么没有 `NOT_FOUND` 码
 *
 * 契约的 `err` 只有 `WITHDRAWAL_IN_PROGRESS | NO_PROJECT_ROLE | AUTH_SERVICE_UNAVAILABLE`，
 * 没有专门的「找不到」。与 `domain/auth/org-lifecycle.ts` 对 `NO_PROJECT_ROLE` 的处置
 * 同一条理由（「`NO_PROJECT_ROLE` 与『没有这个项目』用的是同一条理由」）：`participantId`
 * 在本项目名单里不存在，等同于「这个人在本项目没有身份」，复用 `NO_PROJECT_ROLE`，
 * 不新造一个会泄露「id 存在与否」的探测面。
 */
import { WITHDRAWAL_SLA_MS } from "@repo/contracts/org-admin";
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { ParticipantWithdrawalRepository } from "./participant-withdrawal-ports";

export interface WithdrawParticipantPhoneDeps {
  readonly repo: ParticipantWithdrawalRepository;
}

export interface WithdrawParticipantPhoneInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly participantId: string;
  readonly requestedBy: "data-subject" | "facilitator";
  /** 契约层已用 `z.literal(true)` 挡掉 `false`；这里再断言一次是防御，不是重复校验业务规则。 */
  readonly ackImpact: true;
  readonly now: Date;
}

export interface ReportSegmentRef {
  readonly kind: string;
  readonly id: string;
}

export interface WithdrawParticipantPhoneOutput {
  readonly queuedAt: string;
  readonly logicalRetireDeadline: string;
  readonly physicalDeleteDeadline: string;
  /**
   * ⚠ 如实返回空集，不是「还没查」。定位「引用过这个人的报告段落」是级联引擎（T86）
   *   的职责——本切片没有落一张「participant → report segment」的引用表，
   *   假装从别处拼出一个非空结果会比诚实的空集更具欺骗性（看起来像是级联已经跑过）。
   *   见文件头「D-13 最小切片」一节与 `contracts/org-admin/domain.md` 的分工说明。
   */
  readonly affectedReportSegments: readonly ReportSegmentRef[];
}

export async function withdrawParticipantPhone(
  deps: WithdrawParticipantPhoneDeps,
  input: WithdrawParticipantPhoneInput,
): Promise<WithdrawParticipantPhoneOutput> {
  if (input.ackImpact !== true) {
    // 契约 schema 已经不允许构造出 false；这里只是不信任调用方绕过类型系统直接调用。
    throw new OrgAdminError("NO_PROJECT_ROLE");
  }

  const queuedAt = input.now;
  const logicalRetireDeadline = new Date(queuedAt.getTime() + WITHDRAWAL_SLA_MS.logicalRetire);
  const physicalDeleteDeadline = new Date(queuedAt.getTime() + WITHDRAWAL_SLA_MS.physicalDelete);

  const result = await deps.repo.register({
    orgId: input.orgId,
    projectId: input.projectId,
    participantId: input.participantId,
    requestedBy: input.requestedBy,
    queuedAt,
    logicalRetireDeadline,
    physicalDeleteDeadline,
  });

  if (result.kind === "not-found") throw new OrgAdminError("NO_PROJECT_ROLE");
  if (result.kind === "conflict") throw new OrgAdminError("WITHDRAWAL_IN_PROGRESS");

  const { ticket } = result;
  return {
    queuedAt: ticket.queuedAt.toISOString(),
    logicalRetireDeadline: ticket.logicalRetireDeadline.toISOString(),
    physicalDeleteDeadline: ticket.physicalDeleteDeadline.toISOString(),
    affectedReportSegments: [],
  };
}
