import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { GUIDED_RESEARCH_STEPS, toGuidedResearchVisualStage } from "@/lib/guided-research-six-step";

describe("three-step Deep Research shell", () => {
  it("maps the runtime node and available nodes into the three-stage vocabulary", () => {
    const stage = toGuidedResearchVisualStage({ currentNode: "outline", availableNodes: ["brief", "directions", "outline"] });

    expect(stage.current).toBe("plan");
    expect(stage.available).toEqual(["import", "plan"]);
    expect(GUIDED_RESEARCH_STEPS.map((item) => item.label)).toEqual([
      "确认研究内容", "研究计划", "生成报告",
    ]);
  });

  it("renders three labelled stages and does not allow navigation to a locked future stage", () => {
    const onNavigate = vi.fn();
    render(
      <GuidedResearchSixStepShell
        current="plan"
        available={["import", "plan"]}
        onNavigate={onNavigate}
        main={<div>主工作区</div>}
        assistant={<div>Deep Research 助手</div>}
      />,
    );

    expect(screen.getByTestId("guided-research-six-step-shell")).toHaveAttribute("data-layout", "deep-research-desktop");
    expect(screen.queryByRole("button", { name: /^研究列表$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("research-step-report")).toBeInTheDocument();
    expect(screen.getByTestId("research-step-report")).toHaveAttribute("aria-disabled", "true");
    screen.getByRole("button", { name: /确认研究内容/ }).click();
    expect(onNavigate).toHaveBeenCalledWith("import");
  });

  it("does not reserve an assistant column when no assistant is supplied", () => {
    render(<GuidedResearchSixStepShell current="import" available={["import"]} onNavigate={vi.fn()} main={<div>主工作区</div>} />);

    expect(screen.queryByLabelText("研究导航")).not.toBeInTheDocument();
    expect(screen.queryByText("研究档案")).not.toBeInTheDocument();
    expect(screen.getByTestId("guided-research-six-step-shell").firstElementChild).not.toHaveClass("xl:grid-cols-[11rem_minmax(0,1fr)_16rem]");
  });
  it("presents the current screen title in the shared header alongside step navigation", () => {
    render(<GuidedResearchSixStepShell current="import" available={["import"]} onNavigate={vi.fn()} main={<div>输入需求</div>} />);
    expect(screen.getByTestId("research-workspace-header")).toContainElement(screen.getByRole("heading", { level: 1, name: "新建研究" }));
  });
});
