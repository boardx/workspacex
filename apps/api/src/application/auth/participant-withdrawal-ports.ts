/**
 * `ParticipantWithdrawalRepository` —— F14（UC-1.2 R7）的持久化端口。
 *
 * ## 为什么「登记撤回」是一个方法而不是「查一下再插一条」
 *
 * 契约 `WithdrawParticipantPhone` 的幂等重放：「已在队列中返回同一单据，不重复排队」。
 * 拆成 `find` + `create` 两步，调用方就会写成先查后插，而受访者本人与引导师同时对
 * 同一 `participantId` 发起撤回时，两路都查到「没有」、两路都插入成功——出两张单据、
 * 两个不同的 deadline，`queuedAt` 也不再是唯一的。⇒ 与 0025 `IssueInviteLink` 同一条
 * 纪律：幂等是**一次写**的性质，交给数据库的唯一索引（迁移
 * `20260731165140_f14_interviewee_phone_withdrawal.sql`）+ `ON CONFLICT`。
 *
 * ## 为什么退出检索范围（I-34 ②）不是这个端口的方法
 *
 * 「退出检索」落在 F12 的读路径（`JoinRepository.joinByGroupLink` 的名单核对查询）
 * 上加一条 `AND withdrawn_at IS NULL`——检索范围本来就是别的用例在读的地方，
 * 不是这个端口自己拥有的查询。这里只负责在同一事务里把 `withdrawn_at` 写上，
 * 触发点在 `register()` 内部，见 `pg-invite-link-repository.ts` 的实现。
 */
import type { OrgId } from "../../domain/org-id";

export interface RegisterWithdrawalInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly participantId: string;
  readonly requestedBy: "data-subject" | "facilitator";
  readonly queuedAt: Date;
  readonly logicalRetireDeadline: Date;
  readonly physicalDeleteDeadline: Date;
}

export interface WithdrawalTicket {
  readonly queuedAt: Date;
  readonly logicalRetireDeadline: Date;
  readonly physicalDeleteDeadline: Date;
  /** 本次调用是否新建了单据；false = 命中既有单据（幂等重放）。 */
  readonly created: boolean;
  readonly requestedBy: "data-subject" | "facilitator";
}

export type RegisterWithdrawalResult =
  | { readonly kind: "ok"; readonly ticket: WithdrawalTicket }
  /** 该 `participantId` 在本项目名单里不存在——见 `withdraw-participant-phone.ts` 的映射理由。 */
  | { readonly kind: "not-found" }
  /**
   * 已有一张在途单据，且 `requestedBy` 与本次不同——不是同一次重放，是两个不同来源
   * 对同一目标的冲突声明（例如受访者本人已发起，引导师这次又代发起一次）。
   * 与 `revokeInviteLinks` 撤回态不同：这里没有「谁先谁赢」的裁决，只报告冲突。
   */
  | { readonly kind: "conflict" };

export interface ParticipantWithdrawalRepository {
  register(input: RegisterWithdrawalInput): Promise<RegisterWithdrawalResult>;
}

export const PARTICIPANT_WITHDRAWAL_REPOSITORY = Symbol("ParticipantWithdrawalRepository");
