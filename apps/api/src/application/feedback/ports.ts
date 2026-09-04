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
/** UC-17.8 D1：结构化补充字段，形状只在契约里声明一次。 */
export type FeedbackStructured = z.infer<typeof feedbackLoop.FeedbackStructured>;

export interface NewFeedback {
  readonly id: string;
  readonly submittedBy: string;
  readonly kind: FeedbackKind;
  readonly target: FeedbackTarget;
  readonly targetLabel: string | null;
  readonly title: string;
  readonly detail: string;
  /** UC-17.8 D1：可不带（`null`）。落 `product_feedback.structured`，只在 INSERT 写。 */
  readonly structured: FeedbackStructured | null;
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
  /**
   * UC-17.8 D1：与 `detail` 同一条 D3 门控——它是正文的补充，不是标题/票数那类恒可见的
   * 展示性上下文。同样包成 `Guarded`，让「判了 detail 忘了判 structured」在类型上写不出来。
   */
  readonly structured: Guarded<FeedbackStructured | null>;
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
  /**
   * 这次转移是否真的把状态变更邮件发出去了（best-effort，见
   * `triage-feedback.ts` 的 `notifySubmitter`）。`emailSubject`/`emailText` 是
   * 发出那一刻的快照——`notified === false` 时两者恒为 `null`（没发,自然没有
   * 发了什么可存）。迁移 `20260902110613` 补的三列，理由见该文件头注。
   */
  readonly notified: boolean;
  readonly emailSubject: string | null;
  readonly emailText: string | null;
}

/**
 * `listStatusEvents` 读回来的一行——比写入用的 `StatusEvent` 多一个 `createdAt`
 * （写入不需要它,DB 默认 `now()`；读历史列表必须知道"这一步是什么时候发生的"）。
 */
export interface StatusEventRow extends StatusEvent {
  readonly createdAt: string;
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
   * **同一个数据库事务**里做两件事:改状态 + 落一行"这次转移发生过"的流水
   * (`notified: false`,`emailSubject`/`emailText` 为 `null`——这一步还没发邮件,
   * 见 `triageFeedback` 调用点)。2026-09-02 独立审查 P0 指出:分开调
   * `updateStatus` + `appendStatusEvent` 两次 `withTenant`(两个独立事务)时,
   * 前者成功、后者失败会让状态变了但一行历史都没有——**这条历史事实本身**
   * 永久缺失,不是"缺一部分细节"。这个方法把这两步收进同一次 `withTenant`,
   * 该事实要么两者一起提交、要么一起回滚,不再有中间态。
   *
   * ⚠ 不管**是否真的发出了通知邮件**——那一步(`notifySubmitter`)必须在状态
   *   已经落库**之后**才发生(不能在状态生效前就告诉用户"变了"),因此天然不能
   *   进这同一个事务。见 `markStatusEventNotified` 处理那一半。
   */
  transitionStatusWithEvent(
    feedbackId: string,
    status: FeedbackStatus,
    reason: string | null,
    event: Pick<StatusEvent, "id" | "feedbackId" | "fromStatus" | "toStatus" | "reason" | "actorId">,
  ): Promise<void>;
  /**
   * `transitionStatusWithEvent` 落库之后,尝试发邮件的结果回填进**那一行已经
   * 存在的**流水——不是新插入一行。调用方(`triageFeedback`)把它包在
   * try/catch 里当 best-effort:这一步失败时,上面那行"转移发生过"的历史记录
   * 依然在(只是 `notified` 保守地停在插入时的 `false`),不是整条历史消失。
   * 见 issue #2510(与②③同类限制收敛成统一 outbox 的后续)。
   *
   * ⚠ 只能对同一行调**一次**——第二次调用会被数据库触发器拒绝(`false→false`
   *   那条路径也算"回填过"了,不能被"notified 还是 false 所以再回填一次也无妨"
   *   悄悄绕过,见迁移 `20260902140000_fb2_feedback_status_event_notify_settle
   *   _once` 头注)。`notified: false` 时**必须**传 `null`/`null`——数据库同样
   *   强制这条不变量,不只是信任调用方守规矩。
   */
  markStatusEventNotified(
    eventId: string,
    notified: boolean,
    emailSubject: string | null,
    emailText: string | null,
  ): Promise<void>;
  /**
   * 同 `transitionStatusWithEvent`，但多一个前提：**只在这一刻的 `status` 仍然是
   * `expectedStatus` 时才生效**，且这个前提是同一条 `UPDATE` 语句的 `WHERE` 子句，
   * 不是"先 `SELECT` 读一次、再决定要不要 `UPDATE`"两步——两步之间永远有一个窗口，
   * 另一个事务可能已经把状态改成了别的东西。
   *
   * ⚠ **2026-09-03（PR #2580 独立复核阻断项②）**：`reconcile-closed-github-issues.ts`
   *   最初就是"先 `findById` 读一次当前状态、算出要转到哪、再调
   *   `transitionStatusWithEvent`（无条件 `UPDATE`）"——管理员完全可能在这两步之间
   *   手动把这条反馈改判成「不做」，poller 的这次 `UPDATE` 会**原样覆盖掉那次更晚
   *   发生的人工判断**，还照常写一行 `from_status` 与当前值不符的历史（因为事件行
   *   的 `fromStatus` 用的是 poller 那次读到的旧快照，不是数据库这一刻真正的
   *   `from_status`）。这个方法把"当前状态必须是 X"钉进 `UPDATE ... WHERE
   *   status = $expectedStatus`本身，`RETURNING id` 是空集就说明这一刻状态已经
   *   不是调用方以为的那个，直接返回 `false`——不落库、不写事件，调用方据此放弃
   *   这次转移（不能拿同一个 `expectedStatus` 重试，那只是把窗口往后挪）。
   *
   * ⚠ 只有 `triageFeedback`（人类分诊，单次 HTTP 请求内完成"读→判→写"，管理员看到
   *   的是自己刚点的那次操作）继续用不带前提的 `transitionStatusWithEvent`——那条
   *   路径的"读"与"写"之间没有一个需要跨请求容忍的窗口。这个方法专给后台批量对账
   *   这种"读到的快照与真正写入之间隔着一次 GitHub API 调用"的场景。
   */
  transitionStatusWithEventIfCurrentStatus(
    feedbackId: string,
    expectedStatus: FeedbackStatus,
    status: FeedbackStatus,
    reason: string | null,
    event: Pick<StatusEvent, "id" | "feedbackId" | "fromStatus" | "toStatus" | "reason" | "actorId">,
  ): Promise<boolean>;
  /**
   * 这条反馈的完整状态流水，最旧的在前（管理员在 detail 弹层里从上往下读"发生了
   * 什么"）。⚠ 不做租户外可见性判断——调用方（`list-feedback-events.ts`）已经
   * 先 `findById` 确认过这条反馈在当前租户里存在,这里只是单纯按 `feedback_id`
   * 取,与 `appendStatusEvent` 写入时的仓储天然绑租户（`forOrg`）同一份信任边界。
   */
  listStatusEvents(feedbackId: string): Promise<readonly StatusEventRow[]>;
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
