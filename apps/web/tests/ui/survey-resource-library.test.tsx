import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyResourceLibrary } from "@/components/survey/resource-library/survey-resource-library";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("SurveyResourceLibrary", () => {
  it("默认显示问卷卡片而不自动进入固定问卷", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    expect(screen.getByTestId("survey-resource-library")).toBeInTheDocument();
    expect(screen.getByTestId("survey-resource-nav-surveys")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("survey-resource-card-survey-sv-1")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("切到模板列表时同步 URL 并呈现模板卡片", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-nav-templates"));

    expect(push).toHaveBeenCalledWith("/studio/survey?tab=templates");
    expect(screen.getByTestId("survey-resource-card-template-tpl-digital-collaboration")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-resource-card-survey-sv-1")).not.toBeInTheDocument();
  });

  it("问卷卡片进入现有问卷设计", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);
    fireEvent.click(screen.getByTestId("survey-resource-card-survey-sv-1"));
    expect(push).toHaveBeenCalledWith("/studio/survey/sv-1?step=design");
  });

  it("模板卡片进入独立模板编辑页", () => {
    render(<SurveyResourceLibrary initialTab="templates" uiState="default" />);
    fireEvent.click(screen.getByTestId("survey-resource-card-template-tpl-digital-collaboration"));
    expect(push).toHaveBeenCalledWith("/studio/survey/templates/tpl-digital-collaboration");
  });

  it("按名称过滤当前资源列表", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);
    fireEvent.change(screen.getByTestId("survey-resource-search"), { target: { value: "团队协作" } });
    expect(screen.getByTestId("survey-resource-card-survey-sv-team-health")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-resource-card-survey-sv-1")).not.toBeInTheDocument();
  });

  it.each([
    ["loading", "survey-resource-loading"],
    ["empty", "survey-resource-empty"],
    ["error", "survey-resource-error"],
  ] as const)("呈现 %s 状态", (uiState, testId) => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState={uiState} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});
