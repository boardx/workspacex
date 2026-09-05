/**
 * 2026-09-05 运营收件箱 GitHub 联动 —— `listFeedbackGithubIssueComments` 用例：权限门、
 * "没有 issue"的判法、GitHub 失败的映射。全部 fake 端口，同 `get-feedback-github-issue.test.ts`。
 */
import { describe, expect, it, vi } from "vitest";
import {
  FeedbackGithubCommentsQueryFailedError,
  listFeedbackGithubIssueComments,
  type ListFeedbackGithubIssueCommentsDeps,
} from "../../src/application/feedback/list-feedback-github-issue-comments";
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
    detail: guard({ kind: "feedback", id: "fb-1" }, "正文"),
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

function fakeRepo(current: FeedbackRow | null): ProductFeedbackRepository {
  return { findById: vi.fn(async () => current) } as unknown as ProductFeedbackRepository;
}

const COMMENTS = [
  { id: 1, url: "https://github.com/boardx/workspacex/issues/9#issuecomment-1", author: "dev-a", body: "看到了", createdAt: "2026-09-05T01:00:00Z" },
];

function baseDeps(over: Partial<ListFeedbackGithubIssueCommentsDeps> = {}): ListFeedbackGithubIssueCommentsDeps {
  return {
    repo: fakeRepo(row()),
    githubIssues: {
      create: vi.fn(),
      setState: vi.fn(),
      getStatus: vi.fn(),
      addComment: vi.fn(),
      listComments: vi.fn(async () => COMMENTS),
    },
    ...over,
  };
}

const ADMIN = { actorId: "u-admin", actorOrgRole: "admin" as const };

describe("listFeedbackGithubIssueComments", () => {
  it("管理员：按存下来的 issue 号现查评论，原样返回", async () => {
    const deps = baseDeps();
    const out = await listFeedbackGithubIssueComments(deps, { feedbackId: "fb-1", ...ADMIN });
    expect(deps.githubIssues.listComments).toHaveBeenCalledWith(9);
    expect(out).toEqual({ feedbackId: "fb-1", comments: COMMENTS });
  });

  it("非管理员 ⇒ FeedbackTriageForbiddenError，且不读仓储、不打 GitHub", async () => {
    const deps = baseDeps();
    await expect(
      listFeedbackGithubIssueComments(deps, { feedbackId: "fb-1", actorId: "u", actorOrgRole: null }),
    ).rejects.toBeInstanceOf(FeedbackTriageForbiddenError);
    expect(deps.repo.findById).not.toHaveBeenCalled();
    expect(deps.githubIssues.listComments).not.toHaveBeenCalled();
  });

  it("反馈不存在 ⇒ FeedbackNotFoundError", async () => {
    await expect(
      listFeedbackGithubIssueComments(baseDeps({ repo: fakeRepo(null) }), { feedbackId: "nope", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });

  it("还没有 issue ⇒ FeedbackNoGithubIssueError，不打 GitHub", async () => {
    const deps = baseDeps({ repo: fakeRepo(row({ githubIssueUrl: null, githubIssueNumber: null })) });
    await expect(listFeedbackGithubIssueComments(deps, { feedbackId: "fb-1", ...ADMIN })).rejects.toBeInstanceOf(
      FeedbackNoGithubIssueError,
    );
    expect(deps.githubIssues.listComments).not.toHaveBeenCalled();
  });

  it("GitHub 失败 ⇒ FeedbackGithubCommentsQueryFailedError（控制器映射 503）", async () => {
    const deps = baseDeps();
    (deps.githubIssues.listComments as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new GithubIssueApiError("listComments", 502);
    });
    await expect(listFeedbackGithubIssueComments(deps, { feedbackId: "fb-1", ...ADMIN })).rejects.toBeInstanceOf(
      FeedbackGithubCommentsQueryFailedError,
    );
  });
});
