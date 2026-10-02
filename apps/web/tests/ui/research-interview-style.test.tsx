import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { InterviewWorkbenchHeader, INTERVIEW_WORKBENCH_STEPS } from "@/components/itv/interview-workbench-header";

afterEach(cleanup);

it("highlights ongoing work identically when viewing a different research or interview step", () => {
  render(<>
    <GuidedResearchSixStepShell current="topic" running="report" available={["import", "topic", "plan", "research", "chapters", "report"]} onNavigate={vi.fn()} main={null} />
    <InterviewWorkbenchHeader name="访谈" tags={[]} steps={INTERVIEW_WORKBENCH_STEPS} activeStep="analysis" runningStep="report" completedSteps={["intake"]} status="draft" version={1} topic={null} onStepChange={vi.fn()} onReturnToList={vi.fn()} />
  </>);
  const research = screen.getByRole("navigation", { name: "研究步骤" }).querySelector('[aria-busy="true"]')!;
  const interview = screen.getByTestId("itv-workbench-step-report");
  for (const command of [research, interview]) {
    expect(command).toHaveAttribute("aria-busy", "true");
    expect(command).not.toHaveAttribute("aria-current");
    const circle = command.querySelector("span")!;
    expect(circle).toHaveClass("bg-primary", "text-primary-foreground", "ring-2");
    expect(circle.querySelector("svg")).not.toBeNull();
    expect(circle).not.toHaveTextContent("已完成");
  }
});
