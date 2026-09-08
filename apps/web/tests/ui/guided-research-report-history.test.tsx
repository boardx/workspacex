import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { GuidedResearchReportHistory, GuidedResearchEvidenceWarning } from "@/components/research-studio/guided-research-report-history";
import { GuidedResearchReportDocument } from "@/components/research-studio/guided-research-report-document";
import { researchReportDocument, researchReportMarkdown } from "@/lib/research-report-document";
import { executeResearchRuntime, getResearchRuntime } from "@/lib/guided-research-api";
import { runtimeFixture } from "../guided-runtime-fixture";
vi.mock("@/lib/guided-research-api", () => ({ getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const initial = runtimeFixture("report");
const previous = { title: "上一轮研究", createdAt: "2026-09-08T01:00:00Z", report: null, text: '{"sections":[{"sectionId":"o1","body":"旧结论[[source:S1]]', chapters: [], sources: initial.sources, outline: initial.outline, aliases: [{ alias: "S1", sourceId: "source1" }] };
describe("continuous report history", () => {
  it("restores a historical draft on a blank restarted generation without replaying a command", async () => {
    vi.mocked(getResearchRuntime).mockResolvedValue({ ...initial, report: null, busy: true, leaseUntil: "2099-01-01T00:00:00Z", reportPrevious: previous, sources: [] });
    render(<GuidedResearchLive sessionId={initial.sessionId} onBack={vi.fn()} />);
    const history = await screen.findByTestId("research-report-history");
    expect(history).toHaveAttribute("open");
    expect(within(history).getByText(/旧结论/)).toBeVisible();
    expect(history).toHaveTextContent("历史内容，仅供查看");
    expect(within(history).getByTestId("research-inline-citation")).toHaveAttribute("href", initial.sources[0]!.url);
    expect(within(history).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-report")).not.toBeInTheDocument();
    expect(executeResearchRuntime).not.toHaveBeenCalled();
  });
  it("opens history after failure even when the current draft has content and preserves saved chapters", () => {
    render(<GuidedResearchReportHistory state={{ ...initial, report: null, errorCode: "RESEARCH_MODEL_UNAVAILABLE", reportStream: { requestId: "r", sequence: 1, status: "failed", text: '{"summary":"当前未完成' }, reportPrevious: { ...previous, chapters: [{ sectionId: "o1", body: "上一轮已校验章节", sourceIds: ["source1"] }] } }} />);
    expect(screen.getByTestId("research-report-history")).toHaveAttribute("open");
    expect(screen.getByText("上一轮已校验章节")).toBeVisible();
    expect(screen.queryByText(/旧结论/)).not.toBeInTheDocument();
  });
  it("keeps completed current and previous documents separate with unique navigation targets", () => {
    const document = researchReportDocument(initial.report!, initial.sources, initial.outline);
    const { container } = render(<><GuidedResearchReportDocument document={document} /><GuidedResearchReportHistory state={{ ...initial, reportPrevious: { ...previous, report: initial.report! } }} /></>);
    const history = screen.getByTestId("research-report-history");
    expect(history).not.toHaveAttribute("open");
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    const toc = within(history).getByRole("navigation", { name: "报告目录" });
    const link = within(toc).getByRole("link", { name: "1. 政策章节" });
    expect(link).toHaveAttribute("href", "#previous-research-report-section-0");
    expect(container.querySelector(link.getAttribute("href")!)).toBeInTheDocument();
  });
  it("preserves original coverage limitations independently of current report warnings", () => {
    render(<GuidedResearchReportHistory state={{ ...initial, reportPartial: false, reportEvidenceWarnings: [], reportPrevious: { ...previous, report: initial.report!, partial: true, evidenceWarnings: [{ batchIndex: 0, sourceIds: ["source1"], questionIds: ["q1"], reason: "invalid_model_evidence" }] } }} />);
    const history = screen.getByTestId("research-report-history");
    expect(within(history).getByTestId("previous-report-evidence-gap")).toHaveTextContent("部分检索任务未成功");
    expect(within(history).getByTestId("previous-report-evidence-warning")).toHaveTextContent("上一轮有 1 批证据包含未通过校验的内容，已排除无效部分");
    expect(within(history).getByTestId("previous-report-evidence-warning")).toHaveTextContent("证据覆盖可能不完整");
  });
  it("retains evidence coverage warning after completion and in Markdown export", () => {
    const warnings = [{ batchIndex: 0, sourceIds: ["source1"], questionIds: ["q1"], reason: "invalid_model_evidence" as const }];
    const { rerender } = render(<GuidedResearchEvidenceWarning state={{ ...initial, report: null, busy: true, reportEvidenceWarnings: warnings }} />);
    expect(screen.getByTestId("research-report-evidence-warning")).toHaveTextContent("有 1 批证据包含未通过校验的内容，已排除无效部分");
    expect(screen.getByTestId("research-report-evidence-warning")).toHaveTextContent("继续使用其余有效证据生成");
    rerender(<GuidedResearchEvidenceWarning state={{ ...initial, reportEvidenceWarnings: warnings }} />);
    expect(screen.getByTestId("research-report-evidence-warning")).toHaveTextContent("证据覆盖可能不完整");
    expect(screen.getByTestId("research-report-evidence-warning")).toHaveTextContent("报告基于其余有效证据生成");
    const markdown = researchReportMarkdown(researchReportDocument(initial.report!, initial.sources, initial.outline), false, warnings.length);
    expect(markdown).toContain("有 1 批证据包含未通过校验的内容，已排除无效部分");
    expect(markdown).toContain("证据覆盖可能不完整");
    expect(markdown).toContain("## 1. 政策章节");
  });
});
