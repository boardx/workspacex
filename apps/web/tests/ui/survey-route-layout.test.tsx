import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SurveyPage from "@/app/studio/survey/page";
import SurveyLayout from "@/app/studio/survey/layout";
import SurveyWorkflowPage from "@/app/studio/survey/[surveyId]/page";
import { encodeSurveyCreationDraft } from "@/lib/survey/creation-draft";

const request = vi.hoisted(()=>vi.fn());
vi.mock("@/lib/survey/runtime-client",()=>({surveyRequest:request}));
vi.mock("@/components/shell/app-shell",()=>({AppShell:({children,left}:{children:ReactNode;left:ReactNode})=><div data-testid="shared-app-shell"><aside>{left}</aside>{children}</div>}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/studio/survey",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(()=>{cleanup();request.mockReset();});

describe("Survey route layout", () => {
  it.each([["modules", "question"], ["reports", "report"]])("%s 入口加载真实模板库", async (tab, kind) => {
    request.mockRejectedValueOnce(new Error("模板读取失败"));
    render(<SurveyPage searchParams={{tab}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("模板读取失败");
    expect(request).toHaveBeenCalledWith("/surveys/templates", { query: { kind } });
    expect(screen.queryByTestId("survey-resource-library")).not.toBeInTheDocument();
  });

  it("默认列表路由请求持久问卷，失败时不回退模拟数据", async()=>{
    request.mockRejectedValueOnce(new Error("无权读取问卷"));
    render(<SurveyPage searchParams={{}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("无权读取问卷");
    expect(request).toHaveBeenCalledWith("/surveys");
    expect(screen.queryByTestId("survey-resource-library")).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/打开问卷/})).not.toBeInTheDocument();
  });
  it("默认详情路由请求指定问卷，旧草稿参数不会开启原型", async()=>{
    request.mockRejectedValueOnce(new Error("问卷不可访问"));
    render(<SurveyWorkflowPage params={{surveyId:"real-id"}} searchParams={{step:"design",draft:encodeSurveyCreationDraft({name:"不应显示",tags:[],sourceModuleId:"strategy"})}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("问卷不可访问");
    expect(request).toHaveBeenCalledWith(
      "/surveys/real-id",
      {},
      expect.objectContaining({ parse: expect.any(Function) }),
    );
    expect(screen.queryByTestId("survey-design-question-Q01")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"不应显示"})).not.toBeInTheDocument();
  });
  it("通过路由布局把 Survey 二级菜单和页面内容传入共用外壳", () => {
    render(<SurveyLayout><div data-testid="survey-route-child">问卷列表内容</div></SurveyLayout>);

    expect(screen.getByTestId("shared-app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("survey-section-nav")).toBeInTheDocument();
    expect(screen.getByTestId("survey-route-child")).toBeInTheDocument();
  });

  it("现有问卷路由忽略创建草稿参数", () => {
    render(<SurveyWorkflowPage
      params={{ surveyId: "sv-1" }}
      searchParams={{ preview: "1", step: "design", draft: encodeSurveyCreationDraft({ name: "不应使用", tags: [], sourceModuleId: "strategy" }) }}
    />);

    expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q16")).toBeInTheDocument();
  });

  it("新问卷路由解码单一创建草稿并进入完整设计", () => {
    render(<SurveyWorkflowPage
      params={{ surveyId: "new" }}
      searchParams={{ preview: "1", step: "design", draft: encodeSurveyCreationDraft({ name: "战略调查", tags: ["治理"], sourceModuleId: "strategy" }) }}
    />);

    expect(screen.getByRole("heading", { name: "战略调查" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-workflow-steps")).toBeInTheDocument();
    expect(screen.getByTestId("survey-design-question-Q04")).toBeInTheDocument();
    expect(screen.queryByTestId("survey-design-question-Q01")).not.toBeInTheDocument();
  });
});
