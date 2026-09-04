/**
 * UC-17.8 研发闭环（反馈 → 设计 → 排期）—— 核心交互的可执行断言。
 *
 * 断的几件事：
 *   ① 字段集随「这是什么」切换（缺陷 3 项 ↔ 需求 3 项）。
 *   ② 附件到 5 个后上传入口**隐藏**（不是置灰）。
 *   ③ 收件箱三态：loading / empty / dep-failed 分得开，各自的请求参数正确。
 *   ④ 转「不做」在理由为空时确认按钮禁用；填了理由才能确认，调 `triageFeedback` 带上理由。
 *   ⑤ 看板卡片拖到另一列触发真实迁移调用（反馈 → `PUT /feedback/:id/status`，
 *      系统异常 → `PUT /system/error-logs/:id`）；系统异常拖进「已完成」列**不发请求**。
 *   ⑥ `sources.exception === "withheld"` 时「系统异常」筛选 Chip 禁用并提示「仅平台运维可见」。
 *   ⑦ PM 设计工作台 `pushProject`：项目标记已推送 + `resolvedInbox` 拿到 `D-` 编号
 *      （收件箱本身真栈化后不再由这个 mock store 持有，见 `lib/design-loop-store.tsx` 文件头）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/chat", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream: vi.fn(),
}));

import * as React from "react";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignLoopProvider, useDesignLoop, type Project } from "@/lib/design-loop-store";
import type { InboxItem } from "@/lib/live-inbox";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function wrap() {
  return ({ children }: { children: React.ReactNode }) => <DesignLoopProvider seed={{}}>{children}</DesignLoopProvider>;
}

type Call = [string, { method?: string; body?: Record<string, unknown>; query?: Record<string, string | undefined> } | undefined];
const callsTo = (path: string, method = "GET") =>
  (apiRequest.mock.calls as Call[]).filter(([p, o]) => p === path && (o?.method ?? "GET") === method);

describe("① 快速反馈：字段集随类型切换", () => {
  it("缺陷显示缺陷字段集，切到需求显示需求字段集", async () => {
    render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} />);
    // issue #2679 ②——结构化字段现在只在 review 阶段展示，先写点正文进 review。
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "占位" } });
    fireEvent.click(screen.getByTestId("feedback-proceed-review"));
    await screen.findByTestId("feedback-fields-bug");
    expect(screen.getByTestId("feedback-fields-bug")).toBeTruthy();
    expect(screen.queryByTestId("feedback-fields-req")).toBeNull();
    expect(screen.getByTestId("feedback-field-actual")).toBeTruthy();
    fireEvent.click(screen.getByTestId("feedback-kind-需求"));
    expect(screen.getByTestId("feedback-fields-req")).toBeTruthy();
    expect(screen.queryByTestId("feedback-fields-bug")).toBeNull();
    expect(screen.getByTestId("feedback-field-scene")).toBeTruthy();
    expect(screen.queryByTestId("feedback-field-actual")).toBeNull();
  });
});

describe("② 附件到 5 个后上传入口隐藏", () => {
  it("attachments 达到上限时不再渲染「加文件」入口，而是提示已满", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, text: async () => JSON.stringify({ attachmentId: "a", url: "/x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} />);
      // issue #2679 ②——附件区在 review 阶段才存在，先进 review。
      fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "占位" } });
      fireEvent.click(screen.getByTestId("feedback-proceed-review"));
      await screen.findByTestId("feedback-attachment-input");
      const files = Array.from({ length: 5 }, (_, i) => new File([new Uint8Array([1])], `f${i}.png`, { type: "image/png" }));
      fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files } });
      expect(screen.queryByTestId("feedback-attachment-add")).toBeNull();
      expect(screen.getByTestId("feedback-attachment-full")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ─────────────────────────── 收件箱（B3.4 真栈）─────────────────────────── */

const baseCounts = {
  byStage: { backlog: 1, doing: 0, done: 0, archived: 0 },
  byKind: { feedback: 1, exception: 0, design: 0 },
  total: 1,
  sources: { exception: "included" as const },
};

function feedbackItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "x1", kind: "feedback", code: "B-1", title: "标题一", body: "正文一",
    structured: null, feedbackKind: "缺陷", sourceStatus: "待处理", stage: "backlog",
    statusReason: null, severe: false, votes: 1, reporter: "谁",
    createdAt: "2026-09-01T00:00:00.000Z", github: null, linkedFeedbackId: null,
    resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
    ...over,
  };
}

function exceptionItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "e1", kind: "exception", code: "E-1", title: "异常一", body: "异常正文",
    structured: null, feedbackKind: null, sourceStatus: "待处理", stage: "backlog",
    statusReason: null, severe: false, votes: 0, reporter: null,
    createdAt: "2026-09-01T00:00:00.000Z", github: null, linkedFeedbackId: null,
    resolvedByDesignId: null, exception: { location: "svc", count: 3, affectedUsers: 1 },
    submittedByMe: false, votedByMe: false,
    ...over,
  };
}

function mockInbox(items: InboxItem[], sources: { exception: "included" | "withheld" } = { exception: "included" }) {
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === "/inbox") return { items, nextCursor: null, sources };
    if (path === "/inbox/counts") return { ...baseCounts, sources };
    if (/^\/feedback\/[^/]+\/status$/.test(path) && opts?.method === "PUT") return { status: opts.body?.status };
    if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
    if (/^\/system\/error-logs\/[^/]+$/.test(path) && opts?.method === "PUT") return { status: opts.body?.status };
    throw new Error(`unexpected ${path}`);
  });
}

describe("③ 收件箱三态", () => {
  it("读取中 ⇒ loading；回空 ⇒ empty", async () => {
    let resolve!: (v: unknown) => void;
    apiRequest.mockImplementation((path: string) => {
      if (path === "/inbox") return new Promise((r) => { resolve = r; });
      return Promise.resolve({ ...baseCounts, byStage: { backlog: 0, doing: 0, done: 0, archived: 0 }, byKind: { feedback: 0, exception: 0, design: 0 }, total: 0 });
    });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    expect(screen.getByTestId("loading")).toBeTruthy();
    resolve({ items: [], nextCursor: null, sources: { exception: "included" } });
    expect(await screen.findByTestId("empty")).toBeTruthy();
  });

  it("读取失败 ⇒ dep-failed，可重试", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/inbox") return Promise.reject(new Error("offline"));
      return Promise.resolve(baseCounts);
    });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    expect(await screen.findByTestId("dep-failed")).toBeTruthy();
    mockInbox([feedbackItem()]);
    fireEvent.click(screen.getByTestId("inbox-retry"));
    expect(await screen.findByTestId("inbox-card-B-1")).toBeTruthy();
  });
});

describe("④ 转不做：理由为空禁用，填了才能确认且调真实迁移", () => {
  it("展开理由后确认按钮禁用；填理由后可确认，触发 PUT /feedback/:id/status 带 reason", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-decline"));
    expect(screen.getByTestId("err-reason")).toBeTruthy();
    expect((screen.getByTestId("inbox-decline-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("inbox-decline-reason"), { target: { value: "与别的能力重叠" } });
    expect((screen.getByTestId("inbox-decline-confirm") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("inbox-decline-confirm"));
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/feedback/x1/status", "PUT")[0]!;
    expect(opts!.body!.status).toBe("不做");
    expect(opts!.body!.reason).toBe("与别的能力重叠");
    await waitFor(() => expect(screen.getByTestId("inbox-drawer-reason").textContent).toContain("与别的能力重叠"));
  });
});

describe("⑤ 看板拖放触发真实状态迁移", () => {
  it("反馈：拖到进行中列 ⇒ 乐观挪列 + PUT /feedback/:id/status(已进入迭代)", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("1");
    fireEvent.drop(screen.getByTestId("inbox-column-doing"), { dataTransfer: { getData: () => "x1" } });
    // 乐观更新：列头数字立刻反映挪列（不用等网络）。
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("0");
    expect(screen.getByTestId("inbox-column-count-doing").textContent).toBe("1");
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/feedback/x1/status", "PUT")[0]!;
    expect(opts!.body!.status).toBe("已进入迭代");
    expect(opts!.body!.reason).toBeNull();
  });

  it("系统异常：拖到已完成列不发请求（该边不存在）", async () => {
    mockInbox([exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.drop(screen.getByTestId("inbox-column-done"), { dataTransfer: { getData: () => "e1" } });
    expect(screen.getByTestId("inbox-drag-error")).toBeTruthy();
    expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(0);
    // 卡片仍在原列（没有发生迁移）。
    expect(screen.getByTestId("inbox-card-E-1")).toBeTruthy();
  });

  it("系统异常：拖到进行中列 ⇒ PUT /system/error-logs/:id(已转入开发)", async () => {
    mockInbox([exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.drop(screen.getByTestId("inbox-column-doing"), { dataTransfer: { getData: () => "e1" } });
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/system/error-logs/e1", "PUT")[0]!;
    expect(opts!.body!.status).toBe("已转入开发");
  });

  it("失败时回滚：卡片仍在原列", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/inbox") return { items: [feedbackItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (/^\/feedback\/[^/]+\/status$/.test(path) && opts?.method === "PUT") throw new Error("network down");
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.drop(screen.getByTestId("inbox-column-doing"), { dataTransfer: { getData: () => "x1" } });
    await waitFor(() => expect(screen.getByTestId("inbox-drag-error")).toBeTruthy());
    // 回滚后卡片回到待处理列。
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("1");
    expect(screen.getByTestId("inbox-card-B-1")).toBeTruthy();
  });
});

describe("⑥ 系统异常 withheld：Chip 禁用并提示仅平台运维可见", () => {
  it("sources.exception === withheld ⇒ 系统异常 Chip 禁用、旁边有提示，点它不生效", async () => {
    mockInbox([feedbackItem()], { exception: "withheld" });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    const chip = await screen.findByTestId("inbox-kind-exception");
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("inbox-exception-withheld-hint")).toBeTruthy();
    fireEvent.click(chip);
    expect((chip as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
  });
});

/* ─────────────────────────── B3.5：GitHub 徽标现查升级 + 建 issue 编辑器 ─────────────────────────── */

function mockInboxWithGithub(
  items: InboxItem[],
  githubIssueHandler: (feedbackId: string) => unknown,
) {
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === "/inbox") return { items, nextCursor: null, sources: { exception: "included" } };
    if (path === "/inbox/counts") return baseCounts;
    if (/^\/feedback\/[^/]+\/status$/.test(path) && opts?.method === "PUT") return { status: opts.body?.status, notified: true };
    if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
    const ghMatch = /^\/feedback\/([^/]+)\/github-issue$/.exec(path);
    if (ghMatch) return githubIssueHandler(ghMatch[1]!);
    throw new Error(`unexpected ${path}`);
  });
}

describe("⑧ GitHub 徽标 drawer 展开现查升级", () => {
  it("drawer 打开触发现查；PR 按 merged > open > closed 优先级升级徽标", async () => {
    const item = feedbackItem({
      github: { kind: "issue", number: 10, url: "https://github.com/x/y/issues/10", state: "open" },
    });
    mockInboxWithGithub([item], () => ({
      feedbackId: "x1",
      url: "https://github.com/x/y/issues/10",
      number: 10,
      state: "open",
      stateReason: null,
      linkedPullRequests: [
        { number: 20, url: "https://github.com/x/y/pull/20", title: "closed pr", state: "closed" },
        { number: 21, url: "https://github.com/x/y/pull/21", title: "merged pr", state: "merged" },
        { number: 22, url: "https://github.com/x/y/pull/22", title: "open pr", state: "open" },
      ],
      linkedPullRequestsAvailable: true,
    }));
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    await waitFor(() => expect(callsTo("/feedback/x1/github-issue")).toHaveLength(1));
    // merged 优先级最高，即使 closed/open 也在列表里。
    expect(await screen.findByTestId("github-badge-merged")).toBeTruthy();
    expect(screen.getByTestId("github-badge-merged").textContent).toContain("PR #21");
  });

  it("没有关联 PR 时用现查回来的 issue 真实状态覆盖列表推断值", async () => {
    const item = feedbackItem({
      github: { kind: "issue", number: 10, url: "https://github.com/x/y/issues/10", state: "open" },
    });
    mockInboxWithGithub([item], () => ({
      feedbackId: "x1",
      url: "https://github.com/x/y/issues/10",
      number: 10,
      state: "closed",
      stateReason: "completed",
      linkedPullRequests: [],
      linkedPullRequestsAvailable: true,
    }));
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    expect(await screen.findByTestId("github-badge-closed")).toBeTruthy();
  });

  it("现查失败：不阻塞 drawer 其它内容，徽标退回列表推断值 + 失败提示", async () => {
    const item = feedbackItem({
      github: { kind: "issue", number: 10, url: "https://github.com/x/y/issues/10", state: "open" },
    });
    mockInboxWithGithub([item], () => { throw new Error("rate limited"); });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    await screen.findByTestId("inbox-drawer-github-check-failed");
    // 退回列表推断值（open）而不是整块消失。
    expect(within(screen.getByTestId("inbox-drawer")).getByTestId("github-badge-open")).toBeTruthy();
    // 其余内容（时间线）不受影响，照常渲染。
    expect(screen.getByTestId("inbox-drawer-timeline")).toBeTruthy();
  });

  it("kind === exception / design：github 恒 null，drawer 不渲染徽标区块也不现查", async () => {
    mockInboxWithGithub([exceptionItem()], () => {
      throw new Error("不该被调用");
    });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.click(screen.getByTestId("inbox-card-E-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-drawer-github-loading")).toBeNull();
    expect(screen.queryByTestId("inbox-drawer-github-check-failed")).toBeNull();
    expect(callsTo("/exception/e1/github-issue")).toHaveLength(0);
  });
});

describe("⑨ 建 GitHub Issue 编辑器", () => {
  it("待处理且未关联 github：点「创建 GitHub Issue」打开编辑器，提交调用 triageFeedback(已进入迭代, null, issueDraft)", async () => {
    mockInboxWithGithub([feedbackItem()], () => ({
      feedbackId: "x1",
      url: "https://github.com/x/y/issues/30",
      number: 30,
      state: "open",
      stateReason: null,
      linkedPullRequests: [],
      linkedPullRequestsAvailable: true,
    }));
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-create-issue"));
    expect((screen.getByTestId("inbox-issue-title") as HTMLInputElement).value).toBe("标题一");
    fireEvent.change(screen.getByTestId("inbox-issue-title"), { target: { value: "改过的标题" } });
    fireEvent.click(screen.getByTestId("inbox-issue-submit"));
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/feedback/x1/status", "PUT")[0]!;
    expect(opts!.body!.status).toBe("已进入迭代");
    expect(opts!.body!.reason).toBeNull();
    expect((opts!.body!.issueDraft as { title: string }).title).toBe("改过的标题");
    await waitFor(() => expect(screen.getByTestId("inbox-column-count-doing").textContent).toBe("1"));
  });

  it("已进入迭代态（doing）不提供「创建 GitHub Issue」——doing → doing 是幂等重放，不会真的建 issue", async () => {
    mockInboxWithGithub([feedbackItem({ id: "x2", code: "B-2", stage: "doing", sourceStatus: "已进入迭代" })], () => ({
      feedbackId: "x2", url: "u", number: 1, state: "open", stateReason: null,
      linkedPullRequests: [], linkedPullRequestsAvailable: true,
    }));
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-2");
    fireEvent.click(screen.getByTestId("inbox-card-B-2"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-create-issue")).toBeNull();
  });

  it("已关联 github 的反馈不显示「创建 GitHub Issue」", async () => {
    mockInboxWithGithub(
      [feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })],
      () => ({
        feedbackId: "x1", url: "u", number: 5, state: "open", stateReason: null,
        linkedPullRequests: [], linkedPullRequestsAvailable: true,
      }),
    );
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-create-issue")).toBeNull();
  });

  it("设计方案/系统异常不显示「创建 GitHub Issue」", async () => {
    mockInboxWithGithub([exceptionItem()], () => {
      throw new Error("不该被调用");
    });
    render(<DesignLoopInboxScreen state="default" />, { wrapper: wrap() });
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.click(screen.getByTestId("inbox-card-E-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-create-issue")).toBeNull();
  });
});

describe("⑦ PM 设计工作台：pushProject 标记已推送并生成 D- 编号", () => {
  it("pushProject 后：项目 pushed=true，resolvedInbox 是 D- 开头的编号", () => {
    const project: Project = {
      id: "p1", name: "深化 B-3", template: "wireframe", emoji: "🧩", owner: "我", updated: "2026-09-01T00:00:00.000Z",
      pushed: false, linkedFeedback: "B-3", problem: "问题", criteria: ["a"], frames: ["草稿页 1"], chat: [],
    };
    const { result } = renderHook(() => useDesignLoop(), {
      wrapper: ({ children }) => <DesignLoopProvider seed={{ projects: [project] }}>{children}</DesignLoopProvider>,
    });

    let code = "";
    act(() => { code = result.current.pushProject("p1"); });

    expect(code.startsWith("D-")).toBe(true);
    const p = result.current.projects.find((x) => x.id === "p1")!;
    expect(p.pushed).toBe(true);
    expect(p.resolvedInbox).toBe(code);
  });
});
