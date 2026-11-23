import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { AidtTestSurveyPrint } from "@/features/aidt/components/aidt-test-survey-print";
import { createAidtTestGroup, readAidtTestGroups, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ session: { currentOrgId: "org", userId: "ordinary-member", sessionToken: "token" }, survey: vi.fn(), stage: vi.fn(), resources: vi.fn(), preview: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/lib/survey/runtime-client", async original => ({ ...await original<typeof import("@/lib/survey/runtime-client")>(), surveyRequest: mocks.survey }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.stage }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.resources }));
vi.mock("@/features/aidt/lib/aidt-print-preview", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-print-preview")>(), previewAidtPdf: mocks.preview }));
const projectId = "qa-project", groupId = "15c7b5e2-9d0e-4b10-bc47-000000000001", surveyId = "qa-survey", responseId = "response-1";
function runtimeFixture(): SurveyRuntime {
  const batchQuestions = [
    { id: "old-q1", title: "旧发布问题一：你会先看哪里？", type: "single", chapterId: "main", order: 1, required: true, options: ["先看说明", "先看照片"] },
    { id: "old-q2", title: "旧发布问题二：还有什么不明白？", type: "open", chapterId: "main", order: 2, required: false },
  ];
  const currentQuestions = [{ id: "new-q", title: "新版问题不能替换旧答卷问题", type: "single", chapterId: "main", order: 1, required: true, options: ["新选项"] }];
  return SurveyRuntimeSchema.parse({ id: surveyId, title: "合成原型调查", version: 5, status: "collecting", anonymity: "anonymous", answerRevision: 8, updatedAt: "2026-11-22T00:00:00.000Z", questions: currentQuestions,
    template: { id: "template", title: "已有原生报告模板", sections: [] },
    collectionBatches: [{ id: "old-batch", token: "old-publication", status: "closed", questions: batchQuestions, version: 2, expiresAt: "2026-12-01T00:00:00.000Z", createdAt: "2026-11-20T00:00:00.000Z", closedAt: "2026-11-21T00:00:00.000Z" }],
    publication: { token: "new-publication", status: "collecting", questions: currentQuestions, version: 4, expiresAt: "2026-12-01T00:00:00.000Z" },
    responses: Array.from({ length: 8 }, (_, index) => ({ id: `response-${index + 1}`, collectionBatchId: "old-batch", role: "合成QA", companySize: "软件测试", quality: "normal", analysis: "included", submittedAt: "2026-11-21T00:00:00.000Z", durationSeconds: 65,
      answers: [{ questionId: "old-q1", value: "先看说明" }, { questionId: "old-q2", value: `合成完整开放回答-${index + 1}，原文保留` }] })),
    report: { id: "actual-report", title: "已保存原生调查报告", issues: [], sampleSummary: { total: 8, pendingReview: 0, excluded: 0, included: 8 }, sections: [{ id: "section", title: "已有统计章节", blocks: [{ id: "block", title: "实际纳入分析统计", type: "table", questionIds: ["old-q1"], statistic: "distribution", samplePolicy: "valid", minGroupSize: 8, sampleSize: 8, rows: [{ label: "合成统计行", value: 8, count: 8 }], issues: [] }] }] },
    reportBasisVersion: 4, reportBasisAnswerRevision: 8, reportGeneratedAt: "2026-11-22T00:00:00.000Z",
  });
}
let current: SurveyRuntime, saved: AidtUiStageDraft;
function stageFixture() {
  const base = createAidtTestGroup({ schemaVersion: 1, question: "是否理解流程", beforeTestBelief: "待验证", verificationBasis: "合成QA", verificationLimits: "非课堂验收", prototypeRef: "固定原型", sourceStageRevision: 9, prototypeDesignId: "design", prototypeVersionId: "native-v2" }, groupId)!;
  return updateAidtTestGroup(emptyAidtUiDrafts()[6]!, { ...base, method: "survey", researchPath: "survey", source: { kind: "survey", id: surveyId }, surveyResponseId: responseId });
}
function View({ runtime = current }: { runtime?: SurveyRuntime }) { return <AidtTestSurveyPrint projectId={projectId} groupId={groupId} surveyId={surveyId} responseId={responseId} runtime={runtime} />; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); Object.assign(mocks.session, { currentOrgId: "org", userId: "ordinary-member", sessionToken: "token" }); current = runtimeFixture(); saved = stageFixture(); mocks.survey.mockImplementation(async () => current); mocks.stage.mockImplementation(async () => ({ stage: { revision: 12, content: { draft: saved } } })); mocks.resources.mockResolvedValue({ items: [{ kind: "survey", id: surveyId }] }); mocks.preview.mockResolvedValue("cancelled"); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("prints the real native questionnaire for the selected response's original complete batch, not newer questions", async () => {
  render(<View />); const before = JSON.stringify(current); fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const article = mocks.preview.mock.calls[0]![0] as HTMLElement;
  expect(article).toHaveTextContent("旧发布问题一"); expect(article).toHaveTextContent("旧发布问题二"); expect(article).toHaveTextContent("先看说明"); expect(article).toHaveTextContent("先看照片"); expect(article).toHaveTextContent("发布批次 old-batch · V2");
  expect(article).not.toHaveTextContent("新版问题不能替换旧答卷问题"); expect(article.querySelectorAll("input,textarea,select")).toHaveLength(0);
  expect(mocks.preview.mock.calls[0]![2]).toEqual(expect.objectContaining({ defaultPaper: "A4" })); expect(JSON.stringify(current)).toBe(before);
  expect(mocks.survey.mock.calls.every(([, options]) => options.method === undefined || options.method === "GET")).toBe(true);
});
it("prints the real native report and every original question/answer in the bound batch, with a reasonable A3 default", async () => {
  render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const article = mocks.preview.mock.calls[0]![0] as HTMLElement;
  for (const text of ["已保存原生调查报告", "已有统计章节", "实际纳入分析统计", "合成统计行", "旧发布问题一", "旧发布问题二", "先看说明", "合成完整开放回答-1，原文保留", "报告依据：问卷 V4 · 答卷修订 8"]) expect(article).toHaveTextContent(text);
  expect(article).not.toHaveTextContent("新版问题不能替换旧答卷问题"); expect(mocks.preview.mock.calls[0]![2]).toEqual(expect.objectContaining({ defaultPaper: "A3" }));
});
it.each(["version", "answers"])("refuses a report whose %s basis is stale", async change => {
  if (change === "version") current.reportBasisVersion = 3; else current.reportBasisAnswerRevision = 7;
  render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" })); expect(await screen.findByRole("alert")).toHaveTextContent("尚未生成或已过期"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("retains the existing eight-included-sample gate instead of printing a seven-sample report", async () => {
  current.report!.sampleSummary!.included = 7; render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("样本不足 8"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("refuses an excluded answer and an ambiguous or missing original batch", async () => {
  current.responses[0]!.analysis = "excluded"; current.responses[0]!.exclusionReason = "QA负例";
  const view = render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" })); expect(await screen.findByRole("alert")).toHaveTextContent("答卷当前不可读取"); expect(mocks.preview).not.toHaveBeenCalled(); view.unmount();
  current = runtimeFixture(); current.collectionBatches = []; render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" })); expect(await screen.findByRole("alert")).toHaveTextContent("无法确定答卷对应的发布版本"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("refuses a removed project link or changed saved answer binding without any publish/write request", async () => {
  mocks.resources.mockResolvedValueOnce({ items: [] }); const view = render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" })); expect(await screen.findByRole("alert")).toHaveTextContent("项目关联或访问状态已变化"); expect(mocks.preview).not.toHaveBeenCalled(); view.unmount();
  saved = { ...saved, fields: { ...saved.fields, ["testGroup:" + groupId]: saved.fields["testGroup:" + groupId]!.replace(responseId, "different-response") } };
  render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" })); expect(await screen.findByRole("alert")).toHaveTextContent("项目关联或访问状态已变化"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("cancels stale document work after an actor change and leaves survey data untouched", async () => {
  const response = deferred<SurveyRuntime>(); mocks.survey.mockReturnValueOnce(response.promise); const before = JSON.stringify(current); const view = render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" })); await waitFor(() => expect(mocks.survey).toHaveBeenCalledOnce());
  const signal = mocks.survey.mock.calls[0]![1].signal as AbortSignal; mocks.session.userId = "other-member"; view.rerender(<View />); expect(signal.aborted).toBe(true);
  await act(async () => response.resolve(current)); expect(mocks.preview).not.toHaveBeenCalled(); expect(JSON.stringify(current)).toBe(before);
});
it("invalidates an already open preview when the exact survey runtime changes", async () => {
  vi.useFakeTimers(); const original = current; const preview = deferred<"cancelled">(); mocks.preview.mockReturnValueOnce(preview.promise); render(<View runtime={original} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" }))); expect(mocks.preview).toHaveBeenCalledOnce(); const options = mocks.preview.mock.calls[0]![2]; expect(options.isCurrent()).toBe(true);
  current = { ...original, version: original.version + 1 }; await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(options.isCurrent()).toBe(false);
  await act(async () => preview.resolve("cancelled")); expect(mocks.survey.mock.calls.every(([, request]) => request.method === undefined || request.method === "GET")).toBe(true);
});


it("does not replace a missing original questionnaire batch with the latest publication", async () => {
  current.collectionBatches = []; render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("无法确定答卷对应的发布版本"); expect(mocks.preview).not.toHaveBeenCalled();
});


it("does not substitute current questions when the explicitly bound answer has been excluded", async () => {
  current.responses[0]!.analysis = "excluded"; current.responses[0]!.exclusionReason = "QA负例";
  render(<View />); fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("答卷当前不可读取"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("keeps normal questionnaire preview available without requiring a fabricated answer", async () => {
  saved = updateAidtTestGroup(saved, { ...readAidtTestGroups(saved.fields)[0]!, surveyResponseId: undefined });
  render(<AidtTestSurveyPrint projectId={projectId} groupId={groupId} surveyId={surveyId} runtime={current} />);
  fireEvent.click(screen.getByRole("button", { name: "打印调查问卷" })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  expect(mocks.preview.mock.calls[0]![0] as HTMLElement).toHaveTextContent("新版问题不能替换旧答卷问题");
  expect(mocks.preview.mock.calls[0]![0] as HTMLElement).toHaveTextContent("发布版本 V4");
});
it("retains the minimum sample gate for each actual report output row", async () => {
  current.report!.sections[0]!.blocks[0]!.rows[0]!.count = 7; render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "打印答卷与调查报告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("输出样本不足 8"); expect(mocks.preview).not.toHaveBeenCalled();
});
