/**
 * FB-2 —— 反馈用例与外界之间的端口。
 *
 * ⚠ **仓储是按组织构造的（`forOrg`）**，与 `MESSAGE_RATING_REPOSITORY` /
 *   `THREAD_MOUNT_STORE` 同一形状、同一理由：`submitFeedback.in` 里没有 `orgId`
 *   （它从 principal 来），所以一个「没有绑定租户的反馈仓储」是一个能把反馈
 *   写进别人组织的东西。让它在**类型上就构造不出来**，比在每个方法里多传一个
 *   orgId 参数可靠——后者只要有一处忘了传就是一个洞。
 */
import { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";
import type { Guarded } from "../security/permission-filter";
import type { FeedbackStatus } from "../../domain/feedback/product-feedback";

export const PRODUCT_FEEDBACK_REPOSITORY = Symbol("ProductFeedbackRepository");

/**
 * ⚠ **从契约派生**（ADR-020）。判别联合的三种目标只在
 * `packages/contracts/src/feedback-loop.ts` 里写过一遍——在这里再写一遍，
 * 契约加第四种目标时这里不会有任何东西报。
 */
export type FeedbackTarget = z.infer<typeof feedbackLoop.FeedbackTarget>;
export type FeedbackKind = z.infer<typeof feedbackLoop.FeedbackKind>;

export interface NewFeedback {
  readonly id: string;
  readonly submittedBy: string;
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly targetLabel: string | null;
  readonly title: string;
  readonly detail: string;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
}

/**
 * 一行反馈，**正文被 `Guarded` 包着**。
 *
 * ⚠ 这不是装饰：`Guarded<string>` 的载荷在 `permission-filter` 之外**取不出来**
 *   （WeakMap 是模块私有的）。所以「忘了判 D3 就把正文投影出去」不是一个要靠
 *   代码评审发现的疏忽，而是一个编译不过的东西——`row.detail` 的类型不是 `string`。
 *
 * ⚠ 其余字段**没有**包：标题与票数按 D3 就是全组织可见的。把它们也包起来会让
 *   `discloseDecided` 在每一行上被调用两次、拿着两个不同的判定，
 *   而其中一个判定恒为 allow——一道恒真的门读起来像门，实际不是。
 */
export interface FeedbackRow {
  readonly id: string;
  readonly submittedBy: string;
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly targetLabel: string | null;
  readonly title: string;
  readonly detail: Guarded<string>;
  readonly status: FeedbackStatus;
  readonly statusReason: string | null;
  readonly votes: number;
  readonly votedByMe: boolean;
  readonly occurredRoute: string | null;
  readonly appVersion: string | null;
  readonly createdAt: string;
  /** "转开发"建过 issue 之后回填的两列。见迁移 `20260830120000_fb2_feedback_github_issue.sql`。 */
  readonly githubIssueUrl: string | null;
  readonly githubIssueNumber: number | null;
}

/** 读取口径。⚠ 同样从契约派生，不重列。 */
export type FeedbackScope = z.infer<typeof feedbackLoop.FeedbackScope>;

export interface StatusEvent {
  readonly id: string;
  readonly feedbackId: string;
  /** null = 创建。见迁移里 `from_status` 可空的理由 */
  readonly fromStatus: FeedbackStatus | null;
  readonly toStatus: FeedbackStatus;
  readonly reason: string | null;
  readonly actorId: string;
}

export interface FeedbackCounts {
  readonly total: number;
  readonly 待处理: number;
  readonly 已进入迭代: number;
  readonly 已修复: number;
  readonly 不做: number;
}

export interface ProductFeedbackRepository {
  insert(record: NewFeedback): Promise<void>;
  /**
   * ⚠ `viewerId` 是必参而不是可选：`votedByMe` 没有「不知道」这个值。
   *   可选参数会让某个调用点忘了传，于是每一行的 `votedByMe` 都是 false，
   *   而界面显示的是「你还没投票」——一个看起来完全正常的错误答案。
   */
  list(scope: FeedbackScope, viewerId: string): Promise<readonly FeedbackRow[]>;
  findById(feedbackId: string, viewerId: string): Promise<FeedbackRow | null>;
  /**
   * 投票 / 撤票，幂等。返回**重新数出来的**票数（I-F2：`COUNT(*)`，不是本地加一）。
   * ⚠ 返回值不是「加了没有」的布尔：调用方需要的是最终票数，
   *   而它自己算出来的票数在并发下是错的。
   */
  setVote(feedbackId: string, voterId: string, voted: boolean): Promise<{ readonly votes: number; readonly votedByMe: boolean }>;
  updateStatus(feedbackId: string, status: FeedbackStatus, reason: string | null): Promise<void>;
  appendStatusEvent(event: StatusEvent): Promise<void>;
  /**
   * "转开发"建完 GitHub issue 之后的一次回填。⚠ 只在 `triageFeedback` 用例内
   *   **确认这条反馈还没有 issue**（`githubIssueUrl === null`）时才会被调用一次——
   *   本方法自己不做"已存在就跳过"的判断,它信任调用方只在该建的时候才调它。
   *   把这条判断放进仓储会让"要不要建 issue"这条业务规则的一半长在基础设施层。
   *   ⚠ 顺带清空 `github_issue_claimed_at`——回填成功即释放认领,虽然此后
   *   `claimGithubIssueCreation` 的 `github_issue_url IS NULL` 条件已经会让它
   *   不可能被再次认领,清空只是不留一个再也不会被读到、但语义上"过期"的值。
   */
  setGithubIssue(feedbackId: string, issue: { readonly url: string; readonly number: number }): Promise<void>;
  /**
   * PR #2431 二轮独立审查阻断项①——建 GitHub issue 前先原子地"认领"这条反馈,
   * 把并发/崩溃的重复建 issue 收敛成数据库一行 UPDATE 的互斥,而不是三步分开的
   * 读-判断-写。见迁移 `20260831010000_fb2_feedback_github_issue_claim.sql` 头注
   * 的完整论证(含"解决了什么、没解决什么"的坦白)。
   *
   * 返回 `true` = 认领成功,调用方现在**独占**了"去建这条反馈的 issue"这件事,
   * 必须在建完(`setGithubIssue`)或放弃(`releaseGithubIssueClaim`)之前不再重试。
   * 返回 `false` = 认领失败——已经有 issue、或另一个尚未过期的认领正在进行中,
   * 调用方**不得**再调 GitHub。
   *
   * ⚠ "多旧算过期"由实现自己决定阈值(见 pg 实现),不是调用方传进来的参数——
   *   这是一条基础设施纪律(重试窗口多长),不是业务规则,业务层不该关心它。
   */
  claimGithubIssueCreation(feedbackId: string): Promise<boolean>;
  /**
   * 认领之后建 issue **失败**时释放认领,让下一次重试不必等到认领过期才能重试。
   * ⚠ 只清 `github_issue_claimed_at`,不动 `github_issue_url`——认领失败的语义
   *   是"这次没建成",不是"这条反馈发生了什么别的变化"。
   */
  releaseGithubIssueClaim(feedbackId: string): Promise<void>;
  /** ⚠ 一次查询派生全部五个数。见契约 `getFeedbackCounts` 的理由。 */
  counts(): Promise<FeedbackCounts>;
}

export interface ProductFeedbackRepositoryFactory {
  forOrg(orgId: string): ProductFeedbackRepository;
}
