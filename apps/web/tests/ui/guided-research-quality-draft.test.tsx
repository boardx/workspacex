import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuidedResearchQualityDraft } from "@/components/research-studio/guided-research-quality-draft";
import { GuidedResearchReportTimeline } from "@/components/research-studio/guided-research-report-timeline";
import { runtimeFixture } from "../guided-runtime-fixture";

describe("report drafts with quality issues", () => {
  it("shows saved report content without internal quality diagnostics", () => {
    const base = runtimeFixture("report");
    const state = { ...base, report: null, reportDraft: base.report, busy: false, completed: false,
      reportQualityWarnings: [{ sectionId: base.outline[0]!.id, issues: ["Critical Evidence Mismatch: internal review", "需要补充政策适用范围证据"] }],
      reportTimeline: [{ id: "validation", stage: "validation" as const, status: "warning" as const, attempts: 1 }] };
    render(<><GuidedResearchQualityDraft state={state} /><GuidedResearchReportTimeline state={state} /></>);
    expect(screen.getByTestId("research-quality-draft")).not.toHaveTextContent("完整草稿已生成并保存");
    expect(screen.getByTestId("research-quality-draft")).not.toHaveTextContent("Critical Evidence Mismatch");
    expect(screen.getByTestId("research-report-preview-text")).not.toHaveTextContent("需要补充政策适用范围证据");
    expect(screen.getAllByTestId("research-report-chapter")).toHaveLength(base.report!.sections.length);
    expect(screen.queryByTestId("research-report-document")).not.toBeInTheDocument();
    expect(screen.queryByText("报告已生成并保存。")).not.toBeInTheDocument();
    expect(screen.getByTestId("research-report-timeline")).toHaveTextContent("已生成，待质量核验");
  });
  it("does not render stale review diagnostics without a saved draft", () => {
    const state = { ...runtimeFixture("report"), reportQualityWarnings: [{ sectionId: "o1", issues: ["internal review"] }] };
    const { container } = render(<GuidedResearchQualityDraft state={state} />);
    expect(container).toBeEmptyDOMElement();
  });
});
