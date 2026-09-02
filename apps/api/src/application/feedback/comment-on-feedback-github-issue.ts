/**
 * `commentOnFeedbackGithubIssue` —— 管理员在后台反馈卡片上手动输入、手动提交的一条
 * GitHub issue 评论。**不是**状态转移的副作用（那条是 `triageFeedback` 内部恒定行为，
 * 见其头注②③，跟着状态自动同步开关/发邮件），这条是管理员想额外补充说明时用的。
 *
 * 权限、"这条反馈有没有 issue"的判法，都与 `get-feedback-github-issue.ts` 同一条纪律，
 * 两个用例共用的错误类型因此放在 `notification-ports.ts`（见该文件 `FeedbackNoGithubIssueError`
 * 头注）。
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
