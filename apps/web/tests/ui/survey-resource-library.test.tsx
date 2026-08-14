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
  it("只呈现右侧问卷列表内容，不重复全局和二级导航", () => {
    render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState="default" />);

    expect(screen.getByTestId("survey-resource-library")).toBeInTheDocument();
    expect(screen.queryByText("BoardX Survey")).not.toBeInTheDocument();
    expect(screen.queryByTestId("survey-resource-nav-surveys")).not.toBeInTheDocument();
    expect(screen.queryByText("快速筛选")).not.toBeInTheDocument();
    expect(screen.queryByText("模板分类")).not.toBeInTheDocument();
    expect(screen.getByTestId("survey-resource-card-survey-sv-1")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("新建问卷进入新的问卷设计页", () => {
    render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-new-survey"));

    expect(push).toHaveBeenCalledWith("/studio/survey/new?step=design");
  });

  it("切到问卷模块时呈现可复用的问题设计模块", () => {
    render(<SurveyResourceLibrary initialTab="modules" initialIntent={null} uiState="default" />);

    expect(screen.getByTestId("survey-resource-card-module-profile")).toHaveTextContent("组织画像");
    expect(screen.getByTestId("survey-resource-card-module-strategy")).toHaveTextContent("战略治理");
    fireEvent.click(screen.getByTestId("survey-resource-card-module-profile"));
    expect(push).toHaveBeenLastCalledWith("/studio/survey/module-profile?step=design&mode=module");
    expect(screen.queryByTestId("survey-resource-card-survey-sv-1")).not.toBeInTheDocument();
  });

  it("新建问卷模块进入独立题目编辑模式", () => {
    render(<SurveyResourceLibrary initialTab="modules" initialIntent={null} uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-new-module"));

    expect(push).toHaveBeenCalledWith("/studio/survey/new?step=design&mode=module");
  });

  it("报告模块承接原问卷模板内容并进入报告模板编辑", () => {
    render(<SurveyResourceLibrary initialTab="reports" initialIntent={null} uiState="default" />);

    expect(screen.getByTestId("survey-resource-card-report-template-tpl-digital-collaboration")).toHaveTextContent("企业数字协作成熟度诊断模板");
    fireEvent.click(screen.getByTestId("survey-resource-card-report-template-tpl-digital-collaboration"));
    expect(push).toHaveBeenLastCalledWith("/studio/survey/templates/tpl-digital-collaboration");
  });

  it("问卷卡片进入现有问卷设计", () => {
    render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState="default" />);
    fireEvent.click(screen.getByTestId("survey-resource-card-survey-sv-1"));
    expect(push).toHaveBeenCalledWith("/studio/survey/sv-1?step=design");
  });

  it("按名称过滤当前资源列表", () => {
    render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState="default" />);
    fireEvent.change(screen.getByTestId("survey-resource-search"), { target: { value: "团队协作" } });
    expect(screen.getByTestId("survey-resource-card-survey-sv-team-health")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-resource-card-survey-sv-1")).not.toBeInTheDocument();
  });

  it("切换资源入口时清空上一入口的搜索条件", () => {
    const view = render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState="default" />);
    fireEvent.change(screen.getByTestId("survey-resource-search"), { target: { value: "团队协作" } });

    view.rerender(<SurveyResourceLibrary initialTab="modules" initialIntent={null} uiState="default" />);

    expect(screen.getByTestId("survey-resource-search")).toHaveValue("");
    expect(screen.getByTestId("survey-resource-card-module-profile")).toBeInTheDocument();
  });

  it.each([
    ["loading", "survey-resource-loading"],
    ["empty", "survey-resource-empty"],
    ["error", "survey-resource-error"],
  ] as const)("呈现 %s 状态", (uiState, testId) => {
    render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState={uiState} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it("从问卷列表进入模块选择器后创建完整问卷", () => {
    render(<SurveyResourceLibrary initialTab="modules" initialIntent="create-survey" uiState="default" />);

    expect(screen.getByRole("heading", { name: "选择问卷模块" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("survey-resource-card-module-strategy"));

    expect(push).toHaveBeenCalledWith("/studio/survey/new?step=design&sourceModule=strategy");
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("mode=module"));
  });

  it("模块管理页的卡片仍进入模块编辑器", () => {
    render(<SurveyResourceLibrary initialTab="modules" initialIntent={null} uiState="default" />);

    expect(screen.getByText("点击卡片进入可复用问卷模块编辑")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("survey-resource-card-module-strategy"));

    expect(push).toHaveBeenCalledWith("/studio/survey/module-strategy?step=design&mode=module");
  });

  it("从问卷模块新建按钮进入模块选择器", () => {
    render(<SurveyResourceLibrary initialTab="surveys" initialIntent={null} uiState="default" />);

    fireEvent.click(screen.getByRole("button", { name: "从问卷模块新建" }));

    expect(push).toHaveBeenCalledWith("/studio/survey?tab=modules&intent=create-survey");
  });
});
