/**
 * FB-2 补——定时对账用例：`FeedbackGithubIssuePollWorker` 每 2 分钟调一次。
 *
 * 把 `github-issue-poll-ports.ts` 头注的意图接成真正的状态转移：候选反馈逐条
 * 现查 GitHub issue 状态，关了就转「已修复」+ best-effort 通知提交人。
 *
 * ## 与 `triageFeedback` 共享、也刻意不同的几条纪律
 *
 *   · **同一事务**：改状态与写"这次转移发生过"的流水，走 `transitionStatusWithEvent`
 *     ——原因与 `triageFeedback` 头注④一致，这里不重复论证。
 *   · **通知是 best-effort**：状态已经落库之后才发邮件，失败只记日志——同头注②。
 *   · **不同于 `triageFeedback`**：这里没有"先认领再建 issue"那一步（①）——本用例
 *     从不建 issue，只读现有的 `githubIssueNumber`；也没有"跟着状态同步 GitHub
 *     开关"那一步（③）——issue 本来就是在 GitHub 那边先关的，方向已经是反的，
 *     没有什么需要再同步回去。
 *   · **一条候选处理失败不拖垮整批**：`triageFeedback` 服务单次人类请求，失败
 *     直接抛给那一次 HTTP 调用；这里服务的是一次扫描一批反馈的后台 tick，
 *     一条反馈的 GitHub API 超时不该连累同一批里其余的反馈都同步不到。
 *
 * ## 为什么现查一次当前状态而不是直接信任 scanner 给的快照
 *
 * `scanner.listOpenLinkedToGithubIssue()` 读出来的是**这一刻**的候选集合，从它
 * 返回到这个函数真正执行 `transitionStatusWithEvent` 之间，管理员完全可能已经
 * 手动分诊过（比如已经手动标了「已修复」，或者改判「不做」）。`repo.findById` +
 * `triage()` 在这里重新判一次合法性——如果这一刻状态已经不是「已进入迭代」，
 * `triage()` 要么给出 `unchanged`（已经是「已修复」，本次对账是幂等重放）要么
 * `rejected`（比如已经是「不做」，`不做 → 已修复` 不在合法转移表里），两种结果
 * 都会让 `reconcileOne` 返回 `false`、不落库、不发通知——不会用一次过期的快照
 * 覆盖掉更晚发生的人工判断。
 */
import { triage } from "../../domain/feedback/product-feedback";
import type { LoggerPort } from "../ports/logger.port";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import type { FeedbackSubmitterDirectory, GithubIssueCreator } from "./notification-ports";
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

function closedIssueEmail(input: { readonly title: string; readonly issueNumber: number }): {
  readonly subject: string;
  readonly text: string;
} {
  const subject = `你的反馈《${input.title}》已修复，请测试验收`;
  const text = [
    `你提交的反馈《${input.title}》关联的 GitHub issue（#${input.issueNumber}）已经关闭，状态已自动更新为「已修复」。`,
    `请抽空测试验收一下——如果验证下来还是有问题，可以在反馈弹层里把状态改回「待处理」重新提出。`,
  ].join("\n");
  return { subject, text };
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

  const repo = deps.repos.forOrg(candidate.orgId);
  const current = await repo.findById(candidate.feedbackId, candidate.submittedBy);
  if (current === null) return false; // 反馈已经不在了(极端情况),没有什么可对账的

  const outcome = triage({
    current: current.status,
    next: "已修复",
    reason: `GitHub issue #${candidate.githubIssueNumber} 已关闭，自动同步为已修复`,
  });
  if (outcome.kind !== "changed") return false; // 幂等重放或已被人工改判到别的终态,都不再动

  const eventId = deps.newEventId();
  await repo.transitionStatusWithEvent(candidate.feedbackId, outcome.to, outcome.reason, {
    id: eventId,
    feedbackId: candidate.feedbackId,
    fromStatus: outcome.from,
    toStatus: outcome.to,
    reason: outcome.reason,
    actorId: RECONCILE_ACTOR_ID,
  });

  const notification = await notifySubmitter(deps, candidate);
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
    const { subject, text } = closedIssueEmail({ title: candidate.title, issueNumber: candidate.githubIssueNumber });
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
