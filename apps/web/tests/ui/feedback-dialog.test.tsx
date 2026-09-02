/**
 * FB-2 —— 导航栏反馈弹层与 chat 内 agent/skill 反馈按钮的采集侧行为。
 *
 * ## 这个文件断的六件事
 *
 *   ① **请求体恰好六个字段，没有 `submittedBy`、没有 `status`**——按**实际发出的
 *      请求体**断言，不是按组件源码：源码里没写 ≠ 运行时没发。
 *   ② **目标随入口变**：产品入口发 `{kind:"product"}`，skill 按钮发
 *      `{kind:"skill", skillId}`。发错目标 = 这条意见挂到别的对象上，而界面看不出来。
 *   ③ **不做乐观提交**。失败时明确说「没有被保存」——反馈是一次性表达，
 *      用户以为提交成功就不会再提第二次。
 *   ④ **成功后切到「我提过的」**并标出刚提交的那条。闭环的可见性就是这一下。
 *   ⑤ **上下文是显式展示的**（I-F1）：屏上要能读到"将附带当前页面"。
 *   ⑥ **没有 Provider 时按钮不渲染**，而不是渲染一个点了没反应的按钮。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));

import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import type { FeedbackTarget } from "@/lib/live-feedback";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function openDialogFor(target: FeedbackTarget, label: string | null = null) {
  render(
    <FeedbackProvider>
      <FeedbackButton target={target} targetLabel={label} testid="open-feedback" />
    </FeedbackProvider>,
  );
  fireEvent.click(screen.getByTestId("open-feedback"));
}

/** 2026-09-02 起表单只有「详细说说」：标题从正文派生（第一句，截到 120 字）。 */
function fillAndSubmit(detail: string) {
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: detail } });
  fireEvent.click(screen.getByTestId("feedback-submit"));
}

/** 提交成功 + 随后「我提过的」的读取，都走同一个 mock。 */
function mockSubmitThenList(item: Record<string, unknown>) {
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") return { feedbackId: "fb-new", status: "待处理" };
    return { items: [item] };
  });
}

const mineItem = {
  id: "fb-new", kind: "缺陷", target: { kind: "product" }, targetLabel: null,
  title: "点了没反应", detail: "批准卡点了不动", attachments: [], status: "待处理", statusReason: null,
  votes: 0, votedByMe: false, submittedByMe: true,
  occurredRoute: "/chat", appVersion: null, createdAt: "2026-08-15T00:00:00.000Z",
};

describe("FB-2 反馈弹层（采集侧）", () => {
  it("① 请求体恰好六个字段，没有 submittedBy / status —— 按实际发出的请求断言", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "product" });
    fillAndSubmit("点了没反应。批准卡点了不动");

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [path, opts] = apiRequest.mock.calls[0] as [string, { method: string; body: Record<string, unknown> }];
    expect(path).toBe("/feedback");
    expect(opts.method).toBe("POST");
    expect(Object.keys(opts.body).sort()).toEqual(
      ["appVersion", "detail", "kind", "occurredRoute", "target", "title"].sort(),
    );
    expect(opts.body).not.toHaveProperty("submittedBy");
    expect(opts.body).not.toHaveProperty("status");
    // I-F1：发生位置由客户端给，且给的是真实当前路由。
    expect(opts.body.occurredRoute).toBe("/chat");
    // 标题从正文派生：第一句（到第一个句号）。
    expect(opts.body.title).toBe("点了没反应");
    expect(opts.body.detail).toBe("点了没反应。批准卡点了不动");
  });

  it("② skill 入口发的是 {kind:'skill', skillId}，不是产品级目标", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "skill", skillId: "skill-3" }, "会议纪要");
    // 标题里要出现目标，否则用户不知道自己在对谁说话。
    expect(screen.getByTestId("feedback-dialog-title").textContent).toContain("会议纪要");

    fillAndSubmit("输出格式不稳。有时候是表格有时候是段落");
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, opts] = apiRequest.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(opts.body.target).toEqual({ kind: "skill", skillId: "skill-3" });
  });

  it("② agent 入口发的是 {kind:'agent', agentId}", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "agent", agentId: "agent-7" }, "调研助手");
    fillAndSubmit("老是漏附件。上传了三个文件只读了一个");
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, opts] = apiRequest.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(opts.body.target).toEqual({ kind: "agent", agentId: "agent-7" });
  });

  it("③ 提交失败时明确说没有保存，且不切标签页", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    openDialogFor({ kind: "product" });
    fillAndSubmit("点了没反应。批准卡点了不动");

    const err = await screen.findByTestId("feedback-submit-error");
    expect(err.textContent).toContain("没有被保存");
    // 仍然停在提交表单上——切走会让用户以为提交成功了。
    expect(screen.getByTestId("feedback-form")).toBeTruthy();
  });

  it("④ 成功后切到「我提过的」，并把刚提交的那条标出来", async () => {
    mockSubmitThenList(mineItem);
    openDialogFor({ kind: "product" });
    fillAndSubmit("点了没反应。批准卡点了不动");

    expect(await screen.findByTestId("feedback-mine-list")).toBeTruthy();
    expect(screen.getByTestId("feedback-just-submitted")).toBeTruthy();
    expect(screen.getByTestId("feedback-mine-item-fb-new")).toBeTruthy();
  });

  it("④ 「我提过的」读取失败时是失败态，不是空态 —— 两者必须分得开", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));
    openDialogFor({ kind: "product" });
    fireEvent.click(screen.getByTestId("feedback-tab-mine"));

    const failed = await screen.findByTestId("feedback-mine-failed");
    expect(failed.textContent).toContain("没有丢");
    expect(screen.queryByTestId("feedback-mine-empty")).toBeNull();
  });

  it("⑤ 上下文明写在屏上，不是偷偷带上的", () => {
    openDialogFor({ kind: "product" });
    const notice = screen.getByTestId("feedback-context-notice");
    expect(notice.textContent).toContain("当前页面");
    expect(notice.textContent).toContain("/chat");
  });

  it("⑤ 正文为空时提交按钮不可点 —— 空反馈进队列等于噪声；没有单独的标题框", () => {
    openDialogFor({ kind: "product" });
    expect(screen.queryByTestId("feedback-title-input")).toBeNull();
    const submit = screen.getByTestId("feedback-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "   " } });
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: "有正文了" } });
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("⑥ 没有 Provider 时按钮**不渲染** —— 入口消失比入口失灵诚实", () => {
    render(<FeedbackButton target={{ kind: "product" }} targetLabel={null} testid="orphan-feedback" />);
    expect(screen.queryByTestId("orphan-feedback")).toBeNull();
  });

  it("⑥ 反证：有 Provider 时它确实渲染（否则上一条靠「永远不渲染」平凡通过）", () => {
    render(
      <FeedbackProvider>
        <FeedbackButton target={{ kind: "product" }} targetLabel={null} testid="wired-feedback" />
      </FeedbackProvider>,
    );
    expect(screen.getByTestId("wired-feedback")).toBeTruthy();
  });
});

/**
 * FB-5 补（2026-09-02 devapp 实测复盘）：部署重启窗口里传图/提交，浏览器只给一句
 * `TypeError: Failed to fetch`——原样显示等于什么都没说，而且失败的图只能删掉重选。
 * 这里断两件事：⑦ 网络层失败翻成人话；⑧ 失败的图能用当初那个 File 直接重试，重试成功
 * 之后提交请求体里带上它的 id。
 */
describe("FB-5 网络层失败的可读性与重试", () => {
  it("⑦ 提交遇到 TypeError: Failed to fetch —— 屏上是「无法连接服务器」，不是那行英文", async () => {
    apiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    openDialogFor({ kind: "product" });
    fillAndSubmit("点了没反应。批准卡点了不动");
    const err = await screen.findByTestId("feedback-submit-error");
    expect(err.textContent).toContain("无法连接服务器");
    expect(err.textContent).not.toContain("Failed to fetch");
    expect(err.textContent).toContain("没有被保存");
  });

  it("⑧ 传图失败可重试，重试成功后提交带上 attachmentIds", async () => {
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true, status: 201,
        text: async () => JSON.stringify({ attachmentId: "att-1", url: "/feedback/attachments/att-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    try {
      mockSubmitThenList({ ...mineItem, attachments: [] });
      openDialogFor({ kind: "product" });
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
      fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [file] } });

      const errEl = await screen.findByTestId(/^feedback-attachment-error-/);
      expect(errEl.textContent).toContain("无法连接服务器");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId(/^feedback-attachment-retry-/));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByTestId(/^feedback-attachment-error-/)).toBeNull());
      // 重试发的是同一个 File（multipart 的 file 字段），不是要求用户重新选。
      const sentForm = (fetchMock.mock.calls[1]?.[1] as RequestInit).body as FormData;
      expect((sentForm.get("file") as File).name).toBe("shot.png");

      fillAndSubmit("带图的反馈。见截图");
      await screen.findByTestId("feedback-just-submitted");
      const submitCall = apiRequest.mock.calls.find(([, o]) => (o as { method?: string })?.method === "POST");
      expect((submitCall![1] as { body: { attachmentIds?: string[] } }).body.attachmentIds).toEqual(["att-1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
