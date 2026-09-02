/**
 * FB-3 —— 后台「反馈与迭代」屏接了真后端之后的行为。
 *
 * ## 这个文件断的五件事
 *
 *   ① **屏上的数据来自接口**，不是 `lib/mock/admin` 的三个静态常量。
 *      断言方式：接口回什么，屏上就该出现什么；接口回空，屏上是空态而不是示例数据。
 *   ② **两列按 target 分**：产品级进左列，agent/skill 进右列。
 *   ③ **正文无权时说的是「仅管理员与提交人可见」**，不是「暂无内容」——
 *      `detail === null` 恒等于无权（落库的正文非空）。
 *   ④ **转「不做」必须先写理由**：界面先展开输入框，而不是让人撞一次 422 才知道。
 *   ⑤ **读取失败 ≠ 没有反馈**。失败态里必须说出「数据没有丢」。
 *
 * ⚠ 另外显式钉死一条**回归**：`[打开迭代看板]` / `[导出]` 两个按钮已删除
 *   （UC-17.6 A1/A2：点了没有目标屏的按钮比没有按钮更糟）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { FeedbackScreen } from "@/components/admin/feedback-screen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const base = {
  kind: "缺陷" as const, targetLabel: null, statusReason: null,
  votes: 2, votedByMe: false, submittedByMe: false,
  occurredRoute: "/chat", appVersion: "2026.08.15", createdAt: "2026-08-15T00:00:00.000Z",
};
const productItem = {
  ...base, id: "fb-p", target: { kind: "product" }, title: "批准卡不记得预算",
  detail: "每次都要重填", status: "待处理" as const,
};
const skillItem = {
  ...base, id: "fb-s", target: { kind: "skill", skillId: "skill-3" }, targetLabel: "会议纪要",
  title: "输出格式不稳", detail: null, status: "已进入迭代" as const,
};
const counts = { total: 2, 待处理: 1, 已进入迭代: 1, 已修复: 0, 不做: 0 };

function mockApi(items: unknown[], overrides: Partial<Record<string, unknown>> = {}) {
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === "/feedback/counts") return overrides.counts ?? counts;
    if (path === "/feedback" && (opts?.method ?? "GET") === "GET") return { items };
    // 系统异常区块（见 `SystemExceptionsSection`）独立发起自己的一次请求——
    // 本文件的五件断言都与它无关，缺省给一个"空、无更多"的响应，不去断言它。
    if (path === "/system/error-logs") return { items: [], hasMore: false };
    return {};
  });
}

describe("FB-3 后台反馈屏（真栈）", () => {
  it("① 屏上的条目来自接口", async () => {
    mockApi([productItem, skillItem]);
    render(<FeedbackScreen state="default" />);
    expect(await screen.findByTestId("admin-feedback-item-fb-p")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-item-fb-s")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-counts").textContent).toContain("2");
  });

  it("① 接口回空 ⇒ 两列都是空态，不是示例数据", async () => {
    mockApi([], { counts: { total: 0, 待处理: 0, 已进入迭代: 0, 已修复: 0, 不做: 0 } });
    render(<FeedbackScreen state="default" />);
    expect(await screen.findByTestId("admin-feedback-software-empty")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-capability-empty")).toBeTruthy();
    // 旧 mock 常量里的标题一个都不该出现。
    expect(screen.queryByText(/批准卡不记得预算/)).toBeNull();
  });

  it("② 产品级进左列，skill 进右列", async () => {
    mockApi([productItem, skillItem]);
    render(<FeedbackScreen state="default" />);
    const software = await screen.findByTestId("admin-feedback-software");
    const capability = screen.getByTestId("admin-feedback-capability");
    expect(software.textContent).toContain("批准卡不记得预算");
    expect(software.textContent).not.toContain("输出格式不稳");
    expect(capability.textContent).toContain("输出格式不稳");
    expect(capability.textContent).toContain("会议纪要");
  });

  it("③ detail 为 null ⇒ 说「仅组织管理员与提交人可见」，不说「暂无内容」", async () => {
    mockApi([skillItem]);
    render(<FeedbackScreen state="default" />);
    const withheld = await screen.findByTestId("admin-feedback-detail-withheld-fb-s");
    expect(withheld.textContent).toContain("仅组织管理员与提交人可见");
  });

  it("④ 转「不做」先要理由；理由为空时确认按钮不可点", async () => {
    mockApi([productItem]);
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-不做-fb-p"));

    const submit = screen.getByTestId("admin-feedback-decline-submit-fb-p") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // 展开输入框这一步本身就没有发出请求——不让人先撞一次 422。
    expect(apiRequest.mock.calls.filter((c) => (c[1] as { method?: string })?.method === "PUT")).toHaveLength(0);

    fireEvent.change(screen.getByTestId("admin-feedback-decline-reason-fb-p"), {
      target: { value: "与既有能力重复" },
    });
    fireEvent.click(screen.getByTestId("admin-feedback-decline-submit-fb-p"));
    await waitFor(() => {
      const put = apiRequest.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
      expect(put).toBeTruthy();
      expect((put![1] as { body: Record<string, unknown> }).body).toMatchObject({
        status: "不做", reason: "与既有能力重复",
      });
    });
  });

  it("④ 转「已修复」/「待处理」直接发请求，不要理由，也不要弹层", async () => {
    mockApi([skillItem]); // skillItem 当前是「已进入迭代」，出边是 已修复/待处理/不做
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已修复-fb-s"));
    await waitFor(() => {
      const put = apiRequest.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
      expect((put![1] as { body: Record<string, unknown> }).body).toMatchObject({
        status: "已修复", reason: null, issueDraft: null,
      });
    });
  });

  /**
   * 2026-08-30 新增：转「已进入迭代」("转开发")**不再**直接发请求——先展开一个
   * 预填、可编辑的 GitHub issue 草稿框，确认后才发。见
   * `apps/api/src/application/feedback/triage-feedback.ts` 头注①（fail closed，
   * 后端真的会建一个 issue）。
   */
  it("④ 转「已进入迭代」先展开可编辑的 issue 草稿，不立即发请求", async () => {
    mockApi([productItem]);
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已进入迭代-fb-p"));

    expect(await screen.findByTestId("admin-feedback-issue-fb-p")).toBeTruthy();
    expect(
      apiRequest.mock.calls.filter((c) => (c[1] as { method?: string })?.method === "PUT"),
    ).toHaveLength(0);
  });

  it("④ issue 草稿预填自反馈本身（标题/正文/按 kind 的默认标签）", async () => {
    mockApi([productItem]);
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已进入迭代-fb-p"));

    const title = (await screen.findByTestId("admin-feedback-issue-title-fb-p")) as HTMLInputElement;
    const body = screen.getByTestId("admin-feedback-issue-body-fb-p") as HTMLTextAreaElement;
    const labels = screen.getByTestId("admin-feedback-issue-labels-fb-p") as HTMLInputElement;
    expect(title.value).toBe(productItem.title);
    expect(body.value).toContain(productItem.detail);
    // 缺陷 ⇒ 默认带 bug 标签，且恒带 user-feedback 标记来源。
    expect(labels.value).toContain("user-feedback");
    expect(labels.value).toContain("bug");
  });

  it("④ 草稿可编辑，提交时发的是编辑后的值，不是预填的默认值", async () => {
    mockApi([productItem]);
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已进入迭代-fb-p"));

    fireEvent.change(await screen.findByTestId("admin-feedback-issue-title-fb-p"), {
      target: { value: "管理员改过的标题" },
    });
    fireEvent.change(screen.getByTestId("admin-feedback-issue-body-fb-p"), {
      target: { value: "管理员改过的正文" },
    });
    fireEvent.change(screen.getByTestId("admin-feedback-issue-labels-fb-p"), {
      target: { value: "user-feedback, needs-triage" },
    });
    fireEvent.click(screen.getByTestId("admin-feedback-issue-submit-fb-p"));

    await waitFor(() => {
      const put = apiRequest.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
      expect(put).toBeTruthy();
      const body = (put![1] as { body: Record<string, unknown> }).body;
      expect(body.status).toBe("已进入迭代");
      expect(body.issueDraft).toEqual({
        title: "管理员改过的标题",
        body: "管理员改过的正文",
        labels: ["user-feedback", "needs-triage"],
      });
      // 反证：不是预填的默认值原样发出去的。
      expect(body.issueDraft).not.toMatchObject({ title: productItem.title });
    });
  });

  it("④ 取消 issue 草稿不发请求，按钮重新出现", async () => {
    mockApi([productItem]);
    render(<FeedbackScreen state="default" />);
    fireEvent.click(await screen.findByTestId("admin-feedback-to-已进入迭代-fb-p"));
    await screen.findByTestId("admin-feedback-issue-fb-p");

    fireEvent.click(screen.getByText("取消"));
    expect(screen.queryByTestId("admin-feedback-issue-fb-p")).toBeNull();
    expect(screen.getByTestId("admin-feedback-to-已进入迭代-fb-p")).toBeTruthy();
    expect(
      apiRequest.mock.calls.filter((c) => (c[1] as { method?: string })?.method === "PUT"),
    ).toHaveLength(0);
  });

  it("④ 只出现当前状态出得去的那几条边 —— 「已进入迭代」不该有转到自己的按钮", async () => {
    mockApi([skillItem]);
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-s");
    expect(screen.queryByTestId("admin-feedback-to-已进入迭代-fb-s")).toBeNull();
    expect(screen.getByTestId("admin-feedback-to-已修复-fb-s")).toBeTruthy();
  });

  it("⑤ 读取失败是失败态，且说出「数据没有丢」", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));
    render(<FeedbackScreen state="default" />);
    const failed = await screen.findByTestId("admin-feedback-failed");
    expect(failed.textContent).toContain("数据没有丢");
    expect(screen.queryByTestId("admin-feedback-software-empty")).toBeNull();
  });

  it("⑤ 计数取不到不连坐整块屏：列表照常渲染，计数那一行如实说取不到", async () => {
    apiRequest.mockImplementation(async (path: string) => {
      if (path === "/feedback/counts") throw new Error("forbidden");
      return { items: [productItem] };
    });
    render(<FeedbackScreen state="default" />);
    expect(await screen.findByTestId("admin-feedback-item-fb-p")).toBeTruthy();
    expect(screen.getByTestId("admin-feedback-counts-unavailable")).toBeTruthy();
  });

  it("回归：`打开迭代看板` / `导出` 两个按钮已删除", async () => {
    mockApi([productItem]);
    render(<FeedbackScreen state="default" />);
    await screen.findByTestId("admin-feedback-item-fb-p");
    expect(screen.queryByTestId("admin-feedback-board")).toBeNull();
    expect(screen.queryByTestId("admin-feedback-export")).toBeNull();
  });
});
