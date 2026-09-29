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
  startWorkflowInstance: vi.fn(),
}));
vi.mock("@/lib/workflow-runtime-api", async (orig) => ({ ...(await orig<object>()), ...api }));
// 页面级测试只替换外壳（AppShell 依赖会话/身份 provider），路由页本身与其挂载的组件是真的。
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: (p: { left?: unknown; children: unknown }) => <div data-testid="app-shell">{p.left as never}{p.children as never}</div>,
}));
vi.mock("@/components/admin/capability-edit-page", () => ({ CapabilityEditPage: () => <div data-testid="capability-edit-page" /> }));
vi.mock("@/components/admin/agent-capability-graph", () => ({ AgentCapabilityGraph: () => null }));
vi.mock("@/components/admin/admin-nav", () => ({ AdminNav: () => null }));

import { WorkflowRunPanel } from "@/components/workflow/workflow-run-panel";
import { WorkflowApprovalList, WorkflowRunEntry, WorkflowRunList } from "@/components/workflow/workflow-lists";
import WorkflowRunPage from "@/app/workflows/runs/[instanceId]/page";
import WorkflowMyRunsPage from "@/app/workflows/runs/page";
import WorkflowApprovalsPage from "@/app/workflows/approvals/page";
import AgentEditRoutePage from "@/app/platform-admin/agent/[id]/page";
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
    api.listMyWorkflowApprovals.mockResolvedValue({ items: [] });
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

describe("补充：重连计数 / 审批刷新 / 发起运行", () => {
  it("服务端发完数据后正常关闭：不计失败，立即带新 Last-Event-ID 续传，不降级 polling", async () => {
    let calls = 0;
    api.openWorkflowInstanceStream.mockImplementation(async (_i: string, _l: number | null, on: (e: WorkflowSseEnvelope) => void, o: { signal?: AbortSignal }) => {
      calls += 1;
      if (calls <= 4) { on(delta(10 + calls)); return; } // 每次发一条后干净关闭
      return hang("", null, null, o);
    });
    render(<WorkflowRunPanel instanceId="i1" initial={proj()} reconnectDelayMs={10_000} maxReconnects={1} pollIntervalMs={20} />);
    await waitFor(() => expect(api.openWorkflowInstanceStream.mock.calls.length).toBe(5));
    expect(api.openWorkflowInstanceStream.mock.calls.map((c) => c[1])).toEqual([10, 11, 12, 13, 14]);
    await waitFor(() => expect(screen.getByTestId("workflow-sse-status").getAttribute("data-sse")).toBe("live"));
    expect(screen.getByTestId("workflow-event-log").querySelectorAll("li").length).toBe(4);
  });

  it("未收到任何 envelope 就正常结束：计为失败；首次尝试解决前保持 live", async () => {
    let release: () => void = () => {};
    api.openWorkflowInstanceStream.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    api.openWorkflowInstanceStream.mockImplementation(async () => undefined);
    render(<WorkflowRunPanel instanceId="i1" initial={proj()} reconnectDelayMs={5} maxReconnects={1} pollIntervalMs={1_000} />);
    await waitFor(() => expect(api.openWorkflowInstanceStream).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("workflow-sse-status").getAttribute("data-sse")).toBe("live");
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("workflow-sse-status").getAttribute("data-sse")).toBe("polling"));
  });

  it("待我审批：批准后关闭抽屉并重读列表，已裁决项消失", async () => {
    api.listMyWorkflowApprovals
      .mockResolvedValueOnce({ items: [{ instanceId: "i1", workflowKey: "weekly-report", definitionVersion: 3, agentId: "a1", initiatorUserId: "u1", gate: gate() }] })
      .mockResolvedValueOnce({ items: [] });
    api.getWorkflowInstance.mockResolvedValue(proj({ stateVersion: 9 }));
    api.approveWorkflowGate.mockResolvedValue({ gate: gate({ decision: "approved" }), status: "running", stateVersion: 10 });
    render(<WorkflowApprovalList />);
    fireEvent.click(await screen.findByTestId("workflow-approval-open-g1"));
    fireEvent.click(screen.getByTestId("workflow-approve"));
    expect(await screen.findByTestId("workflow-run-list-empty")).toBeTruthy();
    expect(api.listMyWorkflowApprovals).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("workflow-approve")).toBeNull();
  });

  it("入口：展开后由用户选择具体 Workflow，调 startInstance 并回调新实例", async () => {
    api.listRunnableWorkflows.mockResolvedValue({ items: [
      { key: "weekly-report", version: 3, title: "周报", inputSchema: {} },
      { key: "daily-digest", version: 1, title: "日报", inputSchema: {} },
    ] });
    api.startWorkflowInstance.mockResolvedValue({ instanceId: "i9", status: "running", stateVersion: 1, definitionVersion: 1, pinnedSkills: [] });
    const onStarted = vi.fn();
    render(<WorkflowRunEntry agentId="a1" onStarted={onStarted} />);
    fireEvent.click(await screen.findByTestId("workflow-run-entry"));
    fireEvent.click(screen.getByTestId("workflow-run-start-daily-digest"));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("i9"));
    expect(api.startWorkflowInstance).toHaveBeenCalledWith({ key: "daily-digest", version: 1, agentId: "a1", input: {} });
  });

  it("入口：startInstance 失败显示错误文案", async () => {
    api.listRunnableWorkflows.mockResolvedValue({ items: [{ key: "weekly-report", version: 3, title: "周报", inputSchema: {} }] });
    api.startWorkflowInstance.mockRejectedValue(new ApiError(403, null, { code: "workflow_not_allowed", message: "x" }));
    render(<WorkflowRunEntry agentId="a1" onStarted={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("workflow-run-entry"));
    fireEvent.click(screen.getByTestId("workflow-run-start-weekly-report"));
    expect(await screen.findByTestId("workflow-run-start-error")).toBeTruthy();
  });
});

describe("页面级挂载（路由真实存在并挂载组件）", () => {
  it("/workflows/runs/[instanceId] 渲染运行面板", async () => {
    render(<WorkflowRunPage params={{ instanceId: "i1" }} />);
    await waitFor(() => expect(screen.getByTestId("workflow-run-panel").getAttribute("data-status")).toBe("running"));
    expect(api.getWorkflowInstance).toHaveBeenCalledWith("i1");
  });

  it("/workflows/runs 渲染我的运行列表", async () => {
    api.listMyWorkflowInstances.mockResolvedValue({ items: [], nextCursor: null });
    render(<WorkflowMyRunsPage />);
    expect(await screen.findByTestId("workflow-run-list-empty")).toBeTruthy();
    expect(screen.getByTestId("workflow-nav")).toBeTruthy();
  });

  it("/workflows/approvals 渲染待我审批列表", async () => {
    api.listMyWorkflowApprovals.mockResolvedValue({ items: [] });
    render(<WorkflowApprovalsPage />);
    expect((await screen.findByTestId("workflow-run-list-empty")).textContent).toContain("没有待你审批");
  });

  it("Agent 页（/platform-admin/agent/[id]）挂载「运行 Workflow」入口", async () => {
    api.listRunnableWorkflows.mockResolvedValue({ items: [{ key: "weekly-report", version: 3, title: "周报", inputSchema: {} }] });
    render(<AgentEditRoutePage params={{ id: "a7" }} searchParams={{}} />);
    expect(await screen.findByTestId("workflow-run-entry")).toBeTruthy();
    expect(api.listRunnableWorkflows).toHaveBeenCalledWith("a7");
  });
});
