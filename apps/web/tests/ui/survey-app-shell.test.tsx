import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurveyAppShell } from "@/components/survey/shell/survey-app-shell";

let pathname = "/studio/survey/sv-1";
let search = "step=design";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  pathname = "/studio/survey/sv-1";
  search = "step=design";
});

describe("SurveyAppShell", () => {
  it("同时保留全局导航、Survey 二级菜单和右侧内容", () => {
    render(<SurveyAppShell><div data-testid="survey-shell-child">问卷编辑内容</div></SurveyAppShell>);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("shell-rail")).toBeInTheDocument();
    expect(screen.getByTestId("shell-left-panel")).toBeInTheDocument();
    expect(screen.getByTestId("survey-section-nav")).toBeInTheDocument();
    expect(screen.getByTestId("survey-shell-child")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^survey-section-nav-/)).toHaveLength(3);
    expect(screen.getByTestId("rail-survey")).toHaveAttribute("aria-current", "page");
  });

  it("编辑问卷时仍将问卷列表标记为当前二级入口", () => {
    render(<SurveyAppShell><div>编辑器</div></SurveyAppShell>);

    expect(screen.getByTestId("survey-section-nav-surveys")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("survey-section-nav-modules")).not.toHaveAttribute("aria-current");
  });

  it("编辑问卷模块时保留左栏并标记问卷模块入口", () => {
    pathname = "/studio/survey/new";
    search = "step=design&mode=module&module=profile";

    render(<SurveyAppShell><div>模块编辑器</div></SurveyAppShell>);

    expect(screen.getByTestId("shell-rail")).toBeInTheDocument();
    expect(screen.getByTestId("shell-left-panel")).toBeInTheDocument();
    expect(screen.getByTestId("survey-section-nav-modules")).toHaveAttribute("aria-current", "page");
  });

  it("选择问卷来源模块时仍标记问卷列表入口", () => {
    pathname = "/studio/survey";
    search = "tab=modules&intent=create-survey";

    render(<SurveyAppShell><div>模块选择器</div></SurveyAppShell>);

    expect(screen.getByTestId("survey-section-nav-surveys")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("survey-section-nav-modules")).not.toHaveAttribute("aria-current");
  });

  it("畸形 URL 同时声明模块编辑和新建问卷意图时以编辑器语义为准", () => {
    pathname = "/studio/survey/new";
    search = "step=design&mode=module&intent=create-survey";

    render(<SurveyAppShell><div>模块编辑器</div></SurveyAppShell>);

    expect(screen.getByTestId("survey-section-nav-modules")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("survey-section-nav-surveys")).not.toHaveAttribute("aria-current");
  });

  it("编辑报告模块时保留左栏并标记报告模块入口", () => {
    pathname = "/studio/survey/templates/tpl-team-health";
    search = "";

    render(<SurveyAppShell><div>报告模块编辑器</div></SurveyAppShell>);

    expect(screen.getByTestId("shell-rail")).toBeInTheDocument();
    expect(screen.getByTestId("shell-left-panel")).toBeInTheDocument();
    expect(screen.getByTestId("survey-section-nav-reports")).toHaveAttribute("aria-current", "page");
  });
});
