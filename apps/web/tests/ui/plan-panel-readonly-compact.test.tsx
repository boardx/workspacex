import {afterEach, expect, it} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import {PlanPanelReadOnly, PLAN_STEP_TESTID} from "@/components/plan-control/plan-panel-readonly";
afterEach(cleanup);
const steps = [{planStepId:"s1",content:"检查实际结果",status:"pending" as const,constraints:[]}];
it("compact details retain real step status without repeating the host heading", () => {
  render(<PlanPanelReadOnly steps={steps} compact />);
  expect(screen.queryByText("当前计划")).toBeNull();
  expect(screen.queryByText("Plan")).toBeNull();
  expect(screen.getByTestId(PLAN_STEP_TESTID)).toHaveAttribute("data-plan-status","pending");
  expect(screen.getByLabelText("待执行")).toBeTruthy();
});
it("other consumers keep the existing standalone heading by default", () => {
  render(<PlanPanelReadOnly steps={steps} />);
  expect(screen.getByText("当前计划")).toBeTruthy();
  expect(screen.getByText("Plan")).toBeTruthy();
});
