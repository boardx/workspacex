/**
 * issue #2260 —— 顶部阶段指示器与右侧任务检查器此前分别读两份不同数据
 * （REST 账本 vs AG-UI SSE `STATE_SNAPSHOT`），confirm 触发的续跑（issue #2250）
 * 只更新前者，右侧 Inspector 因此停在陈旧计数上，与顶部矛盾。
 *
 * 本测试钉住修复：`ChatTaskInspector`「进度」页签一旦拿到账本（`getPlanLedger`）
 * 且账本有步骤，必须以账本的步骤/计数为准，即便父组件传入的 `planTodos`
 * （模拟 AG-UI SSE 陈旧快照）与账本不一致——不得展示两份矛盾的进度。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PlanLedgerView } from "@/lib/plan-control-api";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";

afterEach(cleanup);

const api = vi.hoisted(() => ({ fetchPlanLedger: vi.fn() }));
vi.mock("@/lib/plan-control-api", () => api);

import { ChatTaskInspector } from "@/components/chat/chat-task-inspector";

function ledger(overrides: Partial<PlanLedgerView> = {}): PlanLedgerView {
  return {
    revision: 5,
    engineEpoch: 1,
    origin: "engine",
    steps: [
      { planStepId: "s1", content: "理解需求", status: "completed", constraints: [] },
      { planStepId: "s2", content: "对比竞品", status: "in_progress", constraints: [] },
      { planStepId: "s3", content: "生成报告", status: "pending", constraints: [] },
    ],
    orphanedConstraints: [],
    phase: "executing",
    gate: { required: true, reason: "multi-step" },
    progress: { completed: 1, total: 3, elapsedMs: 12_000 },
    pendingApplyAtNextRun: false,
    activeRunId: "run-1",
    errorCode: null,
    failedStepId: null,
    ...overrides,
  };
}

const STALE_SSE_TODOS: readonly PlanTodo[] = [
  { content: "理解需求", status: "completed" },
  { content: "对比竞品", status: "completed" },
  { content: "生成报告", status: "completed" },
];

function baseProps() {
  return {
    hasSelection: true,
    threadId: "t-1",
    artifacts: null,
    materials: null,
    loading: false,
    artifactsError: null,
    materialsError: null,
    onRetry: () => {},
    pendingMaterialsCount: 0,
    isRunning: true,
    runPhaseLabel: null,
    runStartedAt: null,
  };
}

describe("ChatTaskInspector —— 进度页签以账本为准，不信陈旧的 AG-UI 快照（issue #2260）", () => {
  beforeEach(() => {
    api.fetchPlanLedger.mockReset();
  });

  it("账本显示 1/3 完成时，即使父组件传入「已全部完成」的陈旧 planTodos，页签仍展示账本的 1/3", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledger());
    render(<ChatTaskInspector {...baseProps()} planTodos={STALE_SSE_TODOS} />);

    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalledWith("t-1"));
    await waitFor(() =>
      expect(screen.getByTestId("chat-task-workbench-plan-ratio").textContent).toContain("1/3"),
    );
    // 陈旧快照的「3/3」不得出现——那正是本 issue 的矛盾症状。
    expect(screen.queryByText(/已完成 3\/3 步/)).toBeNull();
  });

  it("账本还没取到第一帧（还是 null）时，退回父组件传入的 planTodos，不空白闪烁", () => {
    api.fetchPlanLedger.mockReturnValue(new Promise(() => {})); // 永不 resolve，模拟首帧未到
    render(<ChatTaskInspector {...baseProps()} planTodos={STALE_SSE_TODOS} />);

    expect(screen.getByTestId("chat-task-workbench-plan-ratio").textContent).toContain("3/3");
  });

  it("账本为空计划（steps.length===0）时，同样退回 planTodos，不把「preparing」误当作「没有计划」抹掉已有快照", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledger({ steps: [], phase: "preparing", progress: { completed: 0, total: 0, elapsedMs: 0 } }));
    render(<ChatTaskInspector {...baseProps()} planTodos={STALE_SSE_TODOS} />);

    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalledWith("t-1"));
    await waitFor(() =>
      expect(screen.getByTestId("chat-task-workbench-plan-ratio").textContent).toContain("3/3"),
    );
  });
});
