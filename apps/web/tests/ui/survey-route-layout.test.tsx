import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SurveyLayout from "@/app/studio/survey/layout";
import SurveyWorkflowPage from "@/app/studio/survey/[surveyId]/page";
import { encodeSurveyCreationDraft } from "@/lib/survey/creation-draft";

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio/survey",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

describe("Survey route layout", () => {
  it("通过路由布局同时挂载全局左栏、Survey 二级菜单和页面内容", () => {
    render(<SurveyLayout><div data-testid="survey-route-child">问卷列表内容</div></SurveyLayout>);

    expect(screen.getByTestId("shell-rail")).toBeInTheDocument();
    expect(screen.getByTestId("survey-section-nav")).toBeInTheDocument();
    expect(screen.getByTestId("survey-route-child")).toBeInTheDocument();
  });

  it("现有问卷路由忽略创建草稿参数", () => {
    render(<SurveyWorkflowPage
      params={{ surveyId: "sv-1" }}
      searchParams={{ step: "design", draft: encodeSurveyCreationDraft({ name: "不应使用", tags: [], sourceModuleId: "strategy" }) }}
    />);

    expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q16")).toBeInTheDocument();
  });

  it("新问卷路由解码单一创建草稿并进入完整设计", () => {
    render(<SurveyWorkflowPage
      params={{ surveyId: "new" }}
      searchParams={{ step: "design", draft: encodeSurveyCreationDraft({ name: "战略调查", tags: ["治理"], sourceModuleId: "strategy" }) }}
    />);

    expect(screen.getByRole("heading", { name: "战略调查" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-workflow-steps")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q04")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-design-question-Q01")).not.toBeInTheDocument();
  });
});
