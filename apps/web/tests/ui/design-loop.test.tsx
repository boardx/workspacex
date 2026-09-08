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
// 迭代 8：PNG 导出的 html2canvas 在 jsdom 里跑不了——用 vi.hoisted 定义的 mock（vi.mock 工厂会被提升到 import 之前）。
type FakeCanvas = { toBlob: (cb: (b: Blob | null) => void, type?: string) => void };
const { html2canvasMock } = vi.hoisted(() => ({ html2canvasMock: vi.fn<(el: HTMLElement, opts?: unknown) => Promise<FakeCanvas>>() }));
vi.mock("html2canvas", () => ({ default: html2canvasMock }));
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
import { DesignLoopInboxScreen, INBOX_REFRESH_MS } from "@/components/design-loop/inbox-screen";
import { DesignLoopInboxAdminScreen } from "@/components/admin/design-loop-screens";
import { DesignWorkbenchHome } from "@/components/design-loop/workbench-screen";
import { ApiError } from "@/lib/api-client";
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
  archived: 0,
  byTag: [] as { tag: string; count: number }[],
  sources: { exception: "included" as const },
};

function feedbackItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "x1", kind: "feedback", code: "B-1", title: "标题一", body: "正文一",
    structured: null, feedbackKind: "缺陷", sourceStatus: "待处理", stage: "backlog",
    statusReason: null, severe: false, votes: 1, reporter: "谁",
    createdAt: "2026-09-01T00:00:00.000Z", github: null, attachments: [], linkedFeedbackId: null,
    resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
    boardOrder: 0, tags: [],
    ...over,
  };
}

function exceptionItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "e1", kind: "exception", code: "E-1", title: "异常一", body: "异常正文",
    structured: null, feedbackKind: null, sourceStatus: "待处理", stage: "backlog",
    statusReason: null, severe: false, votes: 0, reporter: null,
    createdAt: "2026-09-01T00:00:00.000Z", github: null, attachments: [], linkedFeedbackId: null,
    resolvedByDesignId: null,
    exception: { location: "svc", count: 3, affectedUsers: 1, devNote: null, lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] },
    submittedByMe: false, votedByMe: false,
    boardOrder: 0, tags: [],
    ...over,
  };
}

function mockInbox(items: InboxItem[], sources: { exception: "included" | "withheld" } = { exception: "included" }) {
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === "/inbox") return { items, nextCursor: null, sources };
    if (path === "/inbox/counts") return { ...baseCounts, sources };
    if (/^\/feedback\/[^/]+\/status$/.test(path) && opts?.method === "PUT") return { status: opts.body?.status };
    if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
    if (/^\/feedback\/[^/]+\/github-issue\/comments$/.test(path)) return { comments: [] };
    if (/^\/system\/error-logs\/[^/]+$/.test(path) && opts?.method === "PUT") return { status: opts.body?.status };
    if (path === "/inbox/order" && opts?.method === "PUT") {
      const orderedIds = (opts.body?.orderedIds as { kind: string; id: string }[] | undefined) ?? [];
      return { stage: opts.body?.stage, count: orderedIds.length };
    }
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
  it("反馈（尚无 issue）：拖到进行中列 ⇒ 不发请求，落到 drawer 的 issue 确认表单（转入开发与建 issue 绑定）", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.drop(screen.getByTestId("inbox-column-doing"), { dataTransfer: { getData: () => "x1" } });
    expect(await screen.findByTestId("inbox-issue-form")).toBeTruthy();
    expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(0);
    // 没有乐观挪列：确认之前状态不变。
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("1");
  });

  it("反馈（已有 issue）：拖到进行中列 ⇒ 乐观挪列 + PUT /feedback/:id/status(已进入迭代)", async () => {
    mockInbox([feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })]);
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
      if (path === "/inbox") {
        return {
          items: [feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })],
          nextCursor: null,
          sources: { exception: "included" },
        };
      }
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

describe("⑫ 归档动作：只对 feedback 且 sourceStatus ∈ {已修复,不做} 显示，点击调 triageFeedback(已归档)", () => {
  it("已修复的反馈卡片：菜单里有「归档」，点击后离开看板进「归档箱」（计数 +1）并调 PUT /feedback/:id/status(已归档)", async () => {
    mockInbox([feedbackItem({ id: "x1", sourceStatus: "已修复", stage: "done" }), feedbackItem({ id: "x2", code: "B-2" })]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    expect(screen.getByTestId("inbox-archived-count").textContent).toBe("0");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-B-1"), { button: 0 });
    expect(await screen.findByTestId("inbox-card-menu-archive-B-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("inbox-card-menu-archive-B-1"));
    // 2026-09-08 ③：归档 = 离开看板（不再挪进「不做」列），归档箱徽标 +1。
    await waitFor(() => expect(screen.queryByTestId("inbox-card-B-1")).toBeNull());
    expect(screen.getByTestId("inbox-card-B-2")).toBeTruthy();
    expect(screen.getByTestId("inbox-archived-count").textContent).toBe("1");
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/feedback/x1/status", "PUT")[0]!;
    expect(opts!.body!.status).toBe("已归档");
    // 已归档不需要理由——不像「不做」那样必填。
    expect(opts!.body!.reason).toBeNull();
  });

  it("待处理的反馈：菜单里没有「归档」（状态机不允许直接归档）", async () => {
    mockInbox([feedbackItem({ id: "x1", sourceStatus: "待处理", stage: "backlog" })]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-B-1"), { button: 0 });
    await screen.findByTestId("inbox-card-menu-start-B-1");
    expect(screen.queryByTestId("inbox-card-menu-archive-B-1")).toBeNull();
  });

  it("系统异常：即使落在「不做」列也没有「归档」菜单项（系统异常没有已归档状态）", async () => {
    mockInbox([exceptionItem({ id: "e1", sourceStatus: "不做", stage: "archived" })]);
    render(<DesignLoopInboxScreen state="default" />);
    // issue #2752 ①——「全部」视图默认隐藏系统异常，先切回可见。
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-E-1"), { button: 0 });
    await waitFor(() => expect(screen.getByTestId("inbox-card-menu-content-E-1")).toBeTruthy());
    expect(screen.queryByTestId("inbox-card-menu-archive-E-1")).toBeNull();
  });
});

describe("⑬ 列内排序：↑↓ 按钮与拖拽落库，且不触发跨列状态迁移", () => {
  it("↑↓ 按钮交换同列内相邻两张卡片的顺序，并调 PUT /inbox/order（不改状态）", async () => {
    mockInbox([
      feedbackItem({ id: "x1", code: "B-1", boardOrder: 0 }),
      feedbackItem({ id: "x2", code: "B-2", boardOrder: 1 }),
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    const col = screen.getByTestId("inbox-column-backlog");
    // 初始顺序：B-1 在 B-2 前面。
    const before = within(col).getAllByRole("button", { name: /^B-\d/ });
    expect(before[0]!.getAttribute("aria-label")).toContain("B-1");
    // 第二张卡片点「上移」，应当与第一张互换。
    fireEvent.click(screen.getByTestId("inbox-card-move-up-B-2"));
    await waitFor(() => expect(callsTo("/inbox/order", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/inbox/order", "PUT")[0]!;
    expect(opts!.body!.stage).toBe("backlog");
    expect((opts!.body!.orderedIds as { id: string }[]).map((o) => o.id)).toEqual(["x2", "x1"]);
    await waitFor(() => {
      const after = within(col).getAllByRole("button", { name: /^B-\d/ });
      expect(after[0]!.getAttribute("aria-label")).toContain("B-2");
    });
    // 没有发状态迁移请求——排序不是分诊。
    expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(0);
    expect(callsTo("/feedback/x2/status", "PUT")).toHaveLength(0);
  });

  it("列首的卡片「上移」按钮禁用，列尾的「下移」按钮禁用", async () => {
    mockInbox([
      feedbackItem({ id: "x1", code: "B-1", boardOrder: 0 }),
      feedbackItem({ id: "x2", code: "B-2", boardOrder: 1 }),
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    expect((screen.getByTestId("inbox-card-move-up-B-1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("inbox-card-move-down-B-2") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("inbox-card-move-down-B-1") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("inbox-card-move-up-B-2") as HTMLButtonElement).disabled).toBe(false);
  });

  it("同列内拖拽落到另一张卡片上 ⇒ 只调 /inbox/order，不触发跨列状态迁移", async () => {
    mockInbox([
      feedbackItem({ id: "x1", code: "B-1", boardOrder: 0 }),
      feedbackItem({ id: "x2", code: "B-2", boardOrder: 1 }),
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    // 把 B-1 拖到 B-2 上面（同列）：应当插到 B-2 前面（顺序不变，因为 B-1 本就在前面）
    // ——换一种更能体现效果的手法：把 B-2 拖到 B-1 上面，B-2 应当被插到 B-1 前面。
    fireEvent.drop(screen.getByTestId("inbox-card-B-1"), { dataTransfer: { getData: () => "x2" } });
    await waitFor(() => expect(callsTo("/inbox/order", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/inbox/order", "PUT")[0]!;
    expect((opts!.body!.orderedIds as { id: string }[]).map((o) => o.id)).toEqual(["x2", "x1"]);
    expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(0);
    expect(callsTo("/feedback/x2/status", "PUT")).toHaveLength(0);
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
    if (/^\/feedback\/[^/]+\/status$/.test(path) && opts?.method === "PUT") return { status: opts.body?.status, notified: true, imageUploadWarnings: [] };
    if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
    if (/^\/feedback\/[^/]+\/github-issue\/comments$/.test(path)) return { comments: [] };
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

describe("⑨ 转入开发 ⇔ 建 GitHub Issue（2026-09-05：不再有独立的「创建 GitHub Issue」按钮）", () => {
  it("待处理且未关联 github：「转入开发」打开整合全部字段的 issue 确认表单，提交调用 triageFeedback(已进入迭代, null, issueDraft)", async () => {
    mockInboxWithGithub(
      [feedbackItem({
        structured: { reproSteps: "1. 打开\n2. 点导出", expectedResult: "导出成功" },
        attachments: [{ id: "fbattach-1", url: "/feedback/attachments/fbattach-1", mime: "application/pdf" }],
      })],
      () => ({
        feedbackId: "x1",
        url: "https://github.com/x/y/issues/30",
        number: 30,
        state: "open",
        stateReason: null,
        linkedPullRequests: [],
        linkedPullRequestsAvailable: true,
      }),
    );
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    expect(screen.queryByTestId("inbox-action-create-issue")).toBeNull();
    fireEvent.click(await screen.findByTestId("inbox-action-start"));
    expect((screen.getByTestId("inbox-issue-title") as HTMLInputElement).value).toBe("标题一");
    const body = (screen.getByTestId("inbox-issue-body") as HTMLTextAreaElement).value;
    // 正文整合：原文 / 结构化字段 / 编号 / 类型 / 提交人 / 票数 / 附件清单 / 来源 id。
    for (const frag of ["正文一", "复现步骤", "1. 打开", "期望结果", "导出成功", "B-1", "缺陷", "谁", "票数", "附件（1 个", "fbattach-1", "反馈 ID x1"]) {
      expect(body).toContain(frag);
    }
    // 表单里列出将随 issue 上传的附件。
    expect(screen.getByTestId("inbox-issue-attachments").textContent).toContain("1 个附件");
    expect(screen.getByTestId("inbox-issue-attachment-fbattach-1")).toBeTruthy();
    fireEvent.change(screen.getByTestId("inbox-issue-title"), { target: { value: "改过的标题" } });
    fireEvent.click(screen.getByTestId("inbox-issue-submit"));
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    const [, opts] = callsTo("/feedback/x1/status", "PUT")[0]!;
    expect(opts!.body!.status).toBe("已进入迭代");
    expect(opts!.body!.reason).toBeNull();
    const draft = opts!.body!.issueDraft as { title: string; labels: string[] };
    expect(draft.title).toBe("改过的标题");
    expect(draft.labels).toEqual(["user-feedback", "bug"]);
    await waitFor(() => expect(screen.getByTestId("inbox-column-count-doing").textContent).toBe("1"));
  });

  it("服务端回 imageUploadWarnings ⇒ 展示持续的附件上传警告，不吞", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/inbox") return { items: [feedbackItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
      if (/^\/feedback\/[^/]+\/github-issue\/comments$/.test(path)) return { comments: [] };
      if (/^\/feedback\/[^/]+\/github-issue$/.test(path)) throw new Error("not yet");
      if (/^\/feedback\/[^/]+\/status$/.test(path) && opts?.method === "PUT") {
        return { feedbackId: "x1", status: "已进入迭代", notified: true, githubIssueUrl: "u", imageUploadWarnings: ["附件 fbattach-9:推送到 GitHub 失败(403)"] };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-start"));
    fireEvent.click(screen.getByTestId("inbox-issue-submit"));
    const warn = await screen.findByTestId("inbox-attachment-upload-warning");
    expect(warn.textContent).toContain("fbattach-9");
  });

  it("已进入迭代态（doing）没有「转入开发」入口——doing → doing 是幂等重放，不会真的建 issue", async () => {
    mockInboxWithGithub([feedbackItem({ id: "x2", code: "B-2", stage: "doing", sourceStatus: "已进入迭代" })], () => ({
      feedbackId: "x2", url: "u", number: 1, state: "open", stateReason: null,
      linkedPullRequests: [], linkedPullRequestsAvailable: true,
    }));
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-2");
    fireEvent.click(screen.getByTestId("inbox-card-B-2"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-start")).toBeNull();
    expect(screen.queryByTestId("inbox-issue-form")).toBeNull();
  });

  it("已关联 github 的待处理反馈：「开始处理」直接迁移，不再弹 issue 表单", async () => {
    mockInboxWithGithub(
      [feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })],
      () => ({
        feedbackId: "x1", url: "https://github.com/x/y/issues/5", number: 5, state: "open", stateReason: null,
        linkedPullRequests: [], linkedPullRequestsAvailable: true,
      }),
    );
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-start"));
    expect(screen.queryByTestId("inbox-issue-form")).toBeNull();
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    expect((callsTo("/feedback/x1/status", "PUT")[0]![1]!.body!.issueDraft)).toBeNull();
  });

  it("系统异常：「开始处理」直接迁移（没有建 issue 的源操作）", async () => {
    mockInboxWithGithub([exceptionItem()], () => {
      throw new Error("不该被调用");
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.click(screen.getByTestId("inbox-card-E-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-start"));
    expect(screen.queryByTestId("inbox-issue-form")).toBeNull();
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
  });
});

describe("2026-09-05：GitHub 徽标是可点击的外链", () => {
  it("卡片上的 Issue 徽标是 <a target=_blank href=url>，点它不会顺带打开 drawer", async () => {
    mockInboxWithGithub(
      [feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })],
      () => { throw new Error("卡片不现查"); },
    );
    render(<DesignLoopInboxScreen state="default" />);
    const badge = await screen.findByTestId("github-badge-open");
    expect(badge.tagName).toBe("A");
    expect(badge.getAttribute("href")).toBe("https://github.com/x/y/issues/5");
    expect(badge.getAttribute("target")).toBe("_blank");
    expect(badge.getAttribute("rel")).toContain("noopener");
    fireEvent.click(badge);
    expect(screen.queryByTestId("inbox-drawer")).toBeNull();
  });

  it("drawer：升级成 PR 徽标后，issue 本体与每条关联 PR 都各有一枚可点的徽标", async () => {
    mockInboxWithGithub(
      [feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })],
      () => ({
        feedbackId: "x1", url: "https://github.com/x/y/issues/5", number: 5, state: "closed", stateReason: "completed",
        linkedPullRequests: [
          { number: 21, url: "https://github.com/x/y/pull/21", title: "fix", state: "merged" },
          { number: 22, url: "https://github.com/x/y/pull/22", title: "follow-up", state: "open" },
        ],
        linkedPullRequestsAvailable: true,
      }),
    );
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    const area = await screen.findByTestId("inbox-drawer-github");
    await waitFor(() => expect(within(area).getByTestId("github-badge-merged")).toBeTruthy());
    const hrefs = Array.from(area.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining([
      "https://github.com/x/y/pull/21",
      "https://github.com/x/y/pull/22",
      "https://github.com/x/y/issues/5",
    ]));
  });
});

describe("2026-09-05：drawer 里看 / 发 GitHub issue 评论", () => {
  function mockWithComments(initial: unknown[]) {
    const store = [...initial];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/inbox") {
        return {
          items: [feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })],
          nextCursor: null,
          sources: { exception: "included" },
        };
      }
      if (path === "/inbox/counts") return baseCounts;
      if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
      if (/^\/feedback\/[^/]+\/github-issue$/.test(path)) {
        return { feedbackId: "x1", url: "https://github.com/x/y/issues/5", number: 5, state: "open", stateReason: null, linkedPullRequests: [], linkedPullRequestsAvailable: true };
      }
      if (/^\/feedback\/[^/]+\/github-issue\/comments$/.test(path) && opts?.method === "POST") {
        store.push({ id: 99, url: "https://github.com/x/y/issues/5#issuecomment-99", author: "ops-bot", body: opts.body?.body, createdAt: "2026-09-05T03:00:00Z" });
        return { feedbackId: "x1", commentUrl: "https://github.com/x/y/issues/5#issuecomment-99" };
      }
      if (/^\/feedback\/[^/]+\/github-issue\/comments$/.test(path)) return { comments: store };
      throw new Error(`unexpected ${path}`);
    });
  }

  it("打开 drawer 拉评论列表并渲染作者/正文；没有 issue 的条目不渲染评论区", async () => {
    mockWithComments([{ id: 7, url: "https://github.com/x/y/issues/5#issuecomment-7", author: "dev-a", body: "已定位到原因", createdAt: "2026-09-05T01:00:00Z" }]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    const list = await screen.findByTestId("inbox-github-comments-list");
    expect(within(list).getByTestId("inbox-github-comment-7").textContent).toContain("dev-a");
    expect(within(list).getByTestId("inbox-github-comment-7").textContent).toContain("已定位到原因");
  });

  it("没有 issue 的反馈：不渲染评论区、不调评论接口", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-github-comments")).toBeNull();
    expect(callsTo("/feedback/x1/github-issue/comments")).toHaveLength(0);
  });

  it("发评论：空白禁用；填了 ⇒ POST /feedback/:id/github-issue/comments，成功后清空输入并重拉列表", async () => {
    mockWithComments([]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    await screen.findByTestId("inbox-github-comments-list");
    const submit = screen.getByTestId("inbox-github-comment-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("inbox-github-comment-input"), { target: { value: "  " } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("inbox-github-comment-input"), { target: { value: "请补充复现视频" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(callsTo("/feedback/x1/github-issue/comments", "POST")).toHaveLength(1));
    expect(callsTo("/feedback/x1/github-issue/comments", "POST")[0]![1]!.body!.body).toBe("请补充复现视频");
    await waitFor(() => expect(screen.getByTestId("inbox-github-comment-99").textContent).toContain("请补充复现视频"));
    expect((screen.getByTestId("inbox-github-comment-input") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("2026-09-05：每 2 分钟静默刷新——服务端轮询把 issue 关闭的反馈转已修复后，这里自动挪到「已完成」", () => {
  it("到点重拉 /inbox + /inbox/counts，按 id 原地合并，卡片挪列且已打开的 drawer 不被关掉", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let round = 0;
      apiRequest.mockImplementation(async (path: string) => {
        if (path === "/inbox") {
          round += 1;
          const status = round === 1 ? "待处理" : "已修复";
          const stage = round === 1 ? "backlog" : "done";
          return {
            items: [feedbackItem({ sourceStatus: status, stage, github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: round === 1 ? "open" : "closed" } })],
            nextCursor: null,
            sources: { exception: "included" },
          };
        }
        if (path === "/inbox/counts") return baseCounts;
        if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
        if (/^\/feedback\/[^/]+\/github-issue\/comments$/.test(path)) return { comments: [] };
        if (/^\/feedback\/[^/]+\/github-issue$/.test(path)) throw new Error("offline");
        throw new Error(`unexpected ${path}`);
      });
      render(<DesignLoopInboxScreen state="default" />);
      fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
      await screen.findByTestId("inbox-drawer");
      expect(within(screen.getByTestId("inbox-column-backlog")).getByTestId("inbox-card-B-1")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(INBOX_REFRESH_MS + 50); });
      await waitFor(() => expect(within(screen.getByTestId("inbox-column-done")).getByTestId("inbox-card-B-1")).toBeTruthy());
      expect(callsTo("/inbox").length).toBeGreaterThanOrEqual(2);
      // drawer 仍然开着（静默刷新不把 load 打回 loading），且状态标签已是「已完成」。
      expect(within(screen.getByTestId("inbox-drawer")).getByTestId("status-badge-done")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ─────────────────────────── B3.7：关联标可点击跳转并高亮 ─────────────────────────── */

/** 反馈 B-1（已生成方案 → 设计 d1）与设计 D-1（源自反馈 → x1）互相指向，两端都在同一屏。 */
function designItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "d1", kind: "design", code: "D-1", title: "方案一", body: null,
    structured: null, feedbackKind: null, sourceStatus: "已推送", stage: "backlog",
    statusReason: null, severe: false, votes: 0, reporter: "我",
    createdAt: "2026-09-02T00:00:00.000Z", github: null, attachments: [], linkedFeedbackId: "x1",
    resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
    boardOrder: 0, tags: [],
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

  it("『全部』= 反馈（需求/缺陷）+ 设计方案：请求带 excludeKind=exception 让服务端过滤；开关打开后不带", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    const first = callsTo("/inbox")[0]![1] as { query?: Record<string, string | undefined> };
    expect(first.query?.excludeKind).toBe("exception");
    expect(first.query?.kind).toBeUndefined();
    fireEvent.click(screen.getByTestId("inbox-toggle-show-exceptions"));
    await waitFor(() => expect(callsTo("/inbox").length).toBeGreaterThanOrEqual(2));
    const last = callsTo("/inbox").at(-1)![1] as { query?: Record<string, string | undefined> };
    expect(last.query?.excludeKind).toBeUndefined();
  });

  it("『全部』徽标数不含系统异常；打开开关后才是 total", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/inbox") return { items: [feedbackItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return { ...baseCounts, byKind: { feedback: 33, exception: 134, design: 0 }, total: 167 };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    await waitFor(() => expect(screen.getByTestId("inbox-kind-all").textContent).toContain("33"));
    expect(screen.getByTestId("inbox-kind-all").textContent).not.toContain("167");
    fireEvent.click(screen.getByTestId("inbox-toggle-show-exceptions"));
    await waitFor(() => expect(screen.getByTestId("inbox-kind-all").textContent).toContain("167"));
  });

  it("服务端已排除后列表为空、但 counts 里有系统异常 ⇒ 展示隐藏态而不是『收件箱是空的』", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/inbox") return { items: [], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return { ...baseCounts, byKind: { feedback: 0, exception: 5, design: 0 }, total: 5 };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    expect(await screen.findByTestId("empty-hidden-exceptions")).toBeTruthy();
    expect(screen.queryByTestId("empty")).toBeNull();
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
  it("看板卡片：待处理态菜单『开始处理』——已有 issue 的反馈一键迁移、不开 drawer", async () => {
    mockInbox([feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-B-1"), { button: 0 });
    fireEvent.click(await screen.findByTestId("inbox-card-menu-start-B-1"));
    await waitFor(() => expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(1));
    expect(callsTo("/feedback/x1/status", "PUT")[0]![1]!.body!.status).toBe("已进入迭代");
    // 菜单动作不应该顺带把 drawer 打开。
    expect(screen.queryByTestId("inbox-drawer")).toBeNull();
  });

  it("看板卡片：待处理态菜单『开始处理』——尚无 issue 的反馈落到 drawer 的 issue 确认表单，不直接发请求（2026-09-05）", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.pointerDown(screen.getByTestId("inbox-card-menu-B-1"), { button: 0 });
    fireEvent.click(await screen.findByTestId("inbox-card-menu-start-B-1"));
    expect(await screen.findByTestId("inbox-issue-form")).toBeTruthy();
    expect(callsTo("/feedback/x1/status", "PUT")).toHaveLength(0);
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
        createdAt: "2026-09-01T00:00:00.000Z", github: null, attachments: [], linkedFeedbackId: null,
        resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
        boardOrder: 0, tags: [],
      },
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-D-1");
    expect(screen.queryByTestId("inbox-card-menu-D-1")).toBeNull();
  });

  it("列表视图：行菜单同样能一键『开始处理』", async () => {
    mockInbox([feedbackItem({ github: { kind: "issue", number: 5, url: "https://github.com/x/y/issues/5", state: "open" } })]);
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
    theme: "dark",
    tags: [],
    refImages: [],
    id: "p1", name: "深化 B-3", template: "wireframe", problem: "问题",
    criteria: ["a"], frames: ["草稿页 1"], prototype: [], frameNotes: [], pushed: false, pushedAt: null,
    linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u1", ownerName: "我",
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


  /**
   * 迭代 13（delta §3）—— V63 / §3.6。引导是**帮忙不是关卡**：跳过之后不再拦。
   * 三张模板卡片已删：它让「挑模板」成了流程第一步，而设备形态本该是澄清完之后的结论。
   */

  /**
   * 迭代 13（delta §5.2）—— V68。**这是本节的核心**：原型主题与后台主题不能分开的话，
   * 这个功能等于没加（做深色 app 的人要看浅色稿，不该被迫把整个后台切成浅色）。
   */

  /**
   * 2026-09-08 CI 实测：编辑改名回 400。原因是 F59 之后编辑路径把 `intake: []` 也捎进了
   * PATCH 体，而 `updateProject.in` 是 .strict()、没有这个字段。
   * 现在类型上就不给带，这条用真实请求体钉住——本地能红，不用等六分钟的 e2e。
   */
  it("编辑保存的 PATCH 体只含可改字段，不夹带 intake", async () => {
    const bodies: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [project({ id: "p1", name: "旧名" })] };
      if (opts?.method === "PATCH") { bodies.push(opts.body); return { project: project({ id: "p1", name: "新名" }) }; }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" />);
    await screen.findByTestId("project-card-p1");
    fireEvent.click(screen.getByTestId("project-edit-p1"));
    fireEvent.change(screen.getByTestId("project-dialog-name"), { target: { value: "新名" } });
    fireEvent.click(screen.getByTestId("project-dialog-submit"));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // ⭐ 反证锚点：把 intake 塞回编辑路径 ⇒ 这条红（服务端 .strict() 会判 400）。
    // 迭代 13：`tags` 进了这个集合——它**总是**发（清空标签框 = 全删，不发就删不掉最后一个）。
    expect(Object.keys(bodies[0] as object).sort()).toEqual(["name", "problem", "tags", "template"]);
  });

  /**
   * 迭代 13（delta `design-chat-inputs` §1）—— V59。参考图三条入口一条上传路径，
   * 且**每一轮对话都带上项目当前的全部参考图**（它是"贴在墙上的参考"，不是某句话的附件）。
   */
  describe("V59 参考图：按钮 / 拖拽 / 粘贴，并随每轮对话发出", () => {
    const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "参考.png", { type: "image/png" });
    const withImage = (over: Partial<DesignProject> = {}) =>
      project({ id: "p1", refImages: [{ id: "ri1", name: "参考.png", size: 4, mime: "image/png", createdAt: "2026-09-08T00:00:00.000Z" }], ...over });

    /** 上传走 multipart（原生 fetch），不经 apiRequest——所以这里两条 mock 都要有。 */
    const stubUpload = (status = 201) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: status < 400,
        status,
        text: async () =>
          status < 400
            ? JSON.stringify({ image: withImage().refImages[0], project: withImage() })
            : JSON.stringify({ reasonCode: "REF_IMAGE_REJECTED", rejectReason: "SIZE" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("选文件后 POST 到本项目的 ref-images，条上出现这张图", async () => {
      apiRequest.mockImplementation(async (path: string) => {
        if (path === "/pm-designs") return { items: [project({ id: "p1" })] };
        throw new Error(`unexpected ${path}`);
      });
      const fetchMock = stubUpload();
      try {
        render(<DesignDetailScreen projectId="p1" />);
        await screen.findByTestId("design-ref-images");
        expect(screen.queryAllByTestId("design-ref-image")).toHaveLength(0);
        fireEvent.change(screen.getByTestId("design-ref-image-file"), { target: { files: [png()] } });
        await waitFor(() => expect(screen.getAllByTestId("design-ref-image")).toHaveLength(1));
        const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData; headers: Record<string, string> }];
        expect(url).toContain("/pm-designs/p1/ref-images");
        expect(init.method).toBe("POST");
        // ⚠ 绝不手设 Content-Type：fetch 要自己带 multipart boundary。
        expect(init.headers["Content-Type"]).toBeUndefined();
        expect((init.body as FormData).get("file")).toBeInstanceOf(File);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("拖进来与粘贴截图走同一条上传路径", async () => {
      apiRequest.mockImplementation(async (path: string) => {
        if (path === "/pm-designs") return { items: [project({ id: "p1" })] };
        throw new Error(`unexpected ${path}`);
      });
      const fetchMock = stubUpload();
      try {
        render(<DesignDetailScreen projectId="p1" />);
        const strip = await screen.findByTestId("design-ref-images");
        // 拖拽悬停时放置区高亮，离开消失（V59 逐字要求的那一半）。
        fireEvent.dragOver(strip);
        expect(strip.className).toContain("border-primary");
        fireEvent.dragLeave(strip);
        expect(strip.className).not.toContain("border-primary");

        fireEvent.dragOver(strip);
        fireEvent.drop(strip, { dataTransfer: { files: [png()] } });
        expect(strip.className).not.toContain("border-primary");
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        cleanup();
        vi.mocked(fetchMock).mockClear();
        render(<DesignDetailScreen projectId="p1" />);
        await screen.findByTestId("design-ref-images");
        // 粘贴挂在 window 上：截图后焦点常常不在输入框里（见 ref-image-strip.tsx 头注）。
        const evt = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
        Object.defineProperty(evt, "clipboardData", {
          value: { items: [{ kind: "file", getAsFile: () => png() }] },
        });
        window.dispatchEvent(evt);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        // ⭐ 反证：把监听挂到 textarea 上 ⇒ 这条红（事件是从 window 派发的）。
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("发消息时带上项目当前的全部参考图 id", async () => {
      const bodies: unknown[] = [];
      apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
        if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [withImage()] };
        if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
          bodies.push(opts.body);
          return { project: withImage(), reply: { source: "model", applied: [], suggestions: [] } };
        }
        throw new Error(`unexpected ${path}`);
      });
      render(<DesignDetailScreen projectId="p1" />);
      await screen.findByTestId("design-detail-input");
      fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "照着这张画" } });
      fireEvent.click(screen.getByTestId("design-detail-send"));
      await waitFor(() => expect(bodies).toHaveLength(1));
      // ⭐ 反证：实现若不带 refImageIds，模型永远看不到用户传的图——这条红。
      expect(bodies[0]).toEqual({ text: "照着这张画", refImageIds: ["ri1"] });
    });

    it("服务端拒绝时说清是哪一种拒绝，不是一句「失败了」", async () => {
      apiRequest.mockImplementation(async (path: string) => {
        if (path === "/pm-designs") return { items: [project({ id: "p1" })] };
        throw new Error(`unexpected ${path}`);
      });
      stubUpload(400);
      try {
        render(<DesignDetailScreen projectId="p1" />);
        await screen.findByTestId("design-ref-images");
        fireEvent.change(screen.getByTestId("design-ref-image-file"), { target: { files: [png()] } });
        // rejectReason=SIZE ⇒ 说的是"太大"，而不是笼统的失败文案
        const err = await screen.findByTestId("design-ref-image-error");
        expect(err.textContent).toContain("4MB");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("已满 3 张时加号禁用，且不发请求", async () => {
      const three = Array.from({ length: 3 }, (_, i) => ({
        id: `ri${i}`, name: `p${i}.png`, size: 4, mime: "image/png" as const, createdAt: "2026-09-08T00:00:00.000Z",
      }));
      apiRequest.mockImplementation(async (path: string) => {
        if (path === "/pm-designs") return { items: [project({ id: "p1", refImages: three })] };
        throw new Error(`unexpected ${path}`);
      });
      const fetchMock = stubUpload();
      try {
        render(<DesignDetailScreen projectId="p1" />);
        await screen.findByTestId("design-ref-images");
        expect(screen.getAllByTestId("design-ref-image")).toHaveLength(3);
        expect((screen.getByTestId("design-ref-image-add") as HTMLButtonElement).disabled).toBe(true);
        // 拖进来也不该发：上限是前端就知道的事，白跑一次往返只会让用户等一下再被拒。
        fireEvent.drop(screen.getByTestId("design-ref-images"), { dataTransfer: { files: [png()] } });
        await waitFor(() => expect(screen.getByTestId("design-ref-image-error")).toBeTruthy());
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("删除后条上少一张，且用的是服务端回来的那份项目", async () => {
      apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
        if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [withImage()] };
        if (path === "/pm-designs/p1/ref-images/ri1" && opts?.method === "DELETE") {
          return { project: project({ id: "p1", refImages: [] }) };
        }
        throw new Error(`unexpected ${path} ${opts?.method}`);
      });
      render(<DesignDetailScreen projectId="p1" />);
      await screen.findByTestId("design-ref-image");
      fireEvent.click(screen.getByTestId("design-ref-image-delete"));
      await waitFor(() => expect(screen.queryAllByTestId("design-ref-image")).toHaveLength(0));
    });
  });

  /** 迭代 13（delta §4）—— V66 的前端一半：chip 词表从项目派生，过滤走服务端参数。 */
  describe("V66 标签过滤（前端）", () => {
    // ⚠ dp-4 的「设计系统」是**只有它带**的标签：按「移动端」过滤会把 dp-4 整个排除，
    //   于是"从当前结果派生词表"的实现会让这个 chip 消失。第一版夹具里没有这样一个标签，
    //   那条断言于是**抓不住**这个变异（实测：改成从结果派生，5 条全绿）。
    const seeded = (tags?: readonly string[]) => [
      project({ id: "dp-1", name: "后台项目", tags: ["后台", "移动端"] }),
      project({ id: "dp-2", name: "只有后台", tags: ["后台"] }),
      project({ id: "dp-3", name: "没标签", tags: [] }),
      project({ id: "dp-4", name: "设计系统", tags: ["设计系统"] }),
    ].filter((p) => (tags ?? []).every((t) => p.tags.includes(t)));

    const mockList = () => {
      const queries: (Record<string, string | undefined> | undefined)[] = [];
      apiRequest.mockImplementation(async (path: string, opts?: { query?: Record<string, string | undefined> }) => {
        if (path !== "/pm-designs") throw new Error(`unexpected ${path}`);
        queries.push(opts?.query);
        const tags = opts?.query?.tags;
        return { items: seeded(tags === undefined ? [] : tags.split(",")) };
      });
      return queries;
    };

    it("chip 词表是**我所有项目**上出现过的标签，去重且不随过滤结果缩水", async () => {
      mockList();
      render(<DesignWorkbenchHome state="default" />);
      await screen.findByTestId("workbench-tag-filter");
      expect(screen.getByTestId("workbench-tag-后台")).toBeTruthy();
      expect(screen.getByTestId("workbench-tag-移动端")).toBeTruthy();

      fireEvent.click(screen.getByTestId("workbench-tag-移动端"));
      await waitFor(() => expect(screen.queryByTestId("project-card-dp-2")).toBeNull());
      // ⭐ 反证：词表若取自"当前结果里的标签"，点一下「移动端」之后「后台」还在（dp-1 有它），
      //   但只要再点一个只有一个项目带的标签，词表就会塌成只剩自己，再也点不到第二个。
      //   这里钉住：过滤后词表**一个都不少**——包括当前结果里已经没有的「设计系统」。
      expect(screen.getByTestId("workbench-tag-后台")).toBeTruthy();
      expect(screen.getByTestId("workbench-tag-移动端")).toBeTruthy();
      expect(screen.queryByTestId("project-card-dp-4")).toBeNull();
      expect(screen.getByTestId("workbench-tag-设计系统")).toBeTruthy();
    });

    it("选两个标签 ⇒ 一个请求带上两个（交集在服务端判，前端不本地过滤）", async () => {
      const queries = mockList();
      render(<DesignWorkbenchHome state="default" />);
      await screen.findByTestId("workbench-tag-后台");
      fireEvent.click(screen.getByTestId("workbench-tag-后台"));
      fireEvent.click(await screen.findByTestId("workbench-tag-移动端"));
      await waitFor(() => expect(queries[queries.length - 1]?.tags).toBe("后台,移动端"));
      // ⭐ 反证：改成前端本地过滤 ⇒ 请求里永远没有 tags，这条红。
      expect(screen.getByTestId("project-card-dp-1")).toBeTruthy();
      expect(screen.queryByTestId("project-card-dp-2")).toBeNull();
    });

    it("「清除筛选」把 tags 参数拿掉，不是发一个空串", async () => {
      const queries = mockList();
      render(<DesignWorkbenchHome state="default" />);
      await screen.findByTestId("workbench-tag-后台");
      fireEvent.click(screen.getByTestId("workbench-tag-后台"));
      await screen.findByTestId("workbench-tag-clear");
      fireEvent.click(screen.getByTestId("workbench-tag-clear"));
      await waitFor(() => expect(screen.getByTestId("project-card-dp-3")).toBeTruthy());
      expect(queries[queries.length - 1]?.tags).toBeUndefined();
    });

    it("卡片上显示标签；没有标签的卡片不渲染空的标签行", async () => {
      mockList();
      render(<DesignWorkbenchHome state="default" />);
      await screen.findByTestId("project-tags-dp-1");
      expect(screen.getByTestId("project-tags-dp-1").textContent).toContain("移动端");
      expect(screen.queryByTestId("project-tags-dp-3")).toBeNull();
    });

    it("弹窗里逗号分隔输入：中英文逗号都认，去空白去重，超上限截断", async () => {
      mockList();
      render(<DesignWorkbenchHome state="default" />);
      fireEvent.click(await screen.findByTestId("workbench-new"));
      const input = await screen.findByTestId("project-tags-input");
      fireEvent.change(input, { target: { value: " 后台 ，后台, 移动端 ,,, " } });
      const preview = screen.getByTestId("project-tags-preview");
      expect([...preview.children].map((c) => c.textContent)).toEqual(["后台", "移动端"]);
    });
  });

  /**
   * 迭代 13（delta §6）—— V70 的前端一半：视觉组默认折叠、内容组默认展开，
   * 且视觉档位改完真的发得出去（含数字档位的回转）。
   */
  describe("V70 属性面板的视觉组", () => {
    const gridProject = () => project({
      id: "p1",
      frames: ["首页"],
      prototype: [{ id: "root", type: "stack", children: [{ id: "g1", type: "grid", props: { columns: 3 }, children: [] }] }],
      frameLinks: [[]],
    });

    const mount = async () => {
      const posted: unknown[] = [];
      apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
        if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [gridProject()] };
        if (path === "/pm-designs/p1/prototype/patch" && opts?.method === "POST") {
          posted.push(opts.body);
          return { project: gridProject() };
        }
        throw new Error(`unexpected ${path}`);
      });
      render(<DesignDetailScreen projectId="p1" />);
      await screen.findByTestId("design-detail-phone-tree");
      fireEvent.click(screen.getByTestId("design-detail-view-single"));
      fireEvent.click(screen.getByTestId("design-detail-phone-tree").querySelector('[data-node-id="g1"]') as HTMLElement);
      await screen.findByTestId("design-inspector");
      return posted;
    };

    it("视觉组默认折叠，展开后才出现；折叠时视觉字段一个都不渲染", async () => {
      await mount();
      expect(screen.queryByTestId("design-inspector-visual")).toBeNull();
      expect(screen.queryByTestId("design-inspector-gap")).toBeNull();
      const toggle = screen.getByTestId("design-inspector-visual-toggle");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(toggle);
      expect(screen.getByTestId("design-inspector-visual")).toBeTruthy();
      expect(screen.getByTestId("design-inspector-gap")).toBeTruthy();
      // ⭐ 反证：视觉组默认展开 ⇒ 第一条红。「像 Figma 但简化」的简化就落在这里。
    });

    it("视觉字段全是下拉，没有一个是自由输入的数字框", async () => {
      await mount();
      fireEvent.click(screen.getByTestId("design-inspector-visual-toggle"));
      const visual = screen.getByTestId("design-inspector-visual");
      const inputs = [...visual.querySelectorAll("input")];
      // ⭐ 反证：把 gap 做成 px 输入 ⇒ 这条红。自由数值会造出落在设计系统之外的值。
      expect(inputs.filter((i) => i.type === "number")).toHaveLength(0);
      expect(visual.querySelectorAll("select").length).toBeGreaterThan(0);
    });

    it("数字档位（grid.columns）显示的是当前值，改完发出去的是**数字**不是字符串", async () => {
      const posted = await mount();
      fireEvent.click(screen.getByTestId("design-inspector-visual-toggle"));
      const sel = screen.getByTestId("design-inspector-columns") as HTMLSelectElement;
      // ⭐ 反证：把它当普通 enum 读 ⇒ 这里会是 ""（"明明是 3 列，面板里显示（默认）"）。
      expect(sel.value).toBe("3");
      fireEvent.change(sel, { target: { value: "2" } });
      fireEvent.click(screen.getByTestId("design-inspector-apply"));
      await waitFor(() => expect(posted).toHaveLength(1));
      // ⭐ 反证：不回转成数字 ⇒ 发出去的是 "2"，被服务端 .strict() 的 props schema 判拒。
      expect((posted[0] as { ops: { props: unknown }[] }).ops[0]!.props).toEqual({ columns: 2 });
    });

    it("清掉一个视觉档位发的是 null（删该键），不是被 JSON 丢掉的 undefined", async () => {
      const posted = await mount();
      fireEvent.click(screen.getByTestId("design-inspector-visual-toggle"));
      fireEvent.change(screen.getByTestId("design-inspector-columns"), { target: { value: "" } });
      fireEvent.click(screen.getByTestId("design-inspector-apply"));
      await waitFor(() => expect(posted).toHaveLength(1));
      // ⭐ 反证：onChange 写 undefined ⇒ 这条红，且现象是"点了应用什么都没发生"（静默失效）。
      expect((posted[0] as { ops: { props: unknown }[] }).ops[0]!.props).toEqual({ columns: null });
    });
  });

  /**
   * 迭代 14 —— 预览时换设备镜头。核心取舍：**镜头不写库**（它是"我现在用什么尺寸看"，
   * 不是"这稿是给什么设备的"），以及机身真的画出来（模拟的意义在于比例与外观是真的）。
   */
  describe("迭代 14 设备模拟", () => {
    const mount = async (template: "mobile" | "ui" | "wireframe" = "mobile") => {
      const bodies: unknown[] = [];
      apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
        if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") {
          return { items: [project({ id: "p1", template, frames: ["首页"], frameLinks: [[]],
            prototype: [{ id: "root", type: "stack", children: [{ id: "b1", type: "button", props: { label: "发送" } }] }] })] };
        }
        if (opts?.method === "PATCH") { bodies.push(opts.body); return { project: project({ id: "p1", template }) }; }
        throw new Error(`unexpected ${path}`);
      });
      render(<DesignDetailScreen projectId="p1" />);
      await screen.findByTestId("design-detail-phone-tree");
      fireEvent.click(screen.getByTestId("design-detail-view-single"));
      return bodies;
    };

    it("默认镜头跟项目模板走；切换后画板尺寸与机身形态都变", async () => {
      await mount("mobile");
      const frame = () => screen.getByTestId("design-detail-phone");
      expect(frame().getAttribute("data-device")).toBe("iphone");
      expect(frame().getAttribute("data-chrome")).toBe("phone");
      expect(frame().style.width).toBe("393px");

      fireEvent.change(screen.getByTestId("design-detail-device"), { target: { value: "laptop" } });
      expect(frame().getAttribute("data-device")).toBe("laptop");
      expect(frame().getAttribute("data-chrome")).toBe("browser");
      expect(frame().style.width).toBe("1280px");
      // ⭐ 反证：尺寸若还从旧的 DEVICE_SIZE 三档来 ⇒ 宽度不会是 1280，这条红。
    });

    it("换镜头**不写库**——一次 PATCH 都不发", async () => {
      const bodies = await mount("mobile");
      fireEvent.change(screen.getByTestId("design-detail-device"), { target: { value: "ipad" } });
      fireEvent.click(screen.getByTestId("design-detail-rotate"));
      await waitFor(() => expect(screen.getByTestId("design-detail-phone").getAttribute("data-device")).toBe("ipad"));
      // ⭐ 反证：把镜头做成 DesignProject 的字段（像 theme 那样 PATCH）⇒ 这条红。
      //   那会让「这稿是给 iPhone 的」和「我现在用 iPhone 尺寸看」混成同一件事。
      expect(bodies).toEqual([]);
    });

    it("旋转交换宽高；桌面浏览器的旋转按钮禁用", async () => {
      await mount("mobile");
      const frame = () => screen.getByTestId("design-detail-phone");
      expect(frame().style.width).toBe("393px");
      fireEvent.click(screen.getByTestId("design-detail-rotate"));
      expect(frame().style.width).toBe("852px");
      expect(frame().getAttribute("data-landscape")).toBe("true");

      fireEvent.change(screen.getByTestId("design-detail-device"), { target: { value: "desktop" } });
      expect((screen.getByTestId("design-detail-rotate") as HTMLButtonElement).disabled).toBe(true);
      // 不可旋转的镜头即便 landscape 状态还留着，也不该被转过来
      expect(frame().getAttribute("data-landscape")).toBe("false");
      expect(frame().style.width).toBe("1440px");
    });

    it("机身 chrome 真的画出来了：手机有灵动岛 + home 条，浏览器有工具栏", async () => {
      await mount("mobile");
      const frame = () => screen.getByTestId("design-detail-phone");
      expect(frame().querySelector('[data-chrome="island"]')).toBeTruthy();
      expect(frame().querySelector('[data-chrome="status"]')).toBeTruthy();
      expect(frame().querySelector('[data-chrome="home"]')).toBeTruthy();
      expect(frame().querySelector('[data-chrome="browser"]')).toBeNull();

      // iPhone SE 是上下额头，不是灵动岛——两者靠形状区分，不是同一个东西
      fireEvent.change(screen.getByTestId("design-detail-device"), { target: { value: "iphone-se" } });
      expect(frame().querySelector('[data-chrome="notch"]')).toBeTruthy();
      expect(frame().querySelector('[data-chrome="island"]')).toBeNull();

      fireEvent.change(screen.getByTestId("design-detail-device"), { target: { value: "laptop" } });
      expect(frame().querySelector('[data-chrome="browser"]')).toBeTruthy();
      expect(frame().querySelector('[data-chrome="home"]')).toBeNull();
      // ⭐ 反证：chrome 若只是换个圆角、不画状态栏/工具栏 ⇒ 这一组全红。"模拟"就剩个空壳。
    });

    it("chrome 是装饰：不进原语树，选不中", async () => {
      await mount("mobile");
      const tree = screen.getByTestId("design-detail-phone-tree");
      // 状态栏/灵动岛都在树**外面**——否则属性面板会多出一批用户根本改不了的目标
      expect(tree.querySelector('[data-chrome]')).toBeNull();
      expect(tree.querySelectorAll('[data-proto]').length).toBeGreaterThan(0);
    });
  });

  it("V68 切原型主题只改画布，后台的 .dark 一动不动", async () => {
    const bodies: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [project({ id: "p1", theme: "dark" })] };
      if (opts?.method === "PATCH") {
        bodies.push(opts.body);
        return { project: project({ id: "p1", theme: "light" }) };
      }
      throw new Error(`unexpected ${path}`);
    });
    // 后台整体是深色（真实形态：html 上挂 .dark）
    document.documentElement.classList.add("dark");
    render(<DesignDetailScreen projectId="p1" />);
    const phone = await screen.findByTestId("design-detail-phone");
    expect(phone.className).toContain("dark");

    fireEvent.click(screen.getByTestId("design-detail-theme-light"));
    await waitFor(() => expect(screen.getByTestId("design-detail-phone").getAttribute("data-theme")).toBe("light"));
    // 画布拿到浅色作用域
    expect(screen.getByTestId("design-detail-phone").className).toContain("wx-light");
    // ⭐ 反证锚点：实现若去切页面全局的 .dark，这条红——那就把后台一起改了。
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // 改的是原型不是别的字段
    expect(bodies).toEqual([{ theme: "light" }]);
    document.documentElement.classList.remove("dark");
  });

  it("V63 整段跳过 ⇒ 直接创建，一次问题都不生成；提交体里没有 intake", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: opts?.body });
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [] };
      if (path === "/pm-designs" && opts?.method === "POST") return { project: project({ id: "p9", name: "跳过建的" }) };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" onOpenProject={vi.fn()} />);
    await screen.findByTestId("empty");
    fireEvent.click(screen.getByTestId("workbench-new"));
    fireEvent.change(screen.getByTestId("project-dialog-name"), { target: { value: "跳过建的" } });
    fireEvent.click(screen.getByTestId("intake-skip-all"));
    await waitFor(() => expect(calls.some((c) => c.path === "/pm-designs" && c.body !== undefined)).toBe(true));
    // ⭐ 反证锚点：实现若在跳过后仍去生成问题（或再拦一次），这两条红。
    expect(calls.some((c) => c.path === "/pm-designs/intake-questions")).toBe(false);
    const created = calls.find((c) => c.path === "/pm-designs" && c.body !== undefined)?.body as Record<string, unknown>;
    expect(created).not.toHaveProperty("intake");
  });

  it("V61/V63 走完问答：只有答了的题进 intake，跳过的不进", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: opts?.body });
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [] };
      if (path === "/pm-designs/intake-questions") {
        return { fallback: false, questions: [
          { dimension: "who", text: "会员分几档？", hint: "例：两档" },
          { dimension: "task", text: "最想省掉哪一步？" },
          { dimension: "success", text: "几步算合格？" },
        ] };
      }
      if (path === "/pm-designs" && opts?.method === "POST") return { project: project({ id: "p8" }) };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" onOpenProject={vi.fn()} />);
    await screen.findByTestId("empty");
    fireEvent.click(screen.getByTestId("workbench-new"));
    fireEvent.change(screen.getByTestId("project-dialog-name"), { target: { value: "牙膏站" } });
    fireEvent.change(screen.getByTestId("project-dialog-problem"), { target: { value: "会员在线下单" } });
    fireEvent.click(screen.getByTestId("intake-ask"));
    await screen.findByTestId("intake-questions");
    // brief 真的发出去了（问题是按它生成的，不是固定问卷）
    expect((calls.find((c) => c.path === "/pm-designs/intake-questions")?.body as { brief: string }).brief).toBe("会员在线下单");
    fireEvent.change(screen.getByTestId("intake-answer-who"), { target: { value: "两档：普通与金卡" } });
    // task 那条**故意不答** —— 它不该出现在 intake 里
    fireEvent.click(screen.getByTestId("intake-next"));
    const guideline = await screen.findByTestId("intake-guideline");
    expect((guideline as HTMLTextAreaElement).value).toContain("两档：普通与金卡");
    fireEvent.click(screen.getByTestId("project-dialog-submit"));
    await waitFor(() => expect(calls.some((c) => c.path === "/pm-designs" && c.body !== undefined)).toBe(true));
    const body = calls.find((c) => c.path === "/pm-designs" && c.body !== undefined)?.body as { intake: { question: string }[] };
    expect(body.intake.map((x) => x.question)).toEqual(["会员分几档？"]);
  });

  it("V62 模型没能生成针对性问题 ⇒ 界面如实说是兜底", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs" && (opts?.method ?? "GET") === "GET") return { items: [] };
      if (path === "/pm-designs/intake-questions") {
        return { fallback: true, questions: [
          { dimension: "who", text: "谁会用这个东西？" }, { dimension: "problem", text: "现在怎么绕过去的？" }, { dimension: "success", text: "做成什么样算做对了？" },
        ] };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignWorkbenchHome state="default" onOpenProject={vi.fn()} />);
    await screen.findByTestId("empty");
    fireEvent.click(screen.getByTestId("workbench-new"));
    fireEvent.change(screen.getByTestId("project-dialog-name"), { target: { value: "随便" } });
    fireEvent.click(screen.getByTestId("intake-ask"));
    // ⭐ 静默用兜底而不说，会让用户以为这就是"针对他"的问题。
    await screen.findByTestId("intake-fallback-notice");
  });

  it("§3.6 三张模板卡片已删，主入口是「新建设计」", async () => {
    apiRequest.mockImplementation(async () => ({ items: [] }));
    render(<DesignWorkbenchHome state="default" />);
    await screen.findByTestId("empty");
    for (const t of ["mobile", "ui", "wireframe"]) {
      expect(screen.queryByTestId(`workbench-template-${t}`)).toBeNull();
    }
    expect(screen.getByTestId("workbench-new")).toBeTruthy();
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
    // 迭代 13：新建走三步问答，「跳过，直接创建」是等价的一步创建路径（提交按钮在第三步）。
    fireEvent.click(screen.getByTestId("intake-skip-all"));
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
          reply: { source: "fallback", applied: [], suggestions: [], fallbackReason: "MODEL_NOT_CONFIGURED" },
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
    // B5.2：退路如实标「未生成」，没写回就没有「已更新」
    expect(screen.getAllByTestId("design-detail-turn-fallback")).toHaveLength(1);
    // 2026-09-07：退路必须说清**为什么**——用户实测时只看到"稍后会更新画布"，等了很久
    // 才发现根本没有东西在生成。原因取自契约闭集，不透传服务端细节。
    expect(screen.getByTestId("design-detail-fallback-reason").textContent).toMatch(/还没配置 AI 模型/);
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
          reply: { source: "model", applied: ["criteria", "frames"], suggestions: [] },
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

  it("B5.3 发消息：模型写回 prototype ⇒ 画布从占位块变成渲染的组件树，切页看到另一页；「已更新」列原型画布", async () => {
    const chatTree = {
      type: "stack" as const, props: { direction: "column" as const },
      children: [
        { type: "navbar" as const, props: { title: "ChatGPT", right: "新对话" } },
        { type: "stack" as const, props: { fill: true }, children: [{ type: "card" as const, children: [{ type: "text" as const, props: { content: "帮我写一封邮件" } }] }] },
        { type: "input" as const, props: { placeholder: "发送消息" } },
        { type: "button" as const, props: { label: "发送", full: true } },
      ],
    };
    const settingsTree = { type: "stack" as const, children: [{ type: "list" as const, props: { items: ["账号", "外观"], leading: "check" as const } }] };
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs") return { items: [project()] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        return {
          project: project({
            frames: ["聊天", "设置"], prototype: [chatTree, settingsTree],
            chat: [
              { role: "user", text: "给我设计一个 chat 的 UI，模拟 chatgpt", at: "2026-09-06T00:00:00.000Z" },
              { role: "ai", text: "画好了两页。", at: "2026-09-06T00:00:01.000Z", source: "model" },
            ],
          }),
          reply: { source: "model", applied: ["frames", "prototype"], suggestions: [] },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    expect(screen.getByTestId("design-detail-phone-placeholder")).toBeTruthy();
    fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "给我设计一个 chat 的 UI，模拟 chatgpt" } });
    fireEvent.click(screen.getByTestId("design-detail-send"));
    expect(await screen.findByTestId("design-detail-generating")).toBeTruthy();
    await screen.findAllByTestId("design-detail-phone-tree");
    fireEvent.click(screen.getByTestId("design-detail-view-single")); // 迭代 4 起默认是画板视图（多页并排），这条断言看单页
    const tree = await screen.findByTestId("design-detail-phone-tree");
    expect(screen.queryByTestId("design-detail-phone-placeholder")).toBeNull();
    expect(tree.textContent).toContain("ChatGPT");
    expect(tree.textContent).toContain("帮我写一封邮件");
    expect(tree.textContent).toContain("发送消息");
    expect(within(tree).getAllByText("发送").length).toBeGreaterThan(0);
    expect(screen.getByTestId("design-detail-chat-applied").textContent).toContain("原型画布");
    fireEvent.click(screen.getByTestId("design-detail-frame-1"));
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("外观");
    expect(screen.queryByTestId("design-detail-generating")).toBeNull();
  });

  it("迭代 2 选中态：点画布节点 ⇒ 焦点 chip 显示标签与路径；发送带 focusNodeId；点 × 清除；节点消失后 chip 自动消失", async () => {
    const tree = {
      type: "stack" as const, id: "n1",
      children: [
        { type: "navbar" as const, id: "n2", props: { title: "首页" } },
        { type: "button" as const, id: "n3", props: { label: "发送" } },
      ],
    };
    const posted: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["聊天"], prototype: [tree] })] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        posted.push(opts.body);
        // 模型把按钮删了 ⇒ 返回的树里没有 n3
        return {
          project: project({ frames: ["聊天"], prototype: [{ ...tree, children: [tree.children[0]!] }], chat: [
            { role: "user", text: "删掉它", at: "2026-09-06T00:00:00.000Z" },
            { role: "ai", text: "删了。", at: "2026-09-06T00:00:01.000Z", source: "model" },
          ] }),
          reply: { source: "model", applied: ["prototype"], suggestions: [] },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    expect(screen.queryByTestId("design-detail-focus")).toBeNull();
    const btn = screen.getByTestId("design-detail-phone-tree").querySelector('[data-node-id="n3"]') as HTMLElement;
    fireEvent.click(btn);
    const chip = screen.getByTestId("design-detail-focus");
    expect(chip.textContent).toContain("按钮「发送」");
    expect(chip.textContent).toContain("纵向布局");
    expect(btn.getAttribute("data-selected")).toBe("true");
    expect((screen.getByTestId("design-detail-input") as HTMLTextAreaElement).placeholder).toContain("这个节点");
    // 清除再选回
    fireEvent.click(screen.getByTestId("design-detail-focus-clear"));
    expect(screen.queryByTestId("design-detail-focus")).toBeNull();
    fireEvent.click(btn);
    fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "删掉它" } });
    fireEvent.click(screen.getByTestId("design-detail-send"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ text: "删掉它", focusNodeId: "n3" });
    await waitFor(() => expect(screen.queryByTestId("design-detail-focus")).toBeNull()); // n3 没了 ⇒ chip 消失
    // 键盘可选：Tab 到节点、Enter 选中、Space 取消
    const nav = screen.getByTestId("design-detail-phone-tree").querySelector('[data-node-id="n2"]') as HTMLElement;
    expect(nav.getAttribute("role")).toBe("button");
    expect(nav.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(nav, { key: "Enter" });
    expect(screen.getByTestId("design-detail-focus").textContent).toContain("导航栏「首页」");
    expect(nav.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(nav, { key: " " });
    expect(screen.queryByTestId("design-detail-focus")).toBeNull();
  });

  it("迭代 2 整页重生成后选中清空：applied 含 frames ⇒ 即使新树里有同名 id 也不沿用（Codex P1）", async () => {
    const tree = { type: "stack" as const, id: "n1", children: [{ type: "button" as const, id: "n2", props: { label: "发送" } }] };
    const regenerated = { type: "stack" as const, id: "n1", children: [{ type: "text" as const, id: "n2", props: { content: "全新的 n2" } }] };
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["页"], prototype: [tree] })] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        return { project: project({ frames: ["新页"], prototype: [regenerated], chat: [{ role: "user", text: "重画", at: "2026-09-06T00:00:00.000Z" }, { role: "ai", text: "重画了。", at: "2026-09-06T00:00:01.000Z", source: "model" }] }), reply: { source: "model", applied: ["frames", "prototype"], suggestions: [] } };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-phone-tree").querySelector('[data-node-id="n2"]') as HTMLElement);
    expect(screen.getByTestId("design-detail-focus").textContent).toContain("按钮「发送」");
    fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "重画" } });
    fireEvent.click(screen.getByTestId("design-detail-send"));
    await waitFor(() => expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("全新的 n2"));
    expect(screen.queryByTestId("design-detail-focus")).toBeNull();
  });

  it("迭代 3 版本历史：打开面板拉列表；点一版 ⇒ 预览横幅 + 画布显示旧树、不可点选；恢复 ⇒ POST、项目整体替换、退出预览、列表刷新", async () => {
    const now = { type: "text" as const, id: "n1", props: { content: "现在的" } };
    const old = { type: "text" as const, id: "n1", props: { content: "旧的" } };
    const calls: string[] = [];
    let restored = false;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      calls.push(`${opts?.method ?? "GET"} ${path}`);
      if (path === "/pm-designs") return { items: [project({ frames: ["页"], prototype: [now] })] };
      if (path === "/pm-designs/p1/versions") return { items: [
        ...(restored ? [{ id: "v3", seq: 3, source: "restore", summary: "恢复自 v1", frames: ["页"], notes: [], createdAt: "2026-09-06T03:00:00.000Z" }] : []),
        { id: "v2", seq: 2, source: "model", summary: "改成现在的", frames: ["页"], notes: [], createdAt: "2026-09-06T02:00:00.000Z" },
        { id: "v1", seq: 1, source: "model", summary: "第一版", frames: ["旧页名"], notes: [], createdAt: "2026-09-06T01:00:00.000Z" },
      ] };
      if (path === "/pm-designs/p1/versions/v1") return { version: { id: "v1", seq: 1, source: "model", summary: "第一版", frames: ["旧页名"], notes: [], createdAt: "2026-09-06T01:00:00.000Z", prototype: [old] } };
      if (path === "/pm-designs/p1/versions/v1/restore" && opts?.method === "POST") {
        restored = true;
        return { project: project({ frames: ["旧页名"], prototype: [old] }), version: { id: "v3", seq: 3, source: "restore", summary: "恢复自 v1", frames: ["旧页名"], notes: [], createdAt: "2026-09-06T03:00:00.000Z" } };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("现在的");
    fireEvent.click(screen.getByTestId("design-detail-history-toggle"));
    await screen.findByTestId("design-history-item-2");
    expect(screen.getByTestId("design-history-item-1").textContent).toContain("第一版");
    fireEvent.click(screen.getByTestId("design-history-preview-1"));
    await screen.findByTestId("design-detail-preview-banner");
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("旧的");
    expect(screen.getByTestId("design-detail-frame-0").textContent).toBe("旧页名");
    // 预览态不可点选
    fireEvent.click(screen.getByTestId("design-detail-phone-tree").querySelector('[data-node-id="n1"]') as HTMLElement);
    expect(screen.queryByTestId("design-detail-focus")).toBeNull();
    fireEvent.click(screen.getByTestId("design-history-restore-1"));
    await waitFor(() => expect(calls).toContain("POST /pm-designs/p1/versions/v1/restore"));
    await waitFor(() => expect(screen.queryByTestId("design-detail-preview-banner")).toBeNull());
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("旧的");
    await screen.findByTestId("design-history-item-3");
    // 退出预览按钮 / 再点同一版取消预览
    fireEvent.click(screen.getByTestId("design-history-preview-1"));
    await screen.findByTestId("design-detail-preview-banner");
    fireEvent.click(screen.getByTestId("design-detail-preview-exit"));
    expect(screen.queryByTestId("design-detail-preview-banner")).toBeNull();
  });

  it("迭代 4 画板视图：默认所有页并排；点标题聚焦该页；−/＋/1:1 改缩放；Ctrl+滚轮缩放、滚轮平移；单页/画板可切换", async () => {
    const t = (c: string) => ({ type: "text" as const, id: `t-${c}`, props: { content: c } });
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["聊天", "设置", "关于"], prototype: [t("一"), t("二"), t("三")] })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    const board = screen.getByTestId("design-detail-board");
    expect(screen.getAllByTestId("design-detail-phone-tree")).toHaveLength(3);
    expect(screen.getByTestId("design-detail-board-frame-2").textContent).toContain("三");
    // 聚焦第 2 页 ⇒ 标签条同步
    fireEvent.click(within(screen.getByTestId("design-detail-board-frame-1")).getByRole("button", { name: /设置/ }));
    expect(screen.getByTestId("design-detail-frame-1").className).toContain("bg-card");
    // 缩放按钮
    const level = () => screen.getByTestId("design-detail-zoom-level").textContent;
    fireEvent.click(screen.getByTestId("design-detail-zoom-reset"));
    expect(level()).toBe("100%");
    fireEvent.click(screen.getByTestId("design-detail-zoom-in"));
    expect(level()).toBe("120%");
    fireEvent.click(screen.getByTestId("design-detail-zoom-out"));
    expect(level()).toBe("100%");
    // Ctrl+滚轮缩放；普通滚轮平移
    fireEvent.wheel(board, { deltaY: -100, ctrlKey: true });
    expect(level()).toBe("120%");
    const before = screen.getByTestId("design-detail-board-stage").style.transform;
    fireEvent.wheel(board, { deltaY: 40, deltaX: 0 });
    expect(screen.getByTestId("design-detail-board-stage").style.transform).not.toBe(before);
    // 缩放工具条上按下指针不会触发画板拖拽（Codex：pointer capture 会吃掉按钮 click）
    const beforeDrag = screen.getByTestId("design-detail-board-stage").style.transform;
    fireEvent.pointerDown(screen.getByTestId("design-detail-zoom-in"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(board, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(board);
    expect(screen.getByTestId("design-detail-board-stage").style.transform).toBe(beforeDrag);
    // 空白处拖拽会平移
    fireEvent.pointerDown(board, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(board, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(board);
    expect(screen.getByTestId("design-detail-board-stage").style.transform).not.toBe(beforeDrag);
    expect(board.className).toContain("touch-none");
    // 点画板里的节点 ⇒ 选中 + 聚焦那页
    fireEvent.click(screen.getByTestId("design-detail-board-frame-2").querySelector('[data-node-id="t-三"]') as HTMLElement);
    expect(screen.getByTestId("design-detail-focus").textContent).toContain("关于");
    // 切单页
    fireEvent.click(screen.getByTestId("design-detail-view-single"));
    expect(screen.queryByTestId("design-detail-board")).toBeNull();
    expect(screen.getAllByTestId("design-detail-phone-tree")).toHaveLength(1);
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("三");
  });

  it("迭代 5 属性面板：选中节点 ⇒ 右栏出现字段；改文案+样式后「应用」只发改动键的 setProps；返回的 project 替换；删除发 remove；服务端 400 的 detail 原样显示", async () => {
    const tree = { type: "stack" as const, id: "n1", children: [{ type: "button" as const, id: "n2", props: { label: "发送" } }] };
    const posted: unknown[] = [];
    let fail = false;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["页"], prototype: [tree] })] };
      if (path === "/pm-designs/p1/prototype/patch" && opts?.method === "POST") {
        posted.push(opts.body);
        if (fail) throw new ApiError(400, "PROTOTYPE_PATCH_REJECTED", { reasonCode: "PROTOTYPE_PATCH_REJECTED", patchReason: "UNKNOWN_NODE", nodeId: "n2" });
        const body = opts.body as { ops: { op: string }[] };
        if (body.ops[0]?.op === "remove") return { project: project({ frames: ["页"], prototype: [{ ...tree, children: [] }] }) };
        return { project: project({ frames: ["页"], prototype: [{ ...tree, children: [{ type: "button", id: "n2", props: { label: "停止", variant: "danger" } }] }] }) };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-view-single"));
    fireEvent.click(screen.getByTestId("design-detail-phone-tree").querySelector('[data-node-id="n2"]') as HTMLElement);
    const inspector = await screen.findByTestId("design-inspector");
    expect(inspector.textContent).toContain("按钮「发送」");
    expect((screen.getByTestId("design-inspector-apply") as HTMLButtonElement).disabled).toBe(true); // 没改不能应用
    fireEvent.change(screen.getByTestId("design-inspector-label"), { target: { value: "停止" } });
    // 迭代 13（V70）：`variant` 是**视觉**字段，默认收在折叠的「外观」组里——要先展开。
    // 内容字段（label）则一直可见，不需要展开。
    expect(screen.queryByTestId("design-inspector-variant")).toBeNull();
    fireEvent.click(screen.getByTestId("design-inspector-visual-toggle"));
    fireEvent.change(screen.getByTestId("design-inspector-variant"), { target: { value: "danger" } });
    fireEvent.click(screen.getByTestId("design-inspector-apply"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ ops: [{ op: "setProps", id: "n2", props: { label: "停止", variant: "danger" } }], summary: "改了按钮「发送」" });
    // 清掉可选属性 ⇒ 发 null（不是被 JSON 丢掉的 undefined）
    await waitFor(() => expect(screen.getByTestId("design-inspector").textContent).toContain("按钮「停止」"));
    fireEvent.change(screen.getByTestId("design-inspector-variant"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("design-inspector-apply"));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect((posted[1] as { ops: unknown[] }).ops).toEqual([{ op: "setProps", id: "n2", props: { variant: null } }]);
    await waitFor(() => expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("停止"));
    expect(screen.getByTestId("design-inspector").textContent).toContain("按钮「停止」"); // 选中保持，面板随新树刷新
    // 失败：detail 原样显示
    fail = true;
    fireEvent.change(screen.getByTestId("design-inspector-label"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("design-inspector-apply"));
    expect((await screen.findByTestId("design-inspector-error")).textContent).toContain("这个节点已经不存在了");
    fail = false;
    // 删除
    fireEvent.click(screen.getByTestId("design-inspector-remove"));
    await waitFor(() => expect(posted).toHaveLength(4));
    expect(posted[3]).toEqual({ ops: [{ op: "remove", id: "n2" }], summary: "删掉了按钮「停止」" });
    await waitFor(() => expect(screen.queryByTestId("design-inspector")).toBeNull());
    expect(screen.getByTestId("design-detail-phone-tree").textContent).not.toContain("停止");
  });

  it("迭代 6：新原语渲染（hero/grid/stat/progress/chip/switch/checkbox/bottomnav）；设备尺寸由模板派生", async () => {
    const page = { type: "stack" as const, id: "r", children: [
      { type: "hero" as const, id: "h", props: { title: "本月用量", cta: "升级套餐" } },
      { type: "grid" as const, id: "g", props: { columns: 3 as const }, children: [{ type: "stat" as const, id: "s", props: { label: "对话数", value: "1,284", delta: "+12%", tone: "success" as const } }] },
      { type: "progress" as const, id: "p", props: { value: 68, label: "配额" } },
      { type: "chip" as const, id: "c", props: { label: "本周", selected: true } },
      { type: "switch" as const, id: "w", props: { label: "提醒", on: true } },
      { type: "checkbox" as const, id: "k", props: { label: "含测试", checked: true } },
      { type: "bottomnav" as const, id: "b", props: { items: ["聊天", "用量"], active: 1 } },
    ] };
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ template: "ui", frames: ["用量"], prototype: [page] })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-view-single"));
    const tree = screen.getByTestId("design-detail-phone-tree");
    for (const t of ["本月用量", "升级套餐", "对话数", "1,284", "+12%", "配额", "68%", "本周", "提醒", "含测试", "聊天", "用量"]) expect(tree.textContent).toContain(t);
    expect(tree.querySelector('[data-proto="grid"]')?.className).toContain("grid-cols-3");
    expect(tree.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("68");
    // 迭代 14：设备预设取代了 phone|tablet|desktop 三档——template ui ⇒ 笔记本镜头（浏览器壳）。
    const frame = screen.getByTestId("design-detail-phone");
    expect(frame.getAttribute("data-device")).toBe("laptop");
    expect(frame.getAttribute("data-chrome")).toBe("browser");
    // 属性面板认识新类型
    fireEvent.click(tree.querySelector('[data-node-id="s"]') as HTMLElement);
    expect(screen.getByTestId("design-inspector").textContent).toContain("指标「对话数」");
    expect(screen.getByTestId("design-inspector-delta")).toBeTruthy();
  });

  it("迭代 7 生成体验：生成中显示已等待秒数与「取消」；取消 ⇒ 草稿保留、无错误；失败 ⇒ 错误条带「重试」，重试重发同一句", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let mode: "hang" | "fail" | "ok" = "hang";
    const posted: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown; signal?: AbortSignal }) => {
      if (path === "/pm-designs") return { items: [project()] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        posted.push(opts.body);
        if (mode === "hang") {
          return new Promise((_resolve, reject) => {
            opts.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          });
        }
        if (mode === "fail") throw new TypeError("Failed to fetch");
        return { project: project({ chat: [{ role: "user", text: "画", at: "2026-09-06T00:00:00.000Z" }, { role: "ai", text: "好", at: "2026-09-06T00:00:01.000Z", source: "model" }] }), reply: { source: "model", applied: [], suggestions: [] } };
      }
      throw new Error(`unexpected ${path}`);
    });
    try {
      render(<DesignDetailScreen projectId="p1" />);
      await screen.findByTestId("design-detail");
      fireEvent.change(screen.getByTestId("design-detail-input"), { target: { value: "画" } });
      fireEvent.click(screen.getByTestId("design-detail-send"));
      await screen.findByTestId("design-detail-generating");
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      expect(screen.getByTestId("design-detail-elapsed").textContent).toBe("5s");
      expect(screen.getByTestId("design-detail-generating").textContent).toContain("生成页面结构");
      fireEvent.click(screen.getByTestId("design-detail-cancel"));
      await waitFor(() => expect(screen.queryByTestId("design-detail-generating")).toBeNull());
      expect(screen.queryByTestId("design-detail-chat-error")).toBeNull();
      expect((screen.getByTestId("design-detail-input") as HTMLTextAreaElement).value).toBe("画");
      // 失败 ⇒ 重试
      mode = "fail";
      fireEvent.click(screen.getByTestId("design-detail-send"));
      await screen.findByTestId("design-detail-chat-error");
      expect(screen.getByTestId("design-detail-chat-error").textContent).toContain("无法连接服务器");
      mode = "ok";
      fireEvent.click(screen.getByTestId("design-detail-retry"));
      await waitFor(() => expect(posted).toHaveLength(3));
      expect(posted[2]).toEqual({ text: "画" });
      await waitFor(() => expect(screen.queryByTestId("design-detail-chat-error")).toBeNull());
      expect((screen.getByTestId("design-detail-input") as HTMLTextAreaElement).value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("迭代 8 导出菜单：JSON 规格下载含页/说明/树；复制 JSON 进剪贴板；PNG 走 html2canvas 抓当前页；说明页显示各页交互说明", async () => {
    const create = vi.fn(() => "blob:x");
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // afterEach 会 reset 所有 mock 的实现，所以在本用例里给
    html2canvasMock.mockImplementation(async () => ({ toBlob: (cb) => cb(new Blob(["png"], { type: "image/png" })) }));
    const tree = { type: "text" as const, id: "n1", props: { content: "你好" } };
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["聊天", "设置"], prototype: [tree, tree], frameNotes: ["首屏即可发消息", ""] })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-export"));
    fireEvent.click(screen.getByTestId("design-detail-export-json"));
    expect(click).toHaveBeenCalledTimes(1);
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    const spec = JSON.parse(await blob.text()) as { version: number; screens: { frame: string; notes: string; root: unknown }[] };
    expect(spec.version).toBe(1);
    expect(spec.screens.map((s) => [s.frame, s.notes])).toEqual([["聊天", "首屏即可发消息"], ["设置", ""]]);
    expect(spec.screens[0]?.root).toEqual(tree);
    // 复制
    fireEvent.click(screen.getByTestId("design-detail-export"));
    fireEvent.click(screen.getByTestId("design-detail-export-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]?.[0])).toContain("首屏即可发消息");
    expect((await screen.findByTestId("design-detail-export-copy")).textContent).toContain("已复制");
    // PNG：html2canvas 被 mock，抓的是 data-frame-index=当前页 的那块屏
    fireEvent.click(screen.getByTestId("design-detail-frame-1"));
    fireEvent.click(screen.getByTestId("design-detail-export-png"));
    await waitFor(() => expect(html2canvasMock).toHaveBeenCalledTimes(1));
    expect((html2canvasMock.mock.calls[0] as unknown as [HTMLElement])[0].getAttribute("data-frame-index")).toBe("1");
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    // 说明页
    fireEvent.click(screen.getByTestId("design-detail-tab-spec"));
    expect(screen.getByTestId("design-detail-notes").textContent).toContain("首屏即可发消息");
    expect(screen.queryByTestId("design-detail-note-1")).toBeNull(); // 空说明的页不列
    click.mockRestore();
  });

  it("迭代 9 起手模板与建议 chips：空项目显示三条起手，点一下即发；AI 回复后显示 suggestions，点一下即发，下一句发出时清掉", async () => {
    const posted: string[] = [];
    let n = 0;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { text: string } }) => {
      if (path === "/pm-designs") return { items: [project({ chat: [] })] };
      if (path === "/pm-designs/p1/chat" && opts?.method === "POST") {
        posted.push(opts.body?.text ?? "");
        n += 1;
        return {
          project: project({ prototype: [{ type: "text", id: "n1", props: { content: "x" } }], chat: [{ role: "user", text: opts.body?.text ?? "", at: "2026-09-06T00:00:00.000Z" }, { role: "ai", text: `第 ${n} 轮`, at: "2026-09-06T00:00:01.000Z", source: "model" }] }),
          reply: { source: "model", applied: ["frames", "prototype"], suggestions: n === 1 ? ["加一个筛选", "设计详情页"] : [] },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    const starters = screen.getByTestId("design-detail-starters");
    expect(starters.querySelectorAll("button")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("design-detail-starter-对话助手"));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toContain("ChatGPT");
    const chips = await screen.findByTestId("design-detail-suggestions");
    expect(chips.textContent).toContain("加一个筛选");
    expect(screen.queryByTestId("design-detail-starters")).toBeNull(); // 有对话后不再显示起手
    fireEvent.click(within(chips).getByText("设计详情页"));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toBe("设计详情页");
    await waitFor(() => expect(screen.queryByTestId("design-detail-suggestions")).toBeNull()); // 第二轮没给建议
  });

  it("B5.3 导出设计文档：点按钮触发一次 .md 下载，内容含问题/验收/原型大纲", async () => {
    const create = vi.fn(() => "blob:doc");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["聊天"], prototype: [{ type: "text", props: { content: "你好" } }] })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-export"));
    fireEvent.click(screen.getByTestId("design-detail-export-doc"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    const md = await blob.text();
    expect(md).toContain("# 深化 B-3");
    expect(md).toContain("## 验收标准");
    expect(md).toContain("### 页 1：聊天");
    expect(md).toContain("文本：你好");
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:doc"), { timeout: 2000 }); // 迭代 10：revoke 延后 1s
    click.mockRestore();
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

describe("⑫ 2026-09-05：系统异常 drawer 的开发备注 / 标签", () => {
  it("异常 drawer 显示开发备注块与已有标签；反馈 drawer 没有这一块", async () => {
    mockInbox([exceptionItem({ exception: { location: "svc", count: 3, affectedUsers: 1, devNote: "转给 @a", lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] }, tags: ["auth"] })]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    await screen.findByTestId("inbox-drawer-exception-dev");
    expect((screen.getByTestId("inbox-drawer-devnote-input") as HTMLTextAreaElement).value).toBe("转给 @a");
    expect(screen.getByTestId("inbox-drawer-tag-auth")).toBeTruthy();
  });

  it("反馈 drawer 不渲染开发备注块（这两个字段不泛化到别的来源）", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-B-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-drawer-exception-dev")).toBeNull();
  });

  it("保存备注 ⇒ PUT /system/error-logs/:id 只带 devNote，不带 status/statusReason", async () => {
    mockInbox([exceptionItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    const ta = await screen.findByTestId("inbox-drawer-devnote-input");
    fireEvent.change(ta, { target: { value: "回调拿不到 code" } });
    fireEvent.click(screen.getByTestId("inbox-drawer-devnote-save"));
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
    const body = callsTo("/system/error-logs/e1", "PUT")[0]![1]!.body!;
    expect(body.devNote).toBe("回调拿不到 code");
    // 契约的 REASON_REQUIRES_STATUS：只改备注的请求绝不能顺带带上这两个键。
    expect("status" in body).toBe(false);
    expect("statusReason" in body).toBe(false);
  });

  it("备注没有改动时保存按钮禁用（不产生一次无意义的写）", async () => {
    mockInbox([exceptionItem({ exception: { location: "svc", count: 1, affectedUsers: null, devNote: "已有备注", lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] }, tags: [] })]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    const save = (await screen.findByTestId("inbox-drawer-devnote-save")) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("inbox-drawer-devnote-input"), { target: { value: "改了" } });
    expect((screen.getByTestId("inbox-drawer-devnote-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("清空备注 ⇒ 提交 null（不是空字符串）", async () => {
    mockInbox([exceptionItem({ exception: { location: "svc", count: 1, affectedUsers: null, devNote: "旧的", lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] }, tags: [] })]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    fireEvent.change(await screen.findByTestId("inbox-drawer-devnote-input"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("inbox-drawer-devnote-save"));
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
    expect(callsTo("/system/error-logs/e1", "PUT")[0]![1]!.body!.devNote).toBeNull();
  });

  it("加标签走回车 ⇒ 提交合并后的整个 tags 数组；重复标签不产生请求", async () => {
    mockInbox([exceptionItem({ exception: { location: "svc", count: 1, affectedUsers: null, devNote: null, lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] }, tags: ["auth"] })]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    fireEvent.click(await screen.findByTestId("inbox-drawer-tag-add"));
    const input = await screen.findByTestId("inbox-drawer-tag-input");
    fireEvent.change(input, { target: { value: "P1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
    expect(callsTo("/system/error-logs/e1", "PUT")[0]![1]!.body!.tags).toEqual(["auth", "P1"]);

    // 重复标签：不再发第二次请求。
    fireEvent.change(input, { target: { value: "auth" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1);
  });

  it("移除标签 ⇒ 提交去掉那一个之后的数组", async () => {
    mockInbox([exceptionItem({ exception: { location: "svc", count: 1, affectedUsers: null, devNote: null, lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] }, tags: ["auth", "P1"] })]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    fireEvent.click(await screen.findByTestId("inbox-card-E-1"));
    fireEvent.click(await screen.findByTestId("inbox-drawer-tag-remove-auth"));
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
    expect(callsTo("/system/error-logs/e1", "PUT")[0]![1]!.body!.tags).toEqual(["P1"]);
  });
});

describe("2026-09-08：看板五条改进（同异常折叠 / 归档箱 / 标签）", () => {
  it("同一异常折叠后卡片显示「×N · 最近」，drawer 有发生记录；count=1 时不显示", async () => {
    mockInbox([
      exceptionItem({
        id: "e1", code: "E-1",
        exception: { location: "svc", count: 3, affectedUsers: null, devNote: null, lastSeenAt: "2026-09-03T00:00:00.000Z", occurrences: ["2026-09-03T00:00:00.000Z", "2026-09-02T00:00:00.000Z", "2026-09-01T00:00:00.000Z"] },
      }),
      exceptionItem({ id: "e2", code: "E-2", exception: { location: "svc", count: 1, affectedUsers: null, devNote: null, lastSeenAt: "2026-09-01T00:00:00.000Z", occurrences: ["2026-09-01T00:00:00.000Z"] } }),
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    await screen.findByTestId("inbox-card-E-1");
    expect(screen.getByTestId("inbox-card-recurrence-E-1").textContent).toContain("×3");
    expect(screen.queryByTestId("inbox-card-recurrence-E-2")).toBeNull();
    fireEvent.click(screen.getByTestId("inbox-card-E-1"));
    const occ = await screen.findByTestId("inbox-drawer-occurrences");
    expect(occ.querySelectorAll("li")).toHaveLength(3);
  });

  it("看板每一列自己滚动：列体是 overflow-y-auto 的独立容器，卡片都在列体内", async () => {
    mockInbox([feedbackItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    for (const col of ["backlog", "doing", "done", "archived"]) {
      const body = screen.getByTestId(`inbox-column-body-${col}`);
      expect(body.className).toContain("overflow-y-auto");
      expect(screen.getByTestId(`inbox-column-${col}`).className).toContain("min-h-0");
    }
    expect(within(screen.getByTestId("inbox-column-body-backlog")).getByTestId("inbox-card-B-1")).toBeTruthy();
  });

  it("归档箱：切换后以 view=archived 请求、只有列表视图、行上「重新打开」把它移出归档箱", async () => {
    const archived = feedbackItem({ id: "a1", code: "B-9", sourceStatus: "已归档", stage: "archived" });
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown>; query?: Record<string, string | undefined> }) => {
      if (path === "/inbox") return { items: opts?.query?.view === "archived" ? [archived] : [feedbackItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return { ...baseCounts, archived: 1 };
      if (path === "/feedback/a1/status" && opts?.method === "PUT") return { status: "待处理" };
      if (/^\/feedback\/[^/]+\/events$/.test(path)) return { events: [] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-toggle-archived"));
    await screen.findByTestId("inbox-archived-hint");
    expect(screen.queryByTestId("inbox-board")).toBeNull();
    expect((screen.getByTestId("inbox-view-board") as HTMLButtonElement).disabled).toBe(true);
    const row = await screen.findByTestId("inbox-row-B-9");
    expect(within(row).getByTestId("status-badge-archived-feedback").textContent).toBe("已归档");
    expect(callsTo("/inbox").some(([, o]) => o?.query?.view === "archived")).toBe(true);
    fireEvent.pointerDown(screen.getByTestId("inbox-row-menu-B-9"), { button: 0 });
    fireEvent.click(await screen.findByTestId("inbox-row-menu-reopen-B-9"));
    await waitFor(() => expect(screen.queryByTestId("inbox-row-B-9")).toBeNull());
    await waitFor(() => expect(callsTo("/feedback/a1/status", "PUT")).toHaveLength(1));
    expect(screen.getByTestId("inbox-archived-count").textContent).toBe("0");
  });

  it("卡片上加标签：反馈走 PUT /inbox/tags（覆盖式整个集合）；系统异常走 PUT /system/error-logs/:id", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/inbox") return { items: [feedbackItem({ tags: ["旧"] }), exceptionItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (path === "/inbox/tags" && opts?.method === "PUT") return { kind: opts.body?.kind, id: opts.body?.id, tags: opts.body?.tags };
      if (path === "/system/error-logs/e1" && opts?.method === "PUT") return { status: "待处理" };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-toggle-show-exceptions"));
    await screen.findByTestId("inbox-card-E-1");
    fireEvent.click(screen.getByTestId("inbox-card-B-1-tag-add"));
    const input = screen.getByTestId("inbox-card-B-1-tag-input");
    fireEvent.change(input, { target: { value: "登录" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(callsTo("/inbox/tags", "PUT")).toHaveLength(1));
    expect(callsTo("/inbox/tags", "PUT")[0]![1]!.body).toEqual({ kind: "feedback", id: "x1", tags: ["旧", "登录"] });
    expect(screen.getByTestId("inbox-card-B-1-tag-登录")).toBeTruthy();
    // 输入框里按空格 / 回车不会把卡片当成「打开」——drawer 没有被打开。
    expect(screen.queryByTestId("inbox-drawer")).toBeNull();

    fireEvent.click(screen.getByTestId("inbox-card-E-1-tag-add"));
    const exInput = screen.getByTestId("inbox-card-E-1-tag-input");
    fireEvent.change(exInput, { target: { value: "P1" } });
    fireEvent.keyDown(exInput, { key: "Enter" });
    await waitFor(() => expect(callsTo("/system/error-logs/e1", "PUT")).toHaveLength(1));
    expect(callsTo("/system/error-logs/e1", "PUT")[0]![1]!.body!.tags).toEqual(["P1"]);
    expect(callsTo("/inbox/tags", "PUT")).toHaveLength(1);
  });

  it("顶部标签筛选：Chip 来自 counts.byTag；点 Chip 或卡片上的标签 ⇒ 以 tag 参数重新请求；再点一次取消", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/inbox") return { items: [feedbackItem({ tags: ["登录"] })], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return { ...baseCounts, byTag: [{ tag: "登录", count: 3 }, { tag: "导出", count: 1 }] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    await screen.findByTestId("inbox-tag-filter");
    expect(screen.getByTestId("inbox-tag-filter-导出")).toBeTruthy();
    fireEvent.click(screen.getByTestId("inbox-tag-filter-登录"));
    await waitFor(() => expect(callsTo("/inbox").some(([, o]) => o?.query?.tag === "登录")).toBe(true));
    expect(screen.getByTestId("inbox-tag-filter-登录").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("inbox-tag-filter-clear"));
    await waitFor(() => expect(screen.getByTestId("inbox-tag-filter-登录").getAttribute("aria-pressed")).toBe("false"));
    // 卡片上的标签芯片也是筛选入口。
    const before = callsTo("/inbox").length;
    fireEvent.click(screen.getByTestId("inbox-card-B-1-tag-登录-filter"));
    await waitFor(() => expect(callsTo("/inbox").length).toBeGreaterThan(before));
    expect(callsTo("/inbox")[callsTo("/inbox").length - 1]![1]!.query!.tag).toBe("登录");
  });

  it("列表视图重做：两层信息（标题 + 元信息行）、标签编辑器、行数", async () => {
    mockInbox([feedbackItem({ tags: ["登录"] })]);
    render(<DesignLoopInboxScreen state="default" />);
    await screen.findByTestId("inbox-card-B-1");
    fireEvent.click(screen.getByTestId("inbox-view-list"));
    const row = await screen.findByTestId("inbox-row-B-1");
    expect(within(row).getByText("标题一")).toBeTruthy();
    expect(within(row).getByText("B-1")).toBeTruthy();
    expect(within(row).getByTestId("inbox-row-B-1-tag-登录")).toBeTruthy();
    expect(screen.getByTestId("inbox-list-count").textContent).toBe("1 条");
  });
});

describe("⑬ 2026-09-05：设计方案「转开发」——收件箱 drawer 建 GitHub Issue", () => {
  it("没有 issue 的设计条目 ⇒ drawer 有「转入开发」按钮（此前 design 条目没有任何操作）", async () => {
    mockInbox([designItem()]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-D-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.getByTestId("inbox-action-design-handoff")).toBeTruthy();
    expect(screen.queryByTestId("inbox-design-handed-off")).toBeNull();
  });

  it("点「转入开发」展开 issue 编辑器；设计方案不显示附件清单块（它没有附件这个概念）", async () => {
    mockInbox([designItem({ body: "要重做导出流程" })]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-D-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-design-handoff"));
    await screen.findByTestId("inbox-issue-form");
    expect((screen.getByTestId("inbox-issue-title") as HTMLInputElement).value).toBe("方案一");
    expect((screen.getByTestId("inbox-issue-body") as HTMLTextAreaElement).value).toContain("要重做导出流程");
    expect(screen.queryByTestId("inbox-issue-attachments")).toBeNull();
  });

  it("确认后调 POST /pm-designs/:id/github-issue（不是反馈那条 triageFeedback）", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/inbox") return { items: [designItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (path === "/pm-designs/d1/github-issue" && opts?.method === "POST") {
        return {
          project: {
            id: "d1", name: "方案一", template: "wireframe", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [],
            pushed: true, pushedAt: "2026-09-02T00:00:00.000Z", linkedFeedbackId: "x1",
            githubIssueUrl: "https://github.com/boardx/workspacex/issues/77", githubIssueNumber: 77,
            chat: [], ownerId: "u1", ownerName: "我",
            createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
          },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-D-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-design-handoff"));
    fireEvent.click(await screen.findByTestId("inbox-issue-submit"));
    await waitFor(() => expect(callsTo("/pm-designs/d1/github-issue", "POST")).toHaveLength(1));
    // 绝不能走反馈那条：那会把一个设计方案当成反馈去转状态。
    expect(callsTo("/feedback/d1/status", "PUT")).toHaveLength(0);
    const body = callsTo("/pm-designs/d1/github-issue", "POST")[0]![1]!.body!;
    expect((body.draft as { title: string }).title).toBe("方案一");
  });

  it("成功后卡片进「进行中」列并挂上 issue 徽标（stage 由有没有 issue 派生）", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/inbox") return { items: [designItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (path === "/pm-designs/d1/github-issue" && opts?.method === "POST") {
        return {
          project: {
            id: "d1", name: "方案一", template: "wireframe", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [],
            pushed: true, pushedAt: "2026-09-02T00:00:00.000Z", linkedFeedbackId: "x1",
            githubIssueUrl: "https://github.com/boardx/workspacex/issues/77", githubIssueNumber: 77,
            chat: [], ownerId: "u1", ownerName: "我",
            createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
          },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-D-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-design-handoff"));
    fireEvent.click(await screen.findByTestId("inbox-issue-submit"));
    await waitFor(() => expect(screen.getByTestId("inbox-column-count-doing").textContent).toBe("1"));
    expect(within(screen.getByTestId("inbox-column-doing")).getByTestId("inbox-card-D-1")).toBeTruthy();
  });

  it("已经有 issue 的设计条目 ⇒ 不再显示「转入开发」，改为提示已转开发", async () => {
    mockInbox([
      designItem({
        stage: "doing",
        sourceStatus: "已转开发",
        github: { kind: "issue", number: 77, url: "https://github.com/o/r/issues/77", state: "open" },
      }),
    ]);
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-D-1"));
    await screen.findByTestId("inbox-drawer");
    expect(screen.queryByTestId("inbox-action-design-handoff")).toBeNull();
    expect(screen.getByTestId("inbox-design-handed-off")).toBeTruthy();
  });

  it("建失败 ⇒ 显示错误、卡片留在原列（这条操作没改过状态，无需回滚）", async () => {
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/inbox") return { items: [designItem()], nextCursor: null, sources: { exception: "included" } };
      if (path === "/inbox/counts") return baseCounts;
      if (path === "/pm-designs/d1/github-issue" && opts?.method === "POST") throw new Error("github down");
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignLoopInboxScreen state="default" />);
    fireEvent.click(await screen.findByTestId("inbox-card-D-1"));
    fireEvent.click(await screen.findByTestId("inbox-action-design-handoff"));
    fireEvent.click(await screen.findByTestId("inbox-issue-submit"));
    await waitFor(() => expect(screen.getByTestId("inbox-drag-error")).toBeTruthy());
    expect(screen.getByTestId("inbox-column-count-backlog").textContent).toBe("1");
  });
});

/**
 * 迭代 11（design-delta `prototype-navigation`，待人类签核）—— UI 先行部分的验收（delta V29 / V30 / V31 的
 * 前端半边）。跳转表由 `project.frameLinks` 给（服务端接线前夹具提供），画布只消费。
 */
/**
 * 2026-09-07 人类指令：composer 回车直接发、Shift+Enter 换行；底部不显示模型名。
 */
describe("对话输入区：回车发送 / Shift+Enter 换行 / 输入法组字不误发", () => {
  const tree = { type: "stack" as const, id: "n1", children: [{ type: "text" as const, id: "n2", props: { content: "x" } }] };
  const setup = async () => {
    const sent: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["页"], prototype: [tree] })] };
      if (/\/chat$/.test(path) && opts?.method === "POST") {
        sent.push(opts.body);
        return { project: project({ frames: ["页"], prototype: [tree] }), reply: { source: "model", applied: [], suggestions: [] } };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    return { sent, input: screen.getByTestId("design-detail-input") };
  };

  it("回车发送；Shift+Enter 不发（留给换行）", async () => {
    const { sent, input } = await setup();
    fireEvent.change(input, { target: { value: "改一下标题" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sent).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: "改一下标题" });
  });

  it("输入法组字中的回车是在选词，不发送（中文/日文用户的半截词不该被发出去）", async () => {
    const { sent, input } = await setup();
    fireEvent.change(input, { target: { value: "改一下" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(sent).toHaveLength(0);
  });

  it("空内容按回车不发", async () => {
    const { sent, input } = await setup();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sent).toHaveLength(0);
  });

  it("底部状态条不显示模型名——它此前是硬编码字面量，与部署实际用的模型无关", () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["页"], prototype: [tree] })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    return waitFor(() => {
      const bar = screen.getByTestId("design-detail-statusbar");
      expect(bar.textContent).not.toMatch(/claude|opus|gpt/i);
      expect(bar.textContent).toContain("设计系统 WorkspaceX UI");
    });
  });
});

describe("迭代 11 · 可点击原型（UI 先行，后端未接线）", () => {
  const btn = (id: string, label: string) => ({ id, type: "button" as const, props: { label } });
  const treeA = { id: "ra", type: "stack" as const, children: [btn("go", "去 B"), btn("stay", "普通按钮")] };
  const treeB = { id: "rb", type: "stack" as const, children: [{ id: "tb", type: "text" as const, props: { content: "这是 B 页" } }] };
  const linked = () => project({ frames: ["A", "B"], prototype: [treeA, treeB], frameLinks: [[{ from: "go", to: 1 }], []] });

  it("V29 预览模式：点有跳转的按钮 ⇒ 换到目标页；点没跳转的节点 ⇒ 不换页也不选中；切回编辑恢复选中语义", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [linked()] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    fireEvent.click(screen.getByTestId("design-detail-view-single"));
    fireEvent.click(screen.getByTestId("design-detail-mode-preview"));
    const tree = screen.getByTestId("design-detail-phone-tree");
    // 只有带跳转的可点位标了 data-linked；普通按钮没有任何可点暗示。
    expect(within(tree).getByText("去 B").closest("[data-node-id]")?.getAttribute("data-linked")).toBe("true");
    expect(within(tree).getByText("普通按钮").closest("[data-node-id]")?.getAttribute("data-linked")).toBeNull();
    // 没跳转的节点：点了不换页，也不选中（预览不是编辑）。
    fireEvent.click(within(tree).getByText("普通按钮"));
    expect(screen.queryByTestId("design-inspector")).toBeNull();
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("去 B");
    // 有跳转的：换到 B 页。
    fireEvent.click(within(tree).getByText("去 B"));
    expect(screen.getByTestId("design-detail-phone-tree").textContent).toContain("这是 B 页");
    // 切回编辑：点节点又是选中语义（属性面板出现）。
    fireEvent.click(screen.getByTestId("design-detail-frame-0"));
    fireEvent.click(screen.getByTestId("design-detail-mode-edit"));
    fireEvent.click(within(screen.getByTestId("design-detail-phone-tree")).getByText("普通按钮"));
    expect(await screen.findByTestId("design-inspector")).toBeTruthy();
  });

  it("V30 画板连线数 == 合法 link 数；没有 link 的项目不渲染连线层", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [linked()] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    expect(screen.getAllByTestId("design-detail-board-link")).toHaveLength(1);
  });
  it("V30 反证：没有 link 的项目不渲染连线层（不是按相邻页画「流程图」）", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["A", "B"], prototype: [treeA, treeB] })] };
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    expect(screen.queryByTestId("design-detail-board-links")).toBeNull();
  });

  it("V31 属性面板「跳转」：单目标一个下拉；选目标 ⇒ 发 setLinks（与模型同一条路），回包的 links 上画板", async () => {
    // 迭代 11 接线后：改跳转**不是本地更新**，而是一条 `setLinks` patch——人改与模型改同一条
    // 写回路径（I-11），所以它同样过 `validateLinks`、同样记一条 user 版本。
    // 用同文件已有的 `linked()` 夹具：它的 from 是真实存在的节点 id（"go"）——
    // 画板只画得出源节点找得到的线，编一个 id 会让这条断言变成假绿。
    const calls: unknown[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/pm-designs") return { items: [project({ frames: ["A", "B"], prototype: [treeA, treeB], frameLinks: [[], []] })] };
      if (path === "/pm-designs/p1/prototype/patch" && opts?.method === "POST") {
        calls.push(opts.body);
        return { project: linked() };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    expect(screen.queryByTestId("design-detail-board-links")).toBeNull();
    fireEvent.click(within(screen.getAllByTestId("design-detail-phone-tree")[0]!).getByText("去 B"));
    const select = await screen.findByTestId("design-inspector-link-0");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["无", "2 · B"]); // 本页 A 不在选项里
    fireEvent.change(select, { target: { value: "1" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ ops: [{ op: "setLinks", screen: 0 }] });
    await waitFor(() => expect(screen.getAllByTestId("design-detail-board-link")).toHaveLength(1));
  });
});

/* ─────────── 迭代 13（delta `design-chat-inputs` §2）：从对话导入 —— V58 ─────────── */

/**
 * 这一组断的是**写入的时机**，不是接口能不能通：
 * 选中线程只该产生一次**预览**请求（body 里没有 `problem`），项目一个字不变；
 * 只有点了确认才发第二次、带上用户**编辑之后**的文本。
 *
 * 直接写会覆盖用户已经写好的 `problem`，而这一步没有撤销——这正是本组存在的理由。
 */
describe("V58 从对话导入：不确认不写，写的是改后的文本", () => {
  const threadCard = (over: Partial<{ id: string; title: string }> = {}) => ({
    id: over.id ?? "th-1",
    title: over.title ?? "会员下单那条线",
    subtitle: "",
    badges: [],
    status: "done" as const,
    artifactCount: 0,
    lastActivityAt: "2026-09-08T02:00:00.000Z",
    visibilityScope: "plenary" as const,
    pinned: false,
  });

  /** 预览回一段服务端摘要；确认回写好之后的项目。两次都是同一条路由，靠 body 区分。 */
  const stubImport = (initial = project({ id: "p1", problem: "用户已经写好的背景" })) => {
    const bodies: Record<string, unknown>[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/pm-designs") return { items: [initial] };
      if (path === "/chat/threads") return { groups: [{ label: "今天", cards: [threadCard()] }], capabilities: [] };
      if (path === "/pm-designs/p1/import-thread" && opts?.method === "POST") {
        bodies.push(opts.body ?? {});
        const problem = opts.body?.problem;
        if (problem === undefined) {
          return {
            project: initial,
            imported: { threadId: "th-1", title: "会员下单那条线", messageCount: 3, at: "2026-09-08T03:00:00.000Z" },
            summary: "服务端摘出来的背景",
            truncated: false,
          };
        }
        return {
          project: project({ id: "p1", problem: String(problem) }),
          imported: { threadId: "th-1", title: "会员下单那条线", messageCount: 3, at: "2026-09-08T03:00:00.000Z" },
          summary: String(problem),
          truncated: false,
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    return bodies;
  };

  it("选中线程 ⇒ 出现可编辑的预览；不点确认 ⇒ 一次写入请求都没有", async () => {
    const bodies = stubImport();
    render(<DesignDetailScreen projectId="p1" />);
    fireEvent.click(await screen.findByTestId("design-detail-import-thread"));
    fireEvent.click(await screen.findByTestId("import-thread-item-th-1"));

    const preview = (await screen.findByTestId("import-thread-preview")) as HTMLTextAreaElement;
    expect(preview.value).toBe("服务端摘出来的背景");
    // 预览框必须是可编辑的——只读的预览等于"你只能接受或放弃"。
    expect(preview.readOnly).toBe(false);
    expect(screen.getByTestId("import-thread-source").textContent).toContain("会员下单那条线");

    // 反悔：直接关掉。
    fireEvent.click(screen.getByTestId("import-thread-cancel"));
    await waitFor(() => expect(screen.queryByTestId("import-thread-dialog")).toBeNull());

    // ⭐ 反证锚点：改成"选中即写" ⇒ 这两条红。
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({ threadId: "th-1" });
    expect(Object.keys(bodies[0]!)).not.toContain("problem");
    // 屏上的背景仍是用户自己写的那份。
    fireEvent.click(screen.getByTestId("design-detail-tab-spec"));
    expect((await screen.findByTestId("design-detail-spec")).textContent).toContain("用户已经写好的背景");
  });

  it("改了预览再确认 ⇒ 写入的是**改后**的文本，且对话里出现系统留痕", async () => {
    const bodies = stubImport();
    render(<DesignDetailScreen projectId="p1" />);
    fireEvent.click(await screen.findByTestId("design-detail-import-thread"));
    fireEvent.click(await screen.findByTestId("import-thread-item-th-1"));
    const preview = await screen.findByTestId("import-thread-preview");
    fireEvent.change(preview, { target: { value: "我改过的背景：首屏直接下单" } });
    fireEvent.click(screen.getByTestId("import-thread-confirm"));

    await waitFor(() => expect(bodies).toHaveLength(2));
    // ⭐ 反证锚点：确认时把服务端那份 summary 交回去（而不是编辑框里的值）⇒ 这条红。
    expect(bodies[1]).toEqual({ threadId: "th-1", problem: "我改过的背景：首屏直接下单" });
    await waitFor(() => expect(screen.queryByTestId("import-thread-dialog")).toBeNull());
    fireEvent.click(screen.getByTestId("design-detail-tab-spec"));
    expect((await screen.findByTestId("design-detail-spec")).textContent).toContain("我改过的背景");
  });

  it("system 留痕在对话里标「系统」，不标成模型的「未生成」", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/pm-designs") {
        return {
          items: [project({
            id: "p1",
            chat: [{ role: "ai" as const, text: "从线程《会员下单那条线》导入了 3 条消息作为背景。", at: "2026-09-08T03:00:00.000Z", source: "system" as const }],
          })],
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    // ⭐ 反证锚点：把 system 也渲染成 fallback 的「未生成」⇒ 这两条红。
    expect(await screen.findByTestId("design-detail-turn-system")).toBeTruthy();
    expect(screen.queryByTestId("design-detail-turn-fallback")).toBeNull();
  });
});
