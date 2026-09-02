/**
 * `getFeedbackGithubIssue` —— 现查这条反馈挂着的 GitHub issue：开/关状态 + 关联它的 PR。
 *
 * ⚠ **不落库、每次都真的打一次 GitHub**——见契约 `getFeedbackGithubIssue` 头注与
 *   `GithubIssueLinkedPullRequest` 头注：issue 是不是 still open、有没有 PR 关联它，
 *   事实源只有 GitHub 一处，落一份到我们数据库就是本仓明令禁止的「同一事实两处」。
 *
 * ⚠ 权限同分诊——`canTriage`（组织管理员）。查 GitHub 状态是分诊之后的运营动作，
 *   不该比分诊本身更松。
 */
import { canTriage } from "../../domain/feedback/product-feedback";
import type { OrgRole } from "../../domain/identity/roles";
import {
  FeedbackNoGithubIssueError,
  GithubIssueApiError,
  type GithubIssueCreator,
} from "./notification-ports";
import type { ProductFeedbackRepository } from "./ports";
import { FeedbackNotFoundError, FeedbackTriageForbiddenError } from "./triage-feedback";

/** GitHub API 本身没成功——冒泡给控制器映射成 `DEPENDENCY_UNAVAILABLE`（503）。 */
export class FeedbackGithubIssueQueryFailedError extends Error {
  constructor(cause: unknown) {
    super("github issue status query failed");
    this.cause = cause;
  }
}

export interface GetFeedbackGithubIssueDeps {
  readonly repo: ProductFeedbackRepository;
  readonly githubIssues: GithubIssueCreator;
}

export interface GetFeedbackGithubIssueInput {
  readonly feedbackId: string;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
}

export interface GetFeedbackGithubIssueResult {
  readonly feedbackId: string;
  readonly url: string;
  readonly number: number;
  readonly state: "open" | "closed";
  readonly stateReason: "completed" | "not_planned" | null;
  readonly linkedPullRequests: readonly {
    readonly number: number;
    readonly url: string;
    readonly title: string;
    readonly state: "open" | "closed" | "merged";
  }[];
}

export async function getFeedbackGithubIssue(
  deps: GetFeedbackGithubIssueDeps,
  input: GetFeedbackGithubIssueInput,
): Promise<GetFeedbackGithubIssueResult> {
  if (!canTriage(input.actorOrgRole)) throw new FeedbackTriageForbiddenError();

  const current = await deps.repo.findById(input.feedbackId, input.actorId);
  if (current === null) throw new FeedbackNotFoundError();
  if (current.githubIssueUrl === null || current.githubIssueNumber === null) {
    throw new FeedbackNoGithubIssueError();
  }

  try {
    const status = await deps.githubIssues.getStatus(current.githubIssueNumber);
    return {
      feedbackId: input.feedbackId,
      url: current.githubIssueUrl,
      number: current.githubIssueNumber,
      state: status.state,
      stateReason: status.stateReason,
      linkedPullRequests: status.linkedPullRequests,
    };
  } catch (e) {
    const cause = e instanceof GithubIssueApiError ? e : new GithubIssueApiError("getStatus", null);
    throw new FeedbackGithubIssueQueryFailedError(cause);
  }
}
