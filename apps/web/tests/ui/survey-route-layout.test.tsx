import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SurveyLayout from "@/app/studio/survey/layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio/survey",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("Survey route layout", () => {
  it("通过路由布局同时挂载全局左栏、Survey 二级菜单和页面内容", () => {
    render(<SurveyLayout><div data-testid="survey-route-child">问卷列表内容</div></SurveyLayout>);

    expect(screen.getByTestId("shell-rail")).toBeInTheDocument();
    expect(screen.getByTestId("survey-section-nav")).toBeInTheDocument();
    expect(screen.getByTestId("survey-route-child")).toBeInTheDocument();
  });
});
