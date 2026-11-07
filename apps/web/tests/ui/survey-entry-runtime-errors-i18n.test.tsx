import { SurveyMarkdownProposalSchema } from "@repo/contracts/survey-markdown-proposal";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurveyDraftInputSchema, SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { ApiError } from "@/lib/api-client";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { httpFailureText } from "@/lib/http-failure-text";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { SurveyConflictError, SurveySystemError } from "@/lib/survey/runtime-client";
import { LiveSurveyLibrary } from "@/components/survey/live/survey-library";
import { CreateSurveyDialog } from "@/components/survey/live/create-survey-dialog";
import { SurveyImportWorkspace } from "@/components/survey/live/survey-import-workspace";
const request = vi.hoisted(() => vi.fn());
const link = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/survey/runtime-client")>(), surveyRequest: request }));
vi.mock("@/lib/live-personal-transcriptions", () => ({ listPersonalTranscriptions: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/live-project-resources", () => ({ linkProjectResource: link }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
beforeEach(() => { request.mockReset(); link.mockReset(); sessionStorage.clear(); localStorage.clear(); });
afterEach(cleanup);
const cases = (["library", "create", "template-load", "import-apply"] as const).flatMap(surface => (["conflict", "forbidden"] as const).map(kind => ({ surface, kind })));
it.each(cases)("retains $kind semantics and raw state at the real $surface entry without locale-triggered requests", async ({ surface, kind }) => {
  const error = kind === "conflict" ? new SurveyConflictError(null) : new SurveySystemError(surveyRuntimeMessages.network, { cause: new ApiError(403, "RAW_PERMISSION_CODE", {}) });
  const raw = "原入口标题 {count}", markdown = "# 原标题 {count}\n\n## raw [open]\n原问题 {name}?\n", onCreated = vi.fn();
  if (surface === "import-apply") request.mockResolvedValueOnce({ markdown, execution: { id: "85f6e172-8b43-4a75-a917-0e91742d1e8c", provider: "configured", modelId: "raw-model", generatedAt: "2026-11-04T00:00:00.000Z" }, source: { kind: "text", sha256: "a".repeat(64) } }).mockRejectedValueOnce(error);
  else request.mockRejectedValueOnce(error);
  const component = surface === "library" ? <LiveSurveyLibrary projectId={null} /> : surface === "import-apply" ? <SurveyImportWorkspace draft={{ name: raw, tags: ["原标签 {name}"] }} projectId={null} /> : <CreateSurveyDialog open onOpenChange={vi.fn()} onCreated={onCreated} />;
  render(<I18nProvider initialLocale="zh-CN"><Driver />{component}</I18nProvider>);
  if (surface === "create" || surface === "template-load") { fireEvent.change(screen.getByRole("textbox", { name: "问卷名称" }), { target: { value: raw } }); if (surface === "template-load") fireEvent.click(screen.getByRole("radio", { name: /从模板创建/ })); else fireEvent.click(screen.getByRole("button", { name: "下一步" })); }
  if (surface === "import-apply") { fireEvent.change(screen.getByRole("textbox", { name: "问卷需求" }), { target: { value: "原研究需求 {count}" } }); fireEvent.click(screen.getByRole("button", { name: "生成问卷" })); await screen.findByRole("textbox", { name: "AI 提案 Markdown" }); fireEvent.click(screen.getByRole("button", { name: "应用到问卷" })); }
  await screen.findAllByRole("alert"); const count = request.mock.calls.length; act(() => setLocale("en")); const expected = kind === "conflict" ? "The data has changed. Refresh and try again. Your unsaved changes are retained." : httpFailureText(403, "en");
  for (const alert of screen.getAllByRole("alert")) { expect(alert).toHaveTextContent(expected); expect(alert).not.toHaveTextContent("RAW_PERMISSION_CODE"); }
  if (surface === "create" || surface === "template-load") expect(screen.getByRole("textbox", { name: "Survey name" })).toHaveValue(raw);
  if (surface === "import-apply") expect(screen.getByRole("textbox", { name: "AI proposal Markdown" })).toHaveValue(markdown);
  expect(request).toHaveBeenCalledTimes(count); expect(count).toBe(surface === "import-apply" ? 2 : 1); expect(onCreated).not.toHaveBeenCalled(); act(() => setLocale("zh-CN")); for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent(kind === "conflict" ? surveyRuntimeMessages.conflict : httpFailureText(403, "zh-CN")); expect(request).toHaveBeenCalledTimes(count);
});

it("renders a typed project-link permission failure without exposing its internal code or changing the import draft", async () => {
  const title = "原项目导入 {count}", markdown = "# 原模型标题\n\n## feedback [open]\n原项目问题 {name}\n";
  let created: ReturnType<typeof SurveyRuntimeSchema.parse> | undefined;
  request.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === "/surveys/markdown-proposals") return SurveyMarkdownProposalSchema.parse({ markdown, execution: { id: "85f6e172-8b43-4a75-a917-0e91742d1e8c", provider: "configured", modelId: "raw-model", generatedAt: "2026-11-04T00:00:00.000Z" }, source: { kind: "text", sha256: "a".repeat(64) } });
    if (path === "/surveys" && options?.method === "POST") { created = SurveyRuntimeSchema.parse({ ...SurveyDraftInputSchema.parse(options.body), id: "80fad4fd-88f7-4e26-a58b-0bc1b14d9ad7", version: 1, status: "draft", anonymity: "anonymous", answerRevision: 0, updatedAt: "2026-11-04T00:00:00.000Z", responses: [], publication: null, report: null, reportBasisVersion: null, reportBasisAnswerRevision: null, reportGeneratedAt: null }); return created; }
    if (created && path === `/surveys/${created.id}/source` && options?.method === "PUT") return SurveyRuntimeSchema.parse({ ...created, version: 2 });
    throw Error(`Unexpected boundary: ${path}`);
  });
  link.mockRejectedValueOnce(new ApiError(403, "CONTROLLED_PROJECT_PERMISSION", {}));
  render(<I18nProvider initialLocale="en"><Driver /><SurveyImportWorkspace draft={{ name: title, tags: [] }} projectId="raw-project" /></I18nProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Survey requirements" }), { target: { value: "原需求 {count}" } }); fireEvent.click(screen.getByRole("button", { name: "Generate survey" })); await screen.findByRole("textbox", { name: "AI proposal Markdown" }); fireEvent.click(screen.getByRole("button", { name: "Apply to survey" })); await screen.findAllByRole("alert");
  expect(link).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(3); for (const alert of screen.getAllByRole("alert")) { expect(alert).toHaveTextContent(httpFailureText(403, "en")); expect(alert).not.toHaveTextContent("CONTROLLED_PROJECT_PERMISSION"); } expect(screen.getByRole("textbox", { name: "AI proposal Markdown" })).toHaveValue(markdown); act(() => setLocale("zh-CN")); for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent(httpFailureText(403, "zh-CN")); expect(link).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(3);
});
