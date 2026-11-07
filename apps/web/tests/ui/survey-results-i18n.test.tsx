import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { survey } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { LiveResponseList } from "@/components/survey/live/response-list";
import { SurveyReportDocument } from "@/components/survey/report/report-document";
import { surveyReportMarkdown } from "@/components/survey/report/report-markdown";
import { reportChartOptions } from "@/components/survey/report/report-chart";
const boundary = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/survey/runtime-client", async original => ({ ...(await original<typeof import("@/lib/survey/runtime-client")>()), downloadSurveyAttachment: boundary.download }));
const rawQuestion = "原问题 {count}", rawAnswer = "原回答 {name}";
const question: survey.SurveyWorkflowQuestion = { id: "raw-q", title: rawQuestion, type: "open", chapterId: "raw-chapter", order: 1, required: false, options: [] };
function response(patch: Partial<survey.SurveyResponse> = {}): survey.SurveyResponse {
  return { id: "raw-response-0", submittedAt: "2026-11-04T06:00:00.000Z", durationSeconds: 20, quality: "normal", analysis: "included", role: "原角色", companySize: "原规模", answers: [{ questionId: question.id, value: rawAnswer }], ...patch };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="zh-CN"><Driver />{children}</I18nProvider>); }
function language(locale: Locale) { act(() => setLocale(locale)); }
function showList(rows = [response()], questions = [question]) { const review = vi.fn(), analysis = vi.fn(); const view = show(<LiveResponseList surveyId="raw-survey" responses={rows} questions={questions} busy={false} onReview={review} onAnalysis={analysis} />); return { ...view, review, analysis }; }
beforeEach(() => { boundary.download.mockReset(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("retains raw search text, focus, selection and quality-filter identity when controls change language", () => {
  const rows = [response(), response({ id: "raw-review", quality: "review", answers: [{ questionId: "raw-q", value: "原独特回答 {count}" }] }), response({ id: "raw-excluded", analysis: "excluded", exclusionReason: "原排除" })];
  const { review, analysis } = showList(rows); const field = screen.getByRole("textbox", { name: "搜索答卷" }) as HTMLInputElement;
  fireEvent.click(screen.getByRole("button", { name: "待复核 1" })); fireEvent.change(field, { target: { value: "原独特" } }); field.focus(); field.setSelectionRange(1, 3); language("en");
  expect(screen.getByRole("textbox", { name: "Search responses" })).toBe(field); expect(field).toHaveValue("原独特"); expect(field).toHaveFocus(); expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
  expect(screen.getByRole("button", { name: "Needs review 1" })).toHaveAttribute("aria-pressed", "true"); const list = screen.getByRole("region", { name: "Response list" }); expect(within(list).getAllByRole("button", { name: "View full response" })).toHaveLength(1);
  fireEvent.click(within(list).getByRole("button", { name: "View full response" })); expect(screen.getByRole("region", { name: "Response details" })).toHaveTextContent("原独特回答 {count}");
  expect(review).not.toHaveBeenCalled(); expect(analysis).not.toHaveBeenCalled(); expect(boundary.download).not.toHaveBeenCalled();
});
it("retains the same selected response and authored exclusion input, then emits only canonical explicit review commands", () => {
  const original = response(), before = structuredClone(original); const { review, analysis } = showList([original]);
  fireEvent.click(screen.getByRole("button", { name: "查看完整答卷" })); const region = screen.getByRole("region", { name: "答卷详情" }); const reason = screen.getByRole("textbox", { name: "排除分析原因" }) as HTMLInputElement;
  fireEvent.change(reason, { target: { value: "  用户原理由 {count}  " } }); reason.focus(); reason.setSelectionRange(2, 7); language("en");
  expect(screen.getByRole("region", { name: "Response details" })).toBe(region); expect(screen.getByRole("textbox", { name: "Reason for exclusion" })).toBe(reason); expect(reason).toHaveFocus(); expect([reason.selectionStart, reason.selectionEnd]).toEqual([2, 7]); expect(reason).toHaveValue("  用户原理由 {count}  ");
  expect(region).toHaveTextContent(rawQuestion); expect(region).toHaveTextContent(rawAnswer); expect(review).not.toHaveBeenCalled(); expect(analysis).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Mark for review" })); expect(review).toHaveBeenCalledTimes(1); expect(review).toHaveBeenLastCalledWith(original.id, "review");
  fireEvent.click(screen.getByRole("button", { name: "Exclude from analysis" })); expect(analysis).toHaveBeenCalledTimes(1); expect(analysis).toHaveBeenLastCalledWith(original.id, "excluded", "用户原理由 {count}"); expect(original).toEqual(before);
});
it("retains pagination and selected raw row IDs across languages", () => {
  showList(Array.from({ length: 12 }, (_, index) => response({ id: `raw-response-${index}` })));
  fireEvent.click(screen.getByRole("button", { name: "下一页" })); const row = screen.getByRole("checkbox", { name: "选择答卷 raw-response-10" }); fireEvent.click(row); language("en");
  expect(screen.getByRole("checkbox", { name: "Select response raw-response-10" })).toBe(row); expect(row).toBeChecked(); expect(screen.getByText("2 / 2")).toBeVisible(); expect(screen.getByText("1 selected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Export selected Markdown" })).toBeEnabled();
});
it("retains raw exclusion history, actors and timestamps while displaying its fixed labels in English", () => {
  const original = response({ analysis: "excluded", exclusionReason: "原排除理由 {count}", analysisHistory: [{ analysis: "excluded", reason: "原历史理由 {name}", actor: "原操作者 {count}", changedAt: "2026-11-04T07:00:00.000Z" }] }); const before = structuredClone(original);
  showList([original]); fireEvent.click(screen.getByRole("button", { name: "查看完整答卷" })); language("en");
  const history = screen.getByRole("region", { name: "Analysis governance history" }); expect(history).toHaveTextContent("Excluded: 原历史理由 {name}"); expect(history).toHaveTextContent("原操作者 {count}"); expect(history).toHaveTextContent(new Date(original.analysisHistory![0]!.changedAt).toLocaleString("en"));
  expect(screen.getByRole("region", { name: "Response list" })).toHaveTextContent("Responses: 1");
  expect(screen.getByRole("region", { name: "Response details" })).toHaveTextContent("Reason for exclusion: 原排除理由 {count}"); expect(screen.getByRole("button", { name: "Include in analysis again" })).toBeEnabled(); expect(original).toEqual(before);
});
it("retains one pending attachment download and an unknown raw failure through language changes", async () => {
  const pending = deferred<void>(); boundary.download.mockReturnValueOnce(pending.promise); const file = { ...question, type: "file" as const }; showList([response({ answers: [{ questionId: "raw-q", value: ["raw-attachment"] }] })], [file]);
  fireEvent.click(screen.getByRole("button", { name: "查看完整答卷" })); fireEvent.click(screen.getByRole("button", { name: "下载附件 1" })); language("en");
  expect(screen.getByRole("button", { name: "Downloading…" })).toBeDisabled(); expect(boundary.download).toHaveBeenCalledTimes(1); expect(boundary.download).toHaveBeenLastCalledWith("raw-survey", "raw-response-0", "raw-attachment");
  await act(async () => pending.reject(new Error("原下载错误 {count} / constructor"))); expect(screen.getByRole("alert")).toHaveTextContent("原下载错误 {count} / constructor"); language("zh-CN"); language("en"); expect(boundary.download).toHaveBeenCalledTimes(1);
});
it("keeps a late download failure with its original response instead of showing it under a newly selected response", async () => {
  const pending = deferred<void>(); boundary.download.mockReturnValueOnce(pending.promise); const file = { ...question, type: "file" as const }, first = response({ answers: [{ questionId: "raw-q", value: ["raw-attachment"] }] }), next = response({ id: "raw-response-1", answers: [] });
  showList([first, next], [file]); fireEvent.click(screen.getAllByRole("button", { name: "查看完整答卷" })[0]!); fireEvent.click(screen.getByRole("button", { name: "下载附件 1" })); fireEvent.click(screen.getByRole("button", { name: "下一条答卷" }));
  await act(async () => pending.reject(new Error("原旧答卷下载失败 {count}"))); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  language("en"); expect(screen.getByRole("region", { name: "Response details" })).toHaveTextContent("raw-response-1"); fireEvent.click(screen.getByRole("button", { name: "Previous response" }));
  expect(screen.getByRole("alert")).toHaveTextContent("原旧答卷下载失败 {count}"); expect(boundary.download).toHaveBeenCalledTimes(1); expect(boundary.download).toHaveBeenLastCalledWith("raw-survey", first.id, "raw-attachment");
});
it.each([
  ["附件不存在或没有访问权限。", "The attachment does not exist or you do not have access."],
  ["登录已过期，请重新登录后下载。", "Your session has expired. Sign in again to download."],
  ["附件下载失败，请检查网络后重试。", "The attachment download failed. Check your connection and try again."],
])("renders known download errors in the current language without changing the source message: %s", async (source, en) => {
  const error = new Error(source); boundary.download.mockRejectedValueOnce(error); showList([response({ answers: [{ questionId: "raw-q", value: ["raw-attachment"] }] })], [{ ...question, type: "file" }]);
  fireEvent.click(screen.getByRole("button", { name: "查看完整答卷" })); await act(async () => fireEvent.click(screen.getByRole("button", { name: "下载附件 1" })));
  expect(screen.getByRole("alert")).toHaveTextContent(source); language("en"); expect(screen.getByRole("alert")).toHaveTextContent(en); expect(error.message).toBe(source); expect(boundary.download).toHaveBeenCalledTimes(1);
});
it("exports the same selected canonical Markdown bytes and filename in both languages", async () => {
  const descriptors = { create: Object.getOwnPropertyDescriptor(URL, "createObjectURL"), revoke: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL") };
  const blobs: Blob[] = [], filenames: string[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:raw-export"; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
  try {
    showList([response(), response({ id: "raw-response-1" })]); fireEvent.click(screen.getByRole("checkbox", { name: "选择答卷 raw-response-0" }));
    vi.useFakeTimers(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "导出所选 Markdown" })); }); act(() => vi.runAllTimers()); vi.useRealTimers(); language("en");
    expect(screen.getByRole("checkbox", { name: "Select response raw-response-0" })).toBeChecked();
    vi.useFakeTimers(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export selected Markdown" })); }); act(() => vi.runAllTimers()); vi.useRealTimers();
    const text = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob); });
    expect(blobs).toHaveLength(2); const actual = await Promise.all(blobs.map(text));
    expect(actual).toEqual(Array(2).fill("# 问卷答卷\n\n## 答卷 raw-response-0\n\n提交时间：2026-11-04T06:00:00.000Z\n\n用时：20 秒\n\n分析状态：纳入分析\n\n### 原问题 {count}\n\n原回答 {name}"));
    expect(filenames).toEqual(["survey-responses.md", "survey-responses.md"]);
  } finally {
    vi.useRealTimers();
    if (descriptors.create) Object.defineProperty(URL, "createObjectURL", descriptors.create); else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    if (descriptors.revoke) Object.defineProperty(URL, "revokeObjectURL", descriptors.revoke); else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
});
function reportBlock(patch: Partial<survey.CompiledSurveyBlock> = {}): survey.CompiledSurveyBlock {
  return { id: "raw-block", title: "原内容块 {count}", caption: "原图注 {name}", type: "table", questionIds: ["raw-q"], statistic: "mean", samplePolicy: "valid", sampleSize: 8, minGroupSize: 5, rows: [{ label: "原指标 {count}", value: 3.25, count: 8, target: 5, gap: -1.75 }], issues: [], ...patch };
}
function report(sample = 8): survey.CompiledSurveyReport {
  return { id: "raw-report", title: "原报告 {count}", issues: [], sampleSummary: { total: sample + 3, pendingReview: 2, excluded: 1, included: sample }, sections: [{ id: "raw-section", title: "原章节 {name}", analysis: [{ title: "原模型发现 {count}", evidence: "原模型证据 {name}", action: "原模型建议 {count}", blockIds: ["raw-block"] }], blocks: [reportBlock({ sampleSize: sample, rows: [{ label: "原指标 {count}", value: 3.25, count: sample, target: 5, gap: -1.75 }] })] }] };
}
it.each([
  [1, "Low sample notice", "Included responses: 1. These are descriptive results only", null],
  [3, "Low sample notice", "descriptive results only", null],
  [8, "Exploratory sample notice", "confidence is limited", "Suggested validation:"],
  [40, null, null, "Recommended action:"],
] as const)("retains the actual sample qualification and raw model text for %i included responses", (count, label, copy, action) => {
  const original = report(count), before = structuredClone(original); show(<SurveyReportDocument report={original} />);
  expect(screen.getByTestId("survey-report-sample-summary")).toHaveTextContent(`纳入分析 ${count}`); language("en");
  expect(screen.getByRole("heading", { name: "原报告 {count}" })).toBeVisible(); expect(screen.getByText("原模型证据 {name}")).toBeVisible();
  expect(screen.getByTestId("survey-report-sample-summary")).toHaveTextContent(`Included in analysis ${count}`);
  if (label) { const notice = screen.getByRole("status", { name: label }); expect(notice).toHaveTextContent(copy!); }
  else expect(screen.queryByRole("status")).not.toBeInTheDocument();
  if (action) { expect(screen.getByText(action)).toBeVisible(); expect(screen.getByText("原模型建议 {count}")).toBeVisible(); }
  else expect(screen.queryByText("原模型建议 {count}")).not.toBeInTheDocument();
  expect(original).toEqual(before);
});
it("uses the existing effective block sample to suppress action advice without rewriting the model output", () => {
  const original = report(40); original.sections[0]!.blocks[0]!.sampleSize = 3; original.sections[0]!.blocks[0]!.rows[0]!.count = 3; show(<SurveyReportDocument report={original} />); language("en");
  expect(screen.queryByText("原模型建议 {count}")).not.toBeInTheDocument(); expect(screen.getByText("原模型证据 {name}")).toBeVisible();
  expect(screen.getByTestId("survey-report-block-sample-raw-block")).toHaveTextContent("Normal-quality responses only · Actual sample size 3"); expect(original.sections[0]!.analysis![0]!.action).toBe("原模型建议 {count}");
});
it("translates table and gap chrome while retaining raw row labels, numbers and unknown data notes", () => {
  const original = report(); original.sections[0]!.blocks = [reportBlock({ type: "gap", issues: ["原模型说明 {count} / constructor"], rows: [{ label: "原指标 {count}", value: 3.25, count: 8, target: 5, gap: -1.75 }, { label: "原未设指标 {name}", value: 2, count: 8 }] })]; const before = structuredClone(original);
  show(<SurveyReportDocument report={original} />); language("en"); const table = screen.getByRole("table");
  for (const name of ["Metric", "Value", "Valid sample", "Target", "Gap"]) expect(within(table).getByRole("columnheader", { name })).toBeVisible();
  for (const value of ["原指标 {count}", "3.25", "5", "-1.75", "Not set", "Cannot calculate"]) expect(within(table).getByText(value)).toBeVisible();
  expect(screen.getByRole("list", { name: "Data notes" })).toHaveTextContent("原模型说明 {count} / constructor"); expect(original).toEqual(before);
});
it("retains an image load failure across locale changes without remounting or rewriting its raw caption", () => {
  const original = report(); original.sections[0]!.blocks = [reportBlock({ type: "image", imageUrl: "https://example.test/raw-image.png", rows: [] })]; show(<SurveyReportDocument report={original} />);
  fireEvent.error(screen.getByRole("img", { name: "原图注 {name}" })); expect(screen.getByRole("status", { name: "探索性样本说明" })).toBeVisible(); const failure = screen.getByText("图片加载失败，请检查图片地址后重试"); language("en");
  expect(screen.getByText("Image failed to load. Check the image URL and try again.")).toBe(failure); expect(screen.queryByRole("img", { name: "原图注 {name}" })).not.toBeInTheDocument(); expect(screen.getByText("原图注 {name}")).toBeVisible(); expect(original.sections[0]!.blocks[0]!.imageUrl).toBe("https://example.test/raw-image.png");
});
it("retains canonical report Markdown bytes independently of displayed locale", () => {
  const original: survey.CompiledSurveyReport = { id: "raw-report", title: "原报告 {count}", issues: [], sections: [{ id: "raw-section", title: "原章节 {name}", blocks: [reportBlock({ sampleSize: 8 })] }] };
  const expected = "# 原报告 {count}\n\n## 原章节 {name}\n\n### 原内容块 {count}\n\n实际样本量：8\n\n原图注 {name}\n\n- 原指标 {count}：3.25（样本 8）；目标 5 ；差距 -1.75\n";
  expect(surveyReportMarkdown(original)).toBe(expected); show(<SurveyReportDocument report={original} />); language("en");
  expect(screen.getByRole("columnheader", { name: "Metric" })).toBeVisible(); expect(surveyReportMarkdown(original)).toBe(expected);
});
it("localizes only the missing chart series name and keeps default export options and raw groups unchanged", () => {
  const original = reportBlock({ type: "line", rows: [{ label: "原横轴 {count}", value: 3.25, count: 8 }] }), before = structuredClone(original);
  expect(reportChartOptions(original)).toMatchObject({ series: [{ name: "数据", data: [3.25] }] });
  const english = reportChartOptions(original, "en");
  expect(english).toMatchObject({ series: [{ name: "数据", data: [3.25] }] });
  const formatter = (english.legend as { formatter?: unknown }).formatter;
  expect(formatter).toBeTypeOf("function");
  if (typeof formatter !== "function") throw new Error("Expected an English legend display formatter");
  expect(formatter("数据")).toBe("Data");
  const raw = reportChartOptions({ ...original, rows: [{ ...original.rows[0]!, group: "数据" }] }, "en");
  const rawFormatter = (raw.legend as { formatter?: unknown }).formatter;
  expect(raw).toMatchObject({ series: [{ name: "数据", data: [3.25] }] });
  expect(typeof rawFormatter === "function" ? rawFormatter("数据") : "数据").toBe("数据");
  expect(original).toEqual(before); expect(reportChartOptions(original)).toMatchObject({ series: [{ name: "数据", data: [3.25] }] });
});
