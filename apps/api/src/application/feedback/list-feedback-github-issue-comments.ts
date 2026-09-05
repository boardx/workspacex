/**
 * `listFeedbackGithubIssueComments` —— 读这条反馈挂着的 GitHub issue 下的全部评论。
 * 给运营收件箱 drawer 的评论区用（2026-09-05 人类要求：在收件箱里就能看到、也能提交
 * issue 评论）。与 `comment-on-feedback-github-issue.ts` 是一对（读 / 写）。
 *
 * ⚠ **不落库、每次都真的打一次 GitHub**——同 `get-feedback-github-issue.ts`：评论的事实源
 *   只有 GitHub 一处。
 * ⚠ 权限同分诊——`canTriage`（组织管理员），与另外两个 GitHub 用例同一条纪律。
 */
import { canTriage } from "../../domain/feedback/product-feedback";
import type { OrgRole } from "../../domain/identity/roles";
import {
  FeedbackNoGithubIssueError,
  GithubIssueApiError,
  type GithubIssueComment,
  type GithubIssueCreator,
} from "./notification-ports";
import type { ProductFeedbackRepository } from "./ports";
import { FeedbackNotFoundError, FeedbackTriageForbiddenError } from "./triage-feedback";

/** GitHub API 本身没成功——冒泡给控制器映射成 `DEPENDENCY_UNAVAILABLE`（503）。 */
export class FeedbackGithubCommentsQueryFailedError extends Error {
  constructor(cause: unknown) {
    super("github issue comments query failed");
    this.cause = cause;
  }
}

export interface ListFeedbackGithubIssueCommentsDeps {
  readonly repo: ProductFeedbackRepository;
  readonly githubIssues: GithubIssueCreator;
}

export interface ListFeedbackGithubIssueCommentsInput {
  readonly feedbackId: string;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
}

export interface ListFeedbackGithubIssueCommentsResult {
  readonly feedbackId: string;
  readonly comments: readonly GithubIssueComment[];
}

export async function listFeedbackGithubIssueComments(
  deps: ListFeedbackGithubIssueCommentsDeps,
  input: ListFeedbackGithubIssueCommentsInput,
): Promise<ListFeedbackGithubIssueCommentsResult> {
  if (!canTriage(input.actorOrgRole)) throw new FeedbackTriageForbiddenError();

  const current = await deps.repo.findById(input.feedbackId, input.actorId);
  if (current === null) throw new FeedbackNotFoundError();
  if (current.githubIssueUrl === null || current.githubIssueNumber === null) {
    throw new FeedbackNoGithubIssueError();
  }

  try {
    const comments = await deps.githubIssues.listComments(current.githubIssueNumber);
    return { feedbackId: input.feedbackId, comments };
  } catch (e) {
    const cause = e instanceof GithubIssueApiError ? e : new GithubIssueApiError("listComments", null);
    throw new FeedbackGithubCommentsQueryFailedError(cause);
  }
}
