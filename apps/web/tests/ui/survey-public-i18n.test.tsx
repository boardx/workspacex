import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { survey } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { PublicSurveyForm } from "@/components/survey/live/public-survey-form";
import { SurveySystemError } from "@/lib/survey/runtime-client";
const boundary = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/survey/runtime-client", async original => ({ ...(await original<typeof import("@/lib/survey/runtime-client")>()), surveyRequest: boundary.request }));
const rawTitle = "原公开问卷 {count}", rawQuestion = "原问题 {name}";
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function language(locale: Locale) { act(() => setLocale(locale)); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function question(patch: Partial<survey.SurveyWorkflowQuestion> = {}): survey.SurveyWorkflowQuestion {
  return { id: "raw-q", title: rawQuestion, type: "open", chapterId: "raw-chapter", order: 1, required: true, options: [], ...patch };
}
function published(questions = [question()]) { return { id: "raw-survey", title: rawTitle, version: 7, expiresAt: "2026-12-20T10:00:00.000Z", questions }; }
async function mount() { let view!: ReturnType<typeof render>; await act(async () => { view = render(<I18nProvider initialLocale="zh-CN"><Driver /><PublicSurveyForm token="raw-token" /></I18nProvider>); }); return view; }
async function load(value: ReturnType<typeof published> & { alreadySubmitted?: boolean; successMessageMarkdown?: string } = published()) { boundary.request.mockResolvedValueOnce(value); return mount(); }
let clock = 100_000;
beforeEach(() => { boundary.request.mockReset(); boundary.fetch.mockReset(); clock = 100_000; vi.spyOn(Date, "now").mockImplementation(() => clock); vi.stubGlobal("fetch", boundary.fetch); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("provides the shared language control during one pending anonymous token load", async () => {
  const pending = deferred<ReturnType<typeof published>>(); boundary.request.mockReturnValueOnce(pending.promise); await mount();
  expect(screen.getByText("正在加载…")).toBeVisible(); const switcher = screen.getByTestId("language-switcher");
  fireEvent.change(switcher, { target: { value: "en" } }); expect(screen.getByText("Loading…")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Language" })).toBe(switcher); expect(boundary.request).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(published())); expect(screen.getByRole("heading", { name: rawTitle })).toBeVisible();
  expect(boundary.request).toHaveBeenCalledWith("/public/surveys/raw-token", { sessionToken: null });
});
it("retains authored answers, focus, selection and pagination without writes on locale changes", async () => {
  await load(published([question(), question({ id: "break", type: "page_break", title: "原分页", order: 2, required: false }), question({ id: "last", title: "原末题 {count}", type: "single", order: 3, options: ["原选项 {name}", "Raw B"], config: { optionIds: ["a", "b"] } })]));
  const field = screen.getByRole("textbox", { name: rawQuestion }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "原回答 {count}" } }); field.focus(); field.setSelectionRange(2, 6); language("en");
  expect(screen.getByRole("textbox", { name: rawQuestion })).toBe(field); expect(field).toHaveFocus(); expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
  expect(screen.getByText("Page 1 / 2")).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  const option = screen.getByRole("radio", { name: "原选项 {name}" }); fireEvent.click(option); language("zh-CN"); language("en");
  expect(screen.getByText("Page 2 / 2")).toBeVisible(); expect(screen.getByRole("radio", { name: "原选项 {name}" })).toBe(option); expect(option).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Previous page" })); expect(screen.getByRole("textbox", { name: rawQuestion })).toHaveValue("原回答 {count}"); expect(boundary.request).toHaveBeenCalledTimes(1);
});
it("keeps a rejected submission and one pending explicit retry with the same identity and raw answers", async () => {
  await load(); fireEvent.change(screen.getByRole("textbox", { name: rawQuestion }), { target: { value: "用户原答案 {count}" } });
  boundary.request.mockRejectedValueOnce(new Error("原服务失败 {name} / constructor")); clock += 2400;
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "提交答卷" })));
  expect(screen.getByRole("alert")).toHaveTextContent("原服务失败 {name} / constructor"); const first = structuredClone(boundary.request.mock.calls[1]![1].body);
  language("en"); expect(screen.getByRole("textbox", { name: rawQuestion })).toHaveValue("用户原答案 {count}"); expect(boundary.request).toHaveBeenCalledTimes(2);
  const pending = deferred<unknown>(); boundary.request.mockReturnValueOnce(pending.promise); clock += 3100;
  fireEvent.click(screen.getByRole("button", { name: "Submit response" })); language("zh-CN"); language("en");
  expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled(); expect(boundary.request).toHaveBeenCalledTimes(3);
  const retry = boundary.request.mock.calls[2]![1].body;
  expect(retry.submissionId).toBe(first.submissionId); expect(retry.answers).toEqual([{ questionId: "raw-q", value: "用户原答案 {count}" }]); expect(first.durationSeconds).toBe(2); expect(retry.durationSeconds).toBe(5);
  await act(async () => pending.resolve({ accepted: true })); expect(screen.getByRole("status")).toHaveTextContent("Submitted successfully. Thank you for participating."); language("zh-CN"); expect(screen.getByRole("status")).toHaveTextContent("提交成功，感谢您的参与。"); expect(boundary.request).toHaveBeenCalledTimes(3);
});
it("retains raw frozen success Markdown and an already-submitted state while controls change language", async () => {
  await load({ ...published(), alreadySubmitted: true, successMessageMarkdown: "# 原成功标题 {count}\n\n原消息 {name}" });
  const status = screen.getByRole("status"); language("en"); expect(screen.getByRole("status")).toBe(status); expect(status).toHaveTextContent("原成功标题 {count}"); expect(status).toHaveTextContent("原消息 {name}");
  expect(screen.queryByRole("button", { name: "Submit response" })).not.toBeInTheDocument(); expect(screen.getByTestId("language-switcher")).toBeVisible(); expect(boundary.request).toHaveBeenCalledTimes(1);
});
it("retranslates the known closed-token failure without loading another publication or exposing a submit action", async () => {
  const error = new SurveySystemError("问卷已关闭、已过期或题目已锁定。"); boundary.request.mockRejectedValueOnce(error); await mount(); expect(screen.getByRole("alert")).toHaveTextContent(error.message); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("The survey is closed, expired, or its questions are locked."); expect(error.message).toBe("问卷已关闭、已过期或题目已锁定。"); expect(boundary.request).toHaveBeenCalledTimes(1); expect(screen.queryByRole("button", { name: "Submit response" })).not.toBeInTheDocument();
});
it("retains the original raw matrix-row focus target while translating validation after calculation", async () => {
  await load(published([question({ type: "matrix_input", config: { rows: [{ id: "filled", label: "原行 {count}", required: true }, { id: "missing", label: "需填原行 {name}", required: true }] } })]));
  fireEvent.change(screen.getByRole("textbox", { name: `${rawQuestion}：原行 {count}` }), { target: { value: "原值 {x}" } });
  const focus = vi.spyOn(HTMLElement.prototype, "focus"), scroll = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const target = document.getElementById("answer-raw-q-missing")!; expect(target).not.toBeNull(); target.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("button", { name: "提交答卷" })); expect(screen.getByText("需填原行 {name}尚未填写")).toBeVisible(); expect(target).toHaveFocus(); const calls = focus.mock.calls.length;
  language("en"); expect(screen.getByText("需填原行 {name} is required.")).toBeVisible(); expect(target).toHaveFocus(); expect(focus).toHaveBeenCalledTimes(calls); expect(scroll).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert")).toHaveTextContent("Check the marked required questions or format errors. Your answers are retained."); expect(boundary.request).toHaveBeenCalledTimes(1);
});
it("shares one pending upload session across two files and retains session, file bytes and submission identity on locale changes", async () => {
  await load(published([question({ id: "file-a", title: "原附件甲 {count}", type: "file", config: { maxFiles: 2 } }), question({ id: "file-b", title: "原附件乙 {name}", type: "file", order: 2, config: { maxFiles: 2 } })]));
  const pending = deferred<{ uploadSessionToken: string }>(), first = deferred<Response>(), second = deferred<Response>();
  boundary.request.mockReturnValueOnce(pending.promise); boundary.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const files = [new File(["raw-first {count}"], "原文件甲.txt", { type: "text/plain" }), new File(["raw-second {name}"], "原文件乙.txt", { type: "text/plain" })];
  const inputs = screen.getAllByLabelText("选择文件"); fireEvent.change(inputs[0]!, { target: { files: [files[0]!] } }); fireEvent.change(inputs[1]!, { target: { files: [files[1]!] } });
  expect(boundary.request).toHaveBeenCalledTimes(2); const sessionBody = structuredClone(boundary.request.mock.calls[1]![1].body);
  language("en"); expect(screen.getAllByLabelText("Choose file")[0]).toBe(inputs[0]); expect(screen.getByRole("button", { name: "Submit response" })).toBeDisabled(); expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.request).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve({ uploadSessionToken: "raw-upload-session" })); expect(boundary.fetch).toHaveBeenCalledTimes(2);
  for (const [index, id] of ["file-a", "file-b"].entries()) {
    const [url, options] = boundary.fetch.mock.calls[index]!; expect(url).toContain(`/public/surveys/raw-token/upload-sessions/raw-upload-session/questions/${id}/attachments`); expect(options.method).toBe("POST");
    const file = options.body.get("file") as File; expect(file.name).toBe(files[index]!.name); expect(file.size).toBe(files[index]!.size);
  }
  language("zh-CN"); language("en"); await act(async () => first.resolve(new Response(JSON.stringify({ attachmentId: "attachment-a", name: files[0]!.name }))));
  expect(screen.getByRole("button", { name: "Submit response" })).toBeDisabled(); await act(async () => second.resolve(new Response(JSON.stringify({ attachmentId: "attachment-b", name: files[1]!.name }))));
  expect(screen.getByText(files[0]!.name)).toBeVisible(); expect(screen.getByText(files[1]!.name)).toBeVisible();
  const submission = deferred<unknown>(); boundary.request.mockReturnValueOnce(submission.promise); fireEvent.click(screen.getByRole("button", { name: "Submit response" })); language("zh-CN"); language("en");
  expect(boundary.request).toHaveBeenCalledTimes(3); expect(boundary.request.mock.calls[2]![1].body).toMatchObject({ submissionId: sessionBody.submissionId, uploadSessionToken: "raw-upload-session", answers: [{ questionId: "file-a", value: ["attachment-a"] }, { questionId: "file-b", value: ["attachment-b"] }] });
  expect(boundary.fetch).toHaveBeenCalledTimes(2); await act(async () => submission.resolve({ accepted: true })); expect(screen.getByRole("status")).toHaveTextContent("Submitted successfully");
});
it("retains the pending File after a failed upload session and retries only explicitly with the same submission identity", async () => {
  await load(published([question({ type: "file", config: { maxFiles: 1 } })]));
  boundary.request.mockRejectedValueOnce(new Error("fake-private-upload-diagnostic"));
  const file = new File(["原文件字节 {count}"], "原待重试文件.txt", { type: "text/plain" }), input = screen.getByLabelText("选择文件");
  await act(async () => fireEvent.change(input, { target: { files: [file] } }));
  expect(screen.getByRole("alert")).toHaveTextContent("上传失败，文件尚未提交。请重试。");
  const first = boundary.request.mock.calls[1]![1].body; language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Upload failed. The file has not been submitted. Try again."); expect(screen.getByRole("alert")).not.toHaveTextContent("fake-private-upload-diagnostic");
  expect(screen.getByLabelText("Choose file")).toBe(input); expect(boundary.request).toHaveBeenCalledTimes(2); expect(boundary.fetch).not.toHaveBeenCalled();
  boundary.request.mockResolvedValueOnce({ uploadSessionToken: "raw-retry-session" }); boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ attachmentId: "raw-attachment", name: file.name })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry upload" })));
  expect(boundary.request).toHaveBeenCalledTimes(3); expect(boundary.request.mock.calls[2]![1].body.submissionId).toBe(first.submissionId);
  expect(boundary.fetch).toHaveBeenCalledTimes(1); const retryFile = boundary.fetch.mock.calls[0]![1].body.get("file") as File; expect(retryFile.name).toBe(file.name); expect(retryFile.size).toBe(file.size);
  expect(screen.getByText(file.name)).toBeVisible(); language("zh-CN"); language("en"); expect(boundary.request).toHaveBeenCalledTimes(3);
});
it("retains one pending attachment deletion and its original upload session while the language changes", async () => {
  await load(published([question({ type: "file", config: { maxFiles: 1 } })]));
  boundary.request.mockResolvedValueOnce({ uploadSessionToken: "raw-upload-session" }); const file = new File(["原文件字节"], "原已上传文件.txt", { type: "text/plain" });
  boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ attachmentId: "raw-attachment", name: file.name })));
  await act(async () => fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [file] } })); expect(screen.getByText(file.name)).toBeVisible();
  const pending = deferred<unknown>(); boundary.request.mockReturnValueOnce(pending.promise); const remove = screen.getByRole("button", { name: "删除材料" });
  await act(async () => fireEvent.click(remove)); language("en"); expect(screen.getByRole("button", { name: "Delete material" })).toBe(remove); expect(remove).toBeDisabled(); expect(screen.getByText(file.name)).toBeVisible();
  expect(boundary.request).toHaveBeenCalledTimes(3); expect(boundary.request).toHaveBeenLastCalledWith("/public/surveys/raw-token/upload-sessions/raw-upload-session/questions/raw-q/attachments/raw-attachment", { method: "DELETE", sessionToken: null });
  language("zh-CN"); language("en"); expect(boundary.request).toHaveBeenCalledTimes(3); await act(async () => pending.resolve({}));
  expect(screen.queryByText(file.name)).not.toBeInTheDocument(); expect(screen.getByLabelText("Choose file")).toBeEnabled(); expect(boundary.fetch).toHaveBeenCalledTimes(1); expect(boundary.request).toHaveBeenCalledTimes(3);
});
