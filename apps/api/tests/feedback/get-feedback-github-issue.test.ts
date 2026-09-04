/**
 * FB-2 —— `getFeedbackGithubIssue` 用例：权限门、"没有 issue"的判法、GitHub 失败的映射。
 *
 * 全部用 fake 端口——不碰真实网络、不碰真实数据库（仓储也是内存 fake）。同
 * `triage-feedback.test.ts` 的纪律：这是应用层单测，断的是用例本身的分支，
 * 不是 HTTP/DB 集成（那需要真 Postgres，见 `feedback.controller.ts` 的 e2e 覆盖）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  FeedbackGithubIssueQueryFailedError,
  getFeedbackGithubIssue,
  type GetFeedbackGithubIssueDeps,
} from "../../src/application/feedback/get-feedback-github-issue";
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

const STATUS = {
  state: "open" as const,
  stateReason: null,
  linkedPullRequests: [{ number: 5, url: "https://github.com/boardx/workspacex/pull/5", title: "fix it", state: "open" as const }],
  linkedPullRequestsAvailable: true,
};

function baseDeps(over: Partial<GetFeedbackGithubIssueDeps> = {}): GetFeedbackGithubIssueDeps {
  return {
    repo: fakeRepo(row()),
    githubIssues: {
      create: vi.fn(),
      setState: vi.fn(),
      getStatus: vi.fn(async () => STATUS),
      addComment: vi.fn(),
    },
    ...over,
  };
}

const ADMIN = { actorId: "u-admin", actorOrgRole: "admin" as const };
const MEMBER = { actorId: "u-member", actorOrgRole: "lead" as const };

describe("getFeedbackGithubIssue", () => {
  it("非管理员 ⇒ 403 语义（FeedbackTriageForbiddenError），且不碰仓储/GitHub", async () => {
    const deps = baseDeps();
    await expect(
      getFeedbackGithubIssue(deps, { feedbackId: "fb-1", ...MEMBER }),
    ).rejects.toBeInstanceOf(FeedbackTriageForbiddenError);
    expect(deps.repo.findById).not.toHaveBeenCalled();
    expect(deps.githubIssues.getStatus).not.toHaveBeenCalled();
  });

  it("反馈不存在（或不在本组织，RLS 之后读到 null）⇒ FeedbackNotFoundError", async () => {
    const deps = baseDeps({ repo: fakeRepo(row()) });
    (deps.repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      getFeedbackGithubIssue(deps, { feedbackId: "fb-missing", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });

  it("这条反馈还没有 issue（githubIssueUrl === null）⇒ FeedbackNoGithubIssueError，不调 GitHub", async () => {
    const deps = baseDeps({ repo: fakeRepo(row({ githubIssueUrl: null, githubIssueNumber: null })) });
    await expect(
      getFeedbackGithubIssue(deps, { feedbackId: "fb-1", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackNoGithubIssueError);
    expect(deps.githubIssues.getStatus).not.toHaveBeenCalled();
  });

  it("成功 ⇒ 用反馈落库的 issue number 查 GitHub，原样带出 url/number/状态/关联 PR", async () => {
    const deps = baseDeps();
    const out = await getFeedbackGithubIssue(deps, { feedbackId: "fb-1", ...ADMIN });
    expect(deps.githubIssues.getStatus).toHaveBeenCalledWith(9);
    expect(out).toEqual({
      feedbackId: "fb-1",
      url: "https://github.com/boardx/workspacex/issues/9",
      number: 9,
      ...STATUS,
    });
  });

  it("GitHub 查询失败 ⇒ FeedbackGithubIssueQueryFailedError（控制器据此映射 503 DEPENDENCY_UNAVAILABLE）", async () => {
    const deps = baseDeps({
      githubIssues: {
        create: vi.fn(),
        setState: vi.fn(),
        getStatus: vi.fn(async () => {
          throw new GithubIssueApiError("getStatus", 500);
        }),
        addComment: vi.fn(),
      },
    });
    await expect(
      getFeedbackGithubIssue(deps, { feedbackId: "fb-1", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackGithubIssueQueryFailedError);
  });
});
