import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuidedResearchQualityDraft } from "@/components/research-studio/guided-research-quality-draft";
import { GuidedResearchReportTimeline } from "@/components/research-studio/guided-research-report-timeline";
import { runtimeFixture } from "../guided-runtime-fixture";

describe("report drafts with quality issues", () => {
  it("shows every saved chapter and actionable issues without claiming final approval", () => {
    const base = runtimeFixture("report");
    const state = { ...base, report: null, reportDraft: base.report, busy: false, completed: false,
      reportQualityWarnings: [{ sectionId: base.outline[0]!.id, issues: ["需要补充政策适用范围证据"] }],
      reportTimeline: [{ id: "validation", stage: "validation" as const, status: "warning" as const, attempts: 1 }] };
    render(<><GuidedResearchQualityDraft state={state} /><GuidedResearchReportTimeline state={state} /></>);
    expect(screen.getByTestId("research-quality-draft")).toHaveTextContent("完整草稿已生成并保存");
    expect(screen.getByTestId("research-quality-draft")).toHaveTextContent("需要补充政策适用范围证据");
    expect(screen.getAllByTestId("research-report-chapter")).toHaveLength(base.report!.sections.length);
    expect(screen.queryByTestId("research-report-document")).not.toBeInTheDocument();
    expect(screen.queryByText("报告已生成并保存。")).not.toBeInTheDocument();
    expect(screen.getByTestId("research-report-timeline")).toHaveTextContent("已生成，待质量核验");
  });
});
