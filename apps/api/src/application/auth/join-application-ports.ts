/**
 * `JoinApplicationRepository` —— F13 意外②的持久化端口
 * （UC-1.2 R4 / contracts/org-admin `ApplyForJoin` `ReviewJoinApplication`）。
 *
 * ⚠ **契约 `applyForJoin.err` 与 `usecases.md` 对 `JOIN_PENDING_APPROVAL` 的描述互相矛盾**，
 *   本实现不替它们选边（矛盾不选边，见 AGENTS.md）：
 *     · `usecases.md` 逐字「重复申请返回既有单据（幂等）」——即**成功**返回既有 applicationId。
 *     · `packages/contracts/src/org-admin.ts` 的 `applyForJoin.err` 里却列着
 *       `JOIN_PENDING_APPROVAL`，暗示它是一个**错误**。
 *   本实现照 `usecases.md` 的字面描述走（幂等 ⇒ `out`，不 `throw`）——因为这正是
 *   F13 `tests/auth/join-apply-pending-approval.test.ts` 要断言的用户可见行为
 *   （重复点「向引导师申请加入」不应该报错）。`OrgAdminError("JOIN_PENDING_APPROVAL")`
 *   仍在 `apply-for-join.ts` 里保留一条注释登记这个矛盾，供以后裁决，
 *   而不是悄悄吞掉它、假装两份文档本来就一致。
 */
import type { OrgId } from "../../domain/org-id";

export interface ApplyForJoinAttempt {
  readonly token: string;
  /** 已规范化（`upsertParticipantRoster` 用的同一个 `normalizePhone`）。 */
  readonly phone: string;
  /** 若本次需要新建申请单，仓储用这个 id；命中既有待批单据时**不用它**（返回既有 id）。 */
  readonly candidateApplicationId: string;
  readonly now: Date;
}

export interface JoinApplicationGrant {
  readonly applicationId: string;
  readonly status: "pending";
  /** true = 命中既有待批单据，本次未新建（幂等重放）。 */
  readonly reusedApplication: boolean;
}

export type ApplyForJoinOutcome =
  | { readonly ok: true; readonly grant: JoinApplicationGrant }
  /** 与 `JoinByGroupLink` 同一套链接失效分类（复用同一份 `linkUsability` 判定）。 */
  | { readonly ok: false; readonly reason: "not-found" | "revoked" | "expired" | "used" };

export interface ReviewJoinApplicationAttempt {
  readonly orgId: OrgId;
  readonly applicationId: string;
  readonly actorId: string;
  readonly decision: "approve" | "reject";
  /** `decision = "approve"` 时必填；仓储对 `reject` 忽略此字段。 */
  readonly groupId: string | null;
  /** 批准时若需要新建名单条目，仓储用这个 id。 */
  readonly candidateParticipantId: string;
  readonly now: Date;
}

export interface ReviewJoinApplicationGrant {
  readonly applicationId: string;
  readonly status: "approved" | "rejected";
}

export type ReviewJoinApplicationOutcome =
  | { readonly ok: true; readonly grant: ReviewJoinApplicationGrant }
  | { readonly ok: false; readonly reason: "not-found" | "already-reviewed" };

export interface JoinApplicationRepository {
  /** 申请侧：定位令牌 → 判是否可用 → 幂等 upsert 待批单据。不碰 `project_participants`。 */
  apply(input: ApplyForJoinAttempt): Promise<ApplyForJoinOutcome>;
  /**
   * 审批侧：批准 = 同一事务内「写名单 + 指定组号 + 标记单据 approved」；
   * 拒绝 = 只标记单据 rejected。条件 UPDATE（`WHERE status = 'pending'`）防两名引导师并发处理同一单。
   */
  review(input: ReviewJoinApplicationAttempt): Promise<ReviewJoinApplicationOutcome>;
}

export const JOIN_APPLICATION_REPOSITORY = Symbol("JoinApplicationRepository");
