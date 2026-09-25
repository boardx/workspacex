import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("shows loading until the real runtime response arrives", async () => {
    let resolve!: (value: SurveyRuntime) => void;
    client.request.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    expect(screen.getByText("正在加载问卷…")).toBeInTheDocument();
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
    resolve(runtime());
    expect(await screen.findByRole("button", { name: "检查发布条件" })).toBeInTheDocument();
  });

  it("renders every business blocker and never infers ready after a rejected prepare", async () => {
    const blockers: SurveyPublishBlocker[] = [
      { code: "QUESTIONS_EMPTY", side: "survey", subjectId: "survey-1", missingFields: ["questions"] },
      { code: "QUESTION_OPTIONS_EMPTY", side: "question", subjectId: "q-choice", missingFields: ["options"] },
      { code: "MAPPING_INCOMPLETE", side: "section", subjectId: "s1", missingFields: ["questionIds"] },
      { code: "LEADING_QUESTION", side: "question", subjectId: "q-leading", missingFields: ["neutralWording"] },
      { code: "LOGIC_INVALID", side: "question", subjectId: "q1", missingFields: ["显示条件只能引用前面有效的题目"] },
    ];
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "检查发布条件" }));
    expect(await screen.findByText("发现 5 项发布阻断")).toBeInTheDocument();
    expect(screen.getByText(/问卷至少需要一道题/)).toBeInTheDocument();
    expect(screen.getByText(/选项题必须包含有效选项/)).toBeInTheDocument();
    expect(screen.getByText(/报告章节尚未覆盖对应题目/)).toBeInTheDocument();
    expect(screen.getByText(/题目措辞可能带有诱导性/)).toBeInTheDocument();
    expect(screen.getByText(/条件显示或跳转规则无效/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
    expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/prepare", { method: "POST", body: { expectedVersion: 4 } }, expect.anything());
  });

  it("separates retryable system failures from business blockers", async () => {
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.SystemError("服务暂时不可用，请重试。"));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "检查发布条件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂时不可用");
    expect(screen.getByRole("button", { name: "重试发布检查" })).toBeInTheDocument();
    expect(screen.queryByText(/项发布阻断/)).not.toBeInTheDocument();
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
  });

  it("summarizes publish quality and routes each blocker to its repair step", async () => {
    const blockers: SurveyPublishBlocker[] = [
      { code: "QUESTION_OPTIONS_EMPTY", side: "question", subjectId: "q1", missingFields: ["options"] },
      { code: "MAPPING_INCOMPLETE", side: "section", subjectId: "s1", missingFields: ["blocks"] },
    ];
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "检查发布条件" }));
    expect(await screen.findByTestId("survey-publish-readiness")).toHaveTextContent("质量评分 55 / 100");
    expect(screen.getByTestId("survey-publish-readiness")).toHaveTextContent("预计完成率 75%");
    fireEvent.click(screen.getByRole("button", { name: "定位并修复：为选项题补充可选择的答案" }));
    expect(screen.getByRole("button", { name: /1\. 设计问卷/ })).toHaveAttribute("class", expect.stringContaining("border-primary"));
  });

  it("routes a question mapping blocker to the report-template editor", async () => {
    const blockers: SurveyPublishBlocker[] = [
      { code: "MAPPING_INCOMPLETE", side: "question", subjectId: "q1", missingFields: ["reportBlock"] },
    ];
    client.request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new client.BlockedError(blockers));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "检查发布条件" }));
    fireEvent.click(await screen.findByRole("button", { name: "定位并修复：将题目映射到报告章节" }));
    expect(screen.getByRole("button", { name: /2\. 报告模板/ })).toHaveAttribute("class", expect.stringContaining("border-primary"));
    expect(screen.getByTestId("survey-mapping-repair-target")).toHaveTextContent("您愿意推荐我们吗？");
  });

  it("shows ready only after the parsed server response and exposes explicit next actions", async () => {
    let resolve!: (value: SurveyRuntime) => void;
    client.request.mockResolvedValueOnce(runtime()).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<LiveSurveyWorkspace surveyId="survey-1" initialStep="publish" />);
    fireEvent.click(await screen.findByRole("button", { name: "检查发布条件" }));
    expect(screen.queryByText("发布准备已完成")).not.toBeInTheDocument();
    resolve(runtime({ status: "ready", version: 5 }));
    expect(await screen.findByText("发布准备已完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始回收" })).toBeInTheDocument();
    await waitFor(() => expect(client.request).toHaveBeenLastCalledWith("/surveys/survey-1/prepare", { method: "POST", body: { expectedVersion: 4 } }, expect.anything()));
  });
});
