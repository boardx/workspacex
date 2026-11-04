import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { SurveyImportWorkspace } from "@/components/survey/live/survey-import-workspace";
import { SurveyAiProposal } from "@/components/survey/live/ai-proposal";

const request = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const recordings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("@/lib/live-personal-transcriptions", () => ({ listPersonalTranscriptions: recordings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const rawText = "原始需求 {count}\nCustomer feedback.";
const markdown = "# 原始标题 {count}\n\n## raw [open]\n原始题干 {name}?\n";
const proposal = {
  markdown,
  execution: { id: "85f6e172-8b43-4a75-a917-0e91742d1e8c", provider: "configured", modelId: "raw-model", generatedAt: "2026-11-04T00:00:00.000Z" },
  source: { kind: "text", sha256: "a".repeat(64) },
};
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function show(children: React.ReactNode, locale: Locale = "zh-CN") {
  return render(<I18nProvider initialLocale={locale}><Driver />{children}</I18nProvider>);
}
function language(locale: Locale) { act(() => setLocale(locale)); }
beforeEach(() => { request.mockReset(); replace.mockReset(); recordings.mockReset(); sessionStorage.clear(); localStorage.clear(); });
afterEach(cleanup);

it("translates invalid creation-draft recovery without sending any request", () => {
  show(<SurveyImportWorkspace draft={null} projectId={null} />, "en");
  expect(screen.getByRole("alert")).toHaveTextContent("Import details are invalid. Return to the survey list and create again.");
  fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
  expect(replace).toHaveBeenCalledWith("/studio/survey");
  expect(request).not.toHaveBeenCalled();
});

it("keeps the intake draft and creation steps across locale changes without creating a survey", () => {
  show(<SurveyImportWorkspace draft={{ name: "原始 survey {count}", tags: ["原标签"] }} projectId="raw/project" />);
  const input = screen.getByRole("textbox", { name: "问卷需求" });
  fireEvent.change(input, { target: { value: rawText } }); language("en");
  expect(screen.getByRole("heading", { name: "Create survey" })).toBeVisible();
  const nav = screen.getByRole("navigation", { name: "Survey creation steps" });
  expect(nav).toHaveTextContent("Import content");
  expect(nav).toHaveTextContent("Design survey");
  expect(nav).toHaveTextContent("Publish and collect");
  expect(nav).toHaveTextContent("View responses");
  expect(screen.getByRole("textbox", { name: "Survey requirements" })).toBe(input);
  expect(input).toHaveValue(rawText);
  expect(screen.getByText("原始 survey {count}")).toBeVisible();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to surveys" }));
  expect(replace).toHaveBeenCalledWith("/studio/survey?projectId=raw%2Fproject");
});

it("preserves a pending proposal request, then rejects its cancelled late result after locale changes", async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  show(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "问卷需求" });
  fireEvent.change(input, { target: { value: rawText } });
  fireEvent.click(screen.getByRole("button", { name: "生成问卷" })); language("en");
  expect(screen.getByRole("textbox", { name: "Survey requirements" })).toBe(input);
  expect(input).toHaveValue(rawText);
  expect(input).toBeDisabled();
  expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![0]).toBe("/surveys/markdown-proposals");
  expect(request.mock.calls[0]![1].body).toEqual({ text: rawText });
  const signal = request.mock.calls[0]![1].signal as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Cancel generation" }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(proposal));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(input).toHaveValue(rawText);
  expect(screen.getByRole("button", { name: "Generate survey" })).toBeEnabled();
});

it("keeps corrected model Markdown and the same modal/editor until explicit application", async () => {
  request.mockResolvedValue(proposal); const apply = vi.fn();
  show(<SurveyAiProposal locked={false} onApply={apply} storageKey="raw-storage-identity" />);
  fireEvent.change(screen.getByRole("textbox", { name: "问卷需求" }), { target: { value: rawText } });
  fireEvent.click(screen.getByRole("button", { name: "生成问卷" }));
  const editor = await screen.findByRole("textbox", { name: "AI 提案 Markdown" });
  const dialog = screen.getByRole("dialog");
  const edited = markdown.replace("原始题干", "用户修订题干");
  fireEvent.change(editor, { target: { value: edited } }); language("en");
  expect(screen.getByRole("heading", { name: "Markdown preview and review" })).toBeVisible();
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("textbox", { name: "AI proposal Markdown" })).toBe(editor);
  expect(editor).toHaveValue(edited);
  expect(within(dialog).getByRole("heading", { name: "原始标题 {count}" })).toBeVisible();
  expect(dialog).toHaveTextContent("用户修订题干 {name}?");
  expect(dialog).toHaveTextContent("configured / raw-model");
  expect(apply).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
  const stored = JSON.parse(sessionStorage.getItem("raw-storage-identity")!);
  expect(stored.text).toBe(rawText); expect(stored.markdown).toBe(edited);
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply to survey" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith(edited));
  expect(request).toHaveBeenCalledTimes(1);
});

it("retains an uploaded file and original demand across locale changes and removes only that file", async () => {
  request.mockImplementation(() => new Promise(() => {}));
  show(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "问卷需求" }), { target: { value: rawText } });
  fireEvent.change(screen.getByLabelText("上传问卷文件"), { target: { files: [new File(["文件原文"], "原文件 {count}.txt")] } });
  await screen.findByRole("button", { name: "移除文件 原文件 {count}.txt" }); language("en");
  expect(screen.getByRole("button", { name: "Remove file 原文件 {count}.txt" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Survey requirements" })).toHaveValue(rawText);
  expect(screen.getByRole("button", { name: "Add file" })).toHaveAttribute("title", "Markdown, TXT, PDF and DOCX, up to 256 KB");
  fireEvent.click(screen.getByRole("button", { name: "Remove file 原文件 {count}.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate survey" }));
  expect(request.mock.calls[0]![1].body).toEqual({ text: rawText });
});

it("keeps an idle saved recording selected by raw name without reloading it on locale change", async () => {
  recordings.mockResolvedValue({ items: [{ sessionId: "voice-raw", name: "原录音 {count}", tags: [], status: "idle", durationMs: 1500, createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z" }], nextCursor: null });
  request.mockImplementation(() => new Promise(() => {}));
  show(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择已保存录音" }));
  fireEvent.click(await screen.findByRole("button", { name: "原录音 {count}" })); language("en");
  expect(screen.getByRole("button", { name: "Choose saved recording" })).toBeEnabled();
  expect(screen.getByText("原录音 {count}")).toBeVisible();
  expect(recordings).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Generate survey" }));
  expect(request.mock.calls[0]![1].body).toEqual({ text: "", transcriptionId: "voice-raw" });
});

it("retranslates an existing local file-limit error without reading or submitting the file", () => {
  show(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("上传问卷文件"), { target: { files: [new File([new Uint8Array(262145)], "原文件.md")] } });
  expect(screen.getByRole("alert")).toHaveTextContent("文件不能超过 256 KB。"); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Files must be 256 KB or smaller.");
  expect(screen.getByRole("button", { name: "Generate survey" })).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
});
