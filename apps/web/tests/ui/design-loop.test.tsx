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
 *   ⑦ （原 mock store 的 `pushProject` 用例已随 UC-17.8 B6.1 删除原型 store 一起删去；
 *      推送的真栈断言见 ⑩。）
 *   ⑧ UC-17.8 B4.4「用 PM 设计工作台深化」：点击后调真栈 `POST /feedback/:id/deepen`，
 *      跳转带的是服务端返回的**真实** `project.id`（不再是已删除的原型 store 本地
 *      拼出来的 mock id），失败时提示错误且 drawer 不关。
 *   ⑨ UC-17.8 B4.5：PM 设计工作台首页 —— loading/empty/dep-failed 三态；「新建」的
 *      生成中过渡等待真实 `createProject` 返回才导航（不是固定超时）；删除调真实
 *      `deleteProject` 成功才从列表移除。
 *   ⑩ UC-17.8 B4.5：设计详情页 —— 按 `id` 在 `listMyProjects()` 里找不到时展示
 *      「找不到这个设计项目」；发消息调真实 `appendProjectChat`，用服务端整体返回的
 *      `chat`（用户消息 + 固定回执两条）覆盖本地；推送调真实 `pushToInbox`，成功页
 *      两个出口读的是服务端返回的真实 `inboxCode`。
 *   ⑪ UC-17.8 B3.7：收件箱关联标（「已生成方案」/「源自反馈」）可点击——同屏换 drawer
 *      到目标条目、目标卡片/行短暂 `data-highlighted`、生产落点把 `?open=<id>` 写进 URL；
 *      目标不在已加载列表里时老实提示而不是静默。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/live-asr-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-asr-draft")>()),
  openAsrDraftStream: vi.fn(),
}));

import * as React from "react";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { DesignLoopInboxScreen } from "@/components/design-loop/inbox-screen";
import { DesignLoopInboxAdminScreen } from "@/components/admin/design-loop-screens";
import { DesignWorkbenchHome } from "@/components/design-loop/workbench-screen";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import type { InboxItem } from "@/lib/live-inbox";
import type { DesignProject } from "@/lib/live-design-workbench";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

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
    render(<DesignLoopInboxScreen state="default" />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    resolve({ items: [], nextCursor: null, sources: { exception: "included" } });
    expect(await screen.findByTestId("empty")).toBeTruthy();
  });

  it("读取失败 ⇒ dep-failed，可重试", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/inbox") return Promise.reject(new Error("offline"));
      return Promise.resolve(baseCounts);
    });
    render(<DesignLoopInboxScreen state="default" />);
    expect(await screen.findByTestId("dep-failed")).toBeTruthy();
    mockInbox([feedbackItem()]);
    fireEvent.click(screen.getByTestId("inbox-retry"));
    expect(await screen.findByTestId("inbox-card-B-1")).toBeTruthy();
  });
});

describe("④ 转不做：理由为空禁用，填了才能确认且调真实迁移", () => {
  it("展开理由后确认按钮禁用；填理由后可确认，触发 PUT /feedback/:id/status 带 reason", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
    // issue #2752 ①——「全部」视图默认隐藏系统异常，测试显式打开开关切回可见。
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.drop(screen.getByTestId("inbox-column-done"), { dataTransfer: { getData: () => "e1" } });
    expect(screen.getByTestId("inbox-drag-error")).toBeTruthy();
    expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(0);
    // 卡片仍在原列（没有发生迁移）。
    expect(screen.getByTestId("inbox-card-E-1")).toBeTruthy();
  });

  it("系统异常：拖到进行中列 ⇒ PUT /system/error-logs/:id(已转入开发)", async () => {
    mockInbox([exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
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
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    expect(await screen.findByTestId("github-badge-closed")).toBeTruthy();
  });

  it("现查失败：不阻塞 drawer 其它内容，徽标退回列表推断值 + 失败提示", async () => {
    const item = feedbackItem({
      github: { kind: "issue", number: 10, url: "https://github.com/x/y/issues/10", state: "open" },
    });
    mockInboxWithGithub([item], () => { throw new Error("rate limited"); });
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
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
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
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
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-create-issue")).toBeNull();
  });

  it("设计方案/系统异常不显示「创建 GitHub Issue」", async () => {
    mockInboxWithGithub([exceptionItem()], () => {
      throw new Error("不该被调用");
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.click(screen.getByTestId("inbox-card-E-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-create-issue")).toBeNull();
  });
});

/* ─────────────────────────── B3.7：关联标可点击跳转并高亮 ─────────────────────────── */

/** 反馈 B-1（已生成方案 → 设计 d1）与设计 D-1（源自反馈 → x1）互相指向，两端都在同一屏。 */
function designItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "d1", kind: "design", code: "D-1", title: "方案一", body: null,
    structured: null, feedbackKind: null, sourceStatus: "已推送", stage: "backlog",
    statusReason: null, severe: false, votes: 0, reporter: "我",
    createdAt: "2026-09-02T00:00:00.000Z", github: null, linkedFeedbackId: "x1",
    resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
    ...over,
  };
}
const linkedPair = () => [feedbackItem({ resolvedByDesignId: "d1" }), designItem()];

describe("UC-17.8 B3.7：关联标可点击跳转并高亮", () => {
  it("看板：drawer 里点「已生成方案」→ drawer 换成设计条目、目标卡片高亮、回调拿到目标 id；再点「源自反馈」跳回", async () => {
    mockInbox(linkedPair());
    const onOpenLinked = vi.fn();
    render(<DesignLoopInboxScreen state="default" onOpenLinked={onOpenLinked} />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    const drawer = screen.getByTestId("inbox-drawer");
    expect(drawer).toHaveTextContent("标题一");

    fireEvent.click(within(drawer).getByTestId("link-generated-B-1"));
    await waitFor(() => expect(screen.getByTestId("inbox-drawer")).toHaveTextContent("方案一"));
    expect(screen.getByTestId("inbox-card-D-1")).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByTestId("inbox-card-B-1")).not.toHaveAttribute("data-highlighted");
    expect(onOpenLinked).toHaveBeenCalledWith("d1");

    fireEvent.click(within(screen.getByTestId("inbox-drawer")).getByTestId("link-from-D-1"));
    await waitFor(() => expect(screen.getByTestId("inbox-drawer")).toHaveTextContent("标题一"));
    expect(screen.getByTestId("inbox-card-B-1")).toHaveAttribute("data-highlighted", "true");
    expect(onOpenLinked).toHaveBeenLastCalledWith("x1");
  });

  it("列表：行内点「源自反馈」→ 目标行高亮、drawer 是目标条目（徽标点击不冒泡成打开本行）", async () => {
    mockInbox(linkedPair());
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-view-list"));
    const row = screen.getByTestId("inbox-row-D-1");
    fireEvent.click(within(row).getByTestId("link-from-D-1"));
    await waitFor(() => expect(screen.getByTestId("inbox-drawer")).toHaveTextContent("标题一"));
    expect(screen.getByTestId("inbox-drawer")).not.toHaveTextContent("方案一");
    expect(screen.getByTestId("inbox-row-B-1")).toHaveAttribute("data-highlighted", "true");
  });

  it("目标不在当前已加载列表里：老实提示，不开 drawer、不回调", async () => {
    mockInbox([feedbackItem({ resolvedByDesignId: "ghost" })]);
    const onOpenLinked = vi.fn();
    render(<DesignLoopInboxScreen state="default" onOpenLinked={onOpenLinked} />);
    const card = await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(within(card).getByTestId("link-generated-B-1"));
    expect(await screen.findByTestId("inbox-link-target-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-drawer")).toBeNull();
    expect(onOpenLinked).not.toHaveBeenCalled();
  });

  it("生产落点 DesignLoopInboxAdminScreen：跳转后 URL 带 ?open=<目标 id>", async () => {
    mockInbox(linkedPair());
    render(<DesignLoopInboxAdminScreen state="default" />);
    const card = await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(within(card).getByTestId("link-generated-B-1"));
    await waitFor(() => expect(screen.getByTestId("inbox-drawer")).toHaveTextContent("方案一"));
    expect(new URL(window.location.href).searchParams.get("open")).toBe("d1");
  });
});

/* ─────────────────────────── issue #2752：默认隐藏系统异常 + 处理默认方案 + hover 操作 ─────────────────────────── */

describe("issue #2752 ①：「全部」视图默认隐藏系统异常，可切换查看", () => {
  it("混合列表里，默认『全部』视图不渲染系统异常卡片；点开关后出现", async () => {
    mockInbox([feedbackItem(), exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    expect(screen.queryByTestId("inbox-card-E-1")).toBeNull();
    fireEvent.click(screen.getByTestId("inbox-toggle-show-exceptions"));
    expect(await screen.findByTestId("inbox-card-E-1")).toBeTruthy();
  });

  it("单独点『系统异常』筛选 chip 不受开关影响，照常可见", async () => {
    mockInbox([exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-kind-exception"));
    expect(await screen.findByTestId("inbox-card-E-1")).toBeTruthy();
  });

  it("全部条目都是系统异常时，展示专门的隐藏态提示，点『显示系统异常』切回", async () => {
    mockInbox([exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    expect(await screen.findByTestId("empty-hidden-exceptions")).toBeTruthy();
    fireEvent.click(screen.getByTestId("inbox-empty-show-exceptions"));
    expect(await screen.findByTestId("inbox-card-E-1")).toBeTruthy();
  });
});

describe("issue #2752 ②：系统异常的「不做」理由预填默认模板", () => {
  it("系统异常展开不做表单时理由框非空、可直接确认；反馈类仍是空白", async () => {
    mockInbox([exceptionItem()], { exception: "included" });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-decline"));
    const textarea = screen.getByTestId("inbox-decline-reason") as HTMLTextAreaElement;
    expect(textarea.value.trim()).not.toBe("");
    expect(screen.queryByTestId("err-reason")).toBeNull();
    expect((screen.getByTestId("inbox-decline-confirm") as HTMLButtonElement).disabled).toBe(false);
  });

  it("反馈类展开不做表单时理由框仍是空白，需要手填", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-decline"));
    const textarea = screen.getByTestId("inbox-decline-reason") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });
});

describe("issue #2752 ③：hover 卡片/行的快捷操作菜单", () => {
  it("看板卡片：待处理态菜单能一键『开始处理』，不用先点开详情", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-B-1"), { button: 0 });
    fireEvent.click(await screen.findByTestId("inbox-card-menu-start-B-1"));
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    expect(callsTo("/feedback/x1/status", "PUT")[0]![1]!.body!.status).toBe("已进入迭代");
    // 菜单动作不应该顺带把 drawer 打开。
    expect(screen.queryByTestId("inbox-drawer")).toBeNull();
  });

  it("看板卡片：『关闭（不做）…』菜单项落点到 drawer 理由表单，不直接发请求", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-B-1"), { button: 0 });
    fireEvent.click(await screen.findByTestId("inbox-card-menu-close-B-1"));
    expect(await screen.findByTestId("inbox-decline-form")).toBeTruthy();
    expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(0);
  });

  it("设计方案卡片不渲染快捷菜单（没有对应源操作）", async () => {
    mockInbox([
      {
        id: "d1", kind: "design", code: "D-1", title: "方案一", body: "方案正文",
        structured: null, feedbackKind: null, sourceStatus: "待处理", stage: "backlog",
        statusReason: null, severe: false, votes: 0, reporter: null,
        createdAt: "2026-09-01T00:00:00.000Z", github: null, linkedFeedbackId: null,
        resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
      },
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-D-1");
    expect(screen.queryByTestId("inbox-card-menu-D-1")).toBeNull();
  });

  it("列表视图：行菜单同样能一键『开始处理』", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-view-list"));
    fireEvent.pointerDown(await screen.findByTestId("inbox-row-menu-B-1"), { button: 0 });
    fireEvent.click(await screen.findByTestId("inbox-row-menu-start-B-1"));
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
  });
});

/* ─────────────────────────── B4.5：PM 设计工作台真栈 ─────────────────────────── */

function project(over: Partial<DesignProject> = {}): DesignProject {
  return {
    id: "p1", name: "深化 B-3", template: "wireframe", problem: "问题",
    criteria: ["a"], frames: ["草稿页 1"], pushed: false, pushedAt: null,
    linkedFeedbackId: null, chat: [], ownerId: "u1", ownerName: "我",
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("UC-17.8 B4.4：收件箱「用 PM 设计工作台深化」调真栈 POST /feedback/:id/deepen", () => {
  it("点击后调真栈接口，拿到返回的真实 project.id 并关掉 drawer", async () => {
    const onDeepen = vi.fn();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/inbox") return { items: [feedbackItem({ stage: "backlog" })], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (path === "/feedback/x1/deepen" && opts?.method === "POST") {
        return { created: true, project: { id: "dp-real-1", name: "标题一", template: "wireframe", problem: "正文一" } };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" onDeepen={onDeepen} />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-deepen"));
    await waitFor(() => expect(callsTo("/feedback/x1/deepen", "POST")).toHaveLength(1));
    // 跳转拿到的是服务端返回的**真实** project.id，不是本地拼出来的 mock id。
    await waitFor(() => expect(onDeepen).toHaveBeenCalledWith("dp-real-1"));
    // 深化成功后 drawer 关闭。
    expect(screen.queryByTestId("inbox-drawer")).toBeNull();
  });

  it("接口失败时提示错误，drawer 保持打开，不跳转", async () => {
    const onDeepen = vi.fn();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/inbox") return { items: [feedbackItem({ stage: "backlog" })], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (path === "/feedback/x1/deepen" && opts?.method === "POST") throw new Error("dependency_unavailable");
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" onDeepen={onDeepen} />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-deepen"));
    await waitFor(() => expect(callsTo("/feedback/x1/deepen", "POST")).toHaveLength(1));
    expect(onDeepen).not.toHaveBeenCalled();
    expect(screen.getByTestId("inbox-drawer")).toBeTruthy();
  });
});

describe("⑨ PM 设计工作台首页：真栈 listMyProjects / createProject / deleteProject", () => {
  it("读取中 ⇒ loading；回空 ⇒ empty", async () => {
    let resolve!: (v: unknown) => void;
    apiRequest.mockImplementation((path: string) => {
      if (path === "/pm-designs") return new Promise((r) => { resolve = r; });
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    resolve({ items: [] });
    expect(await screen.findByTestId("empty")).toBeTruthy();
  });

  it("读取失败 ⇒ dep-failed，可重试", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/pm-designs") return Promise.reject(new Error("offline"));
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" />);
    expect(await screen.findByTestId("dep-failed")).toBeTruthy();
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project()] };
      throw new Error(`unexpected ${path}`);
    });
    fireEvent.click(screen.getByTestId("workbench-retry"));
    expect(await screen.findByTestId("project-card-p1")).toBeTruthy();
  });

  it("新建：生成中过渡等待真实 createProject 返回才导航（不是固定超时）", async () => {
    const onOpenProject = vi.fn();
    let resolveCreate!: (v: unknown) => void;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [] };
      if (path === "/pm-designs" && opts?.method === "POST") {
        return new Promise((r) => { resolveCreate = r; });
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" onOpenProject={onOpenProject} />);
    await screen.findByTestId("empty");
    fireEvent.click(screen.getByTestId("workbench-new"));
    fireEvent.change(screen.getByTestId("project-dialog-name"), { target: { value: "新设计" } });
    fireEvent.click(screen.getByTestId("project-dialog-submit"));
    // 请求还没返回：仍在生成中过渡，没有导航。
    expect(screen.getByTestId("workbench-generating")).toBeTruthy();
    expect(onOpenProject).not.toHaveBeenCalled();
    resolveCreate({ project: project({ id: "p-real", name: "新设计" }) });
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("p-real"));
  });

  it("删除：调真实 deleteProject 成功才从列表移除", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [project()] };
      if (path === "/pm-designs/p1" && opts?.method === "DELETE") return { projectId: "p1" };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" />);
    await screen.findByTestId("project-card-p1");
    fireEvent.click(screen.getByTestId("project-delete-p1"));
    await waitFor(() => expect(screen.queryByTestId("project-card-p1")).toBeNull());
    expect(apiRequest).toHaveBeenCalledWith("/pm-designs/p1", expect.objectContaining({ method: "DELETE" }));
  });
});

describe("⑩ 设计详情页：真栈 listMyProjects / appendProjectChat / pushToInbox", () => {
  it("id 在 listMyProjects() 里找不到 ⇒ 找不到这个设计项目", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ id: "other" })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    expect(await screen.findByTestId("design-detail-missing")).toBeTruthy();
  });

  it("发消息：调真实 appendProjectChat，用服务端返回的 chat 整体覆盖本地", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/pm-designs") return { items: [project()] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        expect(opts.body?.text).toBe("加个筛选");
        return {
          project: project({
            chat: [
              { role: "user", text: "加个筛选", at: "2026-09-04T00:00:00.000Z" },
              { role: "ai", text: "好的，我记下了这个调整，稍后会更新原型画布。", at: "2026-09-04T00:00:01.000Z", source: "fallback" },
            ],
          }),
          reply: { source: "fallback", applied: [] },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "加个筛选" } });
    fireEvent.click(screen.getByTestId("design-detail-send"));
    await waitFor(() => expect(within(screen.getByTestId("design-detail-chat")).getByText("加个筛选")).toBeTruthy());
    expect(within(screen.getByTestId("design-detail-chat")).getByText(/更新原型画布/)).toBeTruthy();
    // B5.2：退路如实标「固定回执」，没写回就没有「已更新」
    expect(screen.getAllByTestId("design-detail-turn-fallback")).toHaveLength(1);
    expect(screen.queryByTestId("design-detail-chat-applied")).toBeNull();
    // 发送成功后输入框清空。
    expect((screen.getByTestId("design-detail-input") as HTMLTextAreaElement).value).toBe("");
  });

  it("B5.2 发消息：模型写回 criteria/frames ⇒ 右侧随返回的 project 更新，最后一条 AI 气泡下显示「已更新：…」，不挂固定回执标识", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs") return { items: [project()] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        return {
          project: project({
            criteria: ["导出成功率 ≥ 99%"],
            frames: ["首页", "导出页"],
            chat: [
              { role: "user", text: "把成功率写进验收标准", at: "2026-09-04T00:00:00.000Z" },
              { role: "ai", text: "加上了，画布也分成两页。", at: "2026-09-04T00:00:01.000Z", source: "model" },
            ],
          }),
          reply: { source: "model", applied: ["criteria", "frames"] },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "把成功率写进验收标准" } });
    fireEvent.click(screen.getByTestId("design-detail-send"));
    const applied = await screen.findByTestId("design-detail-chat-applied");
    expect(applied.textContent).toContain("验收标准");
    expect(applied.textContent).toContain("画布页");
    expect(applied.textContent).not.toContain("背景");
    expect(screen.queryByTestId("design-detail-turn-fallback")).toBeNull();
    expect(screen.getByTestId("design-detail-frame-1").textContent).toContain("导出页");
  });

  it("推送：调真实 pushToInbox，成功页两个出口读服务端返回的真实 inboxCode", async () => {
    const onOpenInbox = vi.fn();
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs") return { items: [project()] };
      if (path === "/pm-designs/p1/push" && opts?.method === "POST") {
        return { project: project({ pushed: true }), inboxCode: "D-7" };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" onOpenInbox={onOpenInbox} />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-push"));
    fireEvent.click(await screen.findByTestId("design-push-confirm-submit"));
    await screen.findByTestId("design-push-success");
    expect(screen.getByTestId("design-push-success").textContent).toContain("D-7");
    fireEvent.click(screen.getByTestId("design-success-inbox"));
    expect(onOpenInbox).toHaveBeenCalled();
  });
});

/* ─────────────── ⑪ UC-17.8 B6.5：无障碍——拖拽的键盘替代 + 焦点管理 ─────────────── */

describe("⑪ B6.5 无障碍：看板拖拽的键盘替代 + 焦点管理", () => {
  it("卡片：aria-label=编号+标题、aria-describedby 指向键盘替代说明、拖起时 aria-grabbed；列容器 role=group 带列名与数量", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    const card = await screen.findByTestId("inbox-card-B-1");
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("aria-label")).toBe("B-1 标题一");
    expect(card.getAttribute("aria-describedby")).toBe("inbox-drag-hint");
    expect(document.getElementById("inbox-drag-hint")!.textContent).toContain("Enter");
    expect(card.getAttribute("aria-grabbed")).toBe("false");
    fireEvent.dragStart(card, { dataTransfer: { setData: () => undefined } });
    expect(card.getAttribute("aria-grabbed")).toBe("true");
    fireEvent.dragEnd(card);
    expect(card.getAttribute("aria-grabbed")).toBe("false");
    const col = screen.getByTestId("inbox-column-backlog");
    expect(col.getAttribute("role")).toBe("group");
    expect(col.getAttribute("aria-label")).toBe("待处理，1 条");
    // 窄视口下四列横向滚动是显式声明的设计（U8 断言据此放行），不是从 computed style 猜的。
    expect(screen.getByTestId("inbox-board").hasAttribute("data-allow-x-scroll")).toBe(true);
  });

  /**
   * 拖拽能做的每一条**合法**迁移，drawer 里都必须有一个按钮做同样的事（键盘用户没有拖拽）。
   * 这张表 = 两个源状态机从每一列出去的全部边（`product-feedback.ts` `ALLOWED_TRANSITIONS`、
   * `system-error-logs.ts` 头注；系统异常没有 `done` 列），见 `inbox-screen.tsx` 文件头。
   * 断言的是**恰好等于**：少一个按钮 = 某条边键盘不可达；多一个按钮 = 一条服务端会拒绝的假边。
   */
  const TRANSITION_BUTTON = /^inbox-action-(start|done|back|reopen|decline)$/;
  const LEGAL_EDGES: { kind: "feedback" | "exception"; stage: InboxItem["stage"]; buttons: string[] }[] = [
    { kind: "feedback", stage: "backlog", buttons: ["inbox-action-start", "inbox-action-decline"] },
    { kind: "feedback", stage: "doing", buttons: ["inbox-action-done", "inbox-action-back", "inbox-action-decline"] },
    { kind: "feedback", stage: "done", buttons: ["inbox-action-reopen"] },
    { kind: "feedback", stage: "archived", buttons: ["inbox-action-reopen"] },
    { kind: "exception", stage: "backlog", buttons: ["inbox-action-start", "inbox-action-decline"] },
    { kind: "exception", stage: "doing", buttons: ["inbox-action-back", "inbox-action-decline"] },
    { kind: "exception", stage: "archived", buttons: ["inbox-action-reopen"] },
  ];
  for (const edge of LEGAL_EDGES) {
    it(`${edge.kind} @ ${edge.stage}：键盘（Enter）打开 drawer 后，状态迁移按钮恰好是 ${edge.buttons.join(" / ")}`, async () => {
      const item = edge.kind === "feedback" ? feedbackItem({ stage: edge.stage }) : exceptionItem({ stage: edge.stage });
      mockInbox([item]);
      render(<DesignLoopInboxScreen state="default" />);
      // issue #2752 ①——「全部」视图默认隐藏系统异常，测试显式打开开关切回可见。
      if (edge.kind === "exception") fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
      const card = await screen.findByTestId(`inbox-card-${item.code}`);
      fireEvent.keyDown(card, { key: "Enter" });
      const drawer = await screen.findByTestId("inbox-drawer");
      const present = Array.from(drawer.querySelectorAll<HTMLElement>("[data-testid^='inbox-action-']"))
        .map((b) => b.getAttribute("data-testid")!)
        .filter((t) => TRANSITION_BUTTON.test(t))
        .sort();
      expect(present).toEqual([...edge.buttons].sort());
      for (const t of edge.buttons) expect((within(drawer).getByTestId(t) as HTMLButtonElement).disabled).toBe(false);
    });
  }

  it("焦点管理：Enter 打开 drawer 后焦点进 drawer；Esc 关闭；关闭后焦点回到触发卡片", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    const card = await screen.findByTestId("inbox-card-B-1");
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: "Enter" });
    const drawer = await screen.findByTestId("inbox-drawer");
    expect(drawer.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("inbox-drawer")).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("inbox-card-B-1"));
  });

  it("焦点管理：drawer 的关闭按钮关闭后同样把焦点还给触发卡片（不是落回 body）", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    const card = await screen.findByTestId("inbox-card-B-1");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    await screen.findByTestId("inbox-drawer");
    fireEvent.click(screen.getByTestId("inbox-drawer-close"));
    await waitFor(() => expect(screen.queryByTestId("inbox-drawer")).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("inbox-card-B-1"));
  });
});
