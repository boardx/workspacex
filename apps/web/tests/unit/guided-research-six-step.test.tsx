import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { GUIDED_RESEARCH_SIX_STEPS, toGuidedResearchVisualStage } from "@/lib/guided-research-six-step";

describe("six-step Deep Research shell", () => {
  it("maps the runtime node and available nodes into the approved six-stage vocabulary", () => {
    const stage = toGuidedResearchVisualStage({ currentNode: "outline", availableNodes: ["brief", "directions", "outline"] });

    expect(stage.current).toBe("plan");
    expect(stage.available).toEqual(["import", "topic", "plan"]);
    expect(GUIDED_RESEARCH_SIX_STEPS.map((item) => item.label)).toEqual([
      "研究列表", "导入需求", "确认研究主题", "研究计划", "资料研究", "研究报告",
    ]);
  });

  it("renders six labelled stages and does not allow navigation to a locked future stage", () => {
    const onNavigate = vi.fn();
    render(
      <GuidedResearchSixStepShell
        current="plan"
        available={["import", "topic", "plan"]}
        onNavigate={onNavigate}
        main={<div>主工作区</div>}
        assistant={<div>Deep Research 助手</div>}
      />,
    );

    expect(screen.getByTestId("guided-research-six-step-shell")).toHaveAttribute("data-layout", "deep-research-desktop");
    expect(screen.getByRole("button", { name: /研究列表/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /研究报告/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /资料研究/ })).toBeDisabled();
    screen.getByRole("button", { name: /确认研究主题/ }).click();
    expect(onNavigate).toHaveBeenCalledWith("topic");
  });

  it("does not reserve an assistant column when no assistant is supplied", () => {
    render(<GuidedResearchSixStepShell current="import" available={["import"]} onNavigate={vi.fn()} main={<div>主工作区</div>} />);

    expect(screen.queryByLabelText("研究导航")).not.toBeInTheDocument();
    expect(screen.queryByText("研究档案")).not.toBeInTheDocument();
    expect(screen.getByTestId("guided-research-six-step-shell").firstElementChild).not.toHaveClass("xl:grid-cols-[11rem_minmax(0,1fr)_16rem]");
  });
});
