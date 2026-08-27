/**
 * 本 PR —— 钉住 `CopilotKitV2PlanControl` 真的把 `plan-control-api.ts` 的读写函数接进了
 * `copilotkit-v2-panel.tsx` 的渲染树：`threadId` 非空时轮询 `fetchPlanLedger`，六态
 * 指示器/计划面板/确认门渲染真实账本数据（不是 mock/占位），点击调序/删步/加约束/
 * 撤约束/确认/暂停/恢复/重试真的调用对应的 `plan-control-api.ts` 函数并带上正确参数
 * （不是靠用户在输入框打字模拟）。
 *
 * `plan-control-api.ts` 整体 mock 掉——本文件只钉「组件把哪个函数、用什么参数调了」，
 * 不重复验证 HTTP 往返本身（那已经被 `apps/api/tests/plan-control/http-endpoints-wired.test.ts`
 * 真实网络覆盖）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { PlanLedgerView } from "@/lib/plan-control-api";

afterEach(cleanup);

const api = vi.hoisted(() => ({
  fetchPlanLedger: vi.fn(),
  reorderPlanStep: vi.fn(),
  deletePlanStep: vi.fn(),
  addPlanConstraint: vi.fn(),
  removePlanConstraint: vi.fn(),
  confirmPlan: vi.fn(),
  pausePlanRun: vi.fn(),
  resumePlanRun: vi.fn(),
  retryPlanStep: vi.fn(),
  planControlErrorCode: vi.fn((): string | null => null),
}));

vi.mock("@/lib/plan-control-api", () => api);

import { CopilotKitV2PlanControl } from "@/components/chat/copilotkit-v2-plan-control";
import { PLAN_PHASE_INDICATOR_TESTID } from "@/components/plan-control/plan-phase-indicator";
import { PLAN_PANEL_TESTID, PLAN_STEP_TESTID } from "@/components/plan-control/plan-panel-readonly";
import { PLAN_STEP_DELETE_TESTID, PLAN_STEP_REORDER_TESTID } from "@/components/plan-control/plan-panel-edit";
import { PLAN_CONFIRM_RUN_TESTID } from "@/components/plan-control/plan-confirm-gate";
import { PLAN_CONTROL_EDIT_TOGGLE_TESTID } from "@/components/chat/copilotkit-v2-plan-control";

function ledgerWithSteps(overrides: Partial<PlanLedgerView> = {}): PlanLedgerView {
  return {
    revision: 3,
    engineEpoch: 1,
    origin: "engine",
    steps: [
      { planStepId: "s1", content: "调研竞品定价", status: "pending", constraints: [] },
      { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
    ],
    orphanedConstraints: [],
    phase: "planning",
    gate: { required: true, reason: "multi-step" },
    progress: { completed: 0, total: 2, elapsedMs: 0 },
    pendingApplyAtNextRun: false,
    activeRunId: null,
    ...overrides,
  };
}

describe("CopilotKitV2PlanControl —— 真实读账本 + 真实调用写操作", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.planControlErrorCode.mockReturnValue(null);
  });

  it("threadId 为 null（新对话尚未发出第一条消息）时不渲染，也不发起任何请求", () => {
    render(<CopilotKitV2PlanControl threadId={null} />);
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
    expect(api.fetchPlanLedger).not.toHaveBeenCalled();
  });

  it("phase='preparing'（零计划，I-1 正常态）时不渲染面板——不是错误态，是本来就没有可展示的计划", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({ steps: [], phase: "preparing", gate: { required: false, reason: "no-plan" } }),
    );
    render(<CopilotKitV2PlanControl threadId="t-1" />);
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalledWith("t-1"));
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
  });

  it("有真实计划时渲染六态指示器 + 只读面板 + 确认门（gate.required=true）", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    render(<CopilotKitV2PlanControl threadId="t-2" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeTruthy());
    expect(screen.getByTestId(PLAN_PANEL_TESTID).getAttribute("data-plan-mode")).toBe("read");
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(2);
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
  });

  it("点击「确认并执行」真的调用 confirmPlan(threadId, {basedOnRevision: 当前 revision})", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.confirmPlan.mockResolvedValue({ revision: 3, runId: "run-1", deliveredPlanDigest: "x", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-3" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID));

    await waitFor(() => expect(api.confirmPlan).toHaveBeenCalledWith("t-3", { basedOnRevision: 3 }));
  });

  it("点击「编辑计划」切到编辑态，拖拽把手键盘调序真的调用 reorderPlanStep 带正确 planStepId/toIndex/basedOnRevision", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.reorderPlanStep.mockResolvedValue({ revision: 4, appliedTo: "ledger-and-engine", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-4" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID));

    const handles = await screen.findAllByTestId(PLAN_STEP_REORDER_TESTID);
    expect(handles).toHaveLength(2);
    // Alt+↓ 把第一步移到第二位（PlanPanelEdit 的既有键盘等价，TW-A11Y-8）。
    fireEvent.keyDown(handles[0]!, { key: "ArrowDown", altKey: true });

    await waitFor(() =>
      expect(api.reorderPlanStep).toHaveBeenCalledWith("t-4", { basedOnRevision: 3, planStepId: "s1", toIndex: 1 }),
    );
  });

  it("编辑态点击「移除」真的调用 deletePlanStep 带正确 planStepId", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.deletePlanStep.mockResolvedValue({
      revision: 4, appliedTo: "ledger-and-engine", orphanedConstraintIds: [], auditEventId: "a",
    });
    render(<CopilotKitV2PlanControl threadId="t-5" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID));

    const deleteButtons = await screen.findAllByTestId(PLAN_STEP_DELETE_TESTID);
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() =>
      expect(api.deletePlanStep).toHaveBeenCalledWith("t-5", { basedOnRevision: 3, planStepId: "s1" }),
    );
  });

  it("phase='executing' 渲染执行进度条，点击「暂停」真的调用 pausePlanRun", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "executing", activeRunId: "run-1",
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "in_progress", constraints: [] },
        ],
        progress: { completed: 1, total: 2, elapsedMs: 5000 },
      }),
    );
    api.pausePlanRun.mockResolvedValue({ runId: "run-1", pausedAtStepId: "s2", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-6" />);

    const pauseBtn = await screen.findByTestId("chat-task-workbench-run-pause");
    fireEvent.click(pauseBtn);
    await waitFor(() => expect(api.pausePlanRun).toHaveBeenCalledWith("t-6"));
  });

  it("phase='failed' 渲染失败恢复，点击「重试该步」真的调用 retryPlanStep 带最先未完成步骤的 planStepId", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "failed",
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
        ],
      }),
    );
    api.retryPlanStep.mockResolvedValue({ runId: "run-2", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-7" />);

    const retryBtn = await screen.findByTestId("chat-task-workbench-failure-retry-step");
    fireEvent.click(retryBtn);
    await waitFor(() => expect(api.retryPlanStep).toHaveBeenCalledWith("t-7", { planStepId: "s2" }));
  });

  it("PLAN_REVISION_CHANGED：操作失败后立即重取账本，界面提示刷新而不是静默丢弃", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.confirmPlan.mockRejectedValue(new Error("stale"));
    api.planControlErrorCode.mockReturnValue("PLAN_REVISION_CHANGED");
    render(<CopilotKitV2PlanControl threadId="t-8" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID));

    await waitFor(() => expect(screen.getByTestId("chat-task-workbench-plan-action-error")).toBeTruthy());
    // 失败后应重新拉取账本（第一次挂载 + 失败后一次 = 至少 2 次）。
    await waitFor(() => expect(api.fetchPlanLedger.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
