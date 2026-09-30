/**
 * AG06 follow-up —— 升级卡片（escalate_matter 中断）的前端反证套件。
 * 断言：谁/为什么/给谁/要决定什么都用人话渲染；resolve/reject 按契约 `EscalateDecision`
 * 形状提交；失败码不上屏；两条渲染路径（旧轨道 AgentApprovalPanel）都走卡片而不是原始 JSON。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { listAgentDirectory } = vi.hoisted(() => ({ listAgentDirectory: vi.fn() }));
vi.mock("@/lib/agent-directory", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAgentDirectory,
}));

import { AgentEscalationCard } from "@/components/chat/agent-escalation-card";
import { AgentApprovalPanel } from "@/components/chat/agent-approval-panel";
import { ApiError } from "@/lib/api-client";
import { ESCALATE_TOOL_NAME, escalationFailureText, parseEscalatePayload } from "@/lib/agent-escalation";
import { resetAgentDirectoryMapCache } from "@/lib/use-agent-directory-map";
import type { AgentRunView } from "@/lib/agent-run";

afterEach(() => { cleanup(); vi.clearAllMocks(); resetAgentDirectoryMapCache(); });

const payload = { matter: "超过 10 万的折扣审批", reason: "客户要求 7 折，超出我的授权上限。", target: "project_owner" as const, contextRefs: ["00000000-0000-4000-8000-000000000001"] };
const IID = "11111111-1111-4111-8111-111111111111";

describe("AgentEscalationCard", () => {
  it("用人话渲染谁、给谁、事项、原因，不出现 reasonCode / 工具名", () => {
    render(<AgentEscalationCard interruptId={IID} payload={payload} agentName="小销" agentAvatarKey="dh-05-sales-representative" />);
    expect(screen.getByTestId("agent-escalation-who").textContent).toBe("小销");
    expect(screen.getByTestId("agent-escalation-target").textContent).toBe("项目负责人");
    expect(screen.getByTestId("agent-escalation-matter").textContent).toBe(payload.matter);
    expect(screen.getByTestId("agent-escalation-reason").textContent).toBe(payload.reason);
    expect(screen.getByTestId("agent-escalation-refs").textContent).toContain("1 条");
    expect(screen.getByTestId("agent-escalation-avatar").getAttribute("data-avatar-key")).toBe("dh-05-sales-representative");
    expect(screen.getByTestId("agent-escalation-card").textContent).not.toContain("escalate_matter");
  });

  it("uiux-r5：有数字人写的原因时它是标题，事项名退成标签（且不再有第二块原因）", () => {
    render(<AgentEscalationCard interruptId={IID} payload={payload} agentName="小销" />);
    const matter = screen.getByTestId("agent-escalation-matter");
    const reason = screen.getByTestId("agent-escalation-reason");
    expect(matter.tagName).not.toBe("DD");
    expect(reason.tagName).toBe("DD");
    expect(screen.getAllByText(payload.reason)).toHaveLength(1);
    expect(screen.getAllByText(payload.matter)).toHaveLength(1);
  });

  it("没写意见时两个动作都禁用；resolve 按契约形状提交 decisionText", async () => {
    const submit = vi.fn().mockResolvedValue({ interruptId: IID, status: "resolved" });
    const onDecided = vi.fn();
    render(<AgentEscalationCard interruptId={IID} payload={payload} submit={submit} sessionToken="tok" onDecided={onDecided} />);
    expect((screen.getByTestId("agent-escalation-resolve") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("agent-escalation-reject") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("你的决定或意见"), { target: { value: "  同意 8 折  " } });
    fireEvent.click(screen.getByTestId("agent-escalation-resolve"));
    await waitFor(() => expect(screen.getByTestId("agent-escalation-done")).toBeTruthy());
    expect(submit).toHaveBeenCalledWith(IID, { decision: "resolve", decisionText: "同意 8 折" }, "tok");
    expect(onDecided).toHaveBeenCalledWith("resolve");
  });

  it("reject 把文本作为 reason 提交；Ctrl+Enter 走 resolve", async () => {
    const submit = vi.fn().mockResolvedValue({ interruptId: IID, status: "rejected" });
    render(<AgentEscalationCard interruptId={IID} payload={payload} submit={submit} />);
    fireEvent.change(screen.getByTestId("agent-escalation-text"), { target: { value: "不行，最多 9 折" } });
    fireEvent.click(screen.getByTestId("agent-escalation-reject"));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(IID, { decision: "reject", reason: "不行，最多 9 折" }, undefined));
    expect(screen.getByTestId("agent-escalation-done").textContent).toContain("不同意");
  });

  it("非决策人被拒（ESCALATION_DECIDER_FORBIDDEN）→ 人话，不露码", async () => {
    const submit = vi.fn().mockRejectedValue(new ApiError(403, "ESCALATION_DECIDER_FORBIDDEN", {}));
    render(<AgentEscalationCard interruptId={IID} payload={payload} submit={submit} />);
    fireEvent.change(screen.getByTestId("agent-escalation-text"), { target: { value: "同意" } });
    fireEvent.keyDown(screen.getByTestId("agent-escalation-text"), { key: "Enter", ctrlKey: true });
    const alert = await screen.findByTestId("agent-escalation-error");
    expect(alert.textContent).toContain("没有权限");
    expect(alert.textContent).not.toContain("ESCALATION");
    expect(screen.queryByTestId("agent-escalation-done")).toBeNull();
  });

  it("载荷读不出 → 兜底文案、无动作；只读用户 → 说明由谁决定", () => {
    const { rerender } = render(<AgentEscalationCard interruptId={IID} payload={null} />);
    expect(screen.getByTestId("agent-escalation-unreadable")).toBeTruthy();
    expect(screen.queryByTestId("agent-escalation-resolve")).toBeNull();
    rerender(<AgentEscalationCard interruptId={IID} payload={payload} canWrite={false} />);
    expect(screen.getByTestId("agent-escalation-readonly").textContent).toContain("项目负责人");
  });

  it("lib：载荷解析与失败文案", () => {
    expect(parseEscalatePayload(JSON.stringify(payload))?.matter).toBe(payload.matter);
    expect(parseEscalatePayload("{bad")).toBeNull();
    expect(parseEscalatePayload(JSON.stringify({ ...payload, target: "ceo" }))).toBeNull();
    expect(escalationFailureText(new ApiError(500, "WHATEVER", {}))).not.toContain("WHATEVER");
    expect(escalationFailureText(new Error("x"))).toContain("网络");
  });
});

describe("AgentApprovalPanel × escalate_matter", () => {
  it("待决工具是 escalate_matter 时渲染升级卡片（带数字人头像），不渲染通用批准 JSON", async () => {
    listAgentDirectory.mockResolvedValue([{
      agentId: "a1", versionId: "v1", name: "小销", initials: "销", roleLabel: "销售代表",
      avatar: { kind: "illustration", key: "dh-05-sales-representative", alt: "小销" }, roleCategory: "sales", tags: [], catalogSource: "official", workflows: [], readiness: "ready",
    }]);
    const view = {
      runId: "r1", threadId: "t1", inputMessageId: "m1", agentId: "a1", agentVersionId: "v1", skillVersionIds: [],
      modelProvider: "deep-agent", modelId: "x", status: "awaiting_tool_permission", error: null, resultMessageId: null,
      steps: [], createdAt: "2026-09-30T00:00:00Z",
      pendingApproval: { permissionRequestId: IID, toolName: ESCALATE_TOOL_NAME, argsSummary: JSON.stringify(payload) },
    } as unknown as AgentRunView;
    render(<AgentApprovalPanel view={view} />);
    expect(screen.getByTestId("agent-escalation-card")).toBeTruthy();
    expect(screen.queryByTestId("agent-approval-args")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("agent-escalation-who").textContent).toBe("销售代表"));
    expect(screen.getByTestId("agent-escalation-avatar").getAttribute("data-avatar-key")).toBe("dh-05-sales-representative");
  });
});
