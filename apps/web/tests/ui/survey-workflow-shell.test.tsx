import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyWorkflowShell } from "@/components/survey/workflow/survey-workflow-shell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  cleanup();
  replace.mockReset();
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
});
