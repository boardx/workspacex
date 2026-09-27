import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewWorkbenchHeader } from "@/components/itv/interview-workbench-header";
afterEach(cleanup);
const steps = ["intake", "analysis", "experts", "outline", "runs", "report"].map((id) => ({ id, label: id, detail: `${id} detail` }));
it("timeline exposes an accessible step navigation with exactly one current stage", () => {
  const change = vi.fn();
  render(<InterviewWorkbenchHeader name="交接班研究" tags={[]} steps={steps} activeStep="experts" status="draft" version={3} topic={null} onStepChange={change} onReturnToList={vi.fn()} onOpenSkill={vi.fn()} />);
  const nav = screen.getByRole("navigation", { name: "访谈步骤" });
  expect(nav.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  fireEvent.click(screen.getByTestId("itv-workbench-step-outline"));
  expect(change).toHaveBeenCalledWith("outline");
  expect(screen.getByTestId("itv-workbench-step-experts")).toHaveAttribute("aria-current", "step");
});
it("return to list remains accessible independently of the timeline", () => {
  const back = vi.fn();
  render(<InterviewWorkbenchHeader name="交接班研究" tags={[]} steps={steps} activeStep="report" status="completed" version={3} topic={null} onStepChange={vi.fn()} onReturnToList={back} onOpenSkill={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "返回访谈列表" }));
  expect(back).toHaveBeenCalledTimes(1);
});
