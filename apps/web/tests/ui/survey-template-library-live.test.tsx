import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SurveyLibraryTemplate } from "@repo/contracts/survey-template-library";
import { SurveyTemplateLibrary } from "@/components/survey/library/template-library";
const request = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const row = (
  patch: Partial<SurveyLibraryTemplate> = {},
): SurveyLibraryTemplate => ({
  id: "source",
  kind: "question",
  title: "团队问卷模板",
  description: "用于团队调研",
  version: 3,
  updatedAt: "2026-09-21T00:00:00.000Z",
  questions: [
    {
      id: "q",
      order: 1,
      chapterId: "general",
      type: "single",
      title: "工作体验",
      required: true,
      options: ["好", "一般"],
    },
  ],
  template: { id: "report", title: "团队报告", sections: [] },
  ...patch,
});
beforeEach(() => {
  request.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  vi.restoreAllMocks();
});
describe("persisted survey template library", () => {
  it("does not navigate after an unverified create response and retains the source card", async () => {
    request
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce({ id: "unverified-id" });
    render(<SurveyTemplateLibrary kind="question" />);
    await screen.findByText("团队问卷模板");
    fireEvent.click(screen.getByRole("button", { name: "用此模板创建问卷" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "问卷创建结果无法确认",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByText("团队问卷模板")).toBeInTheDocument();
  });
  it("keeps a card when a versioned deletion is rejected", async () => {
    request
      .mockResolvedValueOnce([row()])
      .mockRejectedValueOnce(new Error("版本冲突，请刷新"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SurveyTemplateLibrary kind="question" />);
    await screen.findByText("团队问卷模板");
    fireEvent.click(screen.getByRole("button", { name: "删除模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突");
    expect(screen.getByText("团队问卷模板")).toBeInTheDocument();
  });
  it("loads by kind, searches persisted cards and retries an honest load error", async () => {
    request
      .mockRejectedValueOnce(new Error("无法加载模板"))
      .mockResolvedValueOnce([row()]);
    render(<SurveyTemplateLibrary kind="question" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载模板");
    expect(screen.queryByText("团队问卷模板")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("团队问卷模板");
    expect(request).toHaveBeenLastCalledWith("/surveys/templates", {
      query: { kind: "question" },
    });
    fireEvent.change(screen.getByLabelText("搜索模板"), {
      target: { value: "不存在" },
    });
    expect(screen.queryByText("团队问卷模板")).not.toBeInTheDocument();
    expect(screen.getByText("没有匹配的模板")).toBeInTheDocument();
  });
  it("duplicates a separate template without modifying the source or copying runtime state", async () => {
    const source = row();
    const before = JSON.stringify(source);
    request
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce(
        row({ id: "copy", title: "团队问卷模板 副本", version: 1 }),
      );
    render(<SurveyTemplateLibrary kind="question" />);
    await screen.findByText(source.title);
    fireEvent.click(screen.getByRole("button", { name: "复制模板" }));
    await screen.findByText("团队问卷模板 副本");
    expect(screen.getByText(source.title)).toBeInTheDocument();
    expect(JSON.stringify(source)).toBe(before);
    expect(request.mock.calls[1]).toEqual([
      "/surveys/templates",
      {
        method: "POST",
        body: {
          kind: source.kind,
          title: `${source.title} 副本`,
          description: source.description,
          questions: source.questions,
          template: source.template,
        },
      },
    ]);
  });
  it("creates a real survey from a question template and navigates only to its returned id", async () => {
    const source = row();
    request
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce({
        id: "new-real-survey",
        title: source.title,
        questions: source.questions,
        template: source.template,
        version: 1,
        updatedAt: source.updatedAt,
        responses: [],
        publication: null,
        report: null,
        reportBasisVersion: null,
        reportGeneratedAt: null,
      });
    render(<SurveyTemplateLibrary kind="question" />);
    await screen.findByText(source.title);
    fireEvent.click(screen.getByRole("button", { name: "用此模板创建问卷" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/studio/survey/new-real-survey",
      ),
    );
    expect(request.mock.calls[1]).toEqual([
      "/surveys",
      {
        method: "POST",
        body: {
          title: source.title,
          questions: source.questions,
          template: source.template,
        },
      },
    ]);
  });
  it("requires confirmation and the stored version to delete a template", async () => {
    request.mockResolvedValueOnce([row()]).mockResolvedValueOnce(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SurveyTemplateLibrary kind="question" />);
    await screen.findByText("团队问卷模板");
    fireEvent.click(screen.getByRole("button", { name: "删除模板" }));
    expect(request).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "删除模板" }));
    await waitFor(() =>
      expect(screen.queryByText("团队问卷模板")).not.toBeInTheDocument(),
    );
    expect(request).toHaveBeenLastCalledWith("/surveys/templates/source", {
      method: "DELETE",
      query: { expectedVersion: "3" },
    });
  });
  it("disables survey creation for a template without questions and keeps report editing as its main action", async () => {
    request.mockResolvedValueOnce([row({ questions: [] })]);
    const { unmount } = render(<SurveyTemplateLibrary kind="question" />);
    await screen.findByText("团队问卷模板");
    expect(
      screen.getByRole("button", { name: "用此模板创建问卷" }),
    ).toBeDisabled();
    unmount();
    request.mockResolvedValueOnce([row({ kind: "report", title: "报告框架" })]);
    render(<SurveyTemplateLibrary kind="report" />);
    const card = (await screen.findByText("报告框架")).closest("article")!;
    expect(
      within(card).getByRole("link", { name: "编辑模板" }),
    ).toHaveAttribute("href", "/studio/survey/templates/source");
    expect(
      screen.queryByRole("button", { name: "用此模板创建问卷" }),
    ).not.toBeInTheDocument();
  });
});

describe("original built-in templates", () => {
  it.each([["question",12,"组织画像"],["report",6,"企业数字协作成熟度诊断模板"]] as const)("keeps %s presets visible when personal library is empty",async(kind,count,title)=>{
    request.mockResolvedValue([]);
    render(<SurveyTemplateLibrary kind={kind}/>);
    expect(await screen.findByText(title)).toBeInTheDocument();
    const builtins=screen.getByRole("region",{name:"内置模板"});
    expect(within(builtins).getAllByRole("article")).toHaveLength(count);
    if(kind === "report") expect(within(builtins).queryByRole("button",{name:"使用并创建问卷"})).not.toBeInTheDocument();
    expect(within(builtins).queryByRole("button",{name:"删除模板"})).not.toBeInTheDocument();
    expect(within(builtins).queryByText(/更新于|份答卷/)).not.toBeInTheDocument();
    await screen.findByText(`还没有个人${kind==="question"?"问卷模板":"报告模板"}`);
  });
  it("keeps builtin contents available while showing a personal load failure",async()=>{
    request.mockRejectedValue(new Error("个人模板无法读取"));
    render(<SurveyTemplateLibrary kind="question"/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("个人模板无法读取");
    expect(screen.getByText("组织画像")).toBeInTheDocument();
    const card=screen.getByText("组织画像").closest("article")!;
    expect(within(card).getByRole("button",{name:"使用并创建问卷"})).toBeEnabled();
  });
  it("copies builtin configuration into personal storage without fake runtime fields",async()=>{
    request.mockResolvedValueOnce([]).mockImplementationOnce(async(_path,options)=>({ ...options.body,id:"saved-copy",version:1,updatedAt:"2026-09-21T00:00:00.000Z" }));
    render(<SurveyTemplateLibrary kind="question"/>);
    const card=(await screen.findByText("组织画像")).closest("article")!;
    fireEvent.click(within(card).getByRole("button",{name:"保存到我的模板"}));
    await screen.findByText("组织画像 副本");
    const [path,options]=request.mock.calls[1]!;
    expect(path).toBe("/surveys/templates");
    expect(options.body.questions).toHaveLength(3);
    expect(Object.keys(options.body).sort()).toEqual(["description","kind","questions","template","title"]);
    expect(within(screen.getByRole("region",{name:"内置模板"})).getByText("组织画像")).toBeInTheDocument();
  });
  it("creates a real empty-response survey from the original organization preset",async()=>{
    request.mockResolvedValueOnce([]).mockImplementationOnce(async(_path,options)=>({ ...options.body,id:"survey-from-builtin",version:1,answerRevision:0,updatedAt:"2026-09-21T00:00:00.000Z",responses:[],publication:null,report:null,reportBasisVersion:null,reportBasisAnswerRevision:null,reportGeneratedAt:null }));
    render(<SurveyTemplateLibrary kind="question"/>);
    const card=(await screen.findByText("组织画像")).closest("article")!;
    fireEvent.click(within(card).getByRole("button",{name:"使用并创建问卷"}));
    await waitFor(()=>expect(router.push).toHaveBeenCalledWith("/studio/survey/survey-from-builtin"));
    expect(Object.keys(request.mock.calls[1]![1].body).sort()).toEqual(["questions","template","title"]);
  });
});

it("late initial GET cannot hide a builtin copy saved while loading",async()=>{
  let resolveLoad!:(value:unknown)=>void;
  request.mockImplementationOnce(()=>new Promise(resolve=>{resolveLoad=resolve;})).mockImplementationOnce(async(_path,options)=>({...options.body,id:"created-while-loading",version:1,updatedAt:"2026-09-21T00:00:00.000Z"}));
  render(<SurveyTemplateLibrary kind="question"/>);
  const card=screen.getByText("组织画像").closest("article")!;
  fireEvent.click(within(card).getByRole("button",{name:"保存到我的模板"}));
  await screen.findByText("组织画像 副本");
  resolveLoad([]);
  await waitFor(()=>expect(screen.queryByText("正在加载模板…")).not.toBeInTheDocument());
  expect(screen.getByText("组织画像 副本")).toBeInTheDocument();
});
