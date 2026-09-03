/**
 * FB-2 补——定时对账用例：`FeedbackGithubIssuePollWorker` 每 2 分钟调一次。
 *
 * 把 `github-issue-poll-ports.ts` 头注的意图接成真正的状态转移：候选反馈逐条
 * 现查 GitHub issue 状态，关了就转对应的终态 + best-effort 通知提交人。
 *
 * ## 与 `triageFeedback` 共享、也刻意不同的几条纪律
 *
 *   · **同一事务**：改状态与写"这次转移发生过"的流水，走
 *     `transitionStatusWithEventIfCurrentStatus`——原因与 `triageFeedback` 头注④
 *     一致，这里不重复论证；这个方法额外把当前状态的前提也焊进同一条 `UPDATE`，
 *     见下面"为什么不是先读一次再写"。
 *   · **通知是 best-effort**：状态已经落库之后才发邮件，失败只记日志——同头注②。
 *   · **不同于 `triageFeedback`**：这里没有"先认领再建 issue"那一步（①）——本用例
 *     从不建 issue，只读现有的 `githubIssueNumber`；也没有"跟着状态同步 GitHub
 *     开关"那一步（③）——issue 本来就是在 GitHub 那边先关的，方向已经是反的，
 *     没有什么需要再同步回去。
 *   · **一条候选处理失败不拖垮整批**：`triageFeedback` 服务单次人类请求，失败
 *     直接抛给那一次 HTTP 调用；这里服务的是一次扫描一批反馈的后台 tick，
 *     一条反馈的 GitHub API 超时不该连累同一批里其余的反馈都同步不到。
 *
 * ## 为什么不是"先读一次当前状态，判完再写"（2026-09-03，PR #2580 独立复核阻断项②）
 *
 * 第一版是 `repo.findById` 读一次快照 → `triage()` 算出目标状态 → 再调
 * （无条件）`transitionStatusWithEvent` 写入。管理员完全可能在 `findById` 之后、
 * 写入之前，手动把这条反馈改判成别的状态（比如「不做」）——poller 的这次写入会
 * **原样覆盖掉那次更晚发生的人工判断**，还会写一行 `fromStatus` 与数据库里真实
 * 的前一个状态对不上的历史（`fromStatus` 用的是 poller 读到的旧快照，不是数据库
 * 这一刻真正的前一个值）。`findById` 与真正的写入之间隔着一次 GitHub API 调用
 * （`getStatus`），这个窗口不是理论上的。
 *
 * 修法：`repo.transitionStatusWithEventIfCurrentStatus` 把"当前状态必须仍是
 * `current.status`"这个前提焊进同一条 `UPDATE ... WHERE status = $expectedStatus`
 * ——不是两步先后，是一条语句。数据库这一刻的状态已经不是快照里那个时，
 * `RETURNING` 是空集，方法返回 `false`，`reconcileOne` 据此放弃这次转移、不发
 * 通知——不会用一次过期的快照覆盖掉更晚发生的人工判断，也不会写一行撒谎的历史。
 * `findById` 仍然用来做`triage()`需要的"这条转移合法吗"的判断（这一半只是决定
 * 要不要尝试，真正生效与否由那条 `UPDATE` 的 `WHERE` 说了算），不是安全性的来源。
 */
import { triage, type FeedbackStatus } from "../../domain/feedback/product-feedback";
import type { LoggerPort } from "../ports/logger.port";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import type { FeedbackSubmitterDirectory, GithubIssueCreator, GithubIssueStatus } from "./notification-ports";
import type { ProductFeedbackRepositoryFactory } from "./ports";
import type { FeedbackGithubIssueCandidate, FeedbackGithubIssueScanner } from "./github-issue-poll-ports";

/**
 * ⚠ `actor_id` 列是 `text NOT NULL`、无 FK（同人类管理员的 `userId` 一样,见迁移
 *   `20260815140000_fb2_product_feedback.sql`）——这里填一个不会与真实 userId
 *   撞上的固定字符串，让流水历史里能一眼看出"这次转移是自动对账做的，不是某个
 *   具体的人点的"，与人类分诊的行在语义上区分开,不需要为"系统身份"另建一张表。
 */
export const RECONCILE_ACTOR_ID = "system:github-issue-sync";

export interface ReconcileClosedGithubIssuesDeps {
  readonly scanner: FeedbackGithubIssueScanner;
  readonly repos: ProductFeedbackRepositoryFactory;
  readonly githubIssues: GithubIssueCreator;
  readonly submitterDirectory: FeedbackSubmitterDirectory;
  readonly mail: TransactionalMailTransport;
  readonly logger: LoggerPort;
  readonly newEventId: () => string;
}

export interface ReconcileClosedGithubIssuesResult {
  readonly scanned: number;
  readonly reconciled: number;
}

/**
 * GitHub 关闭态 → 反馈终态的映射。
 *
 * ⚠ **2026-09-03（PR #2580 独立复核阻断项③）**：第一版把"issue 已关闭"无条件当成
 *   "已修复"，忽略了 `stateReason` 能区分 `completed`（修好了）与 `not_planned`
 *   （不修了/不是 bug）——一个被判定"不做"而关闭的 issue 会被同步成"已修复"，
 *   还会给提交人发一封"已修复，请测试验收"的邮件，而实际上开发方从没打算修它。
 *   修法：`completed` → 已修复，`not_planned` → 不做（同 `triage-feedback.ts` 的
 *   `targetGithubIssueState` 反过来的映射：那边是"不做"关闭时打 `not_planned`）。
 *   `stateReason` 缺失（GitHub 允许不带 `state_reason` 关闭 issue，比如很旧的
 *   issue 或某些自动化路径）时**不猜测意图，保守跳过**——留给下一轮（可能那时
 *   已经有 stateReason 了）或人工判断，不是"默认当已修复"或"默认当不做"。
 */
function mapClosedIssueToFeedbackStatus(status: GithubIssueStatus): FeedbackStatus | null {
  if (status.stateReason === "completed") return "已修复";
  if (status.stateReason === "not_planned") return "不做";
  return null;
}

function closedIssueEmail(input: {
  readonly title: string;
  readonly issueNumber: number;
  readonly status: FeedbackStatus;
}): { readonly subject: string; readonly text: string } {
  if (input.status === "已修复") {
    return {
      subject: `你的反馈《${input.title}》已修复，请测试验收`,
      text: [
        `你提交的反馈《${input.title}》关联的 GitHub issue（#${input.issueNumber}）已经关闭，状态已自动更新为「已修复」。`,
        `请抽空测试验收一下——如果验证下来还是有问题，可以在反馈弹层里把状态改回「待处理」重新提出。`,
      ].join("\n"),
    };
  }
  return {
    subject: `你的反馈《${input.title}》状态已更新为「不做」`,
    text: [
      `你提交的反馈《${input.title}》关联的 GitHub issue（#${input.issueNumber}）已经关闭（标记为不做），状态已自动更新为「不做」。`,
      `如果你认为这不该被判定为不做，可以在反馈弹层里重新说明情况。`,
    ].join("\n"),
  };
}

export async function reconcileClosedGithubIssues(
  deps: ReconcileClosedGithubIssuesDeps,
): Promise<ReconcileClosedGithubIssuesResult> {
  const candidates = await deps.scanner.listOpenLinkedToGithubIssue();
  let reconciled = 0;
  for (const candidate of candidates) {
    try {
      if (await reconcileOne(deps, candidate)) reconciled += 1;
    } catch (e) {
      // ⚠ 一条候选失败(通常是 GitHub API 报错)不该让同一批里其余候选都同步不到——
      //   记日志、继续下一条，下一次 tick(2 分钟后)会重新把它捞出来再试一次,
      //   同 `triage-feedback.ts` 里"本地事实已落库、外部系统只是尽力同步"那类
      //   权衡是同一条纪律的另一种表现:这里连"本地事实"都还没发生,失败纯粹是
      //   "这一轮没同步成",下一轮自然重试,不需要专门的重试计数/退避。
      deps.logger.error("feedback github issue poll: reconcile one candidate failed", {
        traceId: "feedback-github-issue-poll",
        feedbackId: candidate.feedbackId,
        orgId: candidate.orgId,
        githubIssueNumber: candidate.githubIssueNumber,
        err: e,
      });
    }
  }
  return { scanned: candidates.length, reconciled };
}

async function reconcileOne(
  deps: ReconcileClosedGithubIssuesDeps,
  candidate: FeedbackGithubIssueCandidate,
): Promise<boolean> {
  const status = await deps.githubIssues.getStatus(candidate.githubIssueNumber);
  if (status.state !== "closed") return false;

  const nextStatus = mapClosedIssueToFeedbackStatus(status);
  if (nextStatus === null) {
    deps.logger.info("feedback github issue poll: closed issue has no recognizable stateReason, skipping", {
      traceId: "feedback-github-issue-poll",
      feedbackId: candidate.feedbackId,
      githubIssueNumber: candidate.githubIssueNumber,
    });
    return false;
  }

  const repo = deps.repos.forOrg(candidate.orgId);
  const current = await repo.findById(candidate.feedbackId, candidate.submittedBy);
  if (current === null) return false; // 反馈已经不在了(极端情况),没有什么可对账的

  const reason =
    nextStatus === "已修复"
      ? `GitHub issue #${candidate.githubIssueNumber} 已关闭（completed），自动同步为已修复`
      : `GitHub issue #${candidate.githubIssueNumber} 已关闭（not planned），自动同步为不做`;
  const outcome = triage({ current: current.status, next: nextStatus, reason });
  if (outcome.kind !== "changed") return false; // 幂等重放或不合法转移,都不再动

  const eventId = deps.newEventId();
  // ⚠ 前提(当前状态仍是 current.status)与写入是同一条 UPDATE——见文件头注
  //   "为什么不是先读一次再写"。false 说明这一刻的状态已经被别的地方(通常是
  //   人工分诊)改过,直接放弃,不落库、不发通知、不写一行撒谎的历史。
  const applied = await repo.transitionStatusWithEventIfCurrentStatus(candidate.feedbackId, current.status, outcome.to, outcome.reason, {
    id: eventId,
    feedbackId: candidate.feedbackId,
    fromStatus: outcome.from,
    toStatus: outcome.to,
    reason: outcome.reason,
    actorId: RECONCILE_ACTOR_ID,
  });
  if (!applied) {
    deps.logger.info("feedback github issue poll: status changed concurrently, skipping this candidate", {
      traceId: "feedback-github-issue-poll",
      feedbackId: candidate.feedbackId,
      expectedStatus: current.status,
    });
    return false;
  }

  const notification = await notifySubmitter(deps, candidate, outcome.to);
  try {
    await repo.markStatusEventNotified(eventId, notification.notified, notification.subject, notification.text);
  } catch (e) {
    deps.logger.error("feedback github issue poll: markStatusEventNotified failed", {
      traceId: "feedback-github-issue-poll",
      feedbackId: candidate.feedbackId,
      err: e,
    });
  }
  return true;
}

/** 与 `triage-feedback.ts` 的 `notifySubmitter` 同一套纪律,文案不同——见该文件头注②。 */
async function notifySubmitter(
  deps: ReconcileClosedGithubIssuesDeps,
  candidate: FeedbackGithubIssueCandidate,
  status: FeedbackStatus,
): Promise<{ readonly notified: boolean; readonly subject: string | null; readonly text: string | null }> {
  try {
    const email = await deps.submitterDirectory.emailForUserId(candidate.submittedBy);
    if (email === null) {
      deps.logger.info("feedback github issue poll: submitter has no resolvable email, skipping notification", {
        traceId: "feedback-github-issue-poll",
        feedbackId: candidate.feedbackId,
      });
      return { notified: false, subject: null, text: null };
    }
    const { subject, text } = closedIssueEmail({ title: candidate.title, issueNumber: candidate.githubIssueNumber, status });
    await deps.mail.send({ to: email, subject, text });
    return { notified: true, subject, text };
  } catch (e) {
    deps.logger.error("feedback github issue poll: notification failed (best-effort, transition already committed)", {
      traceId: "feedback-github-issue-poll",
      feedbackId: candidate.feedbackId,
      err: e,
    });
    return { notified: false, subject: null, text: null };
  }
}
