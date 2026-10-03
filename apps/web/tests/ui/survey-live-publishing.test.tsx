import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SurveyPublishBlocker } from "@repo/contracts/survey";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";

const client = vi.hoisted(() => {
  class BlockedError extends Error {
    constructor(readonly blockers: SurveyPublishBlocker[]) {
      super("问卷尚未达到发布条件");
    }
  }
  class SystemError extends Error {
    readonly retryable = true;
  }
  return { request: vi.fn(), BlockedError, SystemError };
});
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/survey/runtime-client", () => ({
  surveyRequest: client.request,
  SurveyPublishBlockedError: client.BlockedError,
  SurveySystemError: client.SystemError,
  SurveyConflictError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const runtime = (patch: Partial<SurveyRuntime> = {}): SurveyRuntime => ({
  id: "survey-1",
  title: "客户体验问卷",
  version: 4,
  status: "draft",
  anonymity: "anonymous",
  answerRevision: 0,
  reportBasisAnswerRevision: null,
  updatedAt: "2026-09-24T08:00:00.000Z",
  questions: [{ id: "q1", title: "您愿意推荐我们吗？", type: "single", chapterId: "general", order: 1, required: true, options: ["会", "不会"] }],
  template: { id: "template", title: "分析报告", sections: [{ id: "s1", title: "推荐意愿", blocks: [{ id: "b1", title: "推荐意愿分布", type: "bar", questionIds: ["q1"], statistic: "distribution", samplePolicy: "valid", minGroupSize: 5 }] }] },
  responses: [],
  publication: null,
  report: null,
  reportBasisVersion: null,
  reportGeneratedAt: null,
  ...patch,
});

beforeEach(() => {
  client.request.mockReset();
  router.replace.mockReset();
  router.push.mockReset();
});

describe("live survey trusted publishing", () => {
  it("checks the current design automatically and updates errors after editing", async () => {
    const invalid = runtime({ questions: [{ ...runtime().questions[0]!, options: [] }] });
    client.request.mockResolvedValueOnce(invalid);
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="design" />);
    const checks = await screen.findByRole("region", { name: "设计检查" });
    expect(within(checks).getByText("选项题必须包含有效选项")).toBeInTheDocument();
    expect(client.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "定位并修复：为选项题补充可选择的答案" }));
    fireEvent.click(screen.getByRole("button", { name: "添加选项" }));
    fireEvent.click(screen.getByRole("button", { name: "添加选项" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑选项 2：新选项" }));
    fireEvent.change(screen.getByRole("textbox", { name: "选项 2" }), { target: { value: "另一个答案" } });
    await waitFor(() => {
      const liveChecks = screen.getByRole("region", { name: "设计检查" });
      expect(liveChecks).toHaveTextContent("设计检查通过");
      expect(within(liveChecks).queryByText("选项题必须包含有效选项")).not.toBeInTheDocument();
    });
  });

  it("publishes a saved valid draft directly without a separate prepare action", async () => {
    client.request.mockResolvedValueOnce(runtime()).mockResolvedValueOnce(runtime({ status: "collecting", version: 5, publication: { token: "new-token", status: "collecting", version: 4, expiresAt: "2026-12-20T10:00:00.000Z", questions: runtime().questions } }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    const start = await screen.findByRole("button", { name: "开始回收" });
    expect(screen.queryByRole("button", { name: "检查发布条件" })).not.toBeInTheDocument();
    fireEvent.click(start);
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 4 } }, expect.anything()));
  });

  it("starts a clean ready survey using the server ready status", async () => {
    client.request.mockResolvedValueOnce(runtime({ status: "ready" })).mockResolvedValueOnce(runtime({ status: "collecting", version: 5, publication: { token: "ready-token", status: "collecting", version: 4, expiresAt: "2026-12-20T10:00:00.000Z", questions: runtime().questions } }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/start-collection", { method: "POST", body: { expectedVersion: 4 } }, expect.anything()));
  });

  it("publishes the saved draft version after editing a ready survey", async () => {
    const edited = runtime().questions[0]!;
    client.request.mockResolvedValueOnce(runtime({ status: "ready" }))
      .mockResolvedValueOnce(runtime({ status: "draft", version: 5, questions: [edited], template: { ...runtime().template, title: "修改后的报告标题" } }))
      .mockResolvedValueOnce(runtime({ status: "collecting", version: 6, questions: [edited], publication: { token: "edited-token", status: "collecting", version: 5, expiresAt: "2026-12-20T10:00:00.000Z", questions: [edited] } }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="template" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "报告标题" }), { target: { value: "修改后的报告标题" } });
    fireEvent.click(screen.getByRole("button", { name: /2\. 发布回收/ }));
    expect(client.request).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    await waitFor(() => expect(client.request).toHaveBeenCalledWith("/surveys/survey-1/source", expect.objectContaining({ method: "PUT", body: expect.objectContaining({ expectedVersion: 4 }) }), expect.anything()));
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 5 } }, expect.anything()));
    expect(client.request).not.toHaveBeenCalledWith("/surveys/survey-1/start-collection", expect.anything(), expect.anything());
  });

  it("retains authoritative rejection diagnostics after a dirty template is saved", async () => {
    const blockers: SurveyPublishBlocker[] = [{ code: "LOGIC_INVALID", side: "question", subjectId: "q1", missingFields: ["服务端发布规则已变化"] }];
    client.request.mockResolvedValueOnce(runtime({ status: "ready" }))
      .mockResolvedValueOnce(runtime({ status: "draft", version: 5, template: { ...runtime().template, title: "更新报告" } }))
      .mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="template" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "报告标题" }), { target: { value: "更新报告" } });
    fireEvent.click(screen.getByRole("button", { name: /2\. 发布回收/ }));
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    expect(await screen.findByText("服务端发布规则已变化")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1\. 设计问卷/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("region", { name: "设计检查" })).toHaveTextContent("发现 1 项设计问题");
    expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 5 } }, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "定位并修复：修复条件显示或跳转规则" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑第 1 题：您愿意推荐我们吗？" }));
    fireEvent.change(screen.getByRole("textbox", { name: "问题内容" }), { target: { value: "您愿意推荐此项服务吗？" } });
    expect(screen.getByRole("region", { name: "设计检查" })).toHaveTextContent("设计检查通过");
    expect(screen.queryByText("服务端发布规则已变化")).not.toBeInTheDocument();
  });

  it("republishes a closed active batch with the current version", async () => {
    const closed = runtime({
      status: "closed",
      publication: { token: "closed-token", status: "closed", version: 4, expiresAt: "2026-10-20T10:00:00.000Z", questions: runtime().questions },
      activeCollectionBatchId: "batch-1",
      collectionBatches: [{ id: "batch-1", token: "closed-token", status: "closed", version: 4, createdAt: "2026-09-24T08:00:00.000Z", closedAt: "2026-09-25T08:00:00.000Z", expiresAt: "2026-10-20T10:00:00.000Z", questions: runtime().questions }],
    });
    const republished = runtime({
      ...closed,
      status: "collecting",
      version: 5,
      publication: { token: "fresh-token", status: "collecting", version: 4, expiresAt: "2026-10-29T10:00:00.000Z", questions: runtime().questions },
      activeCollectionBatchId: "batch-2",
      collectionBatches: [...closed.collectionBatches!, { id: "batch-2", token: "fresh-token", status: "collecting", version: 4, createdAt: "2026-09-29T08:00:00.000Z", closedAt: null, expiresAt: "2026-10-29T10:00:00.000Z", questions: runtime().questions }],
    });
    client.request.mockResolvedValueOnce(closed).mockResolvedValueOnce(republished);
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "再次发布" }));
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith(
      "/surveys/survey-1/republish",
      { method: "POST", body: { expectedVersion: 4 } },
      expect.anything(),
    ));
    expect(await screen.findByText("问卷正在回收中")).toBeInTheDocument();
  });

  it("shows historical batches as read-only and filters their metrics", async () => {
    const firstResponse = { id: "answer-1", submittedAt: "2026-09-24T08:00:00.000Z", durationSeconds: 45, role: "未填写", companySize: "未填写", answers: [], quality: "normal" as const, analysis: "included" as const, collectionBatchId: "batch-1" };
    const secondResponse = { ...firstResponse, id: "answer-2", collectionBatchId: "batch-2" };
    const published = runtime({
      status: "collecting",
      publication: { token: "fresh-token", status: "collecting", version: 4, expiresAt: "2026-10-29T10:00:00.000Z", questions: runtime().questions },
      activeCollectionBatchId: "batch-2",
      collectionBatches: [
        { id: "batch-1", token: "closed-token", status: "closed", version: 4, createdAt: "2026-09-24T08:00:00.000Z", closedAt: "2026-09-25T08:00:00.000Z", expiresAt: "2026-10-20T10:00:00.000Z", questions: runtime().questions },
        { id: "batch-2", token: "fresh-token", status: "collecting", version: 4, createdAt: "2026-09-29T08:00:00.000Z", closedAt: null, expiresAt: "2026-10-29T10:00:00.000Z", questions: runtime().questions },
      ],
      responses: [firstResponse, secondResponse],
    });
    client.request.mockResolvedValueOnce(published);
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "回收批次" }), { target: { value: "batch-1" } });
    expect(screen.getByText("已停止回收 · 1 份答卷")).toBeInTheDocument();
    expect(screen.getByText("历史批次只读")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止回收" })).not.toBeInTheDocument();
    const metrics = screen.getByRole("region", { name: "回收数据" });
    expect(within(metrics).getByText("已收到答卷").parentElement).toHaveTextContent("1");
  });

  it("shows real valid-response counts and recent activity in the right column", async () => {
    const published = runtime({ status: "collecting", publication: { token: "token", status: "collecting", version: 4, expiresAt: "2026-10-20T10:00:00.000Z", questions: runtime().questions } });
    const response = { id: "answer-1", submittedAt: "2026-09-28T08:00:00.000Z", durationSeconds: 45, answers: [], quality: "review" as const, analysis: "included" as const };
    client.request.mockResolvedValueOnce({ ...published, responses: [response, { ...response, id: "answer-2", quality: "normal" }] });
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    expect(await screen.findByText("正在回收 · 2 份答卷")).toBeInTheDocument();
    const metrics = await screen.findByRole("region", { name: "回收数据" });
    expect(within(metrics).getByText("有效答卷").parentElement).toHaveTextContent("1");
    expect(within(screen.getByRole("complementary", { name: "回收设置面板" })).getByRole("region", { name: "最近回收动态" })).toBeInTheDocument();
  });
  it("persists the anonymous-fill setting before publication", async () => {
    client.request.mockResolvedValueOnce(runtime()).mockResolvedValueOnce(runtime({ version: 5, anonymity: "identified" }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "匿名填写" }));
    await waitFor(() => expect(client.request).toHaveBeenCalledWith("/surveys/survey-1", expect.objectContaining({
      method: "PUT", body: expect.objectContaining({ expectedVersion: 4, anonymity: "identified" }),
    }), expect.anything()));
    expect(screen.getByRole("checkbox", { name: "匿名填写" })).not.toBeChecked();
  });
  it("shows loading until the real runtime response arrives", async () => {
    let resolve!: (value: SurveyRuntime) => void;
    client.request.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    expect(screen.getByText("正在加载问卷…")).toBeInTheDocument();
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
    resolve(runtime());
    expect(await screen.findByRole("button", { name: "开始回收" })).toBeInTheDocument();
  });

  it("renders every server business blocker and returns rejected publication to design", async () => {
    const blockers: SurveyPublishBlocker[] = [
      { code: "QUESTIONS_EMPTY", side: "survey", subjectId: "survey-1", missingFields: ["questions"] },
      { code: "QUESTION_OPTIONS_EMPTY", side: "question", subjectId: "q-choice", missingFields: ["options"] },
      { code: "MAPPING_INCOMPLETE", side: "section", subjectId: "s1", missingFields: ["questionIds"] },
      { code: "LEADING_QUESTION", side: "question", subjectId: "q-leading", missingFields: ["neutralWording"] },
      { code: "LOGIC_INVALID", side: "question", subjectId: "q1", missingFields: ["显示条件只能引用前面有效的题目"] },
    ];
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    expect(await screen.findByText("发现 5 项设计问题")).toBeInTheDocument();
    expect(screen.getByText(/问卷至少需要一道题/)).toBeInTheDocument();
    expect(screen.getByText(/选项题必须包含有效选项/)).toBeInTheDocument();
    expect(screen.getByText(/报告章节尚未覆盖对应题目/)).toBeInTheDocument();
    expect(screen.getByText(/题目措辞可能带有诱导性/)).toBeInTheDocument();
    expect(screen.getByText(/条件显示或跳转规则无效/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
    expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 4 } }, expect.anything());
  });

  it("separates retryable system failures from business blockers", async () => {
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.SystemError("服务暂时不可用，请重试。"));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂时不可用");
    expect(screen.getByRole("button", { name: "重试发布" })).toBeInTheDocument();
    expect(screen.queryByText(/项设计问题/)).not.toBeInTheDocument();
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
  });

  it("summarizes publish quality and routes each blocker to its repair step", async () => {
    const blockers: SurveyPublishBlocker[] = [
      { code: "QUESTION_OPTIONS_EMPTY", side: "question", subjectId: "q1", missingFields: ["options"] },
      { code: "MAPPING_INCOMPLETE", side: "section", subjectId: "s1", missingFields: ["blocks"] },
    ];
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    expect(await screen.findByTestId("survey-design-readiness")).toHaveTextContent("质量评分 55 / 100");
    expect(screen.getByTestId("survey-design-readiness")).toHaveTextContent("预计完成率 75%");
    fireEvent.click(screen.getByRole("button", { name: "定位并修复：为选项题补充可选择的答案" }));
    expect(screen.getByRole("button", { name: /1\. 设计问卷/ })).toHaveAttribute("aria-current", "step");
  });

  it("shows configuration diagnostics and focuses the image question for repair", async () => {
    const diagnostic = "请为每个图片选项配置图片和替代文字";
    client.request.mockResolvedValueOnce(runtime({ questions: [
      runtime().questions[0]!,
      { id: "q-image", title: "Image question", type: "image_single", chapterId: "general", order: 2, required: true, options: ["A", "B"], config: { optionIds: ["a", "b"] } },
    ] }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="design" />);
    expect(await screen.findByText(diagnostic)).toBeInTheDocument();
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "POST" }), expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "定位并修复：修复题目配置" }));
    expect(screen.getByRole("button", { name: "选择题目 2：Image question" })).toHaveAttribute("aria-current", "true");
  });

  it("shows the logic diagnostic and focuses its question for repair", async () => {
    const blockers: SurveyPublishBlocker[] = [
      {
        code: "LOGIC_INVALID",
        side: "question",
        subjectId: "q2",
        missingFields: ["显示条件只能引用前面有效的题目"],
      },
    ];
    client.request
      .mockResolvedValueOnce(
        runtime({
          template: { ...runtime().template, sections: [] },
          questions: [
            runtime().questions[0]!,
            { id: "q2", title: "补充原因", type: "short", chapterId: "general", order: 2, required: true, options: [] },
          ],
        }),
      )
      .mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    expect(await screen.findByText("显示条件只能引用前面有效的题目")).toBeInTheDocument();
    expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 4 } }, expect.anything());
    expect(screen.getByRole("button", { name: /1\. 设计问卷/ })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "定位并修复：修复条件显示或跳转规则" }));
    expect(screen.getByRole("button", { name: "选择题目 2：补充原因" })).toHaveAttribute("aria-current", "true");
  });

  it("routes a question mapping blocker to the report-template editor", async () => {
    const blockers: SurveyPublishBlocker[] = [
      { code: "MAPPING_INCOMPLETE", side: "question", subjectId: "q1", missingFields: ["reportBlock"] },
    ];
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    fireEvent.click(await screen.findByRole("button", { name: "定位并修复：将题目映射到报告章节" }));
    expect(screen.getByRole("button", { name: "使用报告模板" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-mapping-repair-target")).toHaveTextContent("您愿意推荐我们吗？");
  });

  it("shows collection only after the parsed server publication response", async () => {
    let resolve!: (value: SurveyRuntime) => void;
    client.request.mockResolvedValueOnce(runtime()).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "开始回收" }));
    expect(screen.queryByText("问卷正在回收中")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止回收" })).not.toBeInTheDocument();
    resolve(runtime({ status: "collecting", version: 5, publication: { token: "server-token", status: "collecting", version: 4, expiresAt: "2026-12-20T10:00:00.000Z", questions: runtime().questions } }));
    expect(await screen.findByText("问卷正在回收中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止回收" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始回收" })).not.toBeInTheDocument();
    expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 4 } }, expect.anything());
  });
  it("posts the selected collection start and end directly on initial publication", async () => {
    const startsAt = new Date("2030-10-03T10:00").toISOString();
    const expiresAt = new Date("2030-10-04T10:00").toISOString();
    client.request.mockResolvedValueOnce(runtime()).mockResolvedValueOnce(runtime({ status: "collecting", version: 5, publication: { token: "scheduled-token", status: "collecting", version: 4, startsAt, expiresAt, questions: runtime().questions } }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.change(await screen.findByLabelText("开始时间"), { target: { value: "2030-10-03T10:00" } });
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2030-10-04T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "开始回收" }));
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/publish", { method: "POST", body: { expectedVersion: 4, startsAt, expiresAt } }, expect.anything()));
    expect(await screen.findByRole("heading", { name: "问卷等待开始" })).toBeInTheDocument();
    expect(screen.getByText(/开始时间：/)).toHaveTextContent(new Date(startsAt).toLocaleString("zh-CN"));
  });

  it("blocks invalid collection windows locally without sending a publication command", async () => {
    client.request.mockResolvedValueOnce(runtime());
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.change(await screen.findByLabelText("开始时间"), { target: { value: "2030-10-04T10:00" } });
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2030-10-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "开始回收" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/截止时间.*晚于.*开始时间/);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "POST" }), expect.anything());
  });

  it("posts a new immutable schedule when republishing a closed batch", async () => {
    const startsAt = new Date("2030-10-05T10:00").toISOString();
    const expiresAt = new Date("2030-10-07T10:00").toISOString();
    const closed = runtime({ status: "closed", publication: { token: "old-token", status: "closed", version: 4, expiresAt: "2026-10-01T00:00:00.000Z", questions: runtime().questions } });
    client.request.mockResolvedValueOnce(closed).mockResolvedValueOnce(runtime({ status: "collecting", version: 5, publication: { token: "new-token", status: "collecting", version: 4, startsAt, expiresAt, questions: runtime().questions } }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.change(await screen.findByLabelText("开始时间"), { target: { value: "2030-10-05T10:00" } });
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2030-10-07T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "再次发布" }));
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/republish", { method: "POST", body: { expectedVersion: 4, startsAt, expiresAt } }, expect.anything()));
    expect(await screen.findByRole("heading", { name: "问卷等待开始" })).toBeInTheDocument();
  });

  it("updates the active batch start and expiry while viewing a closed historical batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-10-03T00:00:00.000Z"));
    try {
      const questions = runtime().questions;
      const old = { id: "old", token: "old-token", status: "closed" as const, version: 3, questions, startsAt: "2030-10-01T00:00:00.000Z", expiresAt: "2030-10-02T00:00:00.000Z", createdAt: "2030-10-01T00:00:00.000Z", closedAt: "2030-10-02T00:00:00.000Z" };
      const active = { id: "active", token: "active-token", status: "collecting" as const, version: 4, questions, startsAt: "2030-10-03T00:00:01.000Z", expiresAt: "2030-10-03T00:00:02.000Z", createdAt: "2030-10-03T00:00:00.000Z", closedAt: null };
      client.request.mockResolvedValueOnce(runtime({ status: "collecting", publication: active, collectionBatches: [old, active], activeCollectionBatchId: "active" }));
      await act(async () => { render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />); });
      fireEvent.change(screen.getByRole("combobox", { name: "回收批次" }), { target: { value: "old" } });
      expect(screen.getByRole("heading", { name: "问卷已停止回收" })).toBeInTheDocument();
      const activeOption = () => within(screen.getByRole("combobox", { name: "回收批次" })).getAllByRole("option")[1]!;
      expect(activeOption()).toHaveTextContent("等待开始");
      await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
      expect(activeOption()).toHaveTextContent("正在回收");
      expect(screen.getByRole("heading", { name: "问卷已停止回收" })).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(activeOption()).toHaveTextContent("已到截止时间");
      expect(screen.getByRole("heading", { name: "问卷已停止回收" })).toBeInTheDocument();
      expect(client.request).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

});
