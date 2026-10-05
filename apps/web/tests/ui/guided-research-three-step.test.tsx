import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { guidedResearchRoute } from "@/lib/guided-research-routes";
import { toGuidedResearchVisualStage } from "@/lib/guided-research-six-step";

describe("three visible research steps over durable legacy nodes", () => {
  it("renders only content, plan and report while old research execution marks the report running", () => {
    const navigate = vi.fn();
    render(<GuidedResearchSixStepShell current="research" running="research" available={["import", "topic", "plan", "research"]} completedStages={["import", "topic", "plan"]} onNavigate={navigate} main={<p>真实检索任务</p>} />);
    const progress = within(screen.getByTestId("research-flow-progress"));
    expect(progress.getAllByRole("listitem")).toHaveLength(3);
    expect(progress.getByText("确认研究内容")).toBeVisible();
    expect(progress.getByText("研究计划")).toBeVisible();
    expect(progress.getByText("生成报告")).toBeVisible();
    expect(progress.queryByText("资料研究")).toBeNull();
    expect(progress.queryByText("报告章节")).toBeNull();
    expect(progress.getByRole("button", { name: /生成报告/ })).toHaveAttribute("aria-busy", "true");
    fireEvent.click(progress.getByRole("button", { name: /研究计划/ }));
    expect(navigate).toHaveBeenCalledWith("plan");
  });
  it("maps legacy links and nodes to a canonical screen without executing or changing data", () => {
    expect(guidedResearchRoute("session", "topic")).toBe("/research/session/plan");
    expect(guidedResearchRoute("session", "research")).toBe("/research/session/report");
    expect(guidedResearchRoute("session", "chapters")).toBe("/research/session/report");
    expect(toGuidedResearchVisualStage({ currentNode: "directions", availableNodes: ["brief", "directions"] })).toEqual({ current: "plan", available: ["import", "plan"] });
    expect(toGuidedResearchVisualStage({ currentNode: "research", availableNodes: ["brief", "directions", "outline", "research", "report"] })).toEqual({ current: "report", available: ["import", "plan", "report"] });
  });
});
