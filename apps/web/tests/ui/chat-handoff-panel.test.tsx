/**
 * AG07 —— 聊天 handoff 卡片（契约束 agent-role ui.md：`handoff-confirm-card` / `handoff-confirm` / `handoff-cancel`；
 * E5 / E8）。数据端口注入替身，不经真实网络；断言用户可见的文案与交互，不出现原始原因码。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { agentRole } from "@repo/contracts";
import { ChatHandoffStream } from "@/components/chat/chat-handoff-panel";
import { useChatStreamSlots } from "@/components/chat/chat-stream-slots";
import { ApiError } from "@/lib/api-client";
import { handoffDraftText, handoffRefusalNotice, type HandoffView, type ThreadHandoffs } from "@/lib/agent-handoff";
import { displayThreadTitle } from "@/lib/thread-title-display";
import { toolLabel, toolObject } from "@/lib/chat-workbench/tool-label";

afterEach(cleanup);

/** 替身消息流：按面板的摆法把 lead / tail 放在消息前后。 */
function Stream() {
  const { lead, tail, draftSeed } = useChatStreamSlots();
  return <div data-testid="stream">{lead}<p data-testid="msg">消息</p>{tail}<output data-testid="seed">{draftSeed?.text ?? ""}</output></div>;
}
const agents: Record<string, { name: string; initials: string; roleLabel: string }> = {
  "agt-d001": { name: "研究助理", initials: "研", roleLabel: "研究与知识分析" },
  "agt-d003": { name: "产品经理", initials: "产", roleLabel: "产品需求负责人" },
};
const loadAgent = vi.fn(async (id: string) => {
  const a = agents[id];
  if (!a) throw new Error("not found");
  return { agentId: id, versionId: "v", name: a.name, initials: a.initials, roleLabel: a.roleLabel, avatar: null, roleCategory: null,
    tags: [], catalogSource: "official", workflows: [], readiness: "ready" } as never;
});
function ChatHandoffPanel(props: Omit<React.ComponentProps<typeof ChatHandoffStream>, "children">) {
  return <ChatHandoffStream loadAgent={loadAgent} {...props}><Stream /></ChatHandoffStream>;
}

const view = (over: Partial<HandoffView> = {}): HandoffView => ({
  handoffId: "h-1", sourceThreadId: "thr-a", sourceAgentId: "agt-d001", targetRole: "D003", targetAgentId: "agt-d003", targetName: "产品经理",
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
    expect(card.textContent).toContain("建议转交给");
    expect(card.textContent).toContain("把调研结论整理成 PRD");
    expect(card.textContent).toContain("2 份（接收方将按你的权限重新读取）");
    // 消息流里 Agent 的一条消息：排在消息之后，带发出者名字 + 时间；目标带角色。
    const stream = screen.getByTestId("stream");
    expect(stream.children[stream.children.length - 2]?.contains(card)).toBe(true);
    await waitFor(() => expect(screen.getByTestId("handoff-message-author").textContent).toBe("研究助理"));
    expect(screen.getByTestId("handoff-message-time").textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(screen.getByTestId("handoff-target").textContent).toContain("产品需求负责人");
    fireEvent.click(screen.getByTestId("handoff-confirm"));
    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith({ handoffId: "h-1", targetAgentId: "agt-d003", newThreadId: "thr-new" }, expect.objectContaining({ handoffId: "h-1" })));
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
    expect(err.textContent).toBe("产品经理 角色目前已停用，未发起转交。当前对话会继续；如需要，可以直接联系对应负责人。");
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
    // 来源卡是线程的起点：排在消息之前。
    expect(screen.getByTestId("stream").firstElementChild?.contains(screen.getByTestId("handoff-origin-card"))).toBe(true);
    expect(items[0]!.textContent).toBe("可查看的来源 · PDF 文档");
  });

  it("工具链标签：request_handoff 显示为「请求转交 · D003」", () => {
    expect(toolLabel("request_handoff")).toBe("请求转交");
    expect(toolObject("request_handoff", { targetRole: "D003", packet: {} })).toBe("D003");
  });

  it("无引用时不显示「引用 无」；问题原文里的触发标记被剥掉", async () => {
    const load = vi.fn(async (): Promise<ThreadHandoffs> => ({
      requested: [view({ packet: { originalQuestion: "UIUX 这个需求请产品经理接手 [request_handoff:D003]", confirmedScope: "", evidenceRefs: [], openItems: [] } })],
      origin: null,
    }));
    render(<ChatHandoffPanel threadId="thr-a" load={load} />);
    const card = await screen.findByTestId("handoff-confirm-card");
    expect(screen.getByTestId("handoff-question").textContent).toBe("UIUX 这个需求请产品经理接手");
    expect(card.textContent).not.toMatch(/引用|资料|\[request_handoff/);
  });

  it("新线程的首条消息草稿：交接包摘要", () => {
    expect(handoffDraftText(view())).toBe(
      "我从上一个对话转交过来，请你接手：把调研结论整理成 PRD\n已确认的范围：仅 B 端\n还没定的事：定价\n相关资料 2 份已随转交附上（见上方转交卡片）。",
    );
  });

  it("拒绝提示：取服务端中文句子，不把给模型的指令摆给用户；已登记的不提示", () => {
    expect(handoffRefusalNotice("该角色不能转交给 D003，未发起转交。当前对话会继续。 不要改转给其它角色，也不要重试；请把这句话告诉用户。"))
      .toBe("该角色不能转交给 D003，未发起转交。当前对话会继续。");
    // loopback 替身的工具结果是裸句子（没有给模型的后缀）——同样认得出。
    expect(handoffRefusalNotice("该角色不能转交给 D003，未发起转交。当前对话会继续；如需要，可以直接联系对应负责人。"))
      .toBe("该角色不能转交给 D003，未发起转交。当前对话会继续；如需要，可以直接联系对应负责人。");
    expect(handoffRefusalNotice("已提交转交给「产品经理」的请求，等待你在对话中确认；确认后会新开一个对话继续。")).toBeNull();
    expect(handoffRefusalNotice("已提交转交请求。 在用户确认前不要自行继续处理被转交的部分；把这句话告诉用户即可。")).toBeNull();
    expect(handoffRefusalNotice(undefined)).toBeNull();
    for (const reason of agentRole.HandoffNotAllowedReason.options) {
      const copy = agentRole.handoffNotAllowedCopy(reason, "产品经理");
      expect(handoffRefusalNotice(copy)).toBe(copy);
    }
  });

  it("线程标题展示兜底：存量标题里的控制标记剥掉", () => {
    expect(displayThreadTitle("UIUX [start_workflow:W0…")).toBe("UIUX");
    expect(displayThreadTitle("[start_workflow:W029]")).toBeUndefined();
    expect(displayThreadTitle("周报")).toBe("周报");
  });

  it("来源卡：回到原对话 + 可收起（收起后不再显示）；重新打开时草稿由交接包派生", async () => {
    localStorage.clear();
    const load = vi.fn(async (): Promise<ThreadHandoffs> => ({
      requested: [], origin: { handoff: view({ status: "confirmed", newThreadId: "thr-new" }), evidence: [] },
    }));
    const onOpenSourceThread = vi.fn();
    render(<ChatHandoffPanel threadId="thr-new" load={load} onOpenSourceThread={onOpenSourceThread} />);
    fireEvent.click(await screen.findByTestId("handoff-origin-open-source"));
    expect(onOpenSourceThread).toHaveBeenCalledWith("thr-a");
    expect(screen.getByTestId("seed").textContent).toBe(handoffDraftText(view()));
    fireEvent.click(screen.getByTestId("handoff-origin-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("handoff-origin-card")).toBeNull());
    cleanup();
    render(<ChatHandoffPanel threadId="thr-new" load={load} />);
    await waitFor(() => expect(screen.getByTestId("seed").textContent).not.toBe(""));
    expect(screen.queryByTestId("handoff-origin-card")).toBeNull();
  });
});
