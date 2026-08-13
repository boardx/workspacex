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
  it("新建问卷使用草稿身份进入问题设计", () => {
    render(<SurveyWorkflowShell surveyId="new" initialStep="design" uiState="default" readonly={false} />);

    expect(screen.getByRole("heading", { name: "未命名问卷" })).toBeInTheDocument();
    expect(screen.getByText(/问卷 ID new/)).toBeInTheDocument();
  });

  it("从问卷模块创建时只载入该模块的问题", () => {
    render(<SurveyWorkflowShell surveyId="module-profile" initialStep="design" uiState="default" readonly={false} moduleEditor />);

    expect(screen.getByRole("heading", { name: "组织画像" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q03")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-design-question-Q04")).not.toBeInTheDocument();

    expect(screen.queryByTestId("survey-workflow-steps")).not.toBeInTheDocument();
    expect(screen.queryByTestId("survey-workflow-step-template")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("survey-workflow-back-to-list"));
    expect(push).toHaveBeenCalledWith("/studio/survey?tab=modules");
  });

  it("不同模块身份对应各自标题与题目集", () => {
    render(<SurveyWorkflowShell surveyId="module-strategy" initialStep="design" uiState="default" readonly={false} moduleEditor />);

    expect(screen.getByRole("heading", { name: "战略治理" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q04")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q06")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-design-question-Q01")).not.toBeInTheDocument();
  });

  it("新建空白问卷模块默认没有题目并提供创建入口", () => {
    render(<SurveyWorkflowShell surveyId="new" initialStep="design" uiState="default" readonly={false} moduleEditor />);

    expect(screen.getByRole("heading", { name: "未命名问卷模块" })).toBeInTheDocument();
    expect(screen.getByText("当前模块还没有题目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加第一道题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从已有问卷模块创建" })).toBeInTheDocument();
    expect(screen.queryByTestId("survey-design-question-Q01")).not.toBeInTheDocument();
  });

  it("空白模块可以复制已有模块题目后独立修改", () => {
    render(<SurveyWorkflowShell surveyId="new" initialStep="design" uiState="default" readonly={false} moduleEditor />);

    fireEvent.click(screen.getByRole("button", { name: "从已有问卷模块创建" }));
    fireEvent.click(screen.getByRole("button", { name: /组织画像/ }));

    expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q03")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-design-question-Q04")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未命名问卷模块" })).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText("问题内容")[0]!, { target: { value: "自定义后的题目" } });
    expect(screen.getAllByLabelText("问题内容")[0]!).toHaveValue("自定义后的题目");
  });

  it("空白模块可以添加第一道题", () => {
    render(<SurveyWorkflowShell surveyId="new" initialStep="design" uiState="default" readonly={false} moduleEditor />);

    fireEvent.click(screen.getByRole("button", { name: "添加第一道题" }));

    expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
    expect(screen.getByLabelText("问题内容")).toHaveValue("请输入问题内容");
  });

  it("只读空白模块不提供创建题目的操作", () => {
    render(<SurveyWorkflowShell surveyId="new" initialStep="design" uiState="default" readonly moduleEditor />);

    expect(screen.getByText("当前模块还没有题目")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加第一道题" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从已有问卷模块创建" })).not.toBeInTheDocument();
  });

  it("问卷模块模式忽略非设计步骤且只显示题目编辑", () => {
    render(<SurveyWorkflowShell surveyId="module-profile" initialStep="template" uiState="default" readonly={false} moduleEditor />);

    expect(screen.getByTestId("survey-design-question-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-template-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("survey-workflow-steps")).not.toBeInTheDocument();
  });

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
