/**
 * FB-2 —— `commentOnFeedbackGithubIssue` 用例：权限门、空白正文、"没有 issue"的判法、
 * GitHub 失败的映射。同 `get-feedback-github-issue.test.ts`：应用层单测，全部用 fake 端口。
 */
import { describe, expect, it, vi } from "vitest";
import {
  FeedbackCommentBodyRequiredError,
  FeedbackGithubCommentFailedError,
  commentOnFeedbackGithubIssue,
  type CommentOnFeedbackGithubIssueDeps,
} from "../../src/application/feedback/comment-on-feedback-github-issue";
import { FeedbackNoGithubIssueError, GithubIssueApiError } from "../../src/application/feedback/notification-ports";
import type { FeedbackRow, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import { guard } from "../../src/application/security/permission-filter";
import { FeedbackNotFoundError, FeedbackTriageForbiddenError } from "../../src/application/feedback/triage-feedback";

function row(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "点了没反应",
    detail: guard({ kind: "feedback", id: "fb-1" }, "反馈正文（本用例不读这个字段）"),
    structured: guard({ kind: "feedback", id: "fb-1" }, null),
    status: "已进入迭代",
    statusReason: null,
    votes: 0,
    votedByMe: false,
    occurredRoute: null,
    appVersion: null,
    createdAt: "2026-09-02T00:00:00.000Z",
    githubIssueUrl: "https://github.com/boardx/workspacex/issues/9",
    githubIssueNumber: 9,
    resolvedByDesignId: null,
    ...over,
  };
}

function fakeRepo(current: FeedbackRow): ProductFeedbackRepository {
  return {
    insert: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(async () => current),
    setVote: vi.fn(),
    updateStatus: vi.fn(),
    appendStatusEvent: vi.fn(),
    claimGithubIssueCreation: vi.fn(),
    releaseGithubIssueClaim: vi.fn(),
    setGithubIssue: vi.fn(),
    counts: vi.fn(),
  } as unknown as ProductFeedbackRepository;
}

function baseDeps(over: Partial<CommentOnFeedbackGithubIssueDeps> = {}): CommentOnFeedbackGithubIssueDeps {
  return {
    repo: fakeRepo(row()),
    githubIssues: {
      create: vi.fn(),
      setState: vi.fn(),
      getStatus: vi.fn(),
      addComment: vi.fn(async () => ({ url: "https://github.com/boardx/workspacex/issues/9#issuecomment-1" })),
      listComments: vi.fn(async () => []),
    },
    ...over,
  };
}

const ADMIN = { actorId: "u-admin", actorOrgRole: "admin" as const };
const MEMBER = { actorId: "u-member", actorOrgRole: "lead" as const };

describe("commentOnFeedbackGithubIssue", () => {
  it("非管理员 ⇒ 403 语义，且不碰仓储/GitHub", async () => {
    const deps = baseDeps();
    await expect(
      commentOnFeedbackGithubIssue(deps, { feedbackId: "fb-1", body: "留言", ...MEMBER }),
    ).rejects.toBeInstanceOf(FeedbackTriageForbiddenError);
    expect(deps.repo.findById).not.toHaveBeenCalled();
    expect(deps.githubIssues.addComment).not.toHaveBeenCalled();
  });

  it("正文全是空白 ⇒ FeedbackCommentBodyRequiredError，先于查仓储（不浪费一次读）", async () => {
    const deps = baseDeps();
    await expect(
      commentOnFeedbackGithubIssue(deps, { feedbackId: "fb-1", body: "   ", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackCommentBodyRequiredError);
    expect(deps.repo.findById).not.toHaveBeenCalled();
  });

  it("反馈不存在 ⇒ FeedbackNotFoundError", async () => {
    const deps = baseDeps();
    (deps.repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      commentOnFeedbackGithubIssue(deps, { feedbackId: "fb-missing", body: "留言", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });

  it("这条反馈还没有 issue ⇒ FeedbackNoGithubIssueError，不调 GitHub", async () => {
    const deps = baseDeps({ repo: fakeRepo(row({ githubIssueUrl: null, githubIssueNumber: null })) });
    await expect(
      commentOnFeedbackGithubIssue(deps, { feedbackId: "fb-1", body: "留言", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackNoGithubIssueError);
    expect(deps.githubIssues.addComment).not.toHaveBeenCalled();
  });

  it("成功 ⇒ 用反馈落库的 issue number 发评论，原样带出 commentUrl", async () => {
    const deps = baseDeps();
    const out = await commentOnFeedbackGithubIssue(deps, { feedbackId: "fb-1", body: "已在 v1.2 修复", ...ADMIN });
    expect(deps.githubIssues.addComment).toHaveBeenCalledWith(9, "已在 v1.2 修复");
    expect(out).toEqual({
      feedbackId: "fb-1",
      commentUrl: "https://github.com/boardx/workspacex/issues/9#issuecomment-1",
    });
  });

  it("GitHub 评论失败 ⇒ FeedbackGithubCommentFailedError（控制器据此映射 503 DEPENDENCY_UNAVAILABLE）", async () => {
    const deps = baseDeps({
      githubIssues: {
        create: vi.fn(),
        setState: vi.fn(),
        getStatus: vi.fn(),
        addComment: vi.fn(async () => {
          throw new GithubIssueApiError("addComment", 500);
        }),
        listComments: vi.fn(async () => []),
      },
    });
    await expect(
      commentOnFeedbackGithubIssue(deps, { feedbackId: "fb-1", body: "留言", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackGithubCommentFailedError);
  });
});
