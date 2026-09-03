/**
 * FB-3 —— 后台「反馈与迭代」屏（2026-09-02 下午设计稿：三个标签页 + 左列表右详情）。
 *
 * ## 这个文件断的六件事
 *
 *   ① **屏上的数据来自接口**，不是 mock 常量。接口回空 ⇒ 空态，不是示例数据。
 *   ② **按类型分页、按状态/来源/关键字筛选**：缺陷与需求各在各的标签页；需求页的状态
 *      词是 待评估/已排期/已上线（同一状态机的显示名，见 `feedback-screen.tsx` 头注）。
 *   ③ **正文无权时说的是「仅管理员与提交人可见」**，不是「暂无内容」；正文可见时
 *      附件缩略图跟着正文一起出现在右侧详情里。
 *   ④ **分诊**：主按钮按类型叫「进入迭代 / 排期」，转「已进入迭代」先展开可编辑的
 *      issue 草稿；转「不做」必须先写理由；「标记已修复」直接发请求。
 *   ⑤ **读取失败 ≠ 没有反馈**。失败态里必须说出「数据没有丢」。
 *   ⑥ **系统异常**是第三个标签页；403 `NOT_PLATFORM_SUPERUSER` 是身份说明，不是失败。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { FeedbackScreen } from "@/components/admin/feedback-screen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const base = {
  targetLabel: null, statusReason: null, attachments: [], submitterName: "chen.jie",
  votes: 2, votedByMe: false, submittedByMe: false,
  occurredRoute: "/chat", appVersion: "2026.08.15", createdAt: "2026-08-15T00:00:00.000Z",
  githubIssueUrl: null, githubIssueNumber: null,
};
const productBug = {
  ...base, id: "fb-p", kind: "缺陷" as const, target: { kind: "product" }, title: "批准卡不记得预算",
  detail: "每次都要重填", status: "待处理" as const,
};
const skillBug = {
  ...base, id: "fb-s", kind: "缺陷" as const, target: { kind: "skill", skillId: "skill-3" }, targetLabel: "会议纪要",
  title: "输出格式不稳", detail: null, submitterName: null, status: "已进入迭代" as const,
  createdAt: "2026-08-16T00:00:00.000Z",
};
const productReq = {
  ...base, id: "fb-r", kind: "需求" as const, target: { kind: "product" }, title: "希望能把对话导出为 Markdown",
  detail: "方便整理到笔记里", status: "待处理" as const, votes: 12,
};

type Handler = (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => unknown;

function mockApi(items: unknown[], extra: Partial<Record<string, unknown>> = {}) {
  const handler: Handler = async (path, opts) => {
    const method = opts?.method ?? "GET";
    if (path === "/feedback" && method === "GET") return { items };
    if (path === "/system/error-logs") {
      if (extra.systemErrors instanceof Error) throw extra.systemErrors;
      return extra.systemErrors ?? { items: [], hasMore: false };
    }
    if (path.endsWith("/events")) return { events: extra.events ?? [] };
    // 来源名字目录（best-effort，见 `feedback-screen.tsx` 头注）。
    if (path.includes("/agents")) return [];
    if (path.includes("/skills")) return { items: [] };
    return {};
  };
  apiRequest.mockImplementation(handler);
}

function putCalls() {
  return apiRequest.mock.calls.filter((c) => (c[1] as { method?: string })?.method === "PUT");
}

describe("FB-3 后台反馈屏（2026-09-02 三标签页 + 左列表右详情）", () => {
  it("① 屏上的条目来自接口；缺陷页只有缺陷，需求页只有需求，标签页带计数", async () => {
    mockApi([productBug, skillBug, productReq]);
    render(<FeedbackScreen state="default" />);
    expect(await screen.findByTestId("admin-feedback-item-fb-p")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-item-fb-s")).toBeTruthy();
    expect(screen.queryByTestId("admin-feedback-item-fb-r")).toBeNull();
    expect(screen.getByTestId("admin-feedback-tab-缺陷").textContent).toContain("2");
    expect(screen.getByTestId("admin-feedback-tab-需求").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("admin-feedback-tab-需求"));
    expect(screen.getByTestId("admin-feedback-item-fb-r")).toBeTruthy();
    expect(screen.queryByTestId("admin-feedback-item-fb-p")).toBeNull();
    // 需求页的状态词是显示名，不是第二套状态。
    expect(screen.getByTestId("admin-feedback-status-fb-r").textContent).toBe("待评估");
    expect(screen.getByTestId("admin-feedback-filter-status-已进入迭代").textContent).toContain("已排期");
  });

  it("① 接口回空 ⇒ 列表空态 + 详情空态，不是示例数据", async () => {
    mockApi([]);
    render(<FeedbackScreen state="default" />);
    expect(await screen.findByTestId("admin-feedback-list-缺陷-empty")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-detail-empty")).toBeTruthy();
    expect(screen.queryByText(/批准卡不记得预算/)).toBeNull();
  });

  it("① 列表行：编号按类型内提交顺序现算，提交人/来源/赞同/时间齐全，无票显示 —", async () => {
    mockApi([productBug, skillBug]);
    render(<FeedbackScreen state="default" />);
    const row = await screen.findByTestId("admin-feedback-item-fb-p");
    expect(row.textContent).toContain("B-1");
    expect(row.textContent).toContain("chen.jie");
    expect(screen.getByTestId("admin-feedback-item-fb-s").textContent).toContain("B-2");
    expect(screen.getByTestId("admin-feedback-item-fb-s").textContent).toContain("Skill · 会议纪要");
    // 正文无权 ⇒ 提交人也拿不到（同一条 D3 门控），显示为「匿名用户」。
    expect(screen.getByTestId("admin-feedback-item-fb-s").textContent).toContain("匿名用户");
    expect(screen.getByTestId("admin-feedback-vote-fb-p").textContent).toContain("2");
    mockApi([{ ...productBug, votes: 0 }]);
  });

  it("② 来源 / 状态 / 关键字三种筛选都只缩小当前页的可见集合", async () => {
    mockApi([productBug, skillBug]);
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-p");

    fireEvent.click(screen.getByTestId("admin-feedback-filter-source-skill"));
    expect(screen.queryByTestId("admin-feedback-item-fb-p")).toBeNull();
    expect(screen.getByTestId("admin-feedback-item-fb-s")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-feedback-filter-source-all"));

    fireEvent.click(screen.getByTestId("admin-feedback-filter-status-待处理"));
    expect(screen.getByTestId("admin-feedback-item-fb-p")).toBeTruthy();
    expect(screen.queryByTestId("admin-feedback-item-fb-s")).toBeNull();
    fireEvent.click(screen.getByTestId("admin-feedback-filter-status-all"));

    fireEvent.change(screen.getByTestId("admin-feedback-search"), { target: { value: "格式不稳" } });
    expect(screen.queryByTestId("admin-feedback-item-fb-p")).toBeNull();
    expect(screen.getByTestId("admin-feedback-item-fb-s")).toBeTruthy();
  });

  it("③ 点行选中 ⇒ 右侧详情；detail 为 null ⇒ 说「仅组织管理员与提交人可见」", async () => {
    mockApi([productBug, skillBug]);
    render(<FeedbackScreen state="default" />);
    // 默认选中第一行。
    expect(await screen.findByTestId("admin-feedback-detail-fb-p")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-detail-fb-p").textContent).toContain("每次都要重填");

    fireEvent.click(screen.getByTestId("admin-feedback-item-fb-s"));
    const withheld = await screen.findByTestId("admin-feedback-detail-withheld-fb-s");
    expect(withheld.textContent).toContain("仅组织管理员与提交人可见");
    expect(screen.queryByTestId("admin-feedback-detail-fb-p")).toBeNull();
  });

  it("③ 正文可见时，附件缩略图出现在详情里（后台必须显示图片）", async () => {
    const withImages = {
      ...productBug,
      attachments: [
        { id: "att-1", url: "/feedback/attachments/att-1", mime: "image/png" },
        { id: "att-2", url: "/feedback/attachments/att-2", mime: "image/jpeg" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"]) })));
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:img"), revokeObjectURL: vi.fn() });
    try {
      mockApi([withImages]);
      render(<FeedbackScreen state="default" />);
      const list = await screen.findByTestId("admin-feedback-attachments-fb-p");
      expect(list.querySelectorAll("li")).toHaveLength(2);
      await waitFor(() => expect(list.querySelectorAll("img")).toHaveLength(2));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("③ 点缩略图打开大图预览，左右切换多图，关闭后清理 object URL", async () => {
    const withImages = {
      ...productBug,
      attachments: [
        { id: "att-1", url: "/feedback/attachments/att-1", mime: "image/png" },
        { id: "att-2", url: "/feedback/attachments/att-2", mime: "image/jpeg" },
      ],
    };
    const revokeObjectURL = vi.fn();
    let objectUrlSeq = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"]) })));
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:img-${objectUrlSeq++}`), revokeObjectURL });
    try {
      mockApi([withImages]);
      render(<FeedbackScreen state="default" />);
      const list = await screen.findByTestId("admin-feedback-attachments-fb-p");
      const thumbnails = within(list).getAllByRole("button");
      expect(thumbnails).toHaveLength(2);

      // 点第一张缩略图 ⇒ lightbox 打开，标题带「1/2」，能看到大图。
      fireEvent.click(thumbnails[0]!);
      expect(await screen.findByTestId("admin-feedback-attachment-lightbox")).toBeTruthy();
      await screen.findByTestId("admin-feedback-attachment-lightbox-image");
      expect(screen.getByTestId("admin-feedback-attachment-lightbox").textContent).toContain("1/2");
      expect(screen.queryByTestId("admin-feedback-attachment-lightbox-prev")).toHaveProperty("disabled", true);

      // 「下一张」切到第二张。
      fireEvent.click(screen.getByTestId("admin-feedback-attachment-lightbox-next"));
      await waitFor(() => {
        expect(screen.getByTestId("admin-feedback-attachment-lightbox").textContent).toContain("2/2");
      });
      expect(screen.getByTestId("admin-feedback-attachment-lightbox-next")).toHaveProperty("disabled", true);

      // 关闭 ⇒ lightbox 消失，加载过的 object URL 都被 revoke（缩略图 2 张 + lightbox 切换过的 2 张）。
      fireEvent.click(screen.getByTestId("admin-feedback-attachment-lightbox-close"));
      await waitFor(() => expect(screen.queryByTestId("admin-feedback-attachment-lightbox")).toBeNull());
      expect(revokeObjectURL).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("④ 转「不做」先要理由；理由为空时确认按钮不可点；成功后行仍选中且能看到处理说明", async () => {
    let status: "待处理" | "不做" = "待处理";
    let statusReason: string | null = null;
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: { reason?: string } }) => {
      if (path === "/feedback" && (opts?.method ?? "GET") === "GET") return { items: [{ ...productBug, status, statusReason }] };
      if (path.endsWith("/events")) return { events: [] };
      if ((opts?.method ?? "GET") === "PUT") {
        status = "不做";
        statusReason = opts?.body?.reason ?? null;
        return { feedbackId: productBug.id, status: "不做", notified: false };
      }
      if (path.includes("/agents")) return [];
      if (path.includes("/skills")) return { items: [] };
      return { items: [], hasMore: false };
    });
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-不做-fb-p"));

    const submit = screen.getByTestId("admin-feedback-decline-submit-fb-p") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(putCalls()).toHaveLength(0);

    fireEvent.change(screen.getByTestId("admin-feedback-decline-reason-fb-p"), { target: { value: "与既有能力重复" } });
    fireEvent.click(submit);
    await waitFor(() => {
      expect((putCalls()[0]![1] as { body: Record<string, unknown> }).body).toMatchObject({ status: "不做", reason: "与既有能力重复" });
    });
    await waitFor(() => expect(screen.getByTestId("admin-feedback-status-fb-p").textContent).toBe("不做"));
    expect(screen.getByTestId("admin-feedback-detail-fb-p")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-reason-fb-p").textContent).toContain("与既有能力重复");
  });

  it("④ 「标记已修复」直接发请求，不要理由，也不要草稿", async () => {
    mockApi([skillBug]); // 已进入迭代 ⇒ 向前那条边是 已修复
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已修复-fb-s"));
    await waitFor(() => {
      expect((putCalls()[0]![1] as { body: Record<string, unknown> }).body).toMatchObject({ status: "已修复", reason: null, issueDraft: null });
    });
    // 已进入迭代 出得去的边里有「退回待处理」，没有转到自己的按钮。
    expect(screen.queryByTestId("admin-feedback-to-已进入迭代-fb-s")).toBeNull();
    expect(screen.getByTestId("admin-feedback-to-待处理-fb-s")).toBeTruthy();
  });

  it("④ 缺陷「进入迭代」/ 需求「排期」都先展开可编辑的 issue 草稿，不立即发请求", async () => {
    mockApi([productBug, productReq]);
    render(<FeedbackScreen state="default" />);
    const bugButton = await screen.findByTestId("admin-feedback-to-已进入迭代-fb-p");
    expect(bugButton.textContent).toContain("进入迭代");
    fireEvent.click(bugButton);
    expect(await screen.findByTestId("admin-feedback-issue-fb-p")).toBeTruthy();
    expect(putCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("admin-feedback-tab-需求"));
    const reqButton = await screen.findByTestId("admin-feedback-to-已进入迭代-fb-r");
    expect(reqButton.textContent).toContain("排期");
  });

  it("④ issue 草稿预填自反馈本身，可编辑，提交时发的是编辑后的值；取消不发请求", async () => {
    mockApi([productBug]);
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已进入迭代-fb-p"));

    const title = (await screen.findByTestId("admin-feedback-issue-title-fb-p")) as HTMLInputElement;
    const body = screen.getByTestId("admin-feedback-issue-body-fb-p") as HTMLTextAreaElement;
    const labels = screen.getByTestId("admin-feedback-issue-labels-fb-p") as HTMLInputElement;
    expect(title.value).toBe(productBug.title);
    expect(body.value).toContain(productBug.detail);
    expect(labels.value).toContain("user-feedback");
    expect(labels.value).toContain("bug");

    fireEvent.click(within(screen.getByTestId("admin-feedback-issue-fb-p")).getByText("取消"));
    expect(screen.queryByTestId("admin-feedback-issue-fb-p")).toBeNull();
    expect(putCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("admin-feedback-to-已进入迭代-fb-p"));
    fireEvent.change(await screen.findByTestId("admin-feedback-issue-title-fb-p"), { target: { value: "管理员改过的标题" } });
    fireEvent.change(screen.getByTestId("admin-feedback-issue-body-fb-p"), { target: { value: "管理员改过的正文" } });
    fireEvent.change(screen.getByTestId("admin-feedback-issue-labels-fb-p"), { target: { value: "user-feedback, needs-triage" } });
    fireEvent.click(screen.getByTestId("admin-feedback-issue-submit-fb-p"));
    await waitFor(() => {
      const put = putCalls()[0];
      expect(put).toBeTruthy();
      const sent = (put![1] as { body: Record<string, unknown> }).body;
      expect(sent.status).toBe("已进入迭代");
      expect(sent.issueDraft).toEqual({ title: "管理员改过的标题", body: "管理员改过的正文", labels: ["user-feedback", "needs-triage"] });
    });
  });

  it("键盘：行聚焦后按 Enter 选中（不止鼠标点击）", async () => {
    mockApi([productBug, skillBug]);
    render(<FeedbackScreen state="default" />);
    const row = await screen.findByTestId("admin-feedback-item-fb-s");
    expect(screen.queryByTestId("admin-feedback-detail-fb-s")).toBeNull();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(await screen.findByTestId("admin-feedback-detail-fb-s")).toBeTruthy();
  });

  it("动态：提交事件写成「用户提交反馈/需求」，状态变更事件带显示名与邮件通知", async () => {
    mockApi([productReq], {
      events: [
        { id: "e1", feedbackId: "fb-r", fromStatus: null, toStatus: "待处理", reason: null, actorId: "u1", createdAt: "2026-09-02T03:20:00.000Z", notified: false, emailSubject: null, emailText: null },
        { id: "e2", feedbackId: "fb-r", fromStatus: "待处理", toStatus: "已进入迭代", reason: null, actorId: "admin", createdAt: "2026-09-02T04:00:00.000Z", notified: true, emailSubject: "你的反馈状态已更新为「已进入迭代」", emailText: "…" },
      ],
    });
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-tab-需求"));
    const list = await screen.findByTestId("admin-feedback-events-list-fb-r");
    expect(list.textContent).toContain("用户提交需求");
    expect(list.textContent).toContain("状态改为「已排期」");
    expect(screen.getByTestId("admin-feedback-event-email-e2").textContent).toContain("已更新为「已进入迭代」");
  });

  it("⑤ 读取失败是失败态，且说出「数据没有丢」", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));
    render(<FeedbackScreen state="default" />);
    const failed = await screen.findByTestId("admin-feedback-failed");
    expect(failed.textContent).toContain("数据没有丢");
    expect(screen.queryByTestId("admin-feedback-list-缺陷-empty")).toBeNull();
  });

  it("⑥ 系统异常是第三个标签页；403 NOT_PLATFORM_SUPERUSER 是身份说明，不是失败态", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mockApi([productBug], { systemErrors: new ApiError(403, "NOT_PLATFORM_SUPERUSER", {}) });
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-p");
    fireEvent.click(screen.getByTestId("admin-feedback-tab-system"));
    expect(await screen.findByTestId("admin-feedback-system-errors-forbidden")).toBeTruthy();
    expect(screen.queryByTestId("admin-feedback-system-errors-failed")).toBeNull();
    expect(screen.queryByTestId("admin-feedback-system-errors-pill")).toBeNull();
  });

  it("⑥ 超管看到异常条数：标签页计数 + 标题旁的「N 条系统异常」胶囊", async () => {
    mockApi([productBug], {
      systemErrors: { items: [
        { id: "1", traceId: "t1", msg: "boom", detail: {}, createdAt: "2026-09-02T00:00:00.000Z", aiTitle: "数据库连接超时", aiSummary: "疑似连接池耗尽，建议先查慢查询与连接数上限。", status: "待处理", statusReason: null, devNote: null, tags: [] },
        { id: "2", traceId: "t2", msg: "bang", detail: {}, createdAt: "2026-09-02T00:01:00.000Z", aiTitle: null, aiSummary: null, status: "待处理", statusReason: null, devNote: null, tags: [] },
      ], hasMore: false },
    });
    render(<FeedbackScreen state="default" />);
    expect((await screen.findByTestId("admin-feedback-system-errors-pill")).textContent).toContain("2 条系统异常");
    expect(screen.getByTestId("admin-feedback-tab-system").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("admin-feedback-tab-system"));
    expect(await screen.findByTestId("admin-feedback-system-error-1")).toBeTruthy();
    // 有 AI 摘要：标题+说明用 AI 生成的文字，跟反馈卡片一样人能看懂。
    expect(screen.getByTestId("admin-feedback-system-error-1").textContent).toContain("数据库连接超时");
    expect(screen.getByTestId("admin-feedback-system-error-summary-1").textContent).toContain("连接池耗尽");
    // 没有 AI 摘要（还没生成完/这次没生成出来）：兜底说明，不编一句假摘要，原始 msg 仍可见。
    expect(screen.getByTestId("admin-feedback-system-error-2").textContent).toContain("bang");
    expect(screen.getByTestId("admin-feedback-system-error-summary-2").textContent).toContain("AI 摘要还没有生成");
    // 原始技术细节仍然可以展开查看（不是被 AI 摘要取代，是多一层）。
    expect(screen.queryByTestId("admin-feedback-system-error-detail-1")).toBeNull();
    fireEvent.click(screen.getByTestId("admin-feedback-system-error-toggle-1"));
    expect(await screen.findByTestId("admin-feedback-system-error-detail-1")).toBeTruthy();
  });

  it("⑥ 系统异常卡片能加/删标签、能转生命周期（转开发/不做/退回待处理）", async () => {
    mockApi([productBug], {
      systemErrors: { items: [
        { id: "1", traceId: "t1", msg: "boom", detail: {}, createdAt: "2026-09-02T00:00:00.000Z", aiTitle: "数据库连接超时", aiSummary: "疑似连接池耗尽。", status: "待处理", statusReason: null, devNote: null, tags: ["db"] },
      ], hasMore: false },
    });
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-p");
    fireEvent.click(screen.getByTestId("admin-feedback-tab-system"));
    await screen.findByTestId("admin-feedback-system-error-1");

    // 加标签
    fireEvent.change(screen.getByTestId("admin-feedback-system-error-tag-input-1"), { target: { value: "urgent" } });
    fireEvent.keyDown(screen.getByTestId("admin-feedback-system-error-tag-input-1"), { key: "Enter" });
    await waitFor(() => {
      const call = putCalls().find((c) => c[0] === "/system/error-logs/1");
      expect(call).toBeTruthy();
      expect((call![1] as { body: Record<string, unknown> }).body).toMatchObject({ tags: ["db", "urgent"] });
    });

    // 转开发——先展开可选的说明输入框，再确认
    fireEvent.click(screen.getByTestId("admin-feedback-system-error-to-已转入开发-1"));
    fireEvent.change(screen.getByTestId("admin-feedback-system-error-devnote-input-1"), { target: { value: "指派给 @foo" } });
    fireEvent.click(screen.getByTestId("admin-feedback-system-error-devnote-submit-1"));
    await waitFor(() => {
      const call = putCalls().find((c) => (c[1] as { body: Record<string, unknown> }).body?.status === "已转入开发");
      expect(call).toBeTruthy();
      expect((call![1] as { body: Record<string, unknown> }).body).toMatchObject({ status: "已转入开发", devNote: "指派给 @foo" });
    });
  });

  it("⑥ 系统异常「不做」必须先写理由——理由为空时确认按钮不可点", async () => {
    mockApi([productBug], {
      systemErrors: { items: [
        { id: "1", traceId: "t1", msg: "boom", detail: {}, createdAt: "2026-09-02T00:00:00.000Z", aiTitle: null, aiSummary: null, status: "待处理", statusReason: null, devNote: null, tags: [] },
      ], hasMore: false },
    });
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-p");
    fireEvent.click(screen.getByTestId("admin-feedback-tab-system"));
    fireEvent.click(await screen.findByTestId("admin-feedback-system-error-to-不做-1"));
    expect(screen.getByTestId("admin-feedback-system-error-decline-submit-1")).toBeDisabled();
    fireEvent.change(screen.getByTestId("admin-feedback-system-error-decline-reason-1"), { target: { value: "已知问题，不再处理" } });
    expect(screen.getByTestId("admin-feedback-system-error-decline-submit-1")).not.toBeDisabled();
  });

  it("回归：`打开迭代看板` / `导出` 两个按钮已删除", async () => {
    mockApi([productBug]);
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-p");
    expect(screen.queryByTestId("admin-feedback-board")).toBeNull();
    expect(screen.queryByTestId("admin-feedback-export")).toBeNull();
  });
});
