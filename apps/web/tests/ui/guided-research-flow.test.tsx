import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";

describe("Issue #1073 · guided deep research UI-first flow", () => {
  it("home distinguishes resumable and completed research", () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    expect(screen.getByTestId("research-history")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("research-continue-r-energy"));
    expect(onStepChange).toHaveBeenCalledWith("search");

    fireEvent.click(screen.getByTestId("research-view-r-grid"));
    expect(onStepChange).toHaveBeenCalledWith("report");
  });

  it("topic confirmation keeps the user's brief editable", () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);

    const topic = screen.getByTestId("research-brief-topic") as HTMLInputElement;
    fireEvent.change(topic, { target: { value: "欧洲储能市场进入策略" } });
    expect(topic.value).toBe("欧洲储能市场进入策略");
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    expect(onStepChange).toHaveBeenCalledWith("directions");
  });

  it("AI directions and outline remain editable before search", () => {
    const { rerender } = render(<GuidedResearchFlow step="directions" />);
    const direction = screen.getByTestId("research-direction-title-d1") as HTMLInputElement;
    fireEvent.change(direction, { target: { value: "市场规模与增长质量" } });
    expect(direction.value).toBe("市场规模与增长质量");
    fireEvent.click(screen.getByTestId("research-add-direction"));
    expect(screen.getByTestId("research-direction-title-d4")).toBeInTheDocument();

    rerender(<GuidedResearchFlow step="outline" />);
    const outline = screen.getByTestId("research-outline-title-o1") as HTMLInputElement;
    fireEvent.change(outline, { target: { value: "执行摘要与关键判断" } });
    expect(outline.value).toBe("执行摘要与关键判断");
    expect(screen.getByTestId("research-start-search")).toBeEnabled();
  });

  it("search and report expose evidence-bearing states", () => {
    const { rerender } = render(<GuidedResearchFlow step="search" />);
    expect(screen.getByTestId("research-search-progress")).toHaveAttribute("data-progress", "68");
    expect(screen.getByTestId("research-current-query")).toHaveTextContent("Germany utility-scale battery storage market 2025");
    expect(screen.getAllByTestId(/^research-source-/)).toHaveLength(3);

    rerender(<GuidedResearchFlow step="report" />);
    expect(screen.getByTestId("research-report")).toHaveTextContent("欧洲储能市场进入策略研究报告");
    expect(screen.getAllByTestId(/^research-citation-/).length).toBeGreaterThanOrEqual(3);
  });
});
