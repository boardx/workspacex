/**
 * WF08 —— Workflow 运行面板与审批 UI（契约束 workflow-runtime ① UI 的七态 + 稳定 testid）。
 * 数据形状全部经契约 schema `.parse` 生成，不手写游离 mock。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowRuntime } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";

const api = vi.hoisted(() => ({
  getWorkflowInstance: vi.fn(),
  openWorkflowInstanceStream: vi.fn(),
  cancelWorkflowInstance: vi.fn(),
  resumeWorkflowInstance: vi.fn(),
  retryWorkflowStage: vi.fn(),
  approveWorkflowGate: vi.fn(),
  denyWorkflowGate: vi.fn(),
  listMyWorkflowInstances: vi.fn(),
  listMyWorkflowApprovals: vi.fn(),
  listRunnableWorkflows: vi.fn(),
}));
vi.mock("@/lib/workflow-runtime-api", async (orig) => ({ ...(await orig<object>()), ...api }));

import { WorkflowRunPanel } from "@/components/workflow/workflow-run-panel";
import { WorkflowApprovalList, WorkflowRunEntry, WorkflowRunList } from "@/components/workflow/workflow-lists";
import type { WorkflowInstanceProjection, WorkflowSseEnvelope } from "@/lib/workflow-runtime-api";

const gate = (over: Record<string, unknown> = {}) =>
  workflowRuntime.WorkflowGateView.parse({
    gateId: "g1", stageId: "publish",
    effectPreview: { capabilityCategory: "mail.send", targetSystem: "smtp", summary: "发送周报邮件", payloadPreview: { to: "team@x" } },
    decision: null, decidedBy: null, decidedAt: null, reason: null, viewerCanDecide: true, ...over,
  });

function proj(over: Partial<WorkflowInstanceProjection> = {}): WorkflowInstanceProjection {
  return workflowRuntime.WorkflowInstanceProjection.parse({
    instanceId: "i1", orgId: "o1", workflowKey: "weekly-report", definitionVersion: 3,
    agentId: "a1", agentVersionId: "av1", initiatorUserId: "u1", triggerKind: "manual",
    status: "running", stateVersion: 5, reasonCode: null,
    stages: [
      { stageId: "draft", title: "起草", status: "succeeded", attempt: 1,
        pinnedSkills: [{ stageId: "draft", stableId: "writer", version: "1.2.0" }],
        outputs: [{ outputId: "o1", label: "草稿", href: "/files/o1" }], reasonCode: null, startedAt: null, finishedAt: null },
      { stageId: "publish", title: "发布", status: "running", attempt: 2, pinnedSkills: [], outputs: [], reasonCode: null, startedAt: null, finishedAt: null },
    ],
    openGate: null, effects: [], lastSeq: 10,
    viewerCapabilities: { canCancel: true, canRetryStage: true, canResume: false },
    createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z", ...over,
  });
}

const delta = (seq: number, event = "stage_started"): WorkflowSseEnvelope =>
  workflowRuntime.WorkflowSseEnvelope.parse({
    instanceId: "i1", seq, type: "delta", stateVersion: 5, payload: { event, stageId: "publish", reasonCode: null, data: {} },
  });

/** 挂起直到 abort 的流：模拟「连接保持中」。 */
const hang = (_id: string, _last: number | null, _on: unknown, o: { signal?: AbortSignal }) =>
  new Promise<void>((resolve) => o.signal?.addEventListener("abort", () => resolve()));

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.openWorkflowInstanceStream.mockImplementation(hang);
  api.getWorkflowInstance.mockResolvedValue(proj());
});

describe("WorkflowRunPanel", () => {
  it("运行中：时间线含状态/attempt/固定 Skill 版本、固定版本徽标、产出链接", async () => {
    render(<WorkflowRunPanel instanceId="i1" initial={proj()} />);
    expect(screen.getByTestId("workflow-run-panel").getAttribute("data-status")).toBe("running");
    expect(screen.getByTestId("workflow-pinned-version").textContent).toBe("weekly-report@3");
    const pub = screen.getByTestId("workflow-stage-publish");
    expect(pub.getAttribute("data-status")).toBe("running");
    expect(pub.getAttribute("data-attempt")).toBe("2");
    expect(screen.getByTestId("workflow-stage-skills-draft").textContent).toBe("writer@1.2.0");
    expect(screen.getByTestId("workflow-output-o1").getAttribute("href")).toBe("/files/o1");
    expect(screen.getByTestId("workflow-sse-status").getAttribute("data-sse")).toBe("live");
    await waitFor(() => expect(api.openWorkflowInstanceStream).toHaveBeenCalledWith("i1", 10, expect.any(Function), expect.anything()));
  });

  it("SSE 日志按 seq 排列且去重（重放 / 旧 seq 被丢弃）", async () => {
    api.openWorkflowInstanceStream.mockImplementationOnce(async (_i: string, _l: number | null, on: (e: WorkflowSseEnvelope) => void, o: { signal?: AbortSignal }) => {
      on(delta(11)); on(delta(11)); on(delta(9)); on(delta(12, "stage_succeeded"));
      return hang("", null, null, o);
    });
    render(<WorkflowRunPanel instanceId="i1" initial={proj()} />);
    await waitFor(() => expect(screen.getByTestId("workflow-event-log").querySelectorAll("li").length).toBe(2));
    const seqs = [...screen.getByTestId("workflow-event-log").querySelectorAll("li")].map((li) => li.getAttribute("data-seq"));
    expect(seqs).toEqual(["11", "12"]);
    expect(api.getWorkflowInstance).toHaveBeenCalled();
  });

  it("断线重连：显示 reconnecting，带 Last-Event-ID 续传；超上限降级 polling", async () => {
    let calls = 0;
    api.openWorkflowInstanceStream.mockImplementation(async (_i: string, _l: number | null, on: (e: WorkflowSseEnvelope) => void) => {
      calls += 1;
      if (calls === 1) on(delta(11));
      throw new Error("network");
    });
    render(<WorkflowRunPanel instanceId="i1" initial={proj()} reconnectDelayMs={30} maxReconnects={2} pollIntervalMs={20} />);
    await waitFor(() => expect(screen.getByTestId("workflow-sse-status").getAttribute("data-sse")).toBe("reconnecting"));
    await waitFor(() => expect(api.openWorkflowInstanceStream.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(api.openWorkflowInstanceStream.mock.calls[1]![1]).toBe(11);
    await waitFor(() => expect(screen.getByTestId("workflow-sse-status").getAttribute("data-sse")).toBe("polling"));
    const before = api.getWorkflowInstance.mock.calls.length;
    await waitFor(() => expect(api.getWorkflowInstance.mock.calls.length).toBeGreaterThan(before));
  });

  it("失败可重试：失败阶段显示「从该阶段重试」，带 expectedStateVersion 调用；已完成阶段产出可见", async () => {
    const failed = proj({
      status: "failed",
      stages: [proj().stages[0]!, { ...proj().stages[1]!, status: "failed", reasonCode: "stage_attempts_exhausted" }],
    });
    api.retryWorkflowStage.mockResolvedValue({ instanceId: "i1", stageId: "publish", attempt: 3, stateVersion: 6 });
    api.getWorkflowInstance.mockResolvedValue(failed);
    render(<WorkflowRunPanel instanceId="i1" initial={failed} />);
    expect(screen.getByTestId("workflow-output-o1")).toBeTruthy();
    expect(screen.queryByTestId("workflow-action-retry-draft")).toBeNull();
    fireEvent.click(screen.getByTestId("workflow-action-retry-publish"));
    await waitFor(() => expect(api.retryWorkflowStage).toHaveBeenCalledWith({ instanceId: "i1", stageId: "publish", expectedStateVersion: 5 }));
    expect((screen.getByTestId("workflow-action-cancel") as HTMLButtonElement).disabled).toBe(true);
    expect(api.openWorkflowInstanceStream).not.toHaveBeenCalled(); // 终态不订阅
  });

  it("无重试权限：失败阶段不渲染重试按钮", () => {
    const failed = proj({ status: "failed", viewerCapabilities: { canCancel: false, canRetryStage: false, canResume: false },
      stages: [{ ...proj().stages[1]!, status: "failed" }] });
    render(<WorkflowRunPanel instanceId="i1" initial={failed} />);
    expect(screen.queryByTestId("workflow-action-retry-publish")).toBeNull();
  });

  it("取消：带 expectedStateVersion；409 state_version_conflict 用 latestProjection 刷新并提示", async () => {
    const latest = proj({ status: "cancelling", stateVersion: 7 });
    api.cancelWorkflowInstance.mockRejectedValue(new ApiError(409, null, { code: "state_version_conflict", message: "x", latestProjection: latest }));
    api.getWorkflowInstance.mockResolvedValue(latest);
    render(<WorkflowRunPanel instanceId="i1" initial={proj()} />);
    fireEvent.click(screen.getByTestId("workflow-action-cancel"));
    await waitFor(() => expect(screen.getByTestId("workflow-action-error").textContent).toContain("已刷新为最新"));
    expect(api.cancelWorkflowInstance).toHaveBeenCalledWith({ instanceId: "i1", expectedStateVersion: 5 });
    await waitFor(() => expect(screen.getByTestId("workflow-run-panel").getAttribute("data-status")).toBe("cancelling"));
  });

  it("权限阻断：提示条显示 reasonCode 文案", () => {
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "blocked_permission", reasonCode: "tool_authorization_revoked" })} />);
    const b = screen.getByTestId("workflow-banner-blocked-permission");
    expect(b.getAttribute("data-reason")).toBe("tool_authorization_revoked");
    expect(b.textContent).toContain("权限已变更");
    expect(screen.queryByTestId("workflow-banner-needs-attention")).toBeNull();
  });

  it("needs_attention：提示条显示原因", () => {
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "needs_attention", reasonCode: "effect_unreconciled" })} />);
    expect(screen.getByTestId("workflow-banner-needs-attention").textContent).toContain("人工核对");
  });

  it("被拒：显示拒绝人与理由，抽屉只读", () => {
    const g = gate({ decision: "denied", decidedBy: "boss", decidedAt: "2026-09-29T01:00:00Z", reason: "内容不妥", viewerCanDecide: false });
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "rejected", reasonCode: "gate_denied", openGate: g })} />);
    expect(screen.getByTestId("workflow-banner-rejected").textContent).toContain("boss");
    expect(screen.getByTestId("workflow-banner-rejected").textContent).toContain("内容不妥");
    expect(screen.getByTestId("workflow-approval-result").getAttribute("data-decision")).toBe("denied");
    expect((screen.getByTestId("workflow-approve") as HTMLButtonElement).disabled).toBe(true);
  });

  it("等待审批：抽屉显示副作用预览/目标系统/能力分类/发起人与 Agent；批准走契约调用", async () => {
    api.approveWorkflowGate.mockResolvedValue({ gate: gate({ decision: "approved", decidedBy: "u2" }), status: "running", stateVersion: 6 });
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "awaiting_gate_decision", openGate: gate() })} />);
    expect(screen.getByTestId("workflow-approval-target").textContent).toBe("smtp");
    expect(screen.getByTestId("workflow-approval-capability").textContent).toBe("mail.send");
    expect(screen.getByTestId("workflow-approval-initiator").textContent).toBe("u1");
    expect(screen.getByTestId("workflow-approval-agent").textContent).toBe("a1");
    expect(screen.getByTestId("workflow-approval-preview").textContent).toContain("team@x");
    fireEvent.click(screen.getByTestId("workflow-approve"));
    await waitFor(() => expect(screen.getByTestId("workflow-approval-result").getAttribute("data-decision")).toBe("approved"));
    expect(api.approveWorkflowGate).toHaveBeenCalledWith({ instanceId: "i1", gateId: "g1", expectedStateVersion: 5 });
  });

  it("拒绝必填理由：空理由不发请求；填写后带理由调用 deny", async () => {
    api.denyWorkflowGate.mockResolvedValue({ gate: gate({ decision: "denied", reason: "不行" }), status: "rejected", stateVersion: 6 });
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "awaiting_gate_decision", openGate: gate() })} />);
    fireEvent.click(screen.getByTestId("workflow-deny"));
    expect(screen.getByTestId("workflow-approval-error").textContent).toContain("必须填写理由");
    expect(api.denyWorkflowGate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("workflow-deny-reason"), { target: { value: " 不行 " } });
    fireEvent.click(screen.getByTestId("workflow-deny"));
    await waitFor(() => expect(api.denyWorkflowGate).toHaveBeenCalledWith({ instanceId: "i1", gateId: "g1", expectedStateVersion: 5, reason: "不行" }));
  });

  it("并发已决（409 gate_already_decided）：显示他人结果并禁用按钮，不假装自己的决定生效", async () => {
    api.approveWorkflowGate.mockRejectedValue(new ApiError(409, null, { code: "gate_already_decided", message: "x", decidedGate: gate({ decision: "denied", decidedBy: "other", reason: "r" }) }));
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "awaiting_gate_decision", openGate: gate() })} />);
    fireEvent.click(screen.getByTestId("workflow-approve"));
    await waitFor(() => expect(screen.getByTestId("workflow-approval-result").getAttribute("data-decision")).toBe("denied"));
    expect(screen.getByTestId("workflow-approval-error").textContent).toContain("已被他人决定");
    expect((screen.getByTestId("workflow-deny") as HTMLButtonElement).disabled).toBe(true);
  });

  it("非指定审批人：viewerCanDecide=false 时按钮禁用", () => {
    render(<WorkflowRunPanel instanceId="i1" initial={proj({ status: "awaiting_gate_decision", openGate: gate({ viewerCanDecide: false }) })} />);
    expect((screen.getByTestId("workflow-approve") as HTMLButtonElement).disabled).toBe(true);
  });

  it("无 initial：先 getInstance 加载；404 显示错误态", async () => {
    api.getWorkflowInstance.mockRejectedValue(new ApiError(404, null, { code: "workflow_not_found", message: "x" }));
    render(<WorkflowRunPanel instanceId="i1" />);
    await waitFor(() => expect(screen.getByTestId("workflow-run-panel").getAttribute("data-state")).toBe("error"));
    expect(screen.getByRole("alert").textContent).toContain("无权查看");
  });
});

describe("列表与入口", () => {
  it("我的运行：空列表态", async () => {
    api.listMyWorkflowInstances.mockResolvedValue({ items: [], nextCursor: null });
    render(<WorkflowRunList />);
    expect((await screen.findByTestId("workflow-run-list-empty")).textContent).toContain("还没有运行记录");
  });

  it("我的运行：按状态筛选透传", async () => {
    const s = workflowRuntime.WorkflowInstanceSummary.parse({ instanceId: "i1", workflowKey: "weekly-report", definitionVersion: 3, agentId: "a1",
      status: "failed", stateVersion: 2, reasonCode: null, createdAt: "t", updatedAt: "t" });
    api.listMyWorkflowInstances.mockResolvedValue({ items: [s], nextCursor: null });
    render(<WorkflowRunList status={["failed"]} />);
    expect((await screen.findByTestId("workflow-run-list")).textContent).toContain("失败");
    expect(api.listMyWorkflowInstances).toHaveBeenCalledWith(["failed"]);
  });

  it("待我审批：空态 & 列表打开抽屉，裁决前读取当前 stateVersion", async () => {
    api.listMyWorkflowApprovals.mockResolvedValueOnce({ items: [] });
    const { unmount } = render(<WorkflowApprovalList />);
    expect(await screen.findByTestId("workflow-run-list-empty")).toBeTruthy();
    unmount();
    api.listMyWorkflowApprovals.mockResolvedValueOnce({ items: [{ instanceId: "i1", workflowKey: "weekly-report", definitionVersion: 3, agentId: "a1", initiatorUserId: "u1", gate: gate() }] });
    api.getWorkflowInstance.mockResolvedValue(proj({ stateVersion: 9 }));
    api.approveWorkflowGate.mockResolvedValue({ gate: gate({ decision: "approved" }), status: "running", stateVersion: 10 });
    render(<WorkflowApprovalList />);
    fireEvent.click(await screen.findByTestId("workflow-approval-open-g1"));
    fireEvent.click(screen.getByTestId("workflow-approve"));
    await waitFor(() => expect(api.approveWorkflowGate).toHaveBeenCalledWith({ instanceId: "i1", gateId: "g1", expectedStateVersion: 9 }));
  });

  it("入口：有可运行 Workflow 时渲染；无运行权限（空 / 403）时不渲染", async () => {
    api.listRunnableWorkflows.mockResolvedValueOnce({ items: [{ key: "weekly-report", version: 3, title: "周报", inputSchema: {} }] });
    const { unmount } = render(<WorkflowRunEntry agentId="a1" />);
    expect(await screen.findByTestId("workflow-run-entry")).toBeTruthy();
    unmount();
    api.listRunnableWorkflows.mockRejectedValueOnce(new ApiError(403, null, { code: "workflow_not_allowed", message: "x" }));
    render(<WorkflowRunEntry agentId="a1" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("workflow-run-entry")).toBeNull();
  });
});
