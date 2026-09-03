/**
 * `reconcileClosedGithubIssues` —— 定时对账用例(FB-2 补,issue #2500 的落地,
 * 经 PR #2580 独立复核三条阻断项修过之后的版本)。全部用 fake 端口,与
 * `triage-feedback.test.ts` 同一套写法；`transitionStatusWithEventIfCurrentStatus`
 * 在真实 Postgres 上的并发前提由 `tests/feedback/github-issue-poll-real-postgres.test.ts`
 * 反证,这里只测用例层的分支逻辑。
 */
import { describe, expect, it, vi } from "vitest";
import {
  RECONCILE_ACTOR_ID,
  reconcileClosedGithubIssues,
  type ReconcileClosedGithubIssuesDeps,
} from "../../src/application/feedback/reconcile-closed-github-issues";
import type { FeedbackGithubIssueCandidate } from "../../src/application/feedback/github-issue-poll-ports";
import type { FeedbackRow, ProductFeedbackRepository, ProductFeedbackRepositoryFactory } from "../../src/application/feedback/ports";
import { guard } from "../../src/application/security/permission-filter";

function candidate(over: Partial<FeedbackGithubIssueCandidate> = {}): FeedbackGithubIssueCandidate {
  return {
    orgId: "org-1",
    feedbackId: "fb-1",
    submittedBy: "u-submitter",
    title: "点了没反应",
    githubIssueNumber: 42,
    ...over,
  };
}

function row(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "点了没反应",
    detail: guard({ kind: "feedback", id: "fb-1" }, "反馈正文(本用例不读这个字段)"),
    status: "已进入迭代",
    statusReason: null,
    votes: 0,
    votedByMe: false,
    occurredRoute: null,
    appVersion: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    githubIssueUrl: "https://github.com/boardx/workspacex/issues/42",
    githubIssueNumber: 42,
    ...over,
  };
}

/**
 * 内存版仓储 fake。`transitionStatusWithEventIfCurrentStatus` 模拟真实 pg 实现的
 * 同一条不变量(见 `pg-product-feedback-repository.ts`)：只在当前状态等于
 * `expectedStatus` 时才生效,否则返回 `false`、不改状态、不记事件——不是真的原子
 * (内存里没有并发这回事),但对"前提不吻合就必须放弃"这条不变量的测试是足够的。
 */
function fakeRepo(initial: FeedbackRow): ProductFeedbackRepository & { current: FeedbackRow; events: unknown[] } {
  const state = { current: initial, events: [] as unknown[] };
  return {
    current: state.current,
    get events() { return state.events; },
    insert: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(async () => state.current),
    setVote: vi.fn(),
    updateStatus: vi.fn(),
    appendStatusEvent: vi.fn(),
    transitionStatusWithEvent: vi.fn(async (_id, status, reason) => {
      state.current = { ...state.current, status, statusReason: reason };
    }),
    transitionStatusWithEventIfCurrentStatus: vi.fn(async (_id, expectedStatus, status, reason, event) => {
      if (state.current.status !== expectedStatus) return false;
      state.current = { ...state.current, status, statusReason: reason };
      state.events.push(event);
      return true;
    }),
    markStatusEventNotified: vi.fn(),
    claimGithubIssueCreation: vi.fn(),
    releaseGithubIssueClaim: vi.fn(),
    setGithubIssue: vi.fn(),
    counts: vi.fn(),
    listStatusEvents: vi.fn(),
    get [Symbol.toStringTag]() { return "fakeRepo"; },
  } as unknown as ProductFeedbackRepository & { current: FeedbackRow; events: unknown[] };
}

function baseDeps(over: Partial<ReconcileClosedGithubIssuesDeps> = {}): ReconcileClosedGithubIssuesDeps {
  const repo = fakeRepo(row());
  const repos: ProductFeedbackRepositoryFactory = { forOrg: vi.fn(() => repo) };
  return {
    scanner: { listOpenLinkedToGithubIssue: vi.fn(async () => [candidate()]) },
    repos,
    githubIssues: {
      create: vi.fn(async () => { throw new Error("not used in this test"); }),
      setState: vi.fn(async () => {}),
      getStatus: vi.fn(async () => ({ state: "closed" as const, stateReason: "completed" as const, linkedPullRequests: [], linkedPullRequestsAvailable: true })),
      addComment: vi.fn(async () => { throw new Error("not used in this test"); }),
    },
    submitterDirectory: { emailForUserId: vi.fn(async () => "submitter@example.com"), displayNamesForUserIds: vi.fn(async () => new Map()) },
    mail: { send: vi.fn(async () => ({})) },
    logger: { info: vi.fn(), error: vi.fn() },
    newEventId: () => "ev-1",
    ...over,
  };
}

describe("reconcileClosedGithubIssues", () => {
  it("issue 已关闭(completed)⇒ 转已修复、写流水、发通知邮件", async () => {
    const deps = baseDeps();
    const result = await reconcileClosedGithubIssues(deps);

    expect(result).toEqual({ scanned: 1, reconciled: 1 });
    const repo = (deps.repos.forOrg as ReturnType<typeof vi.fn>).mock.results[0]!.value as ProductFeedbackRepository;
    expect(repo.transitionStatusWithEventIfCurrentStatus).toHaveBeenCalledWith(
      "fb-1",
      "已进入迭代",
      "已修复",
      expect.stringContaining("#42"),
      expect.objectContaining({ fromStatus: "已进入迭代", toStatus: "已修复", actorId: RECONCILE_ACTOR_ID }),
    );
    expect(deps.mail.send).toHaveBeenCalledTimes(1);
    const call = (deps.mail.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { to: string; subject: string };
    expect(call.to).toBe("submitter@example.com");
    expect(call.subject).toContain("请测试验收");
    expect(repo.markStatusEventNotified).toHaveBeenCalledWith("ev-1", true, expect.any(String), expect.any(String));
  });

  it("issue 已关闭(not_planned)⇒ 转不做,不是已修复,邮件文案也不同", async () => {
    const deps = baseDeps({
      githubIssues: {
        create: vi.fn(),
        setState: vi.fn(),
        getStatus: vi.fn(async () => ({ state: "closed" as const, stateReason: "not_planned" as const, linkedPullRequests: [], linkedPullRequestsAvailable: true })),
        addComment: vi.fn(),
      },
    });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 1 });
    const repo = (deps.repos.forOrg as ReturnType<typeof vi.fn>).mock.results[0]!.value as ProductFeedbackRepository;
    expect(repo.transitionStatusWithEventIfCurrentStatus).toHaveBeenCalledWith(
      "fb-1", "已进入迭代", "不做", expect.any(String),
      expect.objectContaining({ toStatus: "不做" }),
    );
    const call = (deps.mail.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { subject: string };
    expect(call.subject).not.toContain("已修复");
    expect(call.subject).toContain("不做");
  });

  it("issue 已关闭但 stateReason 缺失 ⇒ 不猜测意图,跳过", async () => {
    const deps = baseDeps({
      githubIssues: {
        create: vi.fn(),
        setState: vi.fn(),
        getStatus: vi.fn(async () => ({ state: "closed" as const, stateReason: null, linkedPullRequests: [], linkedPullRequestsAvailable: true })),
        addComment: vi.fn(),
      },
    });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
    expect(deps.mail.send).not.toHaveBeenCalled();
  });

  it("issue 还开着 ⇒ 不动状态、不发通知", async () => {
    const deps = baseDeps({
      githubIssues: {
        create: vi.fn(),
        setState: vi.fn(),
        getStatus: vi.fn(async () => ({ state: "open" as const, stateReason: null, linkedPullRequests: [], linkedPullRequestsAvailable: true })),
        addComment: vi.fn(),
      },
    });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
    expect(deps.mail.send).not.toHaveBeenCalled();
  });

  it("这一刻状态已经不是「已进入迭代」(被人工改判)⇒ 不用过期快照覆盖,跳过", async () => {
    const repo = fakeRepo(row({ status: "不做", statusReason: "重复反馈" }));
    const repos: ProductFeedbackRepositoryFactory = { forOrg: vi.fn(() => repo) };
    const deps = baseDeps({ repos });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
    expect(repo.transitionStatusWithEventIfCurrentStatus).not.toHaveBeenCalled();
    expect(deps.mail.send).not.toHaveBeenCalled();
  });

  it("已经被人工标成已修复(幂等重放)⇒ 不重复写流水、不重复发信", async () => {
    const repo = fakeRepo(row({ status: "已修复" }));
    const repos: ProductFeedbackRepositoryFactory = { forOrg: vi.fn(() => repo) };
    const deps = baseDeps({ repos });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
    expect(repo.transitionStatusWithEventIfCurrentStatus).not.toHaveBeenCalled();
  });

  it("写入那一刻状态被并发改变(仓储层前提不吻合)⇒ 不发通知,不当作已同步", async () => {
    const repo = fakeRepo(row());
    (repo.transitionStatusWithEventIfCurrentStatus as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const repos: ProductFeedbackRepositoryFactory = { forOrg: vi.fn(() => repo) };
    const deps = baseDeps({ repos });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 0 });
    expect(deps.mail.send).not.toHaveBeenCalled();
    expect(repo.markStatusEventNotified).not.toHaveBeenCalled();
  });

  it("一条候选处理失败(GitHub API 报错)不拖垮同一批里其余候选", async () => {
    const failing = candidate({ feedbackId: "fb-fail", githubIssueNumber: 1 });
    const ok = candidate({ feedbackId: "fb-ok", githubIssueNumber: 2 });
    const repoFail = fakeRepo(row({ id: "fb-fail" }));
    const repoOk = fakeRepo(row({ id: "fb-ok" }));
    const repos: ProductFeedbackRepositoryFactory = {
      forOrg: vi.fn((orgId: string) => (orgId === "org-1" ? repoFail : repoOk)),
    };
    let call = 0;
    const deps = baseDeps({
      scanner: { listOpenLinkedToGithubIssue: vi.fn(async () => [failing, { ...ok, orgId: "org-2" }]) },
      repos,
      githubIssues: {
        create: vi.fn(),
        setState: vi.fn(),
        getStatus: vi.fn(async () => {
          call += 1;
          if (call === 1) throw new Error("github down");
          return { state: "closed" as const, stateReason: "completed" as const, linkedPullRequests: [], linkedPullRequestsAvailable: true };
        }),
        addComment: vi.fn(),
      },
    });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 2, reconciled: 1 });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("reconcile one candidate failed"),
      expect.objectContaining({ feedbackId: "fb-fail" }),
    );
    expect(repoOk.transitionStatusWithEventIfCurrentStatus).toHaveBeenCalled();
  });

  it("提交人查不到邮箱 ⇒ 状态照常转,notified 落 false,记 info 不记 error", async () => {
    const deps = baseDeps({
      submitterDirectory: { emailForUserId: vi.fn(async () => null), displayNamesForUserIds: vi.fn(async () => new Map()) },
    });
    const result = await reconcileClosedGithubIssues(deps);
    expect(result).toEqual({ scanned: 1, reconciled: 1 });
    expect(deps.mail.send).not.toHaveBeenCalled();
    const repo = (deps.repos.forOrg as ReturnType<typeof vi.fn>).mock.results[0]!.value as ProductFeedbackRepository;
    expect(repo.markStatusEventNotified).toHaveBeenCalledWith("ev-1", false, null, null);
    expect(deps.logger.error).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalled();
  });
});
