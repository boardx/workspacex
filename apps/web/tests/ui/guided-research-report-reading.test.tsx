import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  expect(screen.getByTestId("research-report-history")).not.toHaveAttribute("open");
  expect(screen.getByTestId(kind === "final" ? "research-report-document" : "research-report-preview-text").querySelectorAll('[data-testid="research-report-chapter"]')).toHaveLength(base.report!.sections.length);
  expect(screen.queryByTestId("research-report-timeline")).not.toBeInTheDocument();
  expect(screen.queryByTestId("research-report-evidence-warning")).not.toBeInTheDocument();
  expect(screen.queryByTestId("research-report-evidence-gap")).not.toBeInTheDocument();
  expect(screen.queryByText(/Critical Evidence Mismatch/)).not.toBeInTheDocument();
  expect(screen.queryByText(/完整草稿已生成并保存/)).not.toBeInTheDocument();
  if (kind === "draft") expect(screen.queryByRole("button", { name: "完成研究" })).not.toBeInTheDocument();
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
