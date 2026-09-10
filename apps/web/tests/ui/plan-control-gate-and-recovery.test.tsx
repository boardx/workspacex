/**
 * F978 —— S4 确认门 + S5 执行态（暂停/恢复同一控件两态）+ S6 失败态（两个恢复动作）。
 *
 * 权威规格：contracts/plan-control/ui.md S4/S5/S6 + usecases.md UC-8 反证 + 人类裁决 (c)。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { deriveRunStatusView } from "@repo/contracts/plan-control";
import {
  PLAN_CONFIRM_EDIT_TESTID, PLAN_CONFIRM_GATE_TESTID, PLAN_CONFIRM_RUN_TESTID, PlanConfirmGate,
} from "@/components/plan-control/plan-confirm-gate";
import {
  PLAN_RUN_PAUSE_TESTID, PLAN_RUN_PROGRESS_TESTID, PLAN_RUN_RESUME_TESTID, PlanRunProgress,
} from "@/components/plan-control/plan-run-progress";
import {
  PLAN_FAILURE_EDIT_INPUT_TESTID, PLAN_FAILURE_RETRY_STEP_TESTID, PlanFailureRecovery,
} from "@/components/plan-control/plan-failure-recovery";

afterEach(cleanup);

describe("S4 确认门：gate.required===true 才渲染，simple 路径从不进入 DOM", () => {
  it("gate.required=true：锚点在 DOM 里，两个出口都在", () => {
    render(<PlanConfirmGate gate={{ required: true, reason: "multi-step" }} />);
    expect(screen.getByTestId(PLAN_CONFIRM_GATE_TESTID)).toBeTruthy();
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
    expect(screen.getByTestId(PLAN_CONFIRM_EDIT_TESTID)).toBeTruthy();
  });

  it.each(["no-plan", "single-step"] as const)(
    "gate.required=false（reason=%s）：锚点不在 DOM 里——queryByTestId 为 null，不是 display:none", (reason) => {
      const { container } = render(<PlanConfirmGate gate={{ required: false, reason }} />);
      expect(screen.queryByTestId(PLAN_CONFIRM_GATE_TESTID)).toBeNull();
      // 结构性断言：整个渲染输出为空，不是隐藏的节点还挂在树上。
      expect(container.innerHTML).toBe("");
    },
  );

  it("确认并执行 / 继续编辑 两个按钮各自触发对应回调", () => {
    const onConfirm = vi.fn();
    const onEdit = vi.fn();
    render(<PlanConfirmGate gate={{ required: true, reason: "multi-step" }} onConfirmRun={onConfirm} onContinueEditing={onEdit} />);
    fireEvent.click(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(PLAN_CONFIRM_EDIT_TESTID));
    expect(onEdit).toHaveBeenCalled();
  });
});


/**
 * issue #3365 —— `PlanRunProgress` 不再收零散的状态量，只收契约派生出来的 `view`。
 * 本 helper 从**真实步骤形状**出发调 `deriveRunStatusView`，不手搓 view 字面量——
 * 手搓等于在测试里复刻一份派生逻辑，那就又是第二个事实源。
 */
function viewFor(stepStatuses: readonly ("pending" | "in_progress" | "completed")[], over: Partial<Parameters<typeof deriveRunStatusView>[0]> = {}) {
  return deriveRunStatusView({
    phase: "executing", runStatus: "running", stepStatuses,
    progressCompleted: stepStatuses.filter((x) => x === "completed").length,
    progressTotal: stepStatuses.length,
    paused: false, pauseRequested: false, gateRequired: false,
    hasRecentError: false, pauseEntryEnabled: true, ...over,
  });
}

describe("S5 执行态：暂停/恢复是同一控件的两态，不是两个并存的按钮", () => {
  it("isPaused=false：只有暂停锚点，恢复锚点不存在", () => {
    render(
      <PlanRunProgress view={viewFor(["completed", "in_progress", "pending", "pending"])} currentStepLabel="起草方案初稿" elapsedMs={65_000} isPaused={false} />,
    );
    expect(screen.getByTestId(PLAN_RUN_PROGRESS_TESTID)).toBeTruthy();
    expect(screen.getByTestId(PLAN_RUN_PAUSE_TESTID)).toBeTruthy();
    expect(screen.queryByTestId(PLAN_RUN_RESUME_TESTID)).toBeNull();
  });

  it("isPaused=true：只有恢复锚点，暂停锚点不存在", () => {
    render(
      <PlanRunProgress view={viewFor(["completed", "in_progress", "pending", "pending"])} currentStepLabel="起草方案初稿" elapsedMs={65_000} isPaused />,
    );
    expect(screen.queryByTestId(PLAN_RUN_PAUSE_TESTID)).toBeNull();
    expect(screen.getByTestId(PLAN_RUN_RESUME_TESTID)).toBeTruthy();
  });

  it("点击暂停/恢复触发对应回调", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { rerender } = render(
      <PlanRunProgress view={viewFor(["in_progress", "pending"])} currentStepLabel="x" elapsedMs={0} isPaused={false} onPause={onPause} onResume={onResume} />,
    );
    fireEvent.click(screen.getByTestId(PLAN_RUN_PAUSE_TESTID));
    expect(onPause).toHaveBeenCalled();
    rerender(
      <PlanRunProgress view={viewFor(["in_progress", "pending"])} currentStepLabel="x" elapsedMs={0} isPaused onPause={onPause} onResume={onResume} />,
    );
    fireEvent.click(screen.getByTestId(PLAN_RUN_RESUME_TESTID));
    expect(onResume).toHaveBeenCalled();
  });

  /*
   * issue #3132 —— TW-P0-3⑤ 的三条机器可读断言，与 e2e
   * `chat-task-workbench-workflow-states.spec.ts:238` 逐字同形（那里断言
   * `data-completed` / `data-total` / `data-elapsed-ms` 匹配 /^\d+$/）。
   *
   * 这一条是**反证接住点**：把三个属性从 `plan-run-progress.tsx` 上撤掉，这里立刻红。
   * 此前该组件只有给人看的文案，e2e 那三条断言即使卡片渲染出来也必红，而单测里
   * 一条会红的断言都没有——缺口只在最慢、最贵的那一层可见。
   */
  it("完成比例与耗时是机器可读的 data 属性，不只是一句给人看的文案", () => {
    render(<PlanRunProgress view={viewFor(["completed", "completed", "in_progress", "pending"])} currentStepLabel="起草方案初稿" elapsedMs={65_000} isPaused={false} />);
    const card = screen.getByTestId(PLAN_RUN_PROGRESS_TESTID);
    expect(card.getAttribute("data-completed")).toBe("2");
    expect(card.getAttribute("data-total")).toBe("4");
    expect(card.getAttribute("data-elapsed-ms")).toBe("65000");
    for (const name of ["data-completed", "data-total", "data-elapsed-ms"]) {
      expect(card.getAttribute(name)).toMatch(/^\d+$/);
    }
  });

  /*
   * 「完成数 ≠ 当前步号」这条语义本身也要有会红的断言：若有人图省事把
   * `data-completed` 接成「当前步号 - 1」，下面这组值（当前步是第 4 步、只完成 1 步——
   * 引擎跳步或收尾才补标时的真实形状）会让那种实现给出 3，这里红。#3365 起
   * 这条语义由契约不变量 I4 兜底（`progressValue === progress.completed`）。
   */
  it("data-completed 是已完成步数，不是当前步号减一", () => {
    render(<PlanRunProgress view={viewFor(["completed", "pending", "pending", "in_progress"])} currentStepLabel="收尾" elapsedMs={1_000} isPaused={false} />);
    expect(screen.getByTestId(PLAN_RUN_PROGRESS_TESTID).getAttribute("data-completed")).toBe("1");
  });

  it("耗时展示来自 elapsedMs（服务端真实计算），不是前端计时器估算的字符串格式", () => {
    render(<PlanRunProgress view={viewFor(["in_progress", "pending"])} currentStepLabel="x" elapsedMs={125_000} isPaused={false} />);
    expect(screen.getByTestId(PLAN_RUN_PROGRESS_TESTID).textContent).toContain("2分5秒");
  });
});

describe("S6 失败态：只渲染两个恢复动作，第三个「恢复检查点」锚点不存在于 DOM", () => {
  it("重试该步 / 修改输入 两个锚点都在", () => {
    render(<PlanFailureRecovery failedStepIndex={3} failedStepLabel="内部评审" reason="工具调用超时" />);
    expect(screen.getByTestId(PLAN_FAILURE_RETRY_STEP_TESTID)).toBeTruthy();
    expect(screen.getByTestId(PLAN_FAILURE_EDIT_INPUT_TESTID)).toBeTruthy();
  });

  it("chat-task-workbench-failure-restore-checkpoint 锚点不存在（不是渲染后隐藏，是从未写进 JSX）", () => {
    render(<PlanFailureRecovery failedStepIndex={3} failedStepLabel="内部评审" reason="工具调用超时" />);
    expect(screen.queryByTestId("chat-task-workbench-failure-restore-checkpoint")).toBeNull();
  });

  it("重试该步 / 修改输入 各自触发对应回调", () => {
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    render(
      <PlanFailureRecovery
        failedStepIndex={3} failedStepLabel="内部评审" reason="工具调用超时"
        onRetryStep={onRetry} onEditInput={onEdit}
      />,
    );
    fireEvent.click(screen.getByTestId(PLAN_FAILURE_RETRY_STEP_TESTID));
    expect(onRetry).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(PLAN_FAILURE_EDIT_INPUT_TESTID));
    expect(onEdit).toHaveBeenCalled();
  });
});
