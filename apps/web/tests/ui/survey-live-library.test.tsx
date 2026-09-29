import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSurveyLibrary } from "@/components/survey/live/survey-library";

const request = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const survey = (patch = {}) => ({
  id: "survey-1", title: "客户满意度", version: 1, status: "collecting", anonymity: "anonymous",
  answerRevision: 0, reportBasisAnswerRevision: null, updatedAt: "2026-09-27T10:00:00.000Z",
  questions: [{ id: "q1", title: "满意吗", type: "single", chapterId: "general", order: 1, required: true, options: ["是", "否"] }],
  template: { id: "t1", title: "报告", sections: [] }, responses: [{ id: "r1" }], publication: { token: "token", status: "collecting", version: 1, expiresAt: "2026-10-01T00:00:00.000Z", questions: [] },
  report: null, reportBasisVersion: null, reportGeneratedAt: null, ...patch,
});

beforeEach(() => { request.mockReset(); push.mockReset(); window.localStorage.clear(); });

describe("LiveSurveyLibrary", () => {
  it("creates a named draft with a pending tag and navigates only after persistence", async () => {
    request.mockResolvedValueOnce([]).mockResolvedValueOnce(survey({id:'created',title:'产品调研',tags:['产品'],publication:null}));
    render(<LiveSurveyLibrary />);await screen.findByRole('heading',{name:'还没有问卷'});
    fireEvent.click(screen.getByTestId('survey-create-primary'));
    fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'产品调研'}});
    fireEvent.change(screen.getByLabelText('标签'),{target:{value:'产品'}});
    fireEvent.click(screen.getByRole('button',{name:'下一步'}));
    await waitFor(()=>expect(push).toHaveBeenCalledWith('/studio/survey/created/design'));
    expect(request).toHaveBeenLastCalledWith('/surveys',expect.objectContaining({method:'POST',body:expect.objectContaining({title:'产品调研',tags:['产品'],questions:[]})}),expect.anything());
  });
  it("routes AI creation to a separate import page without creating a draft first", async () => {
    request.mockResolvedValueOnce([]);
    render(<LiveSurveyLibrary />);await screen.findByRole('heading',{name:'还没有问卷'});
    fireEvent.click(screen.getByTestId('survey-create-primary'));
    fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'AI 调研'}});
    fireEvent.click(screen.getByRole('radio',{name:/AI 导入创建/}));
    fireEvent.click(screen.getByRole('button',{name:'下一步'}));
    await waitFor(()=>expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/studio\/survey\/new\/import\?draft=/)));
    const target = new URL(push.mock.calls[0]?.[0], 'http://localhost');
    expect(JSON.parse(target.searchParams.get('draft') ?? '{}')).toEqual({name:'AI 调研',tags:[]});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('reopens an unfinished AI draft at import and preserves its project context', async () => {
    window.localStorage.setItem('survey:pending-ai-import:survey-1', '1');
    request.mockResolvedValueOnce([survey({status:'draft',publication:null,responses:[]})]);
    render(<LiveSurveyLibrary projectId="project-1" />);
    fireEvent.click(await screen.findByRole('button',{name:'继续设计'}));
    expect(push).toHaveBeenCalledWith('/studio/survey/survey-1?step=import&mode=ai&projectId=project-1');
  });
  it("searches actual persisted tags as well as survey names", async () => {
    request.mockResolvedValueOnce([survey({tags:['组织诊断']})]);render(<LiveSurveyLibrary />);
    await screen.findByTestId('survey-status-survey-1');fireEvent.change(screen.getByLabelText('搜索问卷'),{target:{value:'组织诊断'}});
    expect(screen.getByRole('link',{name:'客户满意度'})).toBeInTheDocument();
  });
  it("counts included pending-review responses using the report sample basis", async () => {
    request.mockResolvedValueOnce([survey({responses:[
      {id:"r1",quality:"normal",analysis:"included"},
      {id:"r2",quality:"review",analysis:"included"},
      {id:"r3",quality:"normal",analysis:"excluded"},
    ]})]);
    render(<LiveSurveyLibrary />);
    const label = await screen.findByText("有效答卷");
    expect(label.parentElement).toHaveTextContent("2有效答卷");
  });
  it("shows real survey status and routes collecting surveys to response review", async () => {
    request.mockResolvedValueOnce([survey()]);
    render(<LiveSurveyLibrary />);
    expect(await screen.findByRole("heading", { name: "问卷" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-status-survey-1")).toHaveTextContent("发布中");
    fireEvent.click(screen.getByRole("button", { name: "查看答卷" }));
    expect(push).toHaveBeenCalledWith("/studio/survey/survey-1/responses");
  });

  it("presents the approved library hierarchy with a neutral visual cover", async () => {
    request.mockResolvedValueOnce([survey({ tags: ["客户调研", "满意度"] })]);
    render(<LiveSurveyLibrary />);

    expect(await screen.findByTestId("survey-card-cover-survey-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入 Markdown" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "问卷二级导航" })).toHaveClass("survey-library-nav");
    expect(screen.getByTestId("survey-status-survey-1")).toHaveTextContent("发布中");
  });

  it("uses a structured loading skeleton while the real survey list is pending", () => {
    request.mockReturnValueOnce(new Promise(() => undefined));
    render(<LiveSurveyLibrary />);
    expect(screen.getByTestId("survey-library-loading")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在加载问卷" })).toBeInTheDocument();
  });

  it("distinguishes a failed list request from an empty survey list", async () => {
    request.mockRejectedValueOnce(new Error("无访问权限"));
    render(<LiveSurveyLibrary />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无访问权限");
    expect(screen.queryByText("还没有问卷")).not.toBeInTheDocument();
  });

  it("renders a focused empty state with create and template actions", async () => {
    request.mockResolvedValueOnce([]);
    render(<LiveSurveyLibrary />);
    expect(await screen.findByRole("heading", { name: "还没有问卷" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建问卷" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "问卷模板" })).toHaveAttribute("href", "/studio/survey?tab=modules");
  });
  it("filters by real tags and keeps templates optional without status filters", async () => {
    request.mockResolvedValueOnce([survey({tags:['客户调研']}),survey({id:'survey-2',title:'员工体验',tags:['员工体验'],publication:null,responses:[]})]);
    render(<LiveSurveyLibrary />);
    await screen.findByRole('link',{name:'员工体验'});
    expect(screen.queryByRole('button',{name:/草稿.*筛选/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'客户调研'}));
    expect(screen.getByRole('link',{name:'客户满意度'})).toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'员工体验'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'报告模板'})).toBeInTheDocument();
  });
  it("expands persisted tags beyond the first seven and keeps them selectable", async () => {
    const tags = Array.from({ length: 8 }, (_, index) => `标签${index + 1}`);
    request.mockResolvedValueOnce([survey({ tags })]);
    render(<LiveSurveyLibrary />);
    await screen.findByRole("link", { name: "客户满意度" });
    expect(screen.queryByRole("button", { name: "标签8" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /更多标签/ }));
    fireEvent.click(screen.getByRole("button", { name: "标签8" }));
    expect(screen.getByRole("link", { name: "客户满意度" })).toBeInTheDocument();
  });
});
