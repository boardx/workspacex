/**
 * issue #2665 —— 任务类型标记 + 计划卡片两态（自动执行版 / 待确认版）。
 *
 * 权威规格：GitHub issue #2665（需求文档 07 章 US-01/02/03）+ PR #2676
 * （`evaluatePlanGate` 的 `taskRiskClass`/`deliverPlan`/新 `reason` 扩展，写这批
 * 测试时该 PR 尚未合并到 main——本文件用 mock props 驱动 `PlanConfirmGate`，
 * 不依赖真实后端返回这些字段，见 `plan-confirm-gate.tsx` 文件头注）。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlanStep } from "@repo/contracts/plan-control";
import {
  PLAN_AUTO_DELIVER_PAUSE_TESTID,
  PLAN_AUTO_DELIVER_STEP_TESTID,
  PLAN_AUTO_DELIVER_TESTID,
  PLAN_CONFIRM_EDIT_TESTID,
  PLAN_CONFIRM_GATE_TESTID,
  PLAN_CONFIRM_RUN_TESTID,
  PLAN_CONFIRM_STEP_ADJUST_TESTID,
  PLAN_CONFIRM_STEP_EXTERNAL_TESTID,
  PLAN_CONFIRM_STEP_REJECT_TESTID,
  PLAN_CONFIRM_STEP_TESTID,
  PLAN_TASK_TYPE_BADGE_TESTID,
  PlanConfirmGate,
  PlanDirectExecutionBadge,
  type PlanGateDecisionWithRisk,
} from "@/components/plan-control/plan-confirm-gate";

afterEach(cleanup);

const STEPS: readonly PlanStep[] = [
  { planStepId: "s1", content: "起草方案初稿", status: "completed", constraints: [] },
  { planStepId: "s2", content: "发送评审邮件", status: "in_progress", constraints: [] },
  { planStepId: "s3", content: "归档最终版本", status: "pending", constraints: [] },
];

describe("issue #2665 US-01：任务类型标记——一步到位任务的轻量标记", () => {
  it("no_plan 分类：只渲染轻量标记，不渲染任何计划/确认 UI", () => {
    const gate: PlanGateDecisionWithRisk = { required: false, reason: "no-plan" };
    render(
      <>
        <PlanDirectExecutionBadge />
        <PlanConfirmGate gate={gate} steps={STEPS} />
      </>,
    );
    expect(screen.getByTestId(PLAN_TASK_TYPE_BADGE_TESTID)).toBeTruthy();
    expect(screen.queryByTestId(PLAN_CONFIRM_GATE_TESTID)).toBeNull();
    expect(screen.queryByTestId(PLAN_AUTO_DELIVER_TESTID)).toBeNull();
  });

  it("PlanConfirmGate 单独渲染 no_plan 分类：整块为空，不是隐藏节点", () => {
    const gate: PlanGateDecisionWithRisk = { required: false, reason: "no-plan" };
    const { container } = render(<PlanConfirmGate gate={gate} steps={STEPS} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("issue #2665 US-02：计划卡片 · 自动执行版（deliverPlan:true）", () => {
  const gate: PlanGateDecisionWithRisk = {
    required: false, reason: "multi-step-low-risk", deliverPlan: true,
  };

  it("渲染计划步骤 + 已在执行状态 + 暂停/调整入口，不渲染确认按钮", () => {
    render(<PlanConfirmGate gate={gate} steps={STEPS} />);
    expect(screen.getByTestId(PLAN_AUTO_DELIVER_TESTID)).toBeTruthy();
    expect(screen.getAllByTestId(PLAN_AUTO_DELIVER_STEP_TESTID)).toHaveLength(3);
    expect(screen.getByText("已在按此计划执行")).toBeTruthy();
    expect(screen.getByTestId(PLAN_AUTO_DELIVER_PAUSE_TESTID)).toBeTruthy();
    // 不渲染确认门（待确认版）的任何锚点。
    expect(screen.queryByTestId(PLAN_CONFIRM_GATE_TESTID)).toBeNull();
    expect(screen.queryByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeNull();
  });

  it("点击暂停/调整入口触发回调——复用与 S5 执行态相同的取消路径", () => {
    const onPauseOrAdjust = vi.fn();
    render(<PlanConfirmGate gate={gate} steps={STEPS} onPauseOrAdjust={onPauseOrAdjust} />);
    fireEvent.click(screen.getByTestId(PLAN_AUTO_DELIVER_PAUSE_TESTID));
    expect(onPauseOrAdjust).toHaveBeenCalledTimes(1);
  });
});

describe("issue #2665 US-03：计划卡片 · 待确认版（required:true，高风险）", () => {
  const gate: PlanGateDecisionWithRisk = { required: true, reason: "multi-step-high-risk" };

  it("渲染计划步骤 + 明确的确认执行按钮，等待态清晰可辨识", () => {
    render(<PlanConfirmGate gate={gate} steps={STEPS} />);
    expect(screen.getByTestId(PLAN_CONFIRM_GATE_TESTID)).toBeTruthy();
    expect(screen.getAllByTestId(PLAN_CONFIRM_STEP_TESTID)).toHaveLength(3);
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
    expect(screen.getByTestId(PLAN_CONFIRM_EDIT_TESTID)).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("等待你的确认");
  });

  it("传入 externalStepIds 时标出哪一步对外", () => {
    render(
      <PlanConfirmGate gate={gate} steps={STEPS} externalStepIds={new Set(["s2"])} />,
    );
    const externalBadges = screen.getAllByTestId(PLAN_CONFIRM_STEP_EXTERNAL_TESTID);
    expect(externalBadges).toHaveLength(1);
    const steps = screen.getAllByTestId(PLAN_CONFIRM_STEP_TESTID);
    expect(steps[1]?.getAttribute("data-plan-step-external")).toBe("true");
    expect(steps[0]?.getAttribute("data-plan-step-external")).toBe("false");
    expect(steps[2]?.getAttribute("data-plan-step-external")).toBe("false");
  });

  it("未传 externalStepIds：展示全部步骤，不假装知道哪一步对外", () => {
    render(<PlanConfirmGate gate={gate} steps={STEPS} />);
    expect(screen.getAllByTestId(PLAN_CONFIRM_STEP_TESTID)).toHaveLength(3);
    expect(screen.queryByTestId(PLAN_CONFIRM_STEP_EXTERNAL_TESTID)).toBeNull();
  });

  it("传入 onAdjustStep/onRejectStep 时支持单步调整/拒绝，只影响点击的那一步", () => {
    const onAdjustStep = vi.fn();
    const onRejectStep = vi.fn();
    render(
      <PlanConfirmGate
        gate={gate} steps={STEPS} onAdjustStep={onAdjustStep} onRejectStep={onRejectStep}
      />,
    );
    const adjustButtons = screen.getAllByTestId(PLAN_CONFIRM_STEP_ADJUST_TESTID);
    const rejectButtons = screen.getAllByTestId(PLAN_CONFIRM_STEP_REJECT_TESTID);
    expect(adjustButtons).toHaveLength(3);
    expect(rejectButtons).toHaveLength(3);
    fireEvent.click(adjustButtons[1] as HTMLElement);
    expect(onAdjustStep).toHaveBeenCalledWith("s2");
    expect(onRejectStep).not.toHaveBeenCalled();
    fireEvent.click(rejectButtons[2] as HTMLElement);
    expect(onRejectStep).toHaveBeenCalledWith("s3");
  });

  it("未传单步回调时不渲染单步调整/拒绝按钮（渐进增强，不强加新交互）", () => {
    render(<PlanConfirmGate gate={gate} steps={STEPS} />);
    expect(screen.queryByTestId(PLAN_CONFIRM_STEP_ADJUST_TESTID)).toBeNull();
    expect(screen.queryByTestId(PLAN_CONFIRM_STEP_REJECT_TESTID)).toBeNull();
  });

  it("既有 reason='multi-step'（未传 taskRiskClass 的旧调用方）同样走待确认版，向后兼容", () => {
    render(<PlanConfirmGate gate={{ required: true, reason: "multi-step" }} steps={STEPS} />);
    expect(screen.getByTestId(PLAN_CONFIRM_GATE_TESTID)).toBeTruthy();
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
  });
});
