import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurveyCreateCommandSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { evaluateSurveyForPublish } from "@repo/contracts/survey-publish-readiness";
import type { SurveyPublishBlocker } from "@repo/contracts/survey";
import { serializeSurveyPublicationMarkdown } from "@repo/contracts/survey-source";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { ApiError } from "@/lib/api-client";
import { LiveSurveyWorkspace } from "@/components/survey/live/survey-workspace";
import { SurveyCollectionSettingsEditor } from "@/components/survey/live/collection-settings";
import { CollectionOverview, RecentCollectionActivity } from "@/components/survey/live/collection-overview";
import { SurveyDraftCopy } from "@/components/survey/live/survey-draft-copy";
import { SurveyShareCode } from "@/components/survey/live/share-code";
import { SurveyConflictError, SurveySystemError } from "@/lib/survey/runtime-client";

const boundary = vi.hoisted(() => ({ request: vi.fn(), router: { replace: vi.fn(), push: vi.fn() }, qr: vi.fn() }));
vi.mock("@/lib/survey/runtime-client", async original => ({ ...(await original<typeof import("@/lib/survey/runtime-client")>()), surveyRequest: boundary.request }));
vi.mock("next/navigation", () => ({ useRouter: () => boundary.router }));
vi.mock("qrcode", () => ({ default: { toDataURL: boundary.qr } }));

const now = Date.UTC(2026, 10, 4, 6);
const rawTitle = "原问卷 {count}";
const rawQuestion = "原问题 {name}";
function runtime(patch: Partial<SurveyRuntime> = {}): SurveyRuntime {
  return { id: "raw-survey", title: rawTitle, tags: ["原标签 {count}"], version: 4, status: "draft", anonymity: "anonymous",
    answerRevision: 0, reportBasisAnswerRevision: null, updatedAt: "2026-09-20T10:00:00.000Z",
    questions: [{ id: "raw-q", title: rawQuestion, type: "single", chapterId: "raw-chapter", order: 1, required: true, options: ["原甲 {count}", "Raw B"], config: { optionIds: ["raw-a", "raw-b"] } }],
    template: { id: "raw-template", title: "原报告 {name}", sections: [{ id: "raw-section", title: "原章节 {count}", blocks: [{ id: "raw-block", title: "原图表 {name}", type: "bar", questionIds: ["raw-q"], statistic: "distribution", samplePolicy: "valid", minGroupSize: 5 }] }] },
    responses: [], publication: null, report: null, reportBasisVersion: null, reportGeneratedAt: null, ...patch };
}
function published(patch: Partial<SurveyRuntime> = {}): SurveyRuntime {
  return runtime({ status: "collecting", version: 5, publication: { token: "old-token", version: 4, status: "collecting", expiresAt: "2026-12-20T10:00:00.000Z", questions: runtime().questions }, ...patch });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function show(children: React.ReactNode, locale: Locale = "zh-CN") { return render(<I18nProvider initialLocale={locale}><Driver />{children}</I18nProvider>); }
function language(locale: Locale) { act(() => setLocale(locale)); }
async function mount(step = "publish") { await act(async () => { show(<LiveSurveyWorkspace surveyId="raw-survey" initialStep={step} />); }); }
async function load(value = runtime(), step = "publish") { boundary.request.mockResolvedValueOnce(value); await mount(step); }
beforeEach(() => {
  boundary.request.mockReset(); boundary.router.replace.mockReset(); boundary.router.push.mockReset(); boundary.qr.mockReset();
  vi.useFakeTimers(); vi.setSystemTime(now); window.history.replaceState(null, "", "/studio/survey/raw-survey/design");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("translates a pending load without repeating GET or replacing the eventual authored draft", async () => {
  const result = deferred<SurveyRuntime>(); boundary.request.mockReturnValueOnce(result.promise); await mount();
  expect(screen.getByText("正在加载问卷…")).toBeVisible(); language("en");
  expect(screen.getByText("Loading survey…")).toBeVisible(); expect(boundary.request).toHaveBeenCalledTimes(1);
  await act(async () => result.resolve(runtime()));
  const field = screen.getByRole("textbox", { name: "Survey name" }); expect(field).toHaveValue(rawTitle);
  language("zh-CN"); expect(screen.getByRole("textbox", { name: "问卷名称" })).toBe(field);
  expect(boundary.request).toHaveBeenCalledTimes(1); expect(boundary.router.replace).not.toHaveBeenCalled();
});

it("keeps the original autosave debounce, pending write, raw source and current-language saved notice", async () => {
  await load(runtime(), "design"); const save = deferred<SurveyRuntime>(); boundary.request.mockReturnValueOnce(save.promise);
  const field = screen.getByRole("textbox", { name: "问卷名称" }) as HTMLInputElement;
  const title = "用户修改 {count}"; fireEvent.change(field, { target: { value: title } }); field.focus(); field.setSelectionRange(2, 6);
  act(() => vi.advanceTimersByTime(1000)); language("en");
  expect(screen.getByRole("textbox", { name: "Survey name" })).toBe(field); expect(field).toHaveFocus(); expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
  await act(async () => { vi.advanceTimersByTime(600); });
  expect(boundary.request).toHaveBeenCalledTimes(2);
  expect(boundary.request).toHaveBeenLastCalledWith("/surveys/raw-survey/source", { method: "PUT", body: { expectedVersion: 4, documents: expect.objectContaining({ design: expect.stringContaining(title), publication: "# 发布与回收\n" }) } }, expect.anything());
  expect(screen.getByRole("button", { name: "1. Design survey" })).toHaveAttribute("aria-current", "step");
  language("zh-CN"); language("en"); expect(boundary.request).toHaveBeenCalledTimes(2); expect(field).toHaveValue(title);
  await act(async () => save.resolve(runtime({ title, version: 5 })));
  expect(screen.getByRole("status")).toHaveTextContent("Changes saved"); language("zh-CN");
  expect(screen.getByRole("status")).toHaveTextContent("修改已保存"); expect(boundary.request).toHaveBeenCalledTimes(2);
});

it("retranslates a saved local error while retaining the same draft and retrying only explicitly", async () => {
  await load(runtime(), "design"); boundary.request.mockRejectedValueOnce(new SurveySystemError("请求未完成，请检查网络后重试。"));
  const field = screen.getByRole("textbox", { name: "问卷名称" }); fireEvent.change(field, { target: { value: "尚未保存 {count}" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "发布回收" })));
  expect(screen.getByRole("alert")).toHaveTextContent("请求未完成，请检查网络后重试。"); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("The request did not finish. Check your connection and try again.");
  expect(screen.getByRole("textbox", { name: "Survey name" })).toBe(field); expect(field).toHaveValue("尚未保存 {count}"); expect(boundary.request).toHaveBeenCalledTimes(2);
  const prior = structuredClone(boundary.request.mock.calls[1]![1].body);
  boundary.request.mockResolvedValueOnce(runtime({ title: "尚未保存 {count}", version: 5 }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry save" })));
  expect(boundary.request).toHaveBeenCalledTimes(3); expect(boundary.request.mock.calls[2]![1].body).toEqual(prior);
});

it.each([
  ["问卷不存在或没有访问权限。", "The survey does not exist or you do not have access."],
  ["服务返回了无法识别的数据，请刷新后重试。", "The service returned unrecognized data. Reload and try again."],
  ["问卷已关闭、已过期或题目已锁定。", "The survey is closed, expired, or its questions are locked."],
])("renders a known runtime error without changing its canonical message or retrying: %s", async (source, translated) => {
  const error = new SurveySystemError(source); boundary.request.mockRejectedValueOnce(error); await mount();
  expect(screen.getByRole("alert")).toHaveTextContent(source); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent(translated); expect(error.message).toBe(source); expect(error.retryable).toBe(true);
  expect(boundary.request).toHaveBeenCalledTimes(1);
});

it("keeps an unknown server diagnostic literal across locale changes", async () => {
  boundary.request.mockRejectedValueOnce(new Error("原服务信息 {count} / constructor")); await mount(); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("原服务信息 {count} / constructor"); expect(boundary.request).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "More actions" })).toBeEnabled();
});

it("preserves a conflict comparison and local draft, then uses the explicit selected version for the next save", async () => {
  await load(runtime(), "design"); boundary.request.mockRejectedValueOnce(new SurveyConflictError("SURVEY_VERSION_CONFLICT"));
  fireEvent.change(screen.getByRole("textbox", { name: "问卷名称" }), { target: { value: "本地 {count}" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "发布回收" })));
  expect(screen.getByRole("region", { name: "版本冲突处理" })).toBeVisible(); language("en");
  expect(screen.getByRole("region", { name: "Version conflict recovery" })).toBeVisible();
  boundary.request.mockResolvedValueOnce(runtime({ title: "远端 {count}", version: 9 }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read latest and keep my changes" })));
  const remote = screen.getByRole("textbox", { name: "Remote Markdown" }); expect(remote).toHaveProperty("value", expect.stringContaining("远端 {count}"));
  language("zh-CN"); language("en"); expect(screen.getByRole("textbox", { name: "Remote Markdown" })).toBe(remote);
  expect(screen.getByRole("textbox", { name: "Survey name" })).toHaveValue("本地 {count}"); expect(boundary.request).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole("button", { name: "Keep local version" })); expect(boundary.request).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("status")).toHaveTextContent("Local design and report template kept");
  boundary.request.mockResolvedValueOnce(runtime({ title: "本地 {count}", version: 10 }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish and collect" })));
  expect(boundary.request).toHaveBeenLastCalledWith("/surveys/raw-survey/source", expect.objectContaining({ body: expect.objectContaining({ expectedVersion: 9, documents: expect.objectContaining({ design: expect.stringContaining("本地 {count}") }) }) }), expect.anything());
});

it("retains schedule input and a single pending publish with unchanged canonical version and dates", async () => {
  await load(); const pending = deferred<SurveyRuntime>(); boundary.request.mockReturnValueOnce(pending.promise);
  const starts = screen.getByLabelText("开始时间"), expires = screen.getByLabelText("截止时间");
  fireEvent.change(starts, { target: { value: "2026-12-01T09:30" } }); fireEvent.change(expires, { target: { value: "2026-12-20T18:00" } }); language("en");
  expect(screen.getByLabelText("Start time")).toBe(starts); expect(starts).toHaveValue("2026-12-01T09:30"); expect(screen.getByLabelText("End time")).toBe(expires);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start collection" })));
  expect(boundary.request).toHaveBeenCalledTimes(2);
  expect(boundary.request).toHaveBeenLastCalledWith("/surveys/raw-survey/publish", { method: "POST", body: { expectedVersion: 4, startsAt: new Date("2026-12-01T09:30").toISOString(), expiresAt: new Date("2026-12-20T18:00").toISOString() } }, expect.anything());
  language("zh-CN"); language("en"); expect(boundary.request).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(published()));
  expect(screen.getByRole("textbox", { name: "Response link" })).toHaveProperty("value", expect.stringContaining("/surveys/old-token"));
  expect(screen.getByText("Published version v4")).toBeVisible(); expect(screen.getByRole("textbox", { name: "Survey name" })).toHaveValue(rawTitle);
});

it.each([
  ["2026-12-01T09:30", "2026-12-01T08:00", "截止时间必须晚于开始时间。", "End time must be after start time."],
  ["", "2025-12-01T08:00", "截止时间必须晚于当前时间。", "End time must be in the future."],
])("retranslates a schedule validation error and never publishes an invalid schedule: %s", async (start, end, source, translated) => {
  await load(); fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: start } }); fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: end } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "开始回收" })));
  expect(screen.getByRole("alert")).toHaveTextContent(source); language("en"); expect(screen.getByRole("alert")).toHaveTextContent(translated);
  expect(screen.getByLabelText("Start time")).toHaveValue(start); expect(screen.getByLabelText("End time")).toHaveValue(end); expect(boundary.request).toHaveBeenCalledTimes(1);
});

it("keeps the same published token and expiry timer across language changes", async () => {
  const initial = published(); initial.publication!.expiresAt = new Date(now + 3000).toISOString(); await load(initial);
  expect(screen.getByRole("heading", { name: "问卷正在回收中" })).toBeVisible(); const link = screen.getByRole("textbox", { name: "答题链接" });
  act(() => vi.advanceTimersByTime(1000)); language("en");
  expect(screen.getByRole("heading", { name: "Survey is collecting responses" })).toBeVisible();
  act(() => vi.advanceTimersByTime(2001)); expect(screen.getByRole("heading", { name: "Survey collection has ended" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Response link" })).toBe(link); expect(link).toHaveProperty("value", expect.stringContaining("/surveys/old-token"));
  expect(initial.publication!.version).toBe(4); expect(initial.anonymity).toBe("anonymous"); expect(boundary.request).toHaveBeenCalledTimes(1);
});

it("keeps a historical batch selection and raw old link read-only across language changes", async () => {
  const initial = published(); const live = { ...initial.publication!, id: "batch-live", createdAt: "2026-11-04T05:00:00.000Z", closedAt: null };
  const old = { ...live, id: "batch-old", token: "historical-token", status: "closed" as const, createdAt: "2026-10-01T05:00:00.000Z", closedAt: "2026-10-20T05:00:00.000Z" };
  await load({ ...initial, collectionBatches: [old, live], activeCollectionBatchId: "batch-live" });
  fireEvent.change(screen.getByRole("combobox", { name: "回收批次" }), { target: { value: "batch-old" } }); language("en");
  expect(screen.getByRole("combobox", { name: "Collection batch" })).toHaveValue("batch-old");
  expect(screen.getByText("Historical batch is read-only")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Response link" })).toHaveProperty("value", expect.stringContaining("/surveys/historical-token"));
  expect(screen.queryByRole("button", { name: "Stop collection" })).not.toBeInTheDocument(); expect(boundary.request).toHaveBeenCalledTimes(1);
});

it("uses a current-language stop confirmation and does not change the token or write on cancellation", async () => {
  await load(published()); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); language("en");
  fireEvent.click(screen.getByRole("button", { name: "Stop collection" })); expect(confirm).toHaveBeenLastCalledWith("Stop collecting and reject new responses?"); expect(boundary.request).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true); const closed = published({ status: "closed", version: 6 }); closed.publication!.status = "closed"; boundary.request.mockResolvedValueOnce(closed);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop collection" })));
  expect(boundary.request).toHaveBeenLastCalledWith("/surveys/raw-survey/close", { method: "POST", body: { expectedVersion: 5 } }, expect.anything());
  expect(screen.getByRole("textbox", { name: "Response link" })).toHaveProperty("value", expect.stringContaining("/surveys/old-token"));
});

it("keeps a template step and the raw report title without loading or saving on locale change", async () => {
  await load(runtime(), "template"); const field = screen.getByDisplayValue("原报告 {name}"); language("en");
  expect(screen.getByDisplayValue("原报告 {name}")).toBe(field); expect(screen.getByRole("button", { name: "1. Design survey" })).toHaveAttribute("aria-current", "step");
  expect(boundary.request).toHaveBeenCalledTimes(1); expect(boundary.router.push).not.toHaveBeenCalled();
});

const blockerCases: [SurveyPublishBlocker["code"], string, string, (value: SurveyRuntime) => SurveyRuntime][] = [
  ["QUESTIONS_EMPTY", "问卷至少需要一道题", "The survey needs at least one question.", value => ({ ...value, questions: [], template: { ...value.template, sections: [] } })],
  ["QUESTION_OPTIONS_EMPTY", "选项题必须包含有效选项", "Choice questions need valid options.", value => ({ ...value, questions: [{ ...value.questions[0]!, options: [], config: { optionIds: [] } }] })],
  ["QUESTION_CONFIG_INVALID", "题目配置不完整或无效", "Question configuration is incomplete or invalid.", value => ({ ...value, questions: [{ ...value.questions[0]!, config: { optionIds: ["raw-a", "raw-b"], step: 0 } }] })],
  ["MAPPING_INCOMPLETE", "报告章节尚未覆盖对应题目", "Report sections do not cover the corresponding questions.", value => ({ ...value, template: { ...value.template, sections: value.template.sections.map(section => ({ ...section, blocks: section.blocks.map(block => ({ ...block, questionIds: [] })) })) } })],
  ["LEADING_QUESTION", "题目措辞可能带有诱导性", "Question wording may be leading.", value => ({ ...value, questions: [{ ...value.questions[0]!, title: "显然这是原题 {count}" }] })],
  ["LOGIC_INVALID", "条件显示或跳转规则无效", "Conditional display or jump rules are invalid.", value => ({ ...value, questions: [{ ...value.questions[0]!, config: { optionIds: ["raw-a", "raw-b"], visibleWhen: [{ questionId: "missing-q", operator: "equals", value: "原条件 {count}" }] } }] })],
];
it.each(blockerCases)("renders actual %s publishing blockers without changing their score or authored data", async (code, source, translated, fixture) => {
  const initial = fixture(runtime()), before = structuredClone(initial);
  expect(evaluateSurveyForPublish(initial).some(blocker => blocker.code === code)).toBe(true);
  await load(initial, "design"); const checks = screen.getByRole("region", { name: "设计检查" }); expect(checks).toHaveTextContent(source);
  const numbers = screen.getByTestId("survey-design-readiness").textContent?.match(/\d+(?:\.\d+)?/g); language("en");
  expect(screen.getByRole("region", { name: "Design checks" })).toBe(checks); expect(checks).toHaveTextContent(translated);
  expect(screen.getByTestId("survey-design-readiness").textContent?.match(/\d+(?:\.\d+)?/g)).toEqual(numbers);
  expect(initial).toEqual(before); expect(screen.getByRole("textbox", { name: "Survey name" })).toHaveValue(rawTitle); expect(boundary.request).toHaveBeenCalledTimes(1);
});

it("keeps authored success Markdown and canonical publication enums while localizing collection controls", () => {
  const changed = vi.fn(), raw = "# 原成功页 {count}\n\n用户内容 {name}";
  function Editor() { const [markdown, setMarkdown] = React.useState(serializeSurveyPublicationMarkdown({ responseLimitScope: "none", successMessageMarkdown: raw })); return <SurveyCollectionSettingsEditor markdown={markdown} locked={false} onChange={next => { changed(next); setMarkdown(next); }} />; }
  show(<Editor />); const field = screen.getByRole("textbox", { name: "成功页 Markdown" }) as HTMLTextAreaElement; field.focus(); field.setSelectionRange(2, 6); language("en");
  expect(screen.getByRole("textbox", { name: "Success-page Markdown" })).toBe(field); expect(field).toHaveValue(raw); expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "One response per browser" }));
  expect(changed).toHaveBeenCalledWith(serializeSurveyPublicationMarkdown({ responseLimitScope: "browser", successMessageMarkdown: raw }));
});

it("keeps collection arithmetic and raw response IDs while localizing statistics and activity dates", () => {
  const initial = published(); initial.responses = [60, 120, 180].map((durationSeconds, index): SurveyRuntime["responses"][number] => ({ id: `raw-response-${index}`, role: "原角色", companySize: "原规模", quality: "normal", analysis: index === 2 ? "excluded" : "included", ...(index === 2 ? { exclusionReason: "原排除 {count}" } : {}), submittedAt: `2026-11-04T05:${index}0:00.000Z`, durationSeconds, answers: [{ questionId: "raw-q", value: "raw-a" }] }));
  show(<><CollectionOverview runtime={initial} /><RecentCollectionActivity runtime={initial} /></>); expect(screen.getByRole("region", { name: "回收数据" })).toHaveTextContent("2分0秒"); language("en");
  const stats = screen.getByRole("region", { name: "Collection data" }); expect(stats).toHaveTextContent("Responses received"); expect(stats).toHaveTextContent("Valid responses"); expect(stats).toHaveTextContent("2m 0s");
  expect(within(stats).getByText("3")).toBeVisible(); expect(within(stats).getByText("2")).toBeVisible();
  expect(screen.getByRole("region", { name: "Recent collection activity" })).toHaveTextContent("raw-response-2");
  expect(screen.getByText(new Date(initial.responses[2]!.submittedAt).toLocaleString("en"))).toHaveAttribute("dateTime", initial.responses[2]!.submittedAt);
});

it("retains a pending QR generation and its raw link and download filename across locale changes", async () => {
  const pending = deferred<string>(); boundary.qr.mockReturnValueOnce(pending.promise); const link = "https://example.test/surveys/raw-token"; show(<SurveyShareCode link={link} />);
  fireEvent.click(screen.getByRole("button", { name: "生成二维码" })); language("en"); expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled(); expect(boundary.qr).toHaveBeenCalledTimes(1);
  const image = "data:image/png;base64,iVBORw0KGgo="; await act(async () => pending.resolve(image));
  expect(screen.getByRole("img", { name: "Survey sharing QR code" })).toHaveAttribute("src", image);
  expect(screen.getByRole("link", { name: "Download QR code" })).toHaveAttribute("download", "survey-qr.png");
  expect(boundary.qr).toHaveBeenCalledWith(link, { errorCorrectionLevel: "M", margin: 4, width: 256 }); language("zh-CN"); expect(boundary.qr).toHaveBeenCalledTimes(1);
});

it("retranslates a QR failure without automatically regenerating or exposing the raw link to another service", async () => {
  boundary.qr.mockRejectedValueOnce(new Error("raw qr failure")); show(<SurveyShareCode link="https://example.test/surveys/raw-token" />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "生成二维码" })));
  expect(screen.getByRole("alert")).toHaveTextContent("二维码生成失败，请重试。"); language("en"); expect(screen.getByRole("alert")).toHaveTextContent("QR code generation failed. Try again.");
  expect(boundary.qr).toHaveBeenCalledTimes(1);
});

it("keeps an open copy dialog and copies only the raw frozen publication into one independent bounded-title draft", async () => {
  const original = published({ title: "原".repeat(194) + "{x}" }); original.questions = [{ ...original.questions[0]!, title: "后续草稿原题" }];
  const before = structuredClone(original), pending = deferred<SurveyRuntime>(), created = vi.fn(); boundary.request.mockReturnValueOnce(pending.promise);
  show(<SurveyDraftCopy runtime={original} onCreated={created} />); fireEvent.click(screen.getByRole("button", { name: "复制为新草稿" }));
  const dialog = screen.getByRole("dialog"); language("en"); expect(screen.getByRole("dialog", { name: "Create a new draft from a published survey" })).toBe(dialog);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm new draft" })));
  expect(boundary.request).toHaveBeenCalledTimes(1); const body = boundary.request.mock.calls[0]![1].body;
  expect(SurveyCreateCommandSchema.safeParse(body).success).toBe(true); expect(body.draft.title).toHaveLength(200); expect(body.draft.title).toMatch(/ \(new draft\)$/);
  expect(body).toMatchObject({ anonymity: "anonymous", draft: { tags: original.tags, questions: original.publication!.questions, template: original.template } });
  expect(body.draft.questions).not.toBe(original.publication!.questions); expect(body.draft).not.toHaveProperty("responses"); expect(body.draft).not.toHaveProperty("publication");
  language("zh-CN"); language("en"); expect(boundary.request).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled(); expect(original).toEqual(before);
  await act(async () => pending.resolve(runtime({ id: "new-draft" }))); expect(created).toHaveBeenCalledWith("new-draft");
});

it("shows the shared permission guidance for a wrapped 403 without exposing diagnostics or retrying", async () => {
  const cause = new ApiError(403, "PRIVATE_UNKNOWN_REASON", { error: "private-server-detail" });
  const error = new SurveySystemError("请求未完成，请检查网络后重试。");
  Object.defineProperty(error, "cause", { value: cause });
  boundary.request.mockRejectedValueOnce(error); await mount();
  expect(screen.getByRole("alert")).toHaveTextContent("你没有权限执行此操作，如需访问请联系管理员");
  language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("You do not have permission to perform this action. Contact your administrator if you need access.");
  expect(screen.getByRole("alert")).not.toHaveTextContent(/PRIVATE_UNKNOWN_REASON|private-server-detail|expired/i);
  expect(error.message).toBe("请求未完成，请检查网络后重试。"); expect(error.retryable).toBe(true);
  expect(boundary.request).toHaveBeenCalledTimes(1); expect(error.cause).toBe(cause);
});

it("creates direct-new-route title defaults once in the entry locale and preserves edits across language changes", async () => {
  await act(async () => { show(<LiveSurveyWorkspace surveyId="new" initialStep="template" />, "en"); });
  const name = screen.getByRole("textbox", { name: "Survey name" });
  const report = screen.getByRole("textbox", { name: "Report title" });
  expect(name).toHaveValue("Untitled survey"); expect(report).toHaveValue("Survey analysis report");
  fireEvent.change(name, { target: { value: "原新问卷 {count}" } });
  fireEvent.change(report, { target: { value: "原新报告 {name}" } });
  report.focus(); (report as HTMLInputElement).setSelectionRange(1, 4);
  language("zh-CN"); expect(screen.getByRole("textbox", { name: "问卷名称" })).toBe(name); expect(name).toHaveValue("原新问卷 {count}");
  expect(screen.getByRole("textbox", { name: "报告标题" })).toBe(report); expect(report).toHaveValue("原新报告 {name}"); expect(report).toHaveFocus();
  expect([(report as HTMLInputElement).selectionStart, (report as HTMLInputElement).selectionEnd]).toEqual([1, 4]);
  language("en"); expect(boundary.request).not.toHaveBeenCalled();
});
it("creates the direct-new import Markdown default in the entry locale without rewriting its raw text on a later switch", async () => {
  await act(async () => { show(<LiveSurveyWorkspace surveyId="new" initialStep="import" creationMode="ai" />, "en"); });
  fireEvent.click(screen.getByText("Edit Markdown directly (optional)", { exact: true }));
  const editor = screen.getByRole("textbox", { name: "Survey Markdown" });
  expect(editor).toHaveValue("# Untitled survey\n\n## q1 [open]\nPlease share your feedback\n");
  const raw = "# 原自写问卷 {count}\n\n## raw [open]\n原自写问题 {name}\n";
  fireEvent.change(editor, { target: { value: raw } }); language("zh-CN");
  expect(screen.getByRole("textbox", { name: "问卷 Markdown" })).toBe(editor); expect(editor).toHaveValue(raw);
  language("en"); expect(editor).toHaveValue(raw); expect(boundary.request).not.toHaveBeenCalled();
});
