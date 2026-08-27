/**
 * F978 —— S3 编辑态 + S7 孤儿约束 + S8 陈旧横条/执行中告知条（`ui.md`）。
 *
 * 权威规格：contracts/plan-control/ui.md S3/S7/S8。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlanStep } from "@repo/contracts/plan-control";
import {
  OrphanConstraintNotice, PLAN_CONSTRAINT_REMOVE_TESTID, PLAN_ORPHAN_CONSTRAINT_TESTID,
  PLAN_PANEL_EDIT_TESTID, PLAN_PENDING_APPLY_TESTID, PLAN_STALE_BANNER_TESTID,
  PLAN_STEP_ADD_CONSTRAINT_CONFIRM_TESTID, PLAN_STEP_ADD_CONSTRAINT_TESTID,
  PLAN_STEP_DELETE_TESTID, PLAN_STEP_REORDER_TESTID, PLAN_STEP_TESTID, PLAN_STEP_UNDO_TESTID,
  PlanPanelEdit, PlanPendingApplyBanner, PlanStaleBanner,
} from "@/components/plan-control/plan-panel-edit";

afterEach(cleanup);

const STEPS: PlanStep[] = [
  { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
  {
    planStepId: "s2", content: "起草方案初稿", status: "in_progress",
    constraints: [{ constraintId: "c1", text: "只用公开可引用的来源", createdAt: "2026-08-26T00:00:00.000Z" }],
  },
  { planStepId: "s3", content: "内部评审", status: "pending", constraints: [] },
];

describe("PlanPanelEdit：一屏内含四控件（调序把手/移除/加约束/撤约束）", () => {
  it("面板带 data-plan-mode=edit，三行 step 各带调序把手与移除按钮", () => {
    render(<PlanPanelEdit steps={STEPS} />);
    expect(screen.getByTestId(PLAN_PANEL_EDIT_TESTID).getAttribute("data-plan-mode")).toBe("edit");
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(3);
    expect(screen.getAllByTestId(PLAN_STEP_REORDER_TESTID)).toHaveLength(3);
    expect(screen.getAllByTestId(PLAN_STEP_DELETE_TESTID)).toHaveLength(3);
  });

  it("点击「移除」直接触发 onDelete，不弹出二次确认（不调用 window.confirm）", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onDelete = vi.fn();
    render(<PlanPanelEdit steps={STEPS} onDelete={onDelete} />);
    fireEvent.click(screen.getAllByTestId(PLAN_STEP_DELETE_TESTID)[0]!);
    expect(onDelete).toHaveBeenCalledWith("s1");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("删后浮出「已移除·撤销」toast（不是二次确认弹窗），撤销触发 onUndoRemove", () => {
    const onUndo = vi.fn();
    render(<PlanPanelEdit steps={STEPS} justRemoved={{ planStepId: "s3", content: "内部评审" }} onUndoRemove={onUndo} />);
    const toast = screen.getByTestId(PLAN_STEP_UNDO_TESTID);
    expect(toast.textContent).toContain("内部评审");
    fireEvent.click(screen.getByText("撤销"));
    expect(onUndo).toHaveBeenCalled();
  });

  it("「加一条约束」就地展开输入，不套第二层弹窗；确认后调用 onAddConstraint", () => {
    const onAdd = vi.fn();
    render(<PlanPanelEdit steps={STEPS} onAddConstraint={onAdd} />);
    const triggers = screen.getAllByTestId(PLAN_STEP_ADD_CONSTRAINT_TESTID);
    fireEvent.click(triggers[2]!); // 内部评审这一行
    const input = screen.getByLabelText("为「内部评审」输入约束");
    fireEvent.change(input, { target: { value: "只写中文" } });
    fireEvent.click(screen.getByTestId(PLAN_STEP_ADD_CONSTRAINT_CONFIRM_TESTID));
    expect(onAdd).toHaveBeenCalledWith("s3", "只写中文");
  });

  it("约束行悬停可见「×」撤约束，点击触发 onRemoveConstraint", () => {
    const onRemove = vi.fn();
    render(<PlanPanelEdit steps={STEPS} onRemoveConstraint={onRemove} />);
    fireEvent.click(screen.getByTestId(PLAN_CONSTRAINT_REMOVE_TESTID));
    expect(onRemove).toHaveBeenCalledWith("c1");
  });

  it("Alt+↑/Alt+↓ 在调序把手上触发 onReorder（键盘等价，TW-A11Y-8）", () => {
    const onReorder = vi.fn();
    render(<PlanPanelEdit steps={STEPS} onReorder={onReorder} />);
    const handles = screen.getAllByTestId(PLAN_STEP_REORDER_TESTID);
    fireEvent.keyDown(handles[1]!, { key: "ArrowUp", altKey: true });
    expect(onReorder).toHaveBeenCalledWith("s2", 0);
  });
});

describe("S7 孤儿约束（I-8 的界面面）", () => {
  it("渲染孤儿约束与原属步骤，点击移除触发回调", () => {
    const onRemove = vi.fn();
    render(<OrphanConstraintNotice text="别调用外部 API" formerStepContent="旧步骤" onRemove={onRemove} />);
    const el = screen.getByTestId(PLAN_ORPHAN_CONSTRAINT_TESTID);
    expect(el.textContent).toContain("别调用外部 API");
    expect(el.textContent).toContain("旧步骤");
    fireEvent.click(screen.getByText("移除"));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe("S8 并发陈旧横条（I-5）与执行中告知条（I-11）", () => {
  it("陈旧横条：role=status，提供查看差异/重新应用两个出口", () => {
    render(<PlanStaleBanner />);
    const el = screen.getByTestId(PLAN_STALE_BANNER_TESTID);
    expect(el.getAttribute("role")).toBe("status");
    expect(screen.getByText("查看差异")).toBeTruthy();
    expect(screen.getByText("重新应用")).toBeTruthy();
  });

  it("执行中告知条：明确说「下一步生效」，且提供暂停出口（I-11 的唯一出口）", () => {
    const onPause = vi.fn();
    render(<PlanPendingApplyBanner onPauseNow={onPause} />);
    const el = screen.getByTestId(PLAN_PENDING_APPLY_TESTID);
    expect(el.textContent).toContain("完成后生效");
    fireEvent.click(screen.getByText("暂停"));
    expect(onPause).toHaveBeenCalled();
  });
});
