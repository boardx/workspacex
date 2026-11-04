import { SurveyMarkdownProposalSchema } from "@repo/contracts/survey-markdown-proposal";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SurveyDraftInputSchema, SurveyRuntimeSchema, SurveySourceSaveCommandSchema, type SurveyRuntime, type SurveySourceSaveCommand } from "@repo/contracts/survey-runtime";
import { serializeSurveyReportTemplateMarkdown } from "@repo/contracts/survey-source";
import { ApiError } from "@/lib/api-client";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { SurveySystemError } from "@/lib/survey/runtime-client";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { SurveyImportWorkspace } from "@/components/survey/live/survey-import-workspace";
const request = vi.hoisted(() => vi.fn()), replace = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/survey/runtime-client")>(), surveyRequest: request }));
vi.mock("@/lib/live-personal-transcriptions", () => ({ listPersonalTranscriptions: vi.fn().mockResolvedValue([]) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
beforeEach(() => { request.mockReset(); replace.mockReset(); sessionStorage.clear(); });
afterEach(cleanup);
it("retries a failed source save in another locale using the already-created entity and its original report default identity", async () => {
  const title = "原导入重试 {count}", markdown = "# 原模型标题 {name}\n\n## feedback [open]\n原问题 {count}\n", sourceBodies: SurveySourceSaveCommand[] = [];
  let created: SurveyRuntime | undefined, creates = 0, reads = 0;
  function persisted() { if (!created) throw Error("Expected the real created-response shape first"); return created; }
  request.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === "/surveys/markdown-proposals") return SurveyMarkdownProposalSchema.parse({ markdown, execution: { id: "85f6e172-8b43-4a75-a917-0e91742d1e8c", provider: "configured", modelId: "raw-model", generatedAt: "2026-11-04T00:00:00.000Z" }, source: { kind: "text", sha256: "a".repeat(64) } });
    if (path === "/surveys" && options?.method === "POST") { creates++; const input = SurveyDraftInputSchema.parse(options.body); created = SurveyRuntimeSchema.parse({ ...input, id: "37e1afe2-9abd-48ad-90ae-ecdb5f7ce8aa", version: 1, status: "draft", anonymity: "anonymous", answerRevision: 0, updatedAt: "2026-11-04T00:00:00.000Z", responses: [], publication: null, report: null, reportBasisVersion: null, reportBasisAnswerRevision: null, reportGeneratedAt: null }); return created; }
    if (path === `/surveys/${persisted().id}` && !options?.method) { reads++; return persisted(); }
    if (path === `/surveys/${persisted().id}/source` && options?.method === "PUT") { sourceBodies.push(SurveySourceSaveCommandSchema.parse(options.body)); if (sourceBodies.length === 1) throw new SurveySystemError(surveyRuntimeMessages.network, { cause: new ApiError(403, "CONTROLLED_SOURCE_PERMISSION", {}) }); return SurveyRuntimeSchema.parse({ ...persisted(), version: 2 }); }
    throw Error(`Unexpected request boundary: ${path}`);
  });
  render(<I18nProvider initialLocale="en"><Driver /><SurveyImportWorkspace draft={{ name: title, tags: ["原标签"] }} projectId={null} /></I18nProvider>); fireEvent.change(screen.getByRole("textbox", { name: "Survey requirements" }), { target: { value: "原需求 {name}" } }); fireEvent.click(screen.getByRole("button", { name: "Generate survey" })); await screen.findByRole("textbox", { name: "AI proposal Markdown" }); fireEvent.click(screen.getByRole("button", { name: "Apply to survey" })); await screen.findAllByRole("alert"); expect(creates).toBe(1); expect(reads).toBe(0); const first = structuredClone(persisted()); expect(first.template.title).toBe(`${title} analysis report`); expect(sourceBodies[0]!.documents.reportTemplate).toBe(serializeSurveyReportTemplateMarkdown(first.template));
  const count = request.mock.calls.length; act(() => setLocale("zh-CN")); expect(screen.getByRole("textbox", { name: "AI 提案 Markdown" })).toHaveValue(markdown); expect(request).toHaveBeenCalledTimes(count); fireEvent.click(screen.getByRole("button", { name: "应用到问卷" })); await waitFor(() => expect(replace).toHaveBeenCalledWith(`/studio/survey/${first.id}/design`)); expect(creates).toBe(1); expect(reads).toBe(1); expect(sourceBodies).toHaveLength(2); expect(sourceBodies[1]!.expectedVersion).toBe(first.version); expect(sourceBodies[1]!.documents.reportTemplate).toBe(serializeSurveyReportTemplateMarkdown(first.template)); expect(persisted()).toEqual(first);
});
