/**
 * DA-07c（#1749，rubric D6）审批面板反证套件。
 *
 * 核心纪律：裁决后**不在本地预测结果**——面板只发请求，run 状态由轮询权威更新；
 * 409 竞态如实展示错误，绝不假装自己的决定生效。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const decideMock = vi.fn();
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decideAgentRun: (...args: unknown[]) => decideMock(...args),
}));

import { AgentApprovalPanel } from "@/components/chat/agent-approval-panel";
import type { AgentRunView } from "@/lib/agent-run";

function view(over: Partial<AgentRunView> = {}): AgentRunView {
  return {
    runId: "r1", threadId: "t1", inputMessageId: "m1", agentId: "a1",
    agentVersionId: "v1", skillVersionIds: [], modelProvider: "deep-agent",
    modelId: "x", status: "awaiting_tool_permission", error: null, resultMessageId: null,
    steps: [], createdAt: "2026-08-22T00:00:00Z",
    pendingApproval: { toolName: "call_skill", argsSummary: '{"skill":"risky"}' },
    ...over,
  } as AgentRunView;
}

describe("AgentApprovalPanel", () => {
  it("awaiting_tool_permission + pendingApproval → 渲染工具名、参数、两钮", () => {
    render(<AgentApprovalPanel view={view()} />);
    const panel = screen.getByTestId("agent-approval-panel");
    expect(panel.getAttribute("data-pending-tool")).toBe("call_skill");
    expect(screen.getByTestId("agent-approval-args").textContent).toBe('{"skill":"risky"}');
    expect(screen.getByTestId("agent-approval-approve")).toBeTruthy();
    expect(screen.getByTestId("agent-approval-reject")).toBeTruthy();
  });

  it("非 awaiting_tool_permission → 渲染为空（不是空壳卡片）", () => {
    const { container } = render(<AgentApprovalPanel view={view({ status: "running" })} />);
    expect(container.innerHTML).toBe("");
  });

  it("pendingApproval 缺失 → 渲染为空——状态与摘要不一致时不摆一个批不了的按钮", () => {
    const { container } = render(<AgentApprovalPanel view={view({ pendingApproval: null })} />);
    expect(container.innerHTML).toBe("");
  });

  it("点批准 → decideAgentRun(runId, approve)，onDecided 回调；不本地改状态", async () => {
    decideMock.mockResolvedValueOnce(view({ status: "queued" }));
    const onDecided = vi.fn();
    render(<AgentApprovalPanel view={view()} onDecided={onDecided} />);
    fireEvent.click(screen.getByTestId("agent-approval-approve"));
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(decideMock).toHaveBeenCalledWith("r1", "approve", undefined);
    // 面板自身不宣布成功——run 状态由轮询权威更新（view prop 未变，面板仍在）。
    expect(screen.getByTestId("agent-approval-panel")).toBeTruthy();
  });

  it("点拒绝 → decideAgentRun(runId, reject)", async () => {
    decideMock.mockResolvedValueOnce(view({ status: "failed" }));
    render(<AgentApprovalPanel view={view()} />);
    fireEvent.click(screen.getByTestId("agent-approval-reject"));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith("r1", "reject", undefined));
  });

  it("409 竞态 → 错误如实可见，绝不假装决定生效", async () => {
    decideMock.mockRejectedValueOnce(new Error("AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION"));
    render(<AgentApprovalPanel view={view()} />);
    fireEvent.click(screen.getByTestId("agent-approval-approve"));
    await waitFor(() =>
      expect(screen.getByTestId("agent-approval-error").textContent).toContain("AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION"),
    );
  });

  it("in-flight 期间两钮都禁用（防双击双裁决）", async () => {
    let resolve!: (v: unknown) => void;
    decideMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<AgentApprovalPanel view={view()} />);
    fireEvent.click(screen.getByTestId("agent-approval-approve"));
    await waitFor(() => {
      expect((screen.getByTestId("agent-approval-approve") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId("agent-approval-reject") as HTMLButtonElement).disabled).toBe(true);
    });
    resolve(view({ status: "queued" }));
  });

  it("点「编辑参数」→ 文本域播种自 argsSummary，可编辑合法 JSON 后提交 edit 决策", async () => {
    decideMock.mockResolvedValueOnce(view({ status: "queued" }));
    const onDecided = vi.fn();
    render(<AgentApprovalPanel view={view()} onDecided={onDecided} />);
    fireEvent.click(screen.getByTestId("agent-approval-start-edit"));
    const textarea = screen.getByTestId("agent-approval-edit-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe('{"skill":"risky"}');
    fireEvent.change(textarea, { target: { value: '{"skill":"safe","note":"reviewed"}' } });
    expect(screen.queryByTestId("agent-approval-edit-json-error")).toBeNull();
    fireEvent.click(screen.getByTestId("agent-approval-edit-submit"));
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(decideMock).toHaveBeenCalledWith("r1", "edit", { skill: "safe", note: "reviewed" }, undefined);
  });

  it("编辑态输入非法 JSON → 就地报错，「编辑并批准」按钮禁用，不提交", () => {
    const callsBefore = decideMock.mock.calls.length;
    render(<AgentApprovalPanel view={view()} />);
    fireEvent.click(screen.getByTestId("agent-approval-start-edit"));
    const textarea = screen.getByTestId("agent-approval-edit-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "{not valid json" } });
    expect(screen.getByTestId("agent-approval-edit-json-error").textContent).toContain("JSON");
    expect((screen.getByTestId("agent-approval-edit-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("agent-approval-edit-submit"));
    expect(decideMock.mock.calls.length).toBe(callsBefore); // 禁用状态下点击不触发新调用
  });

  it("编辑态输入合法但非对象的 JSON（数组）→ 同样报错并禁用提交", () => {
    render(<AgentApprovalPanel view={view()} />);
    fireEvent.click(screen.getByTestId("agent-approval-start-edit"));
    const textarea = screen.getByTestId("agent-approval-edit-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "[1,2,3]" } });
    expect(screen.getByTestId("agent-approval-edit-json-error").textContent).toContain("JSON 对象");
    expect((screen.getByTestId("agent-approval-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("点「取消」→ 退出编辑态，回到批准/编辑/拒绝三入口", () => {
    render(<AgentApprovalPanel view={view()} />);
    fireEvent.click(screen.getByTestId("agent-approval-start-edit"));
    expect(screen.getByTestId("agent-approval-edit-textarea")).toBeTruthy();
    fireEvent.click(screen.getByTestId("agent-approval-edit-cancel"));
    expect(screen.queryByTestId("agent-approval-edit-textarea")).toBeNull();
    expect(screen.getByTestId("agent-approval-start-edit")).toBeTruthy();
  });
});
