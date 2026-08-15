/**
 * FB-2 —— 反馈用例与外界之间的端口。
 *
 * ⚠ **仓储是按组织构造的（`forOrg`）**，与 `MESSAGE_RATING_REPOSITORY` /
 *   `THREAD_MOUNT_STORE` 同一形状、同一理由：`submitFeedback.in` 里没有 `orgId`
 *   （它从 principal 来），所以一个「没有绑定租户的反馈仓储」是一个能把反馈
 *   写进别人组织的东西。让它在**类型上就构造不出来**，比在每个方法里多传一个
 *   orgId 参数可靠——后者只要有一处忘了传就是一个洞。
 */
import type { Guarded } from "../security/permission-filter";
import type { FeedbackStatus } from "../../domain/feedback/product-feedback";

export const PRODUCT_FEEDBACK_REPOSITORY = Symbol("ProductFeedbackRepository");

/** 与契约 `FeedbackTarget` 同构。⚠ 判别联合，不是「kind + 可空 id」——见契约里的理由。 */
export type FeedbackTarget =
  | { readonly kind: "product" }
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "skill"; readonly skillId: string };

export interface NewFeedback {
  readonly id: string;
  readonly submittedBy: string;
  readonly kind: "缺陷" | "需求";
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
  readonly kind: "缺陷" | "需求";
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
}

/** 读取口径。与契约 `FeedbackScope` 同构。 */
export type FeedbackScope =
  | { readonly kind: "mine" }
  | { readonly kind: "org" }
  | { readonly kind: "target"; readonly target: FeedbackTarget };

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
  /** ⚠ 一次查询派生全部五个数。见契约 `getFeedbackCounts` 的理由。 */
  counts(): Promise<FeedbackCounts>;
}

export interface ProductFeedbackRepositoryFactory {
  forOrg(orgId: string): ProductFeedbackRepository;
}
