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
  it("左侧仅显示问卷列表、问卷模块和报告模块三个一级入口", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    expect(screen.getByTestId("survey-resource-library")).toBeInTheDocument();
    expect(screen.getByTestId("survey-resource-nav-surveys")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("survey-resource-nav-modules")).toHaveTextContent("问卷模块");
    expect(screen.getByTestId("survey-resource-nav-reports")).toHaveTextContent("报告模块");
    expect(screen.getAllByRole("navigation")[0]?.querySelectorAll("button")).toHaveLength(3);
    expect(screen.queryByText("快速筛选")).not.toBeInTheDocument();
    expect(screen.queryByText("模板分类")).not.toBeInTheDocument();
    expect(screen.getByTestId("survey-resource-card-survey-sv-1")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("切到问卷模块时同步 URL 并呈现模板卡片", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-nav-modules"));

    expect(push).toHaveBeenCalledWith("/studio/survey?tab=modules");
    expect(screen.getByTestId("survey-resource-card-template-tpl-digital-collaboration")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-resource-card-survey-sv-1")).not.toBeInTheDocument();
  });

  it("切到报告模块时显示报告卡片并进入对应报告", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-nav-reports"));

    expect(push).toHaveBeenCalledWith("/studio/survey?tab=reports");
    expect(screen.getByTestId("survey-resource-card-report-sv-1")).toHaveTextContent("56 份有效答卷");
    expect(screen.queryByTestId("survey-resource-card-report-sv-project-review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("survey-resource-card-report-sv-1"));
    expect(push).toHaveBeenLastCalledWith("/studio/survey/sv-1?step=report");
  });

  it("问卷卡片进入现有问卷设计", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);
    fireEvent.click(screen.getByTestId("survey-resource-card-survey-sv-1"));
    expect(push).toHaveBeenCalledWith("/studio/survey/sv-1?step=design");
  });

  it("模板卡片进入独立模板编辑页", () => {
    render(<SurveyResourceLibrary initialTab="modules" uiState="default" />);
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
