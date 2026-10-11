import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { executeResearchRuntime, getResearchRuntime, type GuidedResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";

vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it.each(["final", "draft"])("reads a saved %s as a report without generation diagnostics", async (kind) => {
  const base = runtimeFixture("report");
  const state: GuidedResearchRuntime = { ...base, report: kind === "final" ? base.report : null,
    reportDraft: kind === "draft" ? base.report : null, completed: kind === "final", reportPartial: true, errorCode: kind === "draft" ? "RESEARCH_REPORT_QUALITY_INSUFFICIENT" : null,
    reportQualityWarnings: [{ sectionId: "o1", issues: ["Critical Evidence Mismatch: internal-only"] }],
    reportEvidenceWarnings: [{ batchIndex: 0, sourceIds: ["source1"], questionIds: ["q1"], reason: "invalid_model_evidence" }],
    reportPrevious: { title: "历史报告", createdAt: "2026-01-01T00:00:00Z", text: "", chapters: [], aliases: [], sources: base.sources, outline: base.outline, report: { ...base.report!, title: "历史报告" } },
    reportTimeline: [{ id: "validation", stage: "validation", status: "warning", attempts: 1 }],
  };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByRole("heading", { name: base.report!.title });
  expect(screen.getByTestId("research-report-history")).toHaveTextContent("历史报告");
  expect(screen.getByTestId("research-report-history").querySelectorAll('[id^="previous-"]').length).toBeGreaterThan(0);
  expect(screen.getByTestId(kind === "final" ? "research-report-document" : "research-report-preview-text").querySelectorAll('[data-testid="research-report-chapter"]')).toHaveLength(base.report!.sections.length);
  expect(screen.getByTestId("research-execution-timeline")).not.toHaveTextContent("Critical Evidence Mismatch");
  expect(screen.queryByTestId("research-report-evidence-warning")).not.toBeInTheDocument();
  expect(screen.queryByTestId("research-report-evidence-gap")).not.toBeInTheDocument();
  expect(screen.queryByText(/Critical Evidence Mismatch/)).not.toBeInTheDocument();
  expect(screen.queryByText(/完整草稿已生成并保存/)).not.toBeInTheDocument();
  if (kind === "draft") expect(screen.queryByRole("button", { name: "完成研究" })).not.toBeInTheDocument();
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});


it("opens the report assistant without losing entered text when collapsed", async () => {
  const state = runtimeFixture("report");
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-report-actions");
  expect(screen.queryByRole("button", { name: "修改报告" })).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "修改报告" }));
  const input = screen.getByRole("textbox", { name: "研究对话" });
  fireEvent.change(input, { target: { value: "请补充结论" } });
  fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "收起助手" }));
  expect(screen.queryByRole("textbox",{name:"研究对话"})).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: "修改报告" }));
  expect(screen.getByRole("textbox", { name: "研究对话" })).toHaveValue("请补充结论");
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("keeps internal quality diagnostics out of the report and its exports", async () => {
  const state = { ...runtimeFixture("report"), completed: true,
    publicationReadiness: { status: "limited" as const, blockers: ["核心问题覆盖不足"], warnings: [], evaluatedAt: "2026-10-08T00:00:00Z" },
    qualityScore: { citationCoverage: 67.5, authority: 90.3, recency: 100, crossValidation: 57.5, openGapCount: 1, overall: 80, explanations: [] } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-report-document");
  expect(screen.queryByText("核心问题覆盖不足")).not.toBeInTheDocument();
  expect(screen.queryByText("发布质量门")).not.toBeInTheDocument();
  expect(screen.queryByText(/带限制完成/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载 Word" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "导出 PDF" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "更多操作" })).toBeEnabled();
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});

it("preserves report primary actions instead of hiding them with the completion label", async () => {
  const state = { ...runtimeFixture("report"), completed: false };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  await screen.findByTestId("research-report-actions");
  const action = screen.getByRole("button", { name: "完成研究" });
  expect(action.closest(".hidden")).toBeNull();
  expect(action).toBeEnabled();
});

 it("keeps the previous formal report readable while regeneration has no current content", async () => {
  const base = runtimeFixture("report");
  const state = { ...base, busy: true, completed: false, report: null, reportDraft: null, leaseUntil: "2099-01-01T00:00:00Z",
    reportPrevious: { title: "上一版正式报告", createdAt: "2026-01-01T00:00:00Z", text: "", chapters: [], aliases: [], sources: base.sources, outline: base.outline, report: { ...base.report!, title: "上一版正式报告" } } };
  vi.mocked(getResearchRuntime).mockResolvedValue(state);
  render(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  const history = await screen.findByTestId("research-report-history");
  expect(history).toHaveAttribute("open");
  expect(history).toHaveTextContent("上一版正式报告");
  expect(history.querySelectorAll('[data-testid="research-report-chapter"]')).toHaveLength(base.report!.sections.length);
  expect(screen.queryByTestId("research-report-document")).not.toBeInTheDocument();
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
