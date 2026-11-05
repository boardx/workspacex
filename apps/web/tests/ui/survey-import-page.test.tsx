import { SurveyDraftInputSchema, SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SurveyImportPage from "@/app/studio/survey/new/import/page";

const request = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const markdown = "# 客户调研\n\n## recent [open]\n请描述最近一次体验\n";
const proposal = {
  markdown,
  execution: { id: "85f6e172-8b43-4a75-a917-0e91742d1e8c", provider: "configured", modelId: "real", generatedAt: "2026-09-28T00:00:00.000Z" },
  source: { kind: "text", sha256: "a".repeat(64) },
};

beforeEach(() => { request.mockReset(); replace.mockReset(); window.sessionStorage.clear(); });

it("creates a real draft only after the corrected Markdown proposal is applied", async () => {
  const createdId = "37e1afe2-9abd-48ad-90ae-ecdb5f7ce8aa";
  let created: SurveyRuntime;
  request.mockResolvedValueOnce(proposal).mockImplementationOnce(async (_path: string, options: { body: unknown }) =>
    created = SurveyRuntimeSchema.parse({
      ...SurveyDraftInputSchema.parse(options.body), id: createdId, version: 1,
      status: "draft", anonymity: "anonymous", answerRevision: 0,
      updatedAt: "2026-11-04T00:00:00.000Z", responses: [], publication: null,
      report: null, reportBasisVersion: null, reportBasisAnswerRevision: null, reportGeneratedAt: null,
    }),
  ).mockImplementationOnce(async () => SurveyRuntimeSchema.parse({ ...created, version: 2 }));
  render(<SurveyImportPage searchParams={{ draft: JSON.stringify({ name: "客户调研", tags: ["客户"] }) }} />);
  expect(screen.getByRole("heading", { name: "创建问卷" })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "问卷需求" }), { target: { value: "了解客户体验" } });
  fireEvent.click(screen.getByRole("button", { name: "生成问卷" }));
  const editor = await screen.findByRole("textbox", { name: "AI 提案 Markdown" });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.change(editor, { target: { value: markdown.replace("最近一次体验", "具体建议") } });
  fireEvent.click(screen.getByRole("button", { name: "应用到问卷" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith(`/studio/survey/${createdId}/design`));
  expect(request).toHaveBeenCalledWith("/surveys", expect.objectContaining({ method: "POST", body: expect.objectContaining({ title: "客户调研", tags: ["客户"], questions: [expect.objectContaining({ title: "请描述具体建议" })] }) }), expect.anything());
  expect(request).toHaveBeenCalledWith(`/surveys/${createdId}/source`, expect.objectContaining({ method: "PUT", body: expect.objectContaining({ documents: expect.objectContaining({ design: expect.stringContaining("具体建议") }) }) }), expect.anything());
});

it("keeps a correctable proposal after import page refresh", async () => {
  request.mockResolvedValueOnce(proposal);
  const props = { searchParams: { draft: JSON.stringify({ name: "客户调研", tags: [] }) } };
  const first = render(<SurveyImportPage {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "问卷需求" }), { target: { value: "了解客户体验" } });
  fireEvent.click(screen.getByRole("button", { name: "生成问卷" }));
  const editor = await screen.findByRole("textbox", { name: "AI 提案 Markdown" });
  fireEvent.change(editor, { target: { value: markdown.replace("最近一次体验", "具体建议") } });
  first.unmount();
  render(<SurveyImportPage {...props} />);
  expect((await screen.findByRole("textbox", { name: "AI 提案 Markdown" }) as HTMLTextAreaElement).value).toContain("具体建议");
});
