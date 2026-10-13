import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { ResearchLoading } from "@/components/research-studio/guided-research-presentation";
import { ResearchWorkspaceStepIndicator } from "@/components/research-studio/research-workspace-style";

it("shows one loading indicator for a running plan while retaining navigation state", () => {
  const { container, rerender } = render(<GuidedResearchSixStepShell
    current="plan" running="plan" available={["import", "plan"]} completedStages={["import"]}
    onNavigate={vi.fn()} main={<ResearchLoading node="outline" />}
  />);
  const progress = within(screen.getByRole("navigation", { name: "研究步骤" }));
  const plan = progress.getByRole("button", { name: /研究计划/ });
  expect(plan).toHaveAttribute("aria-current", "step");
  expect(plan).toHaveAttribute("aria-busy", "true");
  expect(plan).toHaveTextContent("2");
  expect(progress.getByRole("button", { name: /确认研究内容/ })).toHaveTextContent("已完成");
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("正在生成研究计划");
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
  expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
  rerender(<GuidedResearchSixStepShell current="plan" available={["import", "plan"]}
    onNavigate={vi.fn()} main={<p>已生成的研究计划</p>} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
  expect(screen.getByText("已生成的研究计划")).toBeVisible();
});

it("preserves the default running indicator in other workflows sharing the step marker", () => {
  const { container } = render(<ResearchWorkspaceStepIndicator number={2} active completed={false} running />);
  expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
});
