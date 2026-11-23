import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), legacyPrint: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-print-preview", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-print-preview")>(), previewAidtPdf: mocks.preview }));
vi.mock("@/lib/research-report-export", async original => ({ ...await original<typeof import("@/lib/research-report-export")>(), printResearchPdf: mocks.legacyPrint }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => null }));
vi.mock("@/features/aidt/components/aidt-discovery-cards", () => ({ AidtDiscoveryCards: () => null }));
vi.mock("@/features/aidt/components/aidt-research-material", () => ({ AidtResearchMaterialControl: () => null, AidtResearchMaterialPreview: () => null }));
beforeEach(() => { vi.clearAllMocks(); mocks.preview.mockReset().mockResolvedValue("cancelled"); });
afterEach(() => { vi.restoreAllMocks(); });
function Stage({ initial, readOnly = false, projectId = "p" }: { initial?: AidtUiStageDraft; readOnly?: boolean; projectId?: string }) {
  const [draft, update] = React.useState(initial ?? { ...emptyAidtUiDrafts()[2]!, fields: { guide: "原稿：你是不是喜欢排队？", adoptedGuide: "1. 请讲一次最近排队的经历。\n2. 当时你看到了什么？ <script>只作文字</script>" } });
  return <><AidtStageOutput projectId={projectId} step={AIDT_STEPS[1]!} draft={draft} update={mutate => update(old => mutate(old))} readOnly={readOnly} toolHref={() => "#"} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
}
it("requires an explicit adopted list and never substitutes the student's original guide", () => {
  render(<Stage initial={{ ...emptyAidtUiDrafts()[2]!, fields: { guide: "只有学生原稿", adoptedGuide: "  " } }} />);
  expect(screen.getByTestId("aidt-interview-guide-print")).toBeDisabled(); expect(screen.getByTestId("aidt-interview-guide-preview-toggle")).toBeDisabled();
  expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.legacyPrint).not.toHaveBeenCalled(); expect(screen.getByLabelText("访谈 / 观察提纲")).toHaveValue("只有学生原稿");
});
it("previews original and adopted drafts separately, passing only exact adopted text to the real preview boundary", async () => {
  render(<Stage />); fireEvent.click(screen.getByTestId("aidt-interview-guide-preview-toggle"));
  const preview = screen.getByTestId("aidt-interview-guide-preview"); expect(preview).toHaveTextContent("请讲一次最近排队的经历"); expect(preview).not.toHaveTextContent("你是不是喜欢排队"); expect(preview.querySelector("script")).toBeNull();
  expect(mocks.preview).not.toHaveBeenCalled(); fireEvent.click(screen.getByTestId("aidt-interview-guide-print")); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const article = mocks.preview.mock.calls[0]![0] as HTMLElement;
  expect(article).toHaveTextContent("<script>只作文字</script>"); expect(article).not.toHaveTextContent("你是不是喜欢排队"); expect(article.querySelector("script")).toBeNull();
  expect(article.querySelector("pre")?.textContent).toBe((screen.getByLabelText("采纳建议后的问题清单") as HTMLTextAreaElement).value);
  expect(await screen.findByTestId("aidt-interview-guide-status")).toHaveTextContent("已关闭打印预览，清单未改变");
  expect(screen.getByTestId("aidt-interview-guide-status")).not.toHaveTextContent("已保存PDF"); expect(mocks.legacyPrint).not.toHaveBeenCalled();
});
it("keeps both drafts and the inline preview after a preview failure and supports an explicit retry", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("preview blocked")); render(<Stage />); const before = screen.getByTestId("draft").textContent;
  fireEvent.click(screen.getByTestId("aidt-interview-guide-print")); await waitFor(() => expect(screen.getByTestId("aidt-interview-guide-status")).toHaveTextContent("未能打开"));
  expect(screen.getByTestId("aidt-interview-guide-preview")).toBeVisible(); expect(screen.getByTestId("draft").textContent).toBe(before); expect(screen.getByTestId("aidt-interview-guide-print")).toBeEnabled();
  fireEvent.click(screen.getByTestId("aidt-interview-guide-print")); await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("draft").textContent).toBe(before); expect(mocks.legacyPrint).not.toHaveBeenCalled();
});
it("allows read-only preview without modifying either form field or directly opening system print", async () => {
  render(<Stage readOnly />); expect(screen.getByLabelText("访谈 / 观察提纲")).toBeDisabled(); expect(screen.getByLabelText("采纳建议后的问题清单")).toBeDisabled();
  const before = screen.getByTestId("draft").textContent; fireEvent.click(screen.getByTestId("aidt-interview-guide-print")); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  expect(screen.getByTestId("draft").textContent).toBe(before); expect(mocks.legacyPrint).not.toHaveBeenCalled();
});
it("invalidates a pending preview after edits A→B→A and after a project switch", async () => {
  const pending: { isCurrent: () => boolean; reject: (error: Error) => void }[] = [];
  mocks.preview.mockImplementation((_article: HTMLElement, _title: string, options: { isCurrent: () => boolean }) => new Promise<"cancelled">((_resolve, reject) => { pending.push({ isCurrent: options.isCurrent, reject }); }));
  const view = render(<Stage />); fireEvent.click(screen.getByTestId("aidt-interview-guide-print")); await waitFor(() => expect(pending).toHaveLength(1)); expect(pending[0]!.isCurrent()).toBe(true);
  const input = screen.getByLabelText("采纳建议后的问题清单") as HTMLTextAreaElement, original = input.value;
  fireEvent.change(input, { target: { value: "学生新修订" } }); fireEvent.change(input, { target: { value: original } }); expect(pending[0]!.isCurrent()).toBe(false);
  await act(async () => pending[0]!.reject(new Error("stale preview"))); expect(screen.getByTestId("aidt-interview-guide-status")).toHaveTextContent("已变化");
  fireEvent.click(screen.getByTestId("aidt-interview-guide-print")); await waitFor(() => expect(pending).toHaveLength(2)); expect(pending[1]!.isCurrent()).toBe(true);
  view.rerender(<Stage projectId="other" />); expect(pending[1]!.isCurrent()).toBe(false);
  await act(async () => pending[1]!.reject(new Error("project changed"))); expect(mocks.legacyPrint).not.toHaveBeenCalled();
});
