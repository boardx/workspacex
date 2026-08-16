/**
 * F176 —— chat 里 👍/👎 的采集侧行为。
 *
 * ## 这个文件断的四件事
 *
 *   ① **不传归因**。请求体只有 `{ messageId, verdict, reason }`——多传一个字段
 *      就等于任何用户都能给任意 skill 版本刷满意度。这条按**实际发出的请求体**断言，
 *      不是按组件源码：源码里没写 ≠ 运行时没发。
 *   ② **不做乐观更新**。请求还没回来之前不显示「已记录」；失败时**明确说没保存**。
 *      先显示成功再发请求，一旦失败用户会以为自己评过了——他不会再点第二次。
 *   ③ **归因不全时说出来**（I-20）。`attribution.skillVersionId === null` ⇒
 *      屏上出现「只计 agent 级」。这个判断只从 attribution 推，没有第二个字段。
 *   ④ **控件只画在有 agent_run 的 AI 消息上**。人类消息与无 run 的历史消息上
 *      画一个点了必然 404 的按钮，比不画更糟。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { MessageRating } from "@/components/chat/message-rating";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const attributed = {
  ratingId: "r1",
  attribution: { agentId: "a1", skillId: "s1", skillVersionId: "sv1" },
};
const unattributed = {
  ratingId: "r2",
  attribution: { agentId: "a1", skillId: null, skillVersionId: null },
};

describe("F176 消息级评价（采集侧）", () => {
  it("① 请求体恰好三个字段，没有任何归因 —— 按实际发出的请求断言，不是按源码", async () => {
    apiRequest.mockResolvedValue(attributed);
    render(<MessageRating messageId="m1" />);

    fireEvent.click(screen.getByTestId("chat-message-rating-up"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());

    const [path, init] = apiRequest.mock.calls[0] as [string, { method: string; body: unknown }];
    expect(path).toBe("/messages/m1/rating");
    expect(init.method).toBe("POST");
    expect(init.body).toEqual({ messageId: "m1", verdict: "up", reason: null });
    // 逐字段：多一个键就红。`toEqual` 已经覆盖，这条是把「为什么」写在断言里。
    expect(Object.keys(init.body as object).sort()).toEqual(["messageId", "reason", "verdict"]);
  });

  it("👎 可以带理由，也可以不带（契约 reason 可空；强制填会让人干脆不点）", async () => {
    apiRequest.mockResolvedValue(attributed);
    render(<MessageRating messageId="m1" />);

    fireEvent.click(screen.getByTestId("chat-message-rating-down"));
    // 点 👎 先出理由输入框，不是直接提交——「可填理由」是契约里的形状。
    fireEvent.change(screen.getByTestId("chat-message-rating-reason-input"), {
      target: { value: "  答非所问  " },
    });
    fireEvent.click(screen.getByTestId("chat-message-rating-reason-submit"));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, init] = apiRequest.mock.calls[0] as [string, { body: { reason: string | null } }];
    expect(init.body.reason).toBe("答非所问");   // 首尾空白不当成理由
  });

  it("空理由发 null，不发空串 —— 「没填」与「填了个空」在库里是两件事", async () => {
    apiRequest.mockResolvedValue(attributed);
    render(<MessageRating messageId="m1" />);

    fireEvent.click(screen.getByTestId("chat-message-rating-down"));
    fireEvent.click(screen.getByTestId("chat-message-rating-reason-submit"));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, init] = apiRequest.mock.calls[0] as [string, { body: { reason: string | null } }];
    expect(init.body.reason).toBeNull();
  });

  it("② 不做乐观更新：请求失败时不显示「已记录」，且明确说没保存", async () => {
    // 阳性对照：同一路径成功时确实会显示「已记录」，否则下面只是在为「它从不显示」背书。
    apiRequest.mockResolvedValue(attributed);
    const ok = render(<MessageRating messageId="m1" />);
    fireEvent.click(screen.getByTestId("chat-message-rating-up"));
    await waitFor(() => expect(screen.getByTestId("chat-message-rating-done")).toBeTruthy());
    ok.unmount();

    apiRequest.mockRejectedValue(new Error("boom"));
    render(<MessageRating messageId="m2" />);
    fireEvent.click(screen.getByTestId("chat-message-rating-up"));

    await waitFor(() => expect(screen.getByTestId("chat-message-rating-error")).toBeTruthy());
    expect(screen.queryByTestId("chat-message-rating-done")).toBeNull();
    expect(screen.getByTestId("chat-message-rating-error").textContent).toMatch(/没有被保存/);
  });

  it("③ 归因不全 ⇒ 屏上说明只计 agent 级（I-20），不是悄悄消失在满意度之外", async () => {
    apiRequest.mockResolvedValue(unattributed);
    render(<MessageRating messageId="m1" />);
    fireEvent.click(screen.getByTestId("chat-message-rating-up"));

    await waitFor(() => expect(screen.getByTestId("chat-message-rating-unattributed")).toBeTruthy());
    expect(screen.getByTestId("chat-message-rating-unattributed").textContent)
      .toMatch(/不计入任何 skill 的满意度/);
  });

  it("③ 归因正常 ⇒ **不**出现那句提示（标反了会让人以为每一票都白投）", async () => {
    apiRequest.mockResolvedValue(attributed);
    render(<MessageRating messageId="m1" />);
    fireEvent.click(screen.getByTestId("chat-message-rating-up"));

    await waitFor(() => expect(screen.getByTestId("chat-message-rating-done")).toBeTruthy());
    expect(screen.queryByTestId("chat-message-rating-unattributed")).toBeNull();
  });

  it("④ 挂载条件是「AI 消息 ∧ 有 agentRunId」—— 由 chat-live-message-panel 源码钉住", async () => {
    // 组件本身不知道这个条件（它只收 messageId）。条件在调用点，所以断言也在那里。
    // 2026-08-16：动作条（复制/反馈/评分）从身份行挪到气泡下方，但这条挂载条件本身
    // 原样保留（`isAgent && message.agentRunId ?`），断言不用改。
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "components/chat/chat-live-message-panel.tsx"), "utf8",
    );
    expect(src).toMatch(/isAgent && message\.agentRunId \?[\s\S]{0,80}<MessageRating/);
  });
});
