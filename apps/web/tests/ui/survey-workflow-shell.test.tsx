import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyWorkflowShell } from "@/components/survey/workflow/survey-workflow-shell";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));

afterEach(() => {
  cleanup();
  replace.mockReset();
  push.mockReset();
});

describe("SurveyWorkflowShell", () => {
  it("只呈现新的五步导航并用 URL 切步", () => {
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="design" uiState="default" readonly={false} />);

    expect(screen.getByTestId("survey-workflow-shell")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-list")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-tab-vote")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("survey-workflow-step-template"));
    expect(replace).toHaveBeenCalledWith("/studio/survey/sv-1?step=template");
  });

  it.each([
    ["loading", "survey-workflow-loading"],
    ["empty", "survey-workflow-empty"],
    ["error", "survey-workflow-error"],
  ] as const)("呈现 %s 状态", (uiState, testId) => {
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="design" uiState={uiState} readonly={false} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it("只读状态保留内容但移除保存入口", () => {
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="design" uiState="default" readonly />);
    expect(screen.getByTestId("survey-workflow-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-workflow-save")).not.toBeInTheDocument();
  });

  it("返回按钮回到问卷资源列表", () => {
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="design" uiState="default" readonly={false} />);
    fireEvent.click(screen.getByTestId("survey-workflow-back-to-list"));
    expect(push).toHaveBeenCalledWith("/studio/survey");
  });

  it("连续呈现全部问题并让左侧目录定位题目", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="design" uiState="default" readonly={false} />);

    expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q16")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("survey-design-nav-Q16"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getByTestId("survey-design-nav-Q16")).toHaveAttribute("aria-current", "location");
  });

  it("每个报告章节独立保留输出方式与具体图表类型", () => {
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="template" uiState="default" readonly={false} />);

    fireEvent.click(screen.getByTestId("survey-template-chart-type-radar"));
    expect(screen.getByTestId("survey-template-chart-type-radar")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("survey-template-section-action"));
    fireEvent.click(screen.getByTestId("survey-template-output-text"));
    expect(screen.queryByTestId("survey-template-chart-types")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("survey-template-section-gap"));
    expect(screen.getByTestId("survey-template-output-chart")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("survey-template-chart-type-radar")).toHaveAttribute("aria-pressed", "true");
  });

  it("连续呈现整份报告并让左侧目录定位章节", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(<SurveyWorkflowShell surveyId="sv-1" initialStep="report" uiState="default" readonly={false} />);

    expect(screen.getByTestId("survey-report-section-summary")).toBeInTheDocument();
    expect(screen.getByTestId("survey-report-section-boundary")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("survey-report-nav-gap"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getByTestId("survey-report-nav-gap")).toHaveAttribute("aria-current", "location");
  });
});
