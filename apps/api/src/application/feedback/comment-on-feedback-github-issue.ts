/**
 * `commentOnFeedbackGithubIssue` —— 管理员在后台反馈卡片上手动输入、手动提交的一条
 * GitHub issue 评论。**不是**状态转移的副作用（那条是 `triageFeedback` 内部恒定行为，
 * 见其头注②③，跟着状态自动同步开关/发邮件），这条是管理员想额外补充说明时用的。
 *
 * 权限、"这条反馈有没有 issue"的判法，都与 `get-feedback-github-issue.ts` 同一条纪律，
 * 两个用例共用的错误类型因此放在 `notification-ports.ts`（见该文件 `FeedbackNoGithubIssueError`
 * 头注）。
 *
 * ⚠ **已知限制，登记、不在这轮修**（2026-09-02 独立审查提出，issue #2500 记录）：
 *   这次调用没有幂等键/回执。网络超时后的重试、或两个标签页各点一次「发评论」，
 *   都可能在 GitHub 上产生两条一样的评论——GitHub 的 issue comments API 本身
 *   不支持幂等键，要真正堵死需要本地存一份"这次请求发过没有"的回执并按 id 去重，
 *   属于新的一块状态。这是一个**低频、人工触发、后果可肉眼发现并手动删除**的操作
 *   （管理员自己点的按钮，重复了在 GitHub 页面上一看就懂），与「转开发」建 issue
 *   那条 fail-closed 纪律的风险量级不同——那条建的是唯一的 issue 本体，建重了是
 *   两张票；这条顶多是同一条 issue 下的一条重复留言。同 `triage-feedback.ts` 头注③
 *   的"没有持久 outbox"是同一次权衡：先如实登记这个口子，不为了堵它引入新的
 *   幂等状态存储。
 */
import { canTriage } from "../../domain/feedback/product-feedback";
import type { OrgRole } from "../../domain/identity/roles";
import { FeedbackNoGithubIssueError, GithubIssueApiError, type GithubIssueCreator } from "./notification-ports";
import type { ProductFeedbackRepository } from "./ports";
import { FeedbackNotFoundError, FeedbackTriageForbiddenError } from "./triage-feedback";

/** 正文全是空白——同 `TRIAGE_REASON_REQUIRED` 的理由：一条没有信息量的评论不该发出去 */
export class FeedbackCommentBodyRequiredError extends Error {
  constructor() {
    super("comment body must not be blank");
  }
}

/** GitHub API 本身没成功——冒泡给控制器映射成 `DEPENDENCY_UNAVAILABLE`（503） */
export class FeedbackGithubCommentFailedError extends Error {
  constructor(cause: unknown) {
    super("github issue comment failed");
    this.cause = cause;
  }
}

export interface CommentOnFeedbackGithubIssueDeps {
  readonly repo: ProductFeedbackRepository;
  readonly githubIssues: GithubIssueCreator;
}

export interface CommentOnFeedbackGithubIssueInput {
  readonly feedbackId: string;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
  readonly body: string;
}

export interface CommentOnFeedbackGithubIssueResult {
  readonly feedbackId: string;
  readonly commentUrl: string;
}

export async function commentOnFeedbackGithubIssue(
  deps: CommentOnFeedbackGithubIssueDeps,
  input: CommentOnFeedbackGithubIssueInput,
): Promise<CommentOnFeedbackGithubIssueResult> {
  if (!canTriage(input.actorOrgRole)) throw new FeedbackTriageForbiddenError();
  if (input.body.trim() === "") throw new FeedbackCommentBodyRequiredError();

  const current = await deps.repo.findById(input.feedbackId, input.actorId);
  if (current === null) throw new FeedbackNotFoundError();
  if (current.githubIssueUrl === null || current.githubIssueNumber === null) {
    throw new FeedbackNoGithubIssueError();
  }

  try {
    const comment = await deps.githubIssues.addComment(current.githubIssueNumber, input.body);
    return { feedbackId: input.feedbackId, commentUrl: comment.url };
  } catch (e) {
    const cause = e instanceof GithubIssueApiError ? e : new GithubIssueApiError("addComment", null);
    throw new FeedbackGithubCommentFailedError(cause);
  }
}
