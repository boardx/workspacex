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
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

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

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function wrap() {
  return ({ children }: { children: React.ReactNode }) => <DesignLoopProvider seed={{}}>{children}</DesignLoopProvider>;
}

type Call = [string, { method?: string; body?: Record<string, unknown>; query?: Record<string, string | undefined> } | undefined];
const callsTo = (path: string, method = "GET") =>
  (apiRequest.mock.calls as Call[]).filter(([p, o]) => p === path && (o?.method ?? "GET") === method);

describe("① 快速反馈：字段集随类型切换", () => {
  it("缺陷显示缺陷字段集，切到需求显示需求字段集", () => {
    render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} />);
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
  it("attachments 达到上限时不再渲染「加文件」入口，而是提示已满", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, text: async () => JSON.stringify({ attachmentId: "a", url: "/x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={() => undefined} />);
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
