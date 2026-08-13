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

  it("新建问卷进入新的问卷设计页", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-new-survey"));

    expect(push).toHaveBeenCalledWith("/studio/survey/new?step=design");
  });

  it("切到问卷模块时呈现可复用的问题设计模块", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-nav-modules"));

    expect(push).toHaveBeenCalledWith("/studio/survey?tab=modules");
    expect(screen.getByTestId("survey-resource-card-module-profile")).toHaveTextContent("组织画像");
    expect(screen.getByTestId("survey-resource-card-module-strategy")).toHaveTextContent("战略治理");
    fireEvent.click(screen.getByTestId("survey-resource-card-module-profile"));
    expect(push).toHaveBeenLastCalledWith("/studio/survey/module-profile?step=design&mode=module");
    expect(screen.queryByTestId("survey-resource-card-survey-sv-1")).not.toBeInTheDocument();
  });

  it("新建问卷模块进入独立题目编辑模式", () => {
    render(<SurveyResourceLibrary initialTab="modules" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-new-module"));

    expect(push).toHaveBeenCalledWith("/studio/survey/new?step=design&mode=module");
  });

  it("报告模块承接原问卷模板内容并进入报告模板编辑", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);

    fireEvent.click(screen.getByTestId("survey-resource-nav-reports"));

    expect(push).toHaveBeenCalledWith("/studio/survey?tab=reports");
    expect(screen.getByTestId("survey-resource-card-report-template-tpl-digital-collaboration")).toHaveTextContent("企业数字协作成熟度诊断模板");
    fireEvent.click(screen.getByTestId("survey-resource-card-report-template-tpl-digital-collaboration"));
    expect(push).toHaveBeenLastCalledWith("/studio/survey/templates/tpl-digital-collaboration");
  });

  it("问卷卡片进入现有问卷设计", () => {
    render(<SurveyResourceLibrary initialTab="surveys" uiState="default" />);
    fireEvent.click(screen.getByTestId("survey-resource-card-survey-sv-1"));
    expect(push).toHaveBeenCalledWith("/studio/survey/sv-1?step=design");
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
