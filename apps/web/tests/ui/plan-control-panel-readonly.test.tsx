/**
 * F977 —— S2 计划面板只读态（`ui.md` 判据二）。
 *
 * 权威规格：contracts/plan-control/ui.md S2 + I-15（不出现 write_todos 字面串）。
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PlanStep } from "@repo/contracts/plan-control";
import {
  PLAN_PANEL_TESTID, PLAN_STEP_TESTID, PlanPanelReadOnly,
} from "@/components/plan-control/plan-panel-readonly";

afterEach(cleanup);

const STEPS: PlanStep[] = [
  { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
  {
    planStepId: "s2", content: "起草方案初稿", status: "in_progress",
    constraints: [{ constraintId: "c1", text: "只用公开可引用的来源", createdAt: "2026-08-26T00:00:00.000Z" }],
  },
  { planStepId: "s3", content: "内部评审", status: "pending", constraints: [] },
];

describe("PlanPanelReadOnly：每行一条步骤，data-plan-status 直出 getPlanLedger.steps[].status", () => {
  it("三行渲染，data-plan-status 分别对应 completed/in_progress/pending", () => {
    render(<PlanPanelReadOnly steps={STEPS} />);
    const rows = screen.getAllByTestId(PLAN_STEP_TESTID);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute("data-plan-status"))).toEqual([
      "completed", "in_progress", "pending",
    ]);
  });

  it("面板本体带 data-plan-mode=read", () => {
    render(<PlanPanelReadOnly steps={STEPS} />);
    expect(screen.getByTestId(PLAN_PANEL_TESTID).getAttribute("data-plan-mode")).toBe("read");
  });
});

describe("判据二：三种状态各有 aria-label，不只靠图标", () => {
  it.each([
    ["completed", "已完成"],
    ["in_progress", "进行中"],
    ["pending", "待执行"],
  ] as const)("status=%s 的行里存在 aria-label=%s 的元素", (status, label) => {
    render(<PlanPanelReadOnly steps={STEPS} />);
    const row = screen.getAllByTestId(PLAN_STEP_TESTID).find((r) => r.getAttribute("data-plan-status") === status)!;
    expect(within(row).getByLabelText(label)).toBeTruthy();
  });
});

describe("约束缩进挂在宿主步骤下：DOM 结构本身表达归属，不只靠视觉缩进", () => {
  it("约束元素是其宿主 step <li> 的后代，不是兄弟或独立于步骤之外", () => {
    render(<PlanPanelReadOnly steps={STEPS} />);
    const hostRow = screen.getAllByTestId(PLAN_STEP_TESTID).find((r) => r.getAttribute("data-plan-status") === "in_progress")!;
    const constraint = within(hostRow).getByText("只用公开可引用的来源");
    expect(hostRow.contains(constraint)).toBe(true);
  });

  it("没有约束的步骤不渲染任何约束元素", () => {
    render(<PlanPanelReadOnly steps={STEPS} />);
    const hostRow = screen.getAllByTestId(PLAN_STEP_TESTID).find((r) => r.getAttribute("data-plan-status") === "completed")!;
    expect(within(hostRow).queryByTestId("chat-task-workbench-plan-constraint")).toBeNull();
  });
});

describe("I-15：全程不出现 write_todos 字面串", () => {
  it("整个渲染出的文本里不含 write_todos", () => {
    const { container } = render(<PlanPanelReadOnly steps={STEPS} />);
    expect(container.textContent).not.toContain("write_todos");
    expect(container.innerHTML).not.toContain("write_todos");
  });
});

describe("零计划态：steps 为空数组时面板仍正常渲染（不是错误态）", () => {
  it("0 步：面板渲染但没有任何 step 行", () => {
    render(<PlanPanelReadOnly steps={[]} />);
    expect(screen.getByTestId(PLAN_PANEL_TESTID)).toBeTruthy();
    expect(screen.queryAllByTestId(PLAN_STEP_TESTID)).toHaveLength(0);
  });
});
