import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanPanelReadOnly } from "@/components/plan-control/plan-panel-readonly";
import type { PlanStep } from "@repo/contracts/plan-control";
const steps = [
 { planStepId: "s1", content: "收集资料", status: "completed", constraints: [] },
 { planStepId: "s2", content: "分析资料", status: "in_progress", constraints: [] },
 { planStepId: "s3", content: "输出报告", status: "pending", constraints: [] },
] satisfies PlanStep[];
afterEach(cleanup);
describe("plan step display after run termination", () => {
 it("stops advertising active work without inventing completion", () => {
  render(<PlanPanelReadOnly steps={steps} executionStopped />);
  expect(screen.getByLabelText("已停止")).toBeTruthy();
  expect(screen.queryByLabelText("进行中")).toBeNull();
  expect(screen.getAllByLabelText("已完成")).toHaveLength(1);
  expect(screen.getByLabelText("待执行")).toBeTruthy();
  expect(steps[1]!.status).toBe("in_progress");
 });
 it("keeps a live run and completed steps unchanged", () => {
  render(<PlanPanelReadOnly steps={steps} executionStopped={false} />);
  expect(screen.getByLabelText("进行中")).toBeTruthy();
  expect(screen.queryByLabelText("已停止")).toBeNull();
  expect(screen.getAllByLabelText("已完成")).toHaveLength(1);
 });
});
