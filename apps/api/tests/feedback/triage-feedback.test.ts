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
  FeedbackIssueInProgressError,
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

/**
 * 内存版仓储 fake——只实现用例真正用到的行为,状态可变以观测落库结果。
 *
 * `claimGithubIssueCreation` 的默认实现模拟真实 pg 实现的**同一条不变量**
 * （见 `pg-product-feedback-repository.ts`）：只在 `githubIssueUrl === null` 且
 * 尚未被认领时才能认领成功,认领成功会把 `claimed` 标记为 true,直到
 * `setGithubIssue`（建成功回填）或 `releaseGithubIssueClaim`（建失败释放）
 * 把它改回 false——不是真的原子（内存里没有并发这回事），但对"认领之后
 * 必须被释放或转正,不能悬空"这条不变量的测试是足够的：
 * 需要模拟"另一个并发请求正在办"时,测试直接覆写这个方法本身即可
 * （见下方"认领失败"用例），不需要 fake 自己支持并发。
 */
function fakeRepo(initial: FeedbackRow): ProductFeedbackRepository & { current: FeedbackRow; claimed: boolean } {
  const state = { current: initial, claimed: false };
  return {
    current: state.current,
    get claimed() { return state.claimed; },
    insert: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(async () => state.current),
    setVote: vi.fn(),
    updateStatus: vi.fn(async (_id, status, reason) => {
      state.current = { ...state.current, status, statusReason: reason };
    }),
    appendStatusEvent: vi.fn(),
    claimGithubIssueCreation: vi.fn(async () => {
      if (state.current.githubIssueUrl !== null || state.claimed) return false;
      state.claimed = true;
      return true;
    }),
    releaseGithubIssueClaim: vi.fn(async () => { state.claimed = false; }),
    setGithubIssue: vi.fn(async (_id, issue) => {
      state.current = { ...state.current, githubIssueUrl: issue.url, githubIssueNumber: issue.number };
      state.claimed = false;
    }),
    counts: vi.fn(),
    get [Symbol.toStringTag]() { return "fakeRepo"; },
  } as unknown as ProductFeedbackRepository & { current: FeedbackRow; claimed: boolean };
}

/**
 * ③（2026-09-02）加了 `setState`/`getStatus`/`addComment` 之后,`GithubIssueCreator`
 * 不再只有 `create` 一个方法——这个 fake 只实现本文件真正用到的两个（`create` /
 * `setState`,状态同步那条副作用会调 `setState`),其余两个给一个不会被调用的桩,
 * 免得每条既有用例都要重新声明全部四个方法。
 */
function fakeGithubIssues(
  over: Partial<TriageFeedbackDeps["githubIssues"]> = {},
): TriageFeedbackDeps["githubIssues"] {
  return {
    create: vi.fn(async () => ({ url: "https://github.com/boardx/workspacex/issues/1", number: 1 })),
    setState: vi.fn(async () => {}),
    getStatus: vi.fn(async () => {
      throw new Error("not used in this test");
    }),
    addComment: vi.fn(async () => {
      throw new Error("not used in this test");
    }),
    ...over,
  };
}

function baseDeps(over: Partial<TriageFeedbackDeps> = {}): TriageFeedbackDeps {
  return {
    repo: fakeRepo(row()),
    newEventId: () => "ev-1",
    githubIssues: fakeGithubIssues(),
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
      githubIssues: fakeGithubIssues({ create: vi.fn(async () => { throw new GithubIssueCreationError(500); }) }),
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

  it("建失败 ⇒ 释放认领,不悬空——下一次重试不必等 5 分钟的过期窗口", async () => {
    const repo = fakeRepo(row());
    const deps = baseDeps({
      repo,
      githubIssues: fakeGithubIssues({ create: vi.fn(async () => { throw new GithubIssueCreationError(500); }) }),
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
    expect(repo.claimGithubIssueCreation).toHaveBeenCalledWith("fb-1");
    expect(repo.releaseGithubIssueClaim).toHaveBeenCalledWith("fb-1");
    expect(repo.claimed).toBe(false);
  });

  /**
   * PR #2431 二轮独立审查阻断项①——两个并发的"转开发"请求都读到
   * `githubIssueUrl === null`，但只有一个能真的认领成功。这条用例不模拟
   * "两个请求同时跑"（内存 fake 没有真并发），而是直接模拟"认领这一步失败"
   * ——这正是 `claimGithubIssueCreation` 存在的意义：把"两个请求谁赢"这件事
   * 收敛成数据库一行 UPDATE 的互斥，用例层不需要、也不应该自己再实现一遍
   * 并发判断，只需要正确处理"认领失败"这一个结果。
   */
  it("认领失败(另一个并发请求正在办)⇒ 不调 GitHub,抛 FeedbackIssueInProgressError,状态不落库", async () => {
    const repo = fakeRepo(row());
    (repo.claimGithubIssueCreation as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const deps = baseDeps({ repo });
    await expect(
      triageFeedback(deps, {
        feedbackId: "fb-1",
        status: "已进入迭代",
        reason: null,
        issueDraft: { title: "t", body: "b", labels: [] },
        ...ADMIN,
      }),
    ).rejects.toBeInstanceOf(FeedbackIssueInProgressError);
    expect(deps.githubIssues.create).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.appendStatusEvent).not.toHaveBeenCalled();
    expect(repo.releaseGithubIssueClaim).not.toHaveBeenCalled(); // 没认领到,没有什么好释放的
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

  it("appendStatusEvent 收到的是这次真的发出去的通知快照,不是「本来想发的模板」", async () => {
    const repo = fakeRepo(row({ status: "待处理" }));
    const deps = baseDeps({ repo });
    await triageFeedback(deps, {
      feedbackId: "fb-1", status: "已进入迭代", reason: null, issueDraft: null, ...ADMIN,
    });

    expect(repo.appendStatusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        notified: true,
        emailSubject: expect.stringContaining("已进入迭代"),
        emailText: expect.any(String),
      }),
    );
  });

  it("邮件发送失败 ⇒ appendStatusEvent 收到 notified:false 且 subject/text 为 null,不是「曾经打算发的」内容", async () => {
    const repo = fakeRepo(row());
    const deps = baseDeps({
      repo,
      mail: { send: vi.fn(async () => { throw new Error("smtp down"); }) },
    });
    await triageFeedback(deps, {
      feedbackId: "fb-1", status: "已进入迭代", reason: null, issueDraft: null, ...ADMIN,
    });

    expect(repo.appendStatusEvent).toHaveBeenCalledWith(
      expect.objectContaining({ notified: false, emailSubject: null, emailText: null }),
    );
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
