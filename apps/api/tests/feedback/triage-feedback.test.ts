/**
 * FB-2 —— `triageFeedback` 用例的两条新副作用（2026-08-30,见该文件头注①②）：
 *
 *   ① 转「已进入迭代」+ 带 issueDraft + 还没有 issue ⇒ 建一个 GitHub issue,
 *      **fail closed**(建不成整个用例失败,状态不落库)。
 *   ② 任意真实转移都尽力发一封状态变更邮件,**best-effort**
 *      (邮件失败不影响状态转移,也不重试/不回滚)。
 *
 * 全部用 fake 端口——不碰真实网络、不碰真实数据库(仓储也是内存 fake)。
 * 状态机本身(合法转移/理由必填/幂等)已经在 `feedback-state-machine.test.ts`
 * 断过,这里不重复断,只断新加的两条副作用与既有流程的交互。
 */
import { describe, expect, it, vi } from "vitest";
import {
  FeedbackIssueCreationFailedError,
  triageFeedback,
  type TriageFeedbackDeps,
} from "../../src/application/feedback/triage-feedback";
import { GithubIssueCreationError } from "../../src/application/feedback/notification-ports";
import type { FeedbackRow, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import { guard } from "../../src/application/security/permission-filter";

function row(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "点了没反应",
    // ⚠ `detail` 是 `Guarded<string>`(D3 可见性门控),不是这个用例真正读到的字段——
    //   `triageFeedback` 不看正文,这里只是为了满足 `FeedbackRow` 的完整形状。
    detail: guard({ kind: "feedback", id: "fb-1" }, "反馈正文(本用例不读这个字段)"),
    status: "待处理",
    statusReason: null,
    votes: 0,
    votedByMe: false,
    occurredRoute: null,
    appVersion: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    githubIssueUrl: null,
    githubIssueNumber: null,
    ...over,
  };
}

/** 内存版仓储 fake——只实现用例真正用到的行为,状态可变以观测落库结果。 */
function fakeRepo(initial: FeedbackRow): ProductFeedbackRepository & { current: FeedbackRow } {
  const state = { current: initial };
  return {
    current: state.current,
    insert: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(async () => state.current),
    setVote: vi.fn(),
    updateStatus: vi.fn(async (_id, status, reason) => {
      state.current = { ...state.current, status, statusReason: reason };
    }),
    appendStatusEvent: vi.fn(),
    setGithubIssue: vi.fn(async (_id, issue) => {
      state.current = { ...state.current, githubIssueUrl: issue.url, githubIssueNumber: issue.number };
    }),
    counts: vi.fn(),
    get [Symbol.toStringTag]() { return "fakeRepo"; },
  } as unknown as ProductFeedbackRepository & { current: FeedbackRow };
}

function baseDeps(over: Partial<TriageFeedbackDeps> = {}): TriageFeedbackDeps {
  return {
    repo: fakeRepo(row()),
    newEventId: () => "ev-1",
    githubIssues: { create: vi.fn(async () => ({ url: "https://github.com/boardx/workspacex/issues/1", number: 1 })) },
    submitterDirectory: { emailForUserId: vi.fn(async () => "submitter@example.com") },
    mail: { send: vi.fn(async () => ({})) },
    logger: { info: vi.fn(), error: vi.fn() },
    ...over,
  };
}

const ADMIN = { actorId: "u-admin", actorOrgRole: "admin" as const };

describe("triageFeedback —— GitHub issue（fail closed）", () => {
  it("只在目标状态是「已进入迭代」时才尝试建 issue", async () => {
    const deps = baseDeps({ repo: fakeRepo(row({ status: "已进入迭代" })) });
    await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已修复",
      reason: null,
      issueDraft: { title: "不该被用到", body: "", labels: [] },
      ...ADMIN,
    });
    expect(deps.githubIssues.create).not.toHaveBeenCalled();
  });

  it("转「已进入迭代」但没带 issueDraft ⇒ 不建 issue,状态照常变", async () => {
    const deps = baseDeps();
    const out = await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: null,
      ...ADMIN,
    });
    expect(deps.githubIssues.create).not.toHaveBeenCalled();
    expect(out.status).toBe("已进入迭代");
    expect(out.githubIssueUrl).toBeNull();
  });

  it("管理员编辑过的标题/正文/标签是**原样**传给 GitHub,不是反馈原文", async () => {
    const deps = baseDeps({
      repo: fakeRepo(row({ title: "反馈原始标题" })),
    });
    await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: { title: "管理员改过的标题", body: "管理员改过的正文", labels: ["user-feedback", "bug"] },
      ...ADMIN,
    });
    expect(deps.githubIssues.create).toHaveBeenCalledWith({
      title: "管理员改过的标题",
      body: "管理员改过的正文",
      labels: ["user-feedback", "bug"],
    });
  });

  it("建成功 ⇒ 回填 githubIssueUrl 到仓储,并在 out 里回报", async () => {
    const repo = fakeRepo(row());
    const deps = baseDeps({ repo });
    const out = await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: { title: "t", body: "b", labels: [] },
      ...ADMIN,
    });
    expect(repo.setGithubIssue).toHaveBeenCalledWith("fb-1", { url: "https://github.com/boardx/workspacex/issues/1", number: 1 });
    expect(out.githubIssueUrl).toBe("https://github.com/boardx/workspacex/issues/1");
  });

  it("已经有 issue 的反馈再次转「已进入迭代」⇒ 不重复建", async () => {
    const repo = fakeRepo(row({ status: "待处理", githubIssueUrl: "https://github.com/x/y/issues/9", githubIssueNumber: 9 }));
    const deps = baseDeps({ repo });
    await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: { title: "t", body: "b", labels: [] },
      ...ADMIN,
    });
    expect(deps.githubIssues.create).not.toHaveBeenCalled();
  });

  it("**fail closed**：issue 建失败 ⇒ 整个用例抛错,状态不落库,不写流水", async () => {
    const repo = fakeRepo(row());
    const deps = baseDeps({
      repo,
      githubIssues: { create: vi.fn(async () => { throw new GithubIssueCreationError(500); }) },
    });
    await expect(
      triageFeedback(deps, {
        feedbackId: "fb-1",
        status: "已进入迭代",
        reason: null,
        issueDraft: { title: "t", body: "b", labels: [] },
        ...ADMIN,
      }),
    ).rejects.toBeInstanceOf(FeedbackIssueCreationFailedError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.appendStatusEvent).not.toHaveBeenCalled();
    // best-effort 邮件也不该发——状态根本没变,没有什么值得通知的事实。
    expect(deps.mail.send).not.toHaveBeenCalled();
  });
});

describe("triageFeedback —— 状态变更邮件（best-effort）", () => {
  it("四种真实转移都会尝试通知提交人", async () => {
    const cases: Array<{ from: FeedbackRow["status"]; to: FeedbackRow["status"]; reason: string | null }> = [
      { from: "待处理", to: "已进入迭代", reason: null },
      { from: "已进入迭代", to: "已修复", reason: null },
      { from: "已进入迭代", to: "待处理", reason: null },
      { from: "待处理", to: "不做", reason: "重复反馈" },
    ];
    for (const c of cases) {
      const deps = baseDeps({ repo: fakeRepo(row({ status: c.from })) });
      const out = await triageFeedback(deps, {
        feedbackId: "fb-1",
        status: c.to,
        reason: c.reason,
        issueDraft: null,
        ...ADMIN,
      });
      expect(deps.mail.send).toHaveBeenCalledTimes(1);
      const calls = (deps.mail.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]).toBeDefined();
      const call = calls[0]![0] as { to: string; subject: string; text: string };
      expect(call.to).toBe("submitter@example.com");
      expect(call.subject).toContain(c.to);
      if (c.reason !== null) expect(call.text).toContain(c.reason);
      expect(out.notified).toBe(true);
    }
  });

  it("幂等重放(目标状态=当前状态)不发邮件", async () => {
    const deps = baseDeps({ repo: fakeRepo(row({ status: "已进入迭代" })) });
    const out = await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: null,
      ...ADMIN,
    });
    expect(deps.mail.send).not.toHaveBeenCalled();
    expect(out.notified).toBe(false);
  });

  it("**best-effort**：邮件发送失败不影响状态转移已经成功这件事,也不抛给调用方", async () => {
    const repo = fakeRepo(row());
    const deps = baseDeps({
      repo,
      mail: { send: vi.fn(async () => { throw new Error("smtp down"); }) },
    });
    const out = await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: null,
      ...ADMIN,
    });
    // 状态确实变了、流水确实写了——邮件失败没有让这次转移"看起来没发生"。
    expect(repo.updateStatus).toHaveBeenCalledWith("fb-1", "已进入迭代", null);
    expect(repo.appendStatusEvent).toHaveBeenCalled();
    expect(out.status).toBe("已进入迭代");
    // 失败被如实回报,不是被静默吞掉成 notified:true。
    expect(out.notified).toBe(false);
    // 而且失败**被记录**了,不是真的什么都没发生过。
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("提交人查不到邮箱(账号已注销等)⇒ notified:false,记 info 而非 error", async () => {
    const deps = baseDeps({ submitterDirectory: { emailForUserId: vi.fn(async () => null) } });
    const out = await triageFeedback(deps, {
      feedbackId: "fb-1",
      status: "已进入迭代",
      reason: null,
      issueDraft: null,
      ...ADMIN,
    });
    expect(out.notified).toBe(false);
    expect(deps.mail.send).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalled();
  });
});
