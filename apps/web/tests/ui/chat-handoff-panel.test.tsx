/**
 * AG07 —— 聊天 handoff 卡片（契约束 agent-role ui.md：`handoff-confirm-card` / `handoff-confirm` / `handoff-cancel`；
 * E5 / E8）。数据端口注入替身，不经真实网络；断言用户可见的文案与交互，不出现原始原因码。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatHandoffPanel } from "@/components/chat/chat-handoff-panel";
import { ApiError } from "@/lib/api-client";
import type { HandoffView, ThreadHandoffs } from "@/lib/agent-handoff";
import { toolLabel, toolObject } from "@/lib/chat-workbench/tool-label";

afterEach(cleanup);

const view = (over: Partial<HandoffView> = {}): HandoffView => ({
  handoffId: "h-1", sourceThreadId: "thr-a", targetRole: "D003", targetAgentId: "agt-d003", targetName: "产品经理",
  status: "requested", depth: 1, notAllowedReason: null, newThreadId: null, createdAt: "2026-09-30T00:00:00Z",
  packet: { originalQuestion: "把调研结论整理成 PRD", confirmedScope: "仅 B 端", evidenceRefs: ["v1", "v2"], openItems: ["定价"] },
  ...over,
});

describe("ChatHandoffPanel", () => {
  it("无转交时不渲染", async () => {
    const load = vi.fn(async (): Promise<ThreadHandoffs> => ({ requested: [], origin: null }));
    const { container } = render(<ChatHandoffPanel threadId="thr-a" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledWith("thr-a", undefined));
    expect(container.querySelector("[data-testid=chat-handoff-panel]")).toBeNull();
  });

  it("待确认卡片：目标角色 + 交接包摘要；确认后打开接收方新线程", async () => {
    let state: ThreadHandoffs = { requested: [view()], origin: null };
    const load = vi.fn(async () => state);
    const confirm = vi.fn(async () => {
      state = { requested: [view({ status: "confirmed", newThreadId: "thr-new" })], origin: null };
      return { handoffId: "h-1", targetAgentId: "agt-d003", newThreadId: "thr-new" };
    });
    const onOpenThread = vi.fn();
    render(<ChatHandoffPanel threadId="thr-a" load={load} confirm={confirm} onOpenThread={onOpenThread} />);
    const card = await screen.findByTestId("handoff-confirm-card");
    expect(card.textContent).toContain("建议转交给 产品经理（D003）");
    expect(card.textContent).toContain("把调研结论整理成 PRD");
    expect(card.textContent).toContain("2 条（接收方将按你的权限重新读取）");
    fireEvent.click(screen.getByTestId("handoff-confirm"));
    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith({ handoffId: "h-1", targetAgentId: "agt-d003", newThreadId: "thr-new" }));
    await waitFor(() => expect(screen.getByTestId("handoff-confirm-card").getAttribute("data-handoff-status")).toBe("confirmed"));
    expect(screen.queryByTestId("handoff-confirm")).toBeNull();
  });

  it("E5：确认被拒 ⇒ 友好文案（不含原因码），卡片仍在、原对话继续", async () => {
    const load = vi.fn(async (): Promise<ThreadHandoffs> => ({ requested: [view()], origin: null }));
    const confirm = vi.fn(async () => {
      throw new ApiError(403, "HANDOFF_NOT_ALLOWED", { reasonCode: "HANDOFF_NOT_ALLOWED", reason: "target_disabled" });
    });
    render(<ChatHandoffPanel threadId="thr-a" load={load} confirm={confirm} />);
    fireEvent.click(await screen.findByTestId("handoff-confirm"));
    const err = await screen.findByTestId("handoff-error");
    expect(err.textContent).toBe("D003 角色目前已停用，未发起转交。当前对话会继续；如需要，可以直接联系对应负责人。");
    expect(err.textContent).not.toMatch(/HANDOFF_NOT_ALLOWED|target_disabled/);
  });

  it("取消：调用取消并重读", async () => {
    let state: ThreadHandoffs = { requested: [view()], origin: null };
    const load = vi.fn(async () => state);
    const cancel = vi.fn(async () => { state = { requested: [view({ status: "cancelled" })], origin: null }; });
    render(<ChatHandoffPanel threadId="thr-a" load={load} cancel={cancel} />);
    fireEvent.click(await screen.findByTestId("handoff-cancel"));
    await waitFor(() => expect(screen.getByTestId("handoff-confirm-card").getAttribute("data-handoff-status")).toBe("cancelled"));
    expect(cancel).toHaveBeenCalledWith("h-1", undefined);
  });

  it("E8：转交新开的线程——无权引用显示「无法展示此来源」，不带任何内容", async () => {
    const load = vi.fn(async (): Promise<ThreadHandoffs> => ({
      requested: [],
      origin: {
        handoff: view({ status: "confirmed", newThreadId: "thr-new" }),
        evidence: [{ ref: "v1", readable: true, mime: "application/pdf" }, { ref: "v2", readable: false }],
      },
    }));
    render(<ChatHandoffPanel threadId="thr-new" load={load} />);
    const items = await screen.findAllByTestId("handoff-evidence-item");
    expect(items.map((i) => i.getAttribute("data-readable"))).toEqual(["true", "false"]);
    expect(items[1]!.textContent).toBe("无法展示此来源");
    expect(items[1]!.textContent).not.toContain("v2");
    expect(screen.getByTestId("handoff-origin-card").textContent).toContain("这是转交给 产品经理 的对话");
  });

  it("工具链标签：request_handoff 显示为「请求转交 · D003」", () => {
    expect(toolLabel("request_handoff")).toBe("请求转交");
    expect(toolObject("request_handoff", { targetRole: "D003", packet: {} })).toBe("D003");
  });
});
